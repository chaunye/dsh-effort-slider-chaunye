// smoke.mjs - drive the client bundle's component without a browser.
//
// The bundle is a classic script that only expects three things from its host:
// a `window.__ModuleLoader__` to register with, a `require` that can produce
// React, and a per-session model directory service. This harness supplies a
// micro hook runtime for the first two and a hand-rolled store for the third,
// so the component's real logic (level resolution, gesture commits, degenerate
// branches, expansion lifecycle) runs for real before the bundle touches a live
// profile.
//
// Run: node tools/smoke.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(dir, 'client.js'), 'utf8')

// --- capture the module registration ---------------------------------------
let registration = null
const windowListeners = new Map()
globalThis.window = {
  __ModuleLoader__: { load: (value) => { registration = value } },
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set())
    windowListeners.get(type).add(fn)
  },
  removeEventListener: (type, fn) => { windowListeners.get(type)?.delete(fn) },
}
// Minimal document stub: the component binds a capture-phase pointerdown and a
// keydown listener while the card is open and releases both on collapse, and it
// portals the card into document.body.
const documentListeners = new Map()
globalThis.document = {
  body: { nodeType: 1 },
  addEventListener: (type, fn) => {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set())
    documentListeners.get(type).add(fn)
  },
  removeEventListener: (type, fn) => { documentListeners.get(type)?.delete(fn) },
}
// Classic script semantics: evaluate the bundle as a program.
new Function(source)()
if (registration === null) throw new Error('the bundle did not register with the module loader')
// The registered id must equal the package name (the module-table key); the
// manifest is the single source of truth so a rename cannot drift.
const expectedId = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
if (registration.id !== expectedId) throw new Error(`registered id ${registration.id} does not match the package name ${expectedId}`)
if (typeof registration.factory !== 'function') throw new Error('the registration has no factory')

// --- micro React ------------------------------------------------------------
function createHookRuntime() {
  let hooks = []
  let cursor = 0
  let pendingEffects = []
  let cleanups = []

  const schedule = () => { scheduled = true }
  let scheduled = false

  const React = {
    createElement(type, props, ...children) {
      const kids = children.length === 0 ? undefined : (children.length === 1 ? children[0] : children)
      return { type, props: { ...(props ?? {}), children: kids } }
    },
    useState(initial) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      const set = (value) => {
        hooks[i] = typeof value === 'function' ? value(hooks[i]) : value
        schedule()
      }
      return [hooks[i], set]
    },
    useRef(initial) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = { current: initial }
      return hooks[i]
    },
    useEffect(fn, deps) {
      const i = cursor++
      const previous = hooks[i]
      const changed = previous === undefined || deps === undefined || deps.length !== previous.deps.length
        || deps.some((dep, index) => !Object.is(dep, previous.deps[index]))
      if (changed) {
        hooks[i] = { deps }
        pendingEffects.push(fn)
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = { subscribe, unsubscribe: undefined }
      hooks[i].subscribe = subscribe
      return getSnapshot()
    },
  }

  return {
    React,
    render(component, props) {
      cursor = 0
      pendingEffects = []
      scheduled = false
      const tree = component(props)
      for (const effect of pendingEffects) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return tree
    },
    unmount() {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

// --- tiny snapshot store ----------------------------------------------------
function createStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { value = next; for (const listener of listeners) listener() },
  }
}

// --- fixtures ---------------------------------------------------------------
const EFFORTS = [
  { id: 'off', name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High', description: 'The default balance for most tasks.' },
  { id: 'max', name: 'Max' },
]

function stateFor(overrides = {}) {
  return {
    current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'high' },
    routable: true,
    status: 'ready',
    pending: null,
    error: null,
    retainedEffort: 'High',
    failures: [],
    groups: [{
      id: 'diandian',
      name: 'diandian',
      models: [{ id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash', reasoning: { efforts: EFFORTS, defaultEffort: 'high' } }],
    }],
    ...overrides,
  }
}

// --- assertions -------------------------------------------------------------
let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS ${name}`)
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`) }
}

function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) { for (const child of node) flatten(child, out); return out }
  if (typeof node !== 'object') return out
  out.push(node)
  // A portal stands in for its children, which live under another container.
  if (node.__portal === true) { flatten(node.children, out); return out }
  flatten(node.props?.children, out)
  return out
}

function find(node, predicate) {
  return flatten(node).find(predicate)
}

/** Concatenate every string child under a node (flatten skips primitives). */
function textOf(node) {
  if (typeof node === 'string') return node
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

/** Mount the component with the given store/fixtures and return handles. */
function mount(state) {
  const runtime = createHookRuntime()
  const portals = []
  const plugin = registration.factory((spec) => {
    if (spec === 'react') return runtime.React
    if (spec === 'react-dom') {
      return {
        createPortal: (children, container) => {
          const portal = { __portal: true, children, container }
          portals.push(portal)
          return portal
        },
      }
    }
    throw new Error(`the bundle required an unexpected module: ${spec}`)
  })
  if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots')) throw new Error('plugin.inject is not the expected list')
  if (typeof plugin.apply !== 'function') throw new Error('plugin.apply is missing')

  const store = createStore(state)
  const calls = []
  const events = { active: [] }
  const injections = new Map()
  const registrations = []
  const ctx = {
    effect: (fn, name) => { const cleanup = fn(); return cleanup },
    locale: { register: (ns, dict) => { injections.set('locale:' + ns, dict); return () => {} } },
    inject: (names, callback) => { injections.set('inject:' + names.join(','), callback({ slots, modelDirectories: { directoryFor: () => directory } })) },
  }
  const slots = {
    inject: (key, callback) => { injections.set('slot:' + key, callback()); return () => {} },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  }
  const directory = {
    store,
    select: (selection) => {
      calls.push(selection)
      return Promise.resolve({ ok: true, value: undefined })
    },
  }

  plugin.apply(ctx)

  const registration$ = registrations[0]
  if (registration$ === undefined) throw new Error('the plugin registered no slot contribution')
  const face = registration$.options.inject('session-1')
  const props = {
    locked: false,
    onActiveChange: (active) => { events.active.push(active) },
    directory: face.directory,
    select: face.select,
    t: (key) => {
      const dict = injections.get('locale:effort-slider')
      return dict.zh[key] !== undefined ? dict.zh[key] : key
    },
    sessionId: 'session-1',
  }
  return {
    runtime, store, calls, events, props, portals,
    slotName: registration$.options.name,
    slotPriority: registration$.options.priority,
    render: () => runtime.render(registration$.component, props),
  }
}

// --- cases ------------------------------------------------------------------
console.log('case: model that declares no reasoning levels')
{
  const harness = mount(stateFor({
    groups: [{ id: 'diandian', name: 'diandian', models: [{ id: 'DeepSeek-V4.1-Flash', name: 'x' }] }],
  }))
  check('renders nothing', harness.render() === null)
}
{
  const harness = mount(stateFor({ groups: [] }))
  check('renders nothing while the catalog has no group', harness.render() === null)
}

console.log('case: four declared levels, current = high')
{
  const harness = mount(stateFor())
  const tree = harness.render()
  check('contributes to conversation.input.activity', harness.slotName === 'conversation.input.activity', harness.slotName)
  const chip = find(tree, (node) => node.props?.className === 'dsh-effort-chip')
  check('chip renders', chip !== undefined)
  check('chip label is the current level name', chip.props['aria-label'] === '推理等级: High', chip.props['aria-label'])
  check('chip is collapsed initially', chip.props['aria-expanded'] === false)
  check('no card while collapsed', find(tree, (node) => node.props?.className === 'dsh-effort-card') === undefined)
  check('does not claim expansion while collapsed', harness.events.active.every((value) => value === false), JSON.stringify(harness.events.active))

  chip.props.onClick()
  const expandedTree = harness.render()
  const card = find(expandedTree, (node) => node.props?.className === 'dsh-effort-card')
  check('card opens', card !== undefined)
  check('the card is portaled to document.body', harness.portals.length === 1 && harness.portals[0].container === document.body,
    `portals=${harness.portals.length}`)
  const track = find(expandedTree, (node) => node.props?.role === 'slider')
  check('track exposes the slider role with 0-based value 2/3', track.props['aria-valuenow'] === 2 && track.props['aria-valuemax'] === 3,
    `${track.props['aria-valuenow']}/${track.props['aria-valuemax']}`)
  check('track value text is the level name', track.props['aria-valuetext'] === 'High', track.props['aria-valuetext'])
  const tickTexts = flatten(expandedTree)
    .filter((node) => node.type === 'div' && typeof node.props?.children === 'string')
    .map((node) => node.props.children)
  check('tick labels cover every level, using the display override for the top one',
    ['Off', 'Low', 'High', 'Ultra'].every((name) => tickTexts.includes(name)), JSON.stringify(tickTexts))
  check('the adapter name is not shown for the overridden level', !tickTexts.includes('Max'), JSON.stringify(tickTexts))
  check('shows the level description', find(expandedTree, (node) => node.props?.className === 'dsh-effort-note')?.props.children === 'The default balance for most tasks.')
  check('hands the toolbar width over when expanded', harness.events.active.at(-1) === true, JSON.stringify(harness.events.active))

  console.log('case: keyboard stepping')
  // While the selection is in flight the control shows the optimistic value.
  track.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  const optimistic = find(harness.render(), (node) => node.props?.role === 'slider')
  check('optimistic readout moves immediately', optimistic.props['aria-valuenow'] === 3, String(optimistic.props['aria-valuenow']))
  check('the Host call is not issued synchronously', harness.calls.length === 0, `${harness.calls.length} calls`)
  await await0()
  check('ArrowRight commits exactly one selection', harness.calls.length === 1, JSON.stringify(harness.calls))
  check('commits the next level for the same route', harness.calls[0]?.reasoningEffort === 'max' && harness.calls[0]?.provider === 'diandian' && harness.calls[0]?.model === 'DeepSeek-V4.1-Flash',
    JSON.stringify(harness.calls[0]))
  check('the rename is presentation only: the wire value stays the adapter id',
    harness.calls[0]?.reasoningEffort === 'max' && !JSON.stringify(harness.calls).includes('Ultra'),
    JSON.stringify(harness.calls))

  // Once the shared store carries the new selection, the display follows it.
  harness.store.set(stateFor({ current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'max' } }))
  const settledTrack = find(harness.render(), (node) => node.props?.role === 'slider')
  check('settled readout follows the shared store', settledTrack.props['aria-valuenow'] === 3, String(settledTrack.props['aria-valuenow']))
  settledTrack.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  await await0()
  check('stepping into the wall is a no-op', harness.calls.length === 1, `${harness.calls.length} calls`)

  console.log('case: pointer drag commits once, on release')
  const listeners = new Map()
  const trackElement = {
    focus() {},
    setPointerCapture() {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, width: 300, top: 0, height: 20, right: 300, bottom: 20 }),
  }
  settledTrack.props.onPointerDown({ currentTarget: trackElement, clientX: 300, pointerId: 1 })  // stop 3 (max)
  check('drag start commits nothing', harness.calls.length === 1, `${harness.calls.length} calls`)
  listeners.get('pointermove')({ clientX: 200 })   // stop 2 (high)
  listeners.get('pointermove')({ clientX: 100 })   // stop 1 (low)
  check('dragging across stops commits nothing yet', harness.calls.length === 1, `${harness.calls.length} calls`)
  const dragging = find(harness.render(), (node) => node.props?.role === 'slider')
  check('the readout previews the dragged stop', dragging.props['aria-valuenow'] === 1, String(dragging.props['aria-valuenow']))
  listeners.get('pointerup')({})
  await await0()
  check('release commits exactly one selection, for the dragged stop', harness.calls.length === 2 && harness.calls[1].reasoningEffort === 'low',
    JSON.stringify(harness.calls.slice(1)))
  check('the drag listeners are released', listeners.size === 0, [...listeners.keys()].join(','))

  console.log('case: expansion release')
  harness.runtime.unmount()
  check('unmount releases the toolbar width', harness.events.active.at(-1) === false, JSON.stringify(harness.events.active))
}

console.log('case: a failed selection surfaces the error and keeps the control usable')
{
  const harness = mount(stateFor())
  harness.props.select = () => Promise.resolve({ ok: false, error: { code: 'session/writer-held', message: 'held' } })
  const tree = harness.render()
  find(tree, (node) => node.props?.className === 'dsh-effort-chip').props.onClick()
  const track = find(harness.render(), (node) => node.props?.role === 'slider')
  track.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  await await0()
  const errored = harness.render()
  const error = find(errored, (node) => node.props?.className === 'dsh-effort-error')
  check('writer-held renders the dedicated message', error !== undefined && error.props.children.includes('另一处 DSH'), error?.props.children)
  check('the chip is still rendered after the failure', find(errored, (node) => node.props?.className === 'dsh-effort-chip') !== undefined)
}

console.log('case: a single declared level degrades to a badge')
{
  const harness = mount(stateFor({
    groups: [{ id: 'diandian', name: 'diandian', models: [{ id: 'DeepSeek-V4.1-Flash', name: 'x', reasoning: { efforts: [EFFORTS[0]], defaultEffort: 'off' } }] }],
    current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'off' },
  }))
  const tree = harness.render()
  const badge = find(tree, (node) => node.props?.className === 'dsh-effort-badge')
  const badgeText = textOf(badge)
  check('renders a read-only badge instead of a slider', badge !== undefined && badgeText.includes('Off'), badgeText)
  check('no trigger button in the degenerate case', find(tree, (node) => node.props?.className === 'dsh-effort-chip') === undefined)
}

console.log('case: the Codex spec drivers — fill colour, energy, particles, speed')
{
  // The bundle does not export internals; assert against the shipped CSS text.
  const parts = (effort) => {
    const harness = mount(stateFor({
      current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: effort },
    }))
    find(harness.render(), (node) => node.props?.className === 'dsh-effort-chip').props.onClick()
    const tree = harness.render()
    const track = find(tree, (node) => node.props?.role === 'slider')
    const fill = find(tree, (node) => node.props?.className === 'dsh-effort-fill')
    const stars = find(tree, (node) => node.props?.className === 'dsh-effort-stars')
    const starList = flatten(stars ?? tree)
      .filter((node) => node.props?.['data-ces-part'] === 'star')
      .filter((node) => node.props?.style?.display !== 'none')
    const card = find(tree, (node) => node.props?.className === 'dsh-effort-card')
    return {
      fill: fill?.props?.style?.background,
      energy: Number(track?.props?.style?.['--ces-energy']),
      stars: starList.length,
      starOpacity: stars?.props?.style?.opacity,
      border: card?.props?.style?.borderColor,
    }
  }

  const off = parts('off')
  check('the lowest level is pure blue with no energy layer',
    off.fill === 'linear-gradient(90deg,#4d93f8 0%,#4d93f8 100%)' && off.energy === 0,
    `${off.fill} energy=${off.energy}`)

  const ultra = parts('max')
  check('the top level reaches deep violet',
    ultra.fill === 'linear-gradient(90deg,#4d93f8 0%,#4c1d95 100%)', String(ultra.fill))
  check('the top level has full energy and all 22 stars',
    ultra.energy === 1 && ultra.stars === 22, `energy=${ultra.energy} stars=${ultra.stars}`)
  check('the top level card border is the full-strength violet frame',
    ultra.border === 'rgba(139,92,246,0.500)', String(ultra.border))

  const high = parts('high')
  check('the middle level is a violet blend at half energy with 11 stars',
    high.fill === 'linear-gradient(90deg,#4d93f8 0%,#9333ea 100%)' && high.energy === 0.5 && high.stars === 11,
    `${high.fill} energy=${high.energy} stars=${high.stars}`)

  check('stardust layer is invisible with no particles and fully visible at the top',
    String(off.starOpacity) === '0.000' && String(ultra.starOpacity) === '1.000',
    `off=${off.starOpacity} ultra=${ultra.starOpacity}`)

  // ⚠️ 回归锁：星尘层必须覆盖**整条轨道**（inset:0）。绑到填充宽度会让粒子
  //    只在填充段里飞 —— 中段与尾部全空（真机反馈"只有前段有动效"）。
  //    星云层例外：它就该只盖已通电的填充段。
  const css = source
  const starsRule = /\.dsh-effort-stars\{([^}]*)\}/.exec(css)
  check('the stardust layer spans the whole track, not the fill width',
    starsRule !== null && starsRule[1].includes('inset:0') && !starsRule[1].includes('width:calc'),
    starsRule === null ? '(rule not found)' : starsRule[1].slice(0, 90))
  const nebulaRule = /\.dsh-effort-nebula\{([^}]*)\}/.exec(css)
  check('the nebula still covers only the filled segment (by design)',
    nebulaRule !== null && nebulaRule[1].includes('width:calc'),
    nebulaRule === null ? '(rule not found)' : nebulaRule[1].slice(0, 90))
}

console.log('case: the fill and knob share the inset coordinate and ride the draft')
{
  const harness = mount(stateFor({ current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'off' } }))
  const chip = find(harness.render(), (node) => node.props?.className === 'dsh-effort-chip')
  chip.props.onClick()
  const tree = harness.render()
  const track = find(tree, (node) => node.props?.role === 'slider')
  const knob = find(tree, (node) => node.props?.className === 'dsh-effort-knob')
  check('the knob is rendered and positioned via the shared inset CSS variable',
    knob !== undefined && knob.style === undefined && track.props.style['--pct'] === '0.0000',
    `pct=${track.props.style['--pct']}`)

  console.log('case: pointer drag is continuous and snaps on release')
  const listeners = new Map()
  const trackElement = {
    focus() {},
    setPointerCapture() {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, width: 300, top: 0, height: 28, right: 300, bottom: 28 }),
  }
  track.props.onPointerDown({ currentTarget: trackElement, clientX: 14, pointerId: 1 })
  const midDrag = find(harness.render(), (node) => node.props?.role === 'slider')
  check('the draft position drives the knob continuously (14px → pct 0)',
    midDrag.props.style['--pct'] === '0.0000', String(midDrag.props.style['--pct']))
  listeners.get('pointermove')({ clientX: 150 })
  const halfway = find(harness.render(), (node) => node.props?.role === 'slider')
  const midPct = Number(halfway.props.style['--pct'])
  check('mid-drag lands between stops (continuous, not snapped)',
    midPct > 0.3 && midPct < 0.7, String(midPct))
  listeners.get('pointermove')({ clientX: 286 })  // right inset edge
  listeners.get('pointerup')({})
  // Read synchronously, before the micro-task queue clears the optimistic
  // pending state: with a real RPC the pending window is visible, but here the
  // fake select resolves inside one micro-task.
  const optimistic = find(harness.render(), (node) => node.props?.role === 'slider')
  check('release snaps to the nearest level (pct 1, optimistic)',
    optimistic.props.style['--pct'] === '1.0000', String(optimistic.props.style['--pct']))
  await await0()
  check('release commits exactly one selection (the top level)',
    harness.calls.length === 1 && harness.calls[0].reasoningEffort === 'max',
    JSON.stringify(harness.calls))
  harness.store.set(stateFor({ current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'max' } }))
  const settled = find(harness.render(), (node) => node.props?.role === 'slider')
  check('after the store catches up, the knob stays at pct 1',
    settled.props.style['--pct'] === '1.0000', String(settled.props.style['--pct']))
}

console.log('case: lightning mode speeds animations up without touching the wire value')
{
  const harness = mount(stateFor({ current: { provider: 'diandian', model: 'DeepSeek-V4.1-Flash', reasoningEffort: 'max' } }))
  find(harness.render(), (node) => node.props?.className === 'dsh-effort-chip').props.onClick()
  const tree = harness.render()

  const bolt = find(tree, (node) => node.props?.className === 'dsh-effort-bolt')
  check('the lightning toggle renders beside the title', bolt !== undefined)
  check('it starts off (aria-pressed=false)', bolt !== undefined && bolt.props['aria-pressed'] === false)

  // OFF: stardust at the Codex-spec pace (max level → 1.5s), shimmer at 2.2s.
  const starsOff = flatten(tree).filter((node) => node.props?.['data-ces-part'] === 'star' && node.props?.style?.display !== 'none')
  const normalSeconds = starsOff.length > 0 ? parseFloat(starsOff[0].props.style.animationDuration) : null
  check('OFF: top-level stars run at the spec pace (~1.5s)',
    normalSeconds !== null && Math.abs(normalSeconds - 1.5) < 0.1, String(normalSeconds))
  const shimmerOff = find(tree, (node) => node.props?.['data-ces-part'] === 'shimmer')
  check('OFF: shimmer runs at 2.2s', shimmerOff?.props?.style?.animationDuration === undefined,
    String(shimmerOff?.props?.style?.animationDuration))

  bolt.props.onClick()
  const onTree = harness.render()
  const boltOn = find(onTree, (node) => node.props?.className === 'dsh-effort-bolt')
  check('clicking toggles it on (aria-pressed=true)', boltOn.props['aria-pressed'] === true)

  const starsOn = flatten(onTree).filter((node) => node.props?.['data-ces-part'] === 'star' && node.props?.style?.display !== 'none')
  const fastSeconds = starsOn.length > 0 ? parseFloat(starsOn[0].props.style.animationDuration) : null
  check('ON: stars run ~2.5× faster (1.5s → 0.6s)',
    fastSeconds !== null && Math.abs(fastSeconds - 0.6) < 0.1, String(fastSeconds))
  const shimmerOn = find(onTree, (node) => node.props?.['data-ces-part'] === 'shimmer')
  check('ON: shimmer speeds up too (2.2s → 0.88s)',
    shimmerOn?.props?.style?.animationDuration === (2.2 / 2.5).toFixed(2) + 's',
    String(shimmerOn?.props?.style?.animationDuration))

  // The toggle is presentation-only: no selection is written, the committed
  // effort stays exactly what it was.
  check('toggling lightning writes nothing to the Host', harness.calls.length === 0, JSON.stringify(harness.calls))
  const still = find(harness.render(), (node) => node.props?.role === 'slider')
  check('the committed effort is unchanged (aria-valuenow stays 3)',
    still.props['aria-valuenow'] === 3, String(still.props['aria-valuenow']))
}

console.log('')
if (failures === 0) console.log('smoke: all checks passed')
else console.log(`smoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

/** Let queued promise callbacks run. */
function await0() {
  return new Promise((resolve) => setImmediate(resolve))
}
