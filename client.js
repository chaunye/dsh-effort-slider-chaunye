/**
 * dsh-effort-slider — browser half.
 *
 * A reasoning-effort slider for the DSH Web composer, contributed to the
 * `conversation.input.activity` seat (single, session scope) so it sits beside
 * the model selector.
 *
 * Data path: this plugin does NOT talk to the Host itself. It reads and submits
 * through `ctx.modelDirectories`, the per-session directory the official model
 * picker also uses, so both surfaces show the same state and share its
 * generation guard, pending selection, and connection-reset handling.
 *
 * Colour: the bar's ramp is a function of the *active level*, not of position
 * alone. Its stops interpolate between the theme's own onboarding stop colours
 * (blue stops for the lowest level, violet stops for the highest), so the whole
 * bar reads blue at Off/Low, periwinkle in the middle, and almost entirely
 * violet at the top level. The theme exposes violet only inside stop *lists*,
 * which CSS cannot partially reference, so those stops are restated here and
 * interpolated in JS. `GRADIENT = 'token'` keeps the bar on the theme's blue
 * stops token regardless of level.
 *
 * Motion: a narrow light band (the ramp's own lightest stop, with an added alpha
 * suffix) sweeps along the fill every 2.4s via `transform` — compositor-friendly
 * and clearly visible; the fill width, knob position and level colour ease over
 * 200ms; the top level breathes a halo. All of it is off under
 * `prefers-reduced-motion: reduce`.
 *
 * Placement: the card is rendered through a `react-dom` portal, the same way
 * the shipped model menu renders its popover. Rendering a fixed-position card
 * inline inside the composer traps its `z-index` in the composer's stacking
 * context, where the conversation's floating controls (the scroll-to-bottom
 * slot uses `z-index: 7`) paint over it.
 *
 * Constraints this file deliberately honours:
 *   - classic script: the loader executes it and expects one call to the module
 *     loader's `load({ id, factory })` whose `id` equals the package name;
 *   - `require` is limited to the platform module table, so only `react` and
 *     `react-dom` are imported — no Harness Client package may be required;
 *   - styles render as a React element so unmounting removes them.
 */
window.__ModuleLoader__.load({
  id: 'dsh-effort-slider-chaunye',
  factory(require) {
    const React = require('react');
    const reactDom = require('react-dom');
    const h = React.createElement;

    const NS = 'effort-slider';
    const SLOT = 'conversation.input.activity';
    /**
     * Shadowing rank for the single-cell seat. Left at the default on purpose
     * so a future co-occupant collides loudly instead of silently losing its
     * UI; the Client half cannot read the row's `config` (the boot graph row
     * carries no config field), so this is a source constant documented in
     * README.md rather than a Config value.
     */
    const PRIORITY = 0;
    const CARD_WIDTH = 320;
    /** `ramp` = level-dependent ramp below; `token` = the theme's blue stops only. */
    const GRADIENT = 'ramp';
    /**
     * Display names for levels whose adapter-provided name differs from the
     * label wanted in this UI. Presentation only: the value sent on the wire is
     * still the level's own `id`. Adapters hard-code their names (the shipped
     * DeepSeek route ships `name: "Max"`), so this is the only place a rename
     * can happen — and the official model menu keeps showing the adapter name.
     */
    const LABELS = { max: 'Ultra' };
    /* Stop colours lifted from the running theme's own stop lists:
         --dsw-gradient-onboarding-blue-stops   #3964fe, #398efe, #6dccff
         --dsw-gradient-onboarding-violet-stops #2a2fb6, #8b76f6, #c5c0ff
       The violet ramp deliberately runs mid → light → mid (its own first stop is
       left out) so the top level reads purple rather than indigo. */
    const COOL_STOPS = ['#3964fe', '#398efe', '#6dccff'];
    const HOT_STOPS = ['#8b76f6', '#c5c0ff', '#8b76f6'];
    const NEUTRAL = 'var(--dsw-alias-label-caption)';
    const COOL = 'var(--dsh-effort-cool)';
    const HOT = 'var(--dsh-effort-hot)';

    const DICT = {
      zh: {
        title: '推理等级',
        effortDefault: '默认',
        badgeSingle: '推理等级：',
        errorSessionInUse: '该会话正被另一处 DSH 占用，请退出其他 DSH 后重试',
      },
      en: {
        title: 'Reasoning effort',
        effortDefault: 'Default',
        badgeSingle: 'Reasoning effort: ',
        errorSessionInUse: 'This session is held by another DSH instance — close it and retry',
      },    };

    /** Linear sRGB interpolation between two `#rrggbb` strings. */
    function mixHex(from, to, t) {
      const a = parseInt(from.slice(1), 16);
      const b = parseInt(to.slice(1), 16);
      const parts = [16, 8, 0].map((shift) => {
        const start = (a >> shift) & 255;
        const end = (b >> shift) & 255;
        return Math.round(start + (end - start) * t).toString(16).padStart(2, '0');
      });
      return '#' + parts.join('');
    }

    /**
     * The fill's gradient for one level: blue at the bottom of the scale, violet
     * at the top, interpolated per stop so the whole bar shifts hue together.
     * @param index - active level index, or -1 when nothing is selected.
     * @param count - how many levels the model declares.
     * @returns a CSS gradient string.
     */
    function rampFor(index, count) {
      if (GRADIENT === 'token') return 'linear-gradient(90deg,var(--dsw-gradient-onboarding-blue-stops))';
      const t = count <= 1 ? 1 : Math.max(0, index) / (count - 1);
      const stops = COOL_STOPS.map((cool, k) => mixHex(cool, HOT_STOPS[k], t));
      return 'linear-gradient(90deg,' + stops[0] + ' 0%,' + stops[1] + ' 50%,' + stops[2] + ' 100%)';
    }

    /** The sweeping highlight: the ramp's own lightest stop, faded at both ends. */
    function sheenFor(index, count) {
      const t = count <= 1 ? 1 : Math.max(0, index) / (count - 1);
      const light = mixHex(COOL_STOPS[1], HOT_STOPS[1], t);
      return 'linear-gradient(100deg,' + light + '00 0%,' + light + '8c 50%,' + light + '00 100%)';
    }

    /** Label shown for one level: the override when present, else the adapter's name. */
    function labelOf(level) {
      if (level === undefined) return '';
      return LABELS[level.id] !== undefined ? LABELS[level.id] : level.name;
    }

    const CSS = [
      '.dsh-effort{position:relative;display:inline-flex;align-items:center;',
      '--dsh-effort-cool:#3964fe;--dsh-effort-hot:#8b76f6}',
      '.dsh-effort-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;',
      'border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dsh-effort-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-effort-chip[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-effort-chip:disabled{opacity:.5;cursor:default}',
      '.dsh-effort-value{color:var(--dsw-alias-label-caption)}',
      '.dsh-effort-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-caption);',
      'transition:background-color 200ms ease}',
      '.dsh-effort-badge{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;',
      'color:var(--dsw-alias-label-caption);font-size:13px;line-height:20px}',
      /* The palette is declared on the card as well as on the trigger wrapper:
         the card lives in a portal under document.body, and custom properties
         do not cross that boundary, so a value declared only on .dsh-effort
         would resolve to nothing inside the card (title colour, halo). */
      '.dsh-effort-card{position:fixed;z-index:1200;box-sizing:border-box;width:320px;padding:16px 20px 16px;',
      '--dsh-effort-cool:#3964fe;--dsh-effort-hot:#8b76f6;',
      'border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);',
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:20px}',
      '.dsh-effort-title{display:block;text-align:center;font-size:15px;line-height:22px;font-weight:600;',
      'transition:color 200ms ease}',
      '.dsh-effort-sub{display:block;text-align:center;color:var(--dsw-alias-label-caption);font-size:11px;',
      'line-height:16px;margin-top:2px}',
      '.dsh-effort-track{position:relative;display:flex;align-items:center;height:20px;margin:14px 2px 0;',
      'cursor:pointer;touch-action:none}',
      '.dsh-effort-track:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:6px;',
      'border-radius:999px}',
      '.dsh-effort-empty{position:absolute;left:0;right:0;height:20px;border-radius:999px;',
      'background:var(--dsw-alias-border-l2)}',
      '.dsh-effort-fill{position:absolute;left:0;height:20px;border-radius:999px;overflow:hidden;',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);',
      'transition:width 200ms cubic-bezier(.2,.8,.2,1),background-color 200ms ease}',
      '.dsh-effort-ramp{position:absolute;inset:0;transition:background-image 200ms ease}',
      /* The band is 42% of the fill wide, so translateX(-100%) sits it exactly
         off the left edge and translateX(238%) exactly off the right one: the
         whole cycle is a visible crossing, with no dead time off screen. */
      '.dsh-effort-sheen{position:absolute;top:0;bottom:0;left:0;width:42%;pointer-events:none;',
      'animation:dsh-effort-sweep 2.4s linear infinite}',
      '@keyframes dsh-effort-sweep{from{transform:translateX(-100%)}to{transform:translateX(238%)}}',
      '.dsh-effort-knob{position:absolute;top:50%;width:26px;height:26px;margin-left:-13px;border-radius:50%;',
      'background:var(--dsw-static-neutral-00);box-shadow:0 1px 3px #00000033;transform:translateY(-50%);',
      'transition:left 200ms cubic-bezier(.2,.8,.2,1)}',
      '.dsh-effort-knob.unset{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 2px var(--dsw-alias-border-l2)}',
      '.dsh-effort-halo{position:absolute;top:50%;width:26px;height:26px;margin-left:-13px;border-radius:50%;',
      'transform:translateY(-50%);opacity:0;pointer-events:none}',
      '.dsh-effort-halo.pulsing{animation:dsh-effort-breathe 1.8s ease-in-out infinite}',
      '@keyframes dsh-effort-breathe{0%,100%{opacity:0;transform:translateY(-50%) scale(1)}',
      '50%{opacity:.28;transform:translateY(-50%) scale(1.7)}}',
      '.dsh-effort-ticks{display:flex;justify-content:space-between;color:var(--dsw-alias-label-caption);',
      'font-size:11px;line-height:16px;margin:12px 2px 0}',
      '.dsh-effort-ticks span{transition:color 200ms ease}',
      '.dsh-effort-ticks span.on{color:var(--dsw-alias-label-secondary)}',
      '.dsh-effort-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:10px;text-align:center}',
      '.dsh-effort-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:10px;text-align:center}',
      '@media (prefers-reduced-motion: reduce){',
      '.dsh-effort-fill,.dsh-effort-knob,.dsh-effort-dot,.dsh-effort-title,.dsh-effort-ticks span{transition:none}',
      '.dsh-effort-sheen{animation:none;opacity:0}.dsh-effort-halo.pulsing{animation:none}}',
    ].join('');

    /**
     * Read the current model's adapter-declared effort list out of the shared
     * directory snapshot.
     * @param state - ModelDirectoryState from the per-session directory store.
     * @returns the level list plus the adapter default, or null when the model
     *          declares no reasoning metadata — then this plugin renders nothing,
     *          because a control that cannot do what it says is worse than none.
     */
    function levelsOf(state) {
      const current = state.current;
      if (current === null || current === undefined) return null;
      const groups = Array.isArray(state.groups) ? state.groups : [];
      const group = groups.find((entry) => entry.id === current.provider);
      if (group === undefined) return null;
      const model = group.models.find((entry) => entry.id === current.model);
      const reasoning = model === undefined ? undefined : model.reasoning;
      if (reasoning === undefined || !Array.isArray(reasoning.efforts) || reasoning.efforts.length === 0) return null;
      return {
        efforts: reasoning.efforts,
        defaultEffort: reasoning.defaultEffort,
        // The catalog's display name, falling back to the wire id when the
        // current model is not (or no longer) listed.
        modelName: model !== undefined && typeof model.name === 'string' && model.name.length > 0
          ? model.name
          : current.model,
      };
    }

    /** Track percentage for one stop index. */
    function percent(index, count) {
      if (count <= 1) return '0%';
      return ((index / (count - 1)) * 100).toFixed(2) + '%';
    }

    /**
     * Colour of the chip dot and the halo for one stop.
     * @param index - position in the adapter-declared list.
     * @param count - how many levels that model declares.
     * @returns a colour reference (theme token or one of the two endpoints).
     */
    function colorFor(index, count) {
      if (index <= 0) return NEUTRAL;
      if (count === 2) return COOL;
      return index === count - 1 ? HOT : COOL;
    }

    function EffortSlider(props) {
      const { locked, onActiveChange, directory, select, t } = props;
      const state = React.useSyncExternalStore(
        (onChange) => directory.subscribe(onChange),
        () => directory.getSnapshot(),
      );
      // A throwing component blanks this slot entry, so optional props are read
      // defensively instead of assumed.
      const tr = typeof t === 'function' ? t : (key) => (DICT.en[key] !== undefined ? DICT.en[key] : key);
      const notify = (active) => { if (typeof onActiveChange === 'function') onActiveChange(active); };

      const [expanded, setExpanded] = React.useState(false);
      const [dragIndex, setDragIndex] = React.useState(null);
      const [pending, setPending] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [pos, setPos] = React.useState(null);
      const triggerRef = React.useRef(null);
      const cardRef = React.useRef(null);
      const dragRef = React.useRef(null);

      const levels = levelsOf(state);
      const hasLevels = levels !== null;
      const count = hasLevels ? levels.efforts.length : 0;

      const savedEffort = state.current !== null && state.current !== undefined
        ? state.current.reasoningEffort
        : undefined;
      const selectedId = pending !== null
        ? pending
        : (savedEffort !== undefined ? savedEffort : (hasLevels ? levels.defaultEffort : undefined));
      const selectedIndex = hasLevels ? levels.efforts.findIndex((level) => level.id === selectedId) : -1;
      const activeIndex = dragIndex !== null ? dragIndex : selectedIndex;

      // The owner hands the toolbar width to an expanded activity; release it on
      // unmount, which a slot collapse or plugin unload performs.
      React.useEffect(() => () => { notify(false); }, []);
      React.useEffect(() => { notify(expanded); }, [expanded, onActiveChange]);

      // A model switch can remove the level list while the card is open.
      React.useEffect(() => { if (!hasLevels && expanded) setExpanded(false); }, [hasLevels, expanded]);

      React.useEffect(() => {
        if (!expanded) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (cardRef.current !== null && cardRef.current.contains(target)) return;
          if (triggerRef.current !== null && triggerRef.current.contains(target)) return;
          setExpanded(false);
        };
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          setExpanded(false);
          if (triggerRef.current !== null) triggerRef.current.focus();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [expanded]);

      // The card is fixed-positioned above the chip; recompute while it is open
      // because the composer can move (window resize, transcript scroll).
      React.useEffect(() => {
        if (!expanded) { setPos(null); return undefined; }
        const measure = () => {
          const el = triggerRef.current;
          if (el === null) return;
          const rect = el.getBoundingClientRect();
          const width = cardRef.current === null ? CARD_WIDTH : cardRef.current.offsetWidth;
          setPos({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            bottom: Math.max(8, window.innerHeight - rect.top + 8),
          });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
          window.removeEventListener('resize', measure);
          window.removeEventListener('scroll', measure, true);
        };
      }, [expanded]);

      const commit = (effortId) => {
        const current = state.current;
        if (current === null || current === undefined) return;
        if (locked || typeof select !== 'function') return;
        setError(null);
        setPending(effortId);
        const selection = { provider: current.provider, model: current.model };
        if (effortId !== undefined) selection.reasoningEffort = effortId;
        Promise.resolve()
          .then(() => select(selection))
          .then((result) => {
            if (result !== undefined && result !== null && result.ok === false) {
              const code = result.error.code;
              setError(code === 'session/writer-held' ? tr('errorSessionInUse') : code + ': ' + result.error.message);
            }
          })
          .catch((failure) => {
            setError(failure !== null && failure !== undefined && failure.message ? failure.message : String(failure));
          })
          .then(() => { setPending(null); });
      };

      const indexAt = (clientX, track) => {
        const rect = track.getBoundingClientRect();
        const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
      };

      const onTrackPointerDown = (event) => {
        if (locked || !hasLevels || count < 2) return;
        const track = event.currentTarget;
        track.focus();
        track.setPointerCapture(event.pointerId);
        const start = indexAt(event.clientX, track);
        dragRef.current = start;
        setDragIndex(start);
        const onMove = (moveEvent) => {
          const next = indexAt(moveEvent.clientX, track);
          dragRef.current = next;
          setDragIndex(next);
        };
        const onUp = () => {
          track.removeEventListener('pointermove', onMove);
          track.removeEventListener('pointerup', onUp);
          track.removeEventListener('pointercancel', onUp);
          const settled = dragRef.current;
          dragRef.current = null;
          setDragIndex(null);
          // One commit per gesture: dragging across four stops must not write
          // four selections, and every write also resets the new-session default.
          if (settled !== null) commit(levels.efforts[settled].id);
        };
        track.addEventListener('pointermove', onMove);
        track.addEventListener('pointerup', onUp);
        track.addEventListener('pointercancel', onUp);
      };

      const onTrackKeyDown = (event) => {
        if (!hasLevels || count === 0) return;
        const base = selectedIndex >= 0 ? selectedIndex : -1;
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(count - 1, base + 1);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, base - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = count - 1;
        else if (event.key === 'Enter' || event.key === ' ') next = Math.max(0, base);
        else return;
        event.preventDefault();
        // Stepping into the wall, or re-committing the current level, is a no-op:
        // every commit also rewrites the profile's new-session default.
        if (next === selectedIndex) return;
        setDragIndex(next);
        commit(levels.efforts[next].id);
        setDragIndex(null);
      };

      if (!hasLevels) return null;

      const activeColor = activeIndex >= 0 ? colorFor(activeIndex, count) : NEUTRAL;
      const isTop = activeIndex >= 0 && activeIndex === count - 1;

      const icon = h('svg', {
        width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, focusable: false,
        style: { display: 'block', flex: '0 0 auto' },
      }, h('path', {
        d: 'M1 3h10M1 6h7M1 9h4', stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', fill: 'none',
      }));

      const label = activeIndex >= 0 ? labelOf(levels.efforts[activeIndex]) : tr('effortDefault');

      // One declared level is not something to slide.
      if (count < 2) {
        return h('span', { className: 'dsh-effort' },
          h('style', null, CSS),
          h('span', { className: 'dsh-effort-badge' },
            h('span', { className: 'dsh-effort-dot', style: { background: activeColor } }),
            tr('badgeSingle') + label));
      }

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-effort-chip',
        disabled: locked,
        'aria-haspopup': 'dialog',
        'aria-expanded': expanded,
        'aria-label': tr('title') + ': ' + label,
        title: tr('title'),
        onClick: () => setExpanded((open) => !open),
      },
      icon,
      h('span', { className: 'dsh-effort-dot', style: { background: activeColor } }),
      h('span', { className: 'dsh-effort-value' }, label));

      if (!expanded) {
        return h('span', { className: 'dsh-effort' }, h('style', null, CSS), trigger);
      }

      const fillWidth = activeIndex >= 0 ? percent(activeIndex, count) : '0%';

      const track = h('div', {
        className: 'dsh-effort-track',
        role: 'slider',
        tabIndex: 0,
        'aria-label': tr('title'),
        'aria-valuemin': 1,
        'aria-valuemax': count,
        ...(activeIndex >= 0 ? { 'aria-valuenow': activeIndex + 1 } : {}),
        'aria-valuetext': label,
        'aria-disabled': locked ? true : undefined,
        onPointerDown: onTrackPointerDown,
        onKeyDown: onTrackKeyDown,
      },
      h('span', { className: 'dsh-effort-empty' }),
      h('span', { className: 'dsh-effort-fill', style: { width: fillWidth } },
        h('span', { className: 'dsh-effort-ramp', style: { backgroundImage: rampFor(activeIndex, count) } }),
        h('span', { className: 'dsh-effort-sheen', style: { backgroundImage: sheenFor(activeIndex, count) } })),
      h('span', {
        className: 'dsh-effort-halo' + (isTop ? ' pulsing' : ''),
        style: { left: activeIndex >= 0 ? percent(activeIndex, count) : '0%', background: activeColor },
      }),
      h('span', {
        className: 'dsh-effort-knob' + (activeIndex >= 0 ? '' : ' unset'),
        style: { left: activeIndex >= 0 ? percent(activeIndex, count) : '0%' },
      }));

      const activeLevel = activeIndex >= 0 ? levels.efforts[activeIndex] : undefined;

      const card = h('div', {
        ref: cardRef,
        className: 'dsh-effort-card',
        role: 'dialog',
        'aria-label': tr('title'),
        style: pos === null
          ? { left: '-9999px', bottom: '0px' }
          : { left: pos.left + 'px', bottom: pos.bottom + 'px' },
      },
      h('span', { className: 'dsh-effort-title', style: { color: activeColor } }, label),
      // The small line under the level name names the model, the way the
      // reference slider does; the tick row already shows where the knob sits.
      h('span', { className: 'dsh-effort-sub' }, levels.modelName),
      track,
      h('div', { className: 'dsh-effort-ticks' },
        levels.efforts.map((level, index) => h('span', {
          key: level.id,
          className: index === activeIndex ? 'on' : undefined,
        }, labelOf(level)))),
      activeLevel !== undefined && activeLevel.description !== undefined
        ? h('div', { className: 'dsh-effort-note' }, activeLevel.description)
        : null,
      error !== null ? h('div', { className: 'dsh-effort-error', role: 'status' }, error) : null);

      // Portal the card out of the composer's stacking context, so the
      // conversation's floating controls cannot paint over it.
      return h('span', { className: 'dsh-effort' },
        h('style', null, CSS),
        trigger,
        reactDom.createPortal(card, document.body));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICT), 'effort-slider: dictionaries');
      ctx.inject(['slots', 'modelDirectories'], (scope) => {
        const models = scope.modelDirectories;
        scope.slots.inject(SLOT, () => scope.slots.register({
          name: SLOT,
          locale: NS,
          priority: PRIORITY,
          inject: (sessionId) => {
            const directory = models.directoryFor(sessionId);
            return {
              directory: directory.store,
              select: (selection) => {
                try {
                  return directory.select(selection);
                } catch (failure) {
                  return Promise.reject(failure);
                }
              },
            };
          },
        }, EffortSlider));
      });
    }

    return { inject: ['slots', 'locale', 'modelDirectories'], apply };
  },
});
