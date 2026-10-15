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
 * Look & motion (Codex power-slider spec): a 28px inset-capsule track whose
 * knob, fill edge and ticks share one coordinate `calc(14px + p*(100% - 28px))`,
 * so the knob stays a full circle at both ends. The fill runs blue → violet →
 * deep violet with the position; a purple nebula + shimmer layer and a
 * decoupled stardust layer fade in past the first third (energy 0 → 1), with
 * particle count 0 → 22 and traverse speed 0.35× → 2× (≈8.6s → 1.5s, the
 * Codex-original timing — deliberately NOT the ×4 some forks add). Stardust is
 * fully deterministic (golden-ratio phases, slot-hash heights, ±8% spread,
 * brightness = size) so re-renders never reshuffle it. Dragging is continuous
 * and snaps to the nearest level on release. The card border glows with energy.
 * Under `prefers-reduced-motion: reduce` the shimmer hides and particles slow
 * 2.6× instead of freezing.
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
 *   - styles render as a React element so unmounting removes them. Colours are
 *     theme tokens except the documented violet anchors (the theme ships violet
 *     only inside gradient stop lists, which CSS cannot partially reference).
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
    /**
     * Display names for levels whose adapter-provided name differs from the
     * label wanted in this UI. Presentation only: the value sent on the wire is
     * still the level's own `id`. Adapters hard-code their names (the shipped
     * DeepSeek route ships `name: "Max"`), so this is the only place a rename
     * can happen — and the official model menu keeps showing the adapter name.
     */
    const LABELS = { max: 'Ultra' };

    /* ── Codex power-slider geometry ──
       Track height 28px, knob rides inside it, every moving part shares the
       inset coordinate calc(R + p*(100% - KNOB)) so nothing gets clipped. */
    const TRACK_HEIGHT = 28;
    const KNOB_SIZE = 24;
    const KNOB_INSET = TRACK_HEIGHT / 2; // 14px

    /* ── colour anchors (Codex spec) ──
       #4d93f8 is the theme's own blue-450; the violet trio only exists inside
       the theme's gradient stop lists, so they are restated here (documented
       exception — see README). */
    const FILL_BLUE = '#4d93f8';
    const FILL_VIOLET = '#9333ea';
    const FILL_DEEP = '#4c1d95';
    const TEXT_VIOLET = '#8b5cf6';
    const GLOW_RGB = '168,85,247';      // knob glow (rgba)
    const CARD_RGB = '139,92,246';      // card border/shimmer halo (rgba)
    const NEUTRAL = 'var(--dsw-alias-label-caption)';

    /* ── stardust parameters (Codex spec) ── */
    const MAX_PARTICLES = 22;
    const STAR_DURATION_MEAN = 1.5;   // seconds at speed 2× (top level)
    const STAR_DURATION_SPREAD = 0.08; // ±8% anti-clustering
    const PHI = 0.6180339887498949;    // golden ratio phase sequence
    const REDUCED_SLOWDOWN = 2.6;      // prefers-reduced-motion: slow, don't freeze
    const ENERGY_START = 1 / 3;
    const ENERGY_END = 2 / 3;

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
      },
    };

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

    /** Deterministic hash in [0,1) — no Math.random, so re-renders never reshuffle. */
    function starHash01(seed) {
      const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    }

    /* ── the four continuous drivers of the spec ── */

    /** Fill's right-end colour: pure blue for the first third, then blue → violet → deep violet. */
    function fillColorFor(pct) {
      if (pct <= ENERGY_START) return FILL_BLUE;
      if (pct <= ENERGY_END) return mixHex(FILL_BLUE, FILL_VIOLET, (pct - ENERGY_START) * 3);
      return mixHex(FILL_VIOLET, FILL_DEEP, (pct - ENERGY_END) * 3);
    }

    /** Energy 0 → 1: nothing below the second stop, then linear to full at the top. */
    function energyFor(pct) {
      if (pct <= ENERGY_START) return 0;
      return Math.min(1, (pct - ENERGY_START) / (1 - ENERGY_START));
    }

    /** Stardust count 0 → 22. */
    function particleCountFor(pct) {
      return Math.round(energyFor(pct) * MAX_PARTICLES);
    }

    /** Traverse speed 0.35× → 1× → 2×. */
    function speedFor(pct) {
      if (pct <= ENERGY_START) return 0.35;
      if (pct <= ENERGY_END) return 0.35 + (pct - ENERGY_START) * 3 * 0.65;
      return 1.0 + (pct - ENERGY_END) * 3 * 1.0;
    }

    /** Level text / chip colour: Off stays neutral, everything else blue → text violet. */
    function valueColorFor(pct, isOff) {
      if (isOff) return NEUTRAL;
      return mixHex(FILL_BLUE, TEXT_VIOLET, energyFor(pct));
    }

    /** Stardust layer opacity: hidden with no particles, else 0.85 + 0.15 × energy. */
    function starLayerOpacityFor(pct) {
      return particleCountFor(pct) > 0 ? 0.85 + 0.15 * energyFor(pct) : 0;
    }

    /** Per-star traverse seconds at one position (before the ±spread). */
    function starBaseSeconds(pct) {
      return (STAR_DURATION_MEAN * 2) / speedFor(pct);
    }

    /* The 22 stardust particles, fixed forever: heights spread over 8–92% of
       the track via a salted slot hash (decoupled from the phase so no diagonal
       line), golden-ratio phases (stable across density changes), ±8% duration
       spread (fast stars do not pile onto slow ones), brightness = size. */
    const PARTICLES = Array.from({ length: MAX_PARTICLES }, (_, i) => {
      const slot = (i * 7 + 3) % MAX_PARTICLES;
      return {
        top: (8 + (slot / (MAX_PARTICLES - 1)) * 84).toFixed(1) + '%',
        brightness: (0.5 + 0.5 * starHash01(i + 101)).toFixed(3),
        phase01: ((i + 1) * PHI) % 1,
        spread01: starHash01(i + 307) * 2 - 1,
      };
    });

    /** Inset coordinate for one normalised position. */
    function knobLeft(pct) {
      return 'calc(' + KNOB_INSET + 'px + ' + Math.max(0, Math.min(1, pct)).toFixed(4) + ' * (100% - ' + TRACK_HEIGHT + 'px))';
    }

    /** Label shown for one level: the override when present, else the adapter's name. */
    function labelOf(level) {
      if (level === undefined) return '';
      return LABELS[level.id] !== undefined ? LABELS[level.id] : level.name;
    }

    const CSS = [
      '.dsh-effort{position:relative;display:inline-flex;align-items:center}',
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
         would resolve to nothing inside the card (title colour, glow). */
      '.dsh-effort-card{position:fixed;z-index:1200;box-sizing:border-box;width:320px;padding:16px 20px 16px;',
      'border:1px solid transparent;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);',
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:20px;user-select:none;-webkit-user-select:none}',
      '.dsh-effort-title{display:block;text-align:center;font-size:15px;line-height:22px;font-weight:600;',
      'transition:color 100ms ease}',
      '.dsh-effort-sub{display:block;text-align:center;color:var(--dsw-alias-label-caption);font-size:11px;',
      'line-height:16px;margin-top:2px}',
      /* ── inset capsule track: knob, fill edge and ticks share one coordinate ── */
      '.dsh-effort-track{position:relative;display:flex;align-items:center;height:' + TRACK_HEIGHT + 'px;',
      'margin:14px 2px 0;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;',
      'cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}',
      '.dsh-effort-track:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:4px;}',
      '.dsh-effort-fill{position:absolute;top:0;bottom:0;left:0;',
      'width:calc(' + KNOB_INSET + 'px + var(--pct,0) * (100% - ' + TRACK_HEIGHT + 'px));',
      'border-radius:999px 0 0 999px;pointer-events:none}',
      '.dsh-effort-nebula{position:absolute;top:0;bottom:0;left:0;',
      'width:calc(' + KNOB_INSET + 'px + var(--pct,0) * (100% - ' + TRACK_HEIGHT + 'px));',
      'opacity:var(--ces-energy,0);overflow:hidden;pointer-events:none;',
      'background:radial-gradient(120% 180% at 85% 50%,rgba(192,132,252,.45) 0%,transparent 70%),',
      'linear-gradient(90deg,rgba(77,147,248,.2),rgba(147,51,234,.75),rgba(76,29,149,.95));',
      'transition:opacity 150ms ease}',
      '.dsh-effort-shimmer{position:absolute;inset:0;pointer-events:none;',
      'background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.28) 50%,transparent 80%);',
      'transform:translateX(-100%);animation:dsh-effort-shimmer 2.2s linear infinite}',
      '@keyframes dsh-effort-shimmer{to{transform:translateX(100%)}}',
      /* Stardust rides in its own layer spanning the WHOLE track (no width
         clamp): the lane is full-width and its dot enters from the right edge,
         so stars stream right-to-left across the entire bar — including the
         unfilled middle and tail. Clamping the layer to the fill width is what
         made the middle and tail look dead. */
      '.dsh-effort-stars{position:absolute;inset:0;border-radius:999px;overflow:hidden;pointer-events:none;transition:opacity 150ms ease}',
      '.dsh-effort-star{position:absolute;left:0;right:0;height:4px;margin-top:-2px;pointer-events:none;',
      'will-change:transform,opacity;animation-name:dsh-effort-star-sweep;animation-timing-function:linear;',
      'animation-iteration-count:infinite}',
      '.dsh-effort-star__dot{position:absolute;left:100%;top:0;width:4px;height:4px;margin-left:-2px;',
      'border-radius:50%;background:#fff;box-shadow:0 0 7px rgba(216,180,254,.95),0 0 12px rgba(216,180,254,.5);',
      'opacity:var(--ces-b,1);transform:scale(var(--ces-b,1))}',
      'body[data-ds-dark-theme] .dsh-effort-star__dot{background:#f5f3ff}',
      /* Full-lane traverse with fade only at the invisible ends: stars pour out
         of the knob side and never vanish mid-track. */
      '@keyframes dsh-effort-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}',
      /* Micro ticks: reached ones brighten (they sit on the coloured fill, so
         white reads on both themes); unreached ones stay dim. */
      '.dsh-effort-tick{position:absolute;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;',
      'border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 26%,transparent);',
      'pointer-events:none;transition:background-color 150ms ease}',
      '.dsh-effort-tick[data-on="1"]{background:rgba(255,255,255,.52)}',
      '.dsh-effort-knob{position:absolute;top:50%;left:calc(' + KNOB_INSET + 'px + var(--pct,0) * (100% - ' + TRACK_HEIGHT + 'px));',
      'width:' + KNOB_SIZE + 'px;height:' + KNOB_SIZE + 'px;border-radius:50%;',
      'background:var(--dsw-static-neutral-00);transform:translate(-50%,-50%);pointer-events:none;',
      'box-shadow:0 2px 6px rgba(0,0,0,.4),0 0 10px rgba(' + GLOW_RGB + ',var(--ces-energy,0));',
      'transition:left 100ms ease}',
      '.dsh-effort-knob.unset{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 2px var(--dsw-alias-border-l2)}',
      '.dsh-effort-ticks{position:relative;height:16px;margin:6px 2px 0}',
      '.dsh-effort-ticks .dsh-effort-ticklabel{position:absolute;top:0;transform:translateX(-50%);',
      'color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap;transition:color 150ms ease}',
      '.dsh-effort-ticks .dsh-effort-ticklabel[data-on="1"]{color:var(--dsw-alias-label-secondary)}',
      '.dsh-effort-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:8px;text-align:center;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-effort-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:8px;text-align:center}',
      /* Reduced motion: hide the shimmer, slow the stars (JS ×2.6), keep the
         "energy flows" semantics instead of freezing everything. */
      '@media (prefers-reduced-motion: reduce){',
      '.dsh-effort-fill,.dsh-effort-knob,.dsh-effort-dot,.dsh-effort-title,.dsh-effort-ticks .dsh-effort-ticklabel{transition:none}',
      '.dsh-effort-shimmer{display:none}}',
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

    /** Nearest level index for one normalised position. */
    function indexFromPct(pct, count) {
      if (count <= 1) return 0;
      const safe = Math.max(0, Math.min(1, pct));
      return Math.max(0, Math.min(count - 1, Math.round(safe * (count - 1))));
    }

    /** Normalised position of one level index. */
    function pctFromIndex(index, count) {
      if (count <= 1) return 0;
      return Math.max(0, Math.min(count - 1, index)) / (count - 1);
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
      const [draftPct, setDraftPct] = React.useState(null);
      const [pending, setPending] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [pos, setPos] = React.useState(null);
      const triggerRef = React.useRef(null);
      const cardRef = React.useRef(null);
      const draftRef = React.useRef(null);

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
      const committedPct = selectedIndex >= 0 ? pctFromIndex(selectedIndex, count) : 0;

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

      // Inset pointer mapping: the knob centre travels [R, width-R].
      const pctFromPointer = (clientX, track) => {
        const rect = track.getBoundingClientRect();
        const usable = Math.max(1, rect.width - TRACK_HEIGHT);
        return Math.max(0, Math.min(1, (clientX - rect.left - KNOB_INSET) / usable));
      };

      const onTrackPointerDown = (event) => {
        if (locked || !hasLevels || count < 2) return;
        const track = event.currentTarget;
        track.focus();
        track.setPointerCapture(event.pointerId);
        const start = pctFromPointer(event.clientX, track);
        draftRef.current = start;
        setDraftPct(start);
        const onMove = (moveEvent) => {
          const next = pctFromPointer(moveEvent.clientX, track);
          draftRef.current = next;
          setDraftPct(next);
        };
        const onUp = () => {
          track.removeEventListener('pointermove', onMove);
          track.removeEventListener('pointerup', onUp);
          track.removeEventListener('pointercancel', onUp);
          const settled = draftRef.current;
          draftRef.current = null;
          setDraftPct(null);
          // Magnetic snap + one commit per gesture: dragging across four stops
          // must not write four selections (each write also resets the
          // new-session default).
          if (settled === null) return;
          const index = indexFromPct(settled, count);
          if (index !== selectedIndex) commit(levels.efforts[index].id);
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
        if (next === selectedIndex || next < 0) return;
        commit(levels.efforts[next].id);
      };

      if (!hasLevels) return null;

      // Drag preview is continuous; everything else sits exactly on a level.
      const shownPct = draftPct !== null ? draftPct : committedPct;
      const shownIndex = draftPct !== null ? indexFromPct(draftPct, count) : selectedIndex;
      const shownLevel = shownIndex >= 0 ? levels.efforts[shownIndex] : undefined;
      const isOff = shownLevel !== undefined && shownLevel.id === 'off';
      const label = shownLevel !== undefined ? labelOf(shownLevel) : tr('effortDefault');

      const energy = energyFor(shownPct);
      const starCount = particleCountFor(shownPct);
      const starOpacity = starLayerOpacityFor(shownPct);
      const reduced = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const slowdown = reduced ? REDUCED_SLOWDOWN : 1;
      const baseSeconds = starBaseSeconds(shownPct);

      const activeColor = valueColorFor(committedPct, selectedIndex >= 0 && levels.efforts[selectedIndex].id === 'off');

      const icon = h('svg', {
        width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, focusable: false,
        style: { display: 'block', flex: '0 0 auto' },
      }, h('path', {
        d: 'M1 3h10M1 6h7M1 9h4', stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', fill: 'none',
      }));

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

      const trackStyle = { '--pct': shownPct.toFixed(4), '--ces-energy': energy.toFixed(3) };

      const starNodes = [];
      for (let s = 0; s < MAX_PARTICLES; s += 1) {
        const particle = PARTICLES[s];
        const seconds = baseSeconds * (1 + particle.spread01 * STAR_DURATION_SPREAD) * slowdown;
        starNodes.push(h('span', {
          key: 'star-' + s,
          className: 'dsh-effort-star',
          'data-ces-part': 'star',
          style: {
            top: particle.top,
            display: s < starCount ? 'block' : 'none',
            // ⚠️ Duration and negative phase must be inline: CSS-variable delays
            //    did not take effect in the real host (see the codex fork's notes).
            animationDuration: seconds.toFixed(3) + 's',
            animationDelay: (-particle.phase01 * seconds).toFixed(3) + 's',
          },
        }, h('span', {
          className: 'dsh-effort-star__dot',
          'data-ces-part': 'particle',
          style: { '--ces-b': particle.brightness },
        })));
      }

      const tickNodes = levels.efforts.map((level, index) => h('span', {
        key: 'tick-' + level.id,
        className: 'dsh-effort-tick',
        'data-ces-part': 'tick',
        'data-on': shownIndex >= index ? '1' : '0',
        style: { left: knobLeft(pctFromIndex(index, count)) },
      }));

      const track = h('div', {
        className: 'dsh-effort-track',
        'data-ces-part': 'track',
        role: 'slider',
        tabIndex: 0,
        'aria-label': tr('title'),
        'aria-valuemin': 0,
        'aria-valuemax': Math.max(0, count - 1),
        'aria-valuenow': Math.max(0, shownIndex),
        'aria-valuetext': label,
        'aria-disabled': locked ? true : undefined,
        style: trackStyle,
        onPointerDown: onTrackPointerDown,
        onKeyDown: onTrackKeyDown,
      },
      h('span', {
        className: 'dsh-effort-fill',
        'data-ces-part': 'fill',
        style: { background: 'linear-gradient(90deg,' + FILL_BLUE + ' 0%,' + fillColorFor(shownPct) + ' 100%)' },
      }),
      h('span', { className: 'dsh-effort-nebula', 'data-ces-part': 'nebula' },
        h('span', { className: 'dsh-effort-shimmer', 'data-ces-part': 'shimmer' })),
      h('span', {
        className: 'dsh-effort-stars',
        'data-ces-part': 'stars',
        style: { opacity: starOpacity.toFixed(3) },
      }, starNodes),
      tickNodes,
      h('span', {
        className: 'dsh-effort-knob' + (shownIndex >= 0 ? '' : ' unset'),
        'data-ces-part': 'knob',
      }));

      const tickLabelNodes = levels.efforts.map((level, index) => h('div', {
        key: 'ticklabel-' + level.id,
        className: 'dsh-effort-ticklabel',
        'data-ces-part': 'ticklabel',
        'data-on': index === shownIndex ? '1' : '0',
        style: { left: knobLeft(pctFromIndex(index, count)) },
      }, labelOf(level)));

      const activeLevel = shownLevel;

      const card = h('div', {
        ref: cardRef,
        className: 'dsh-effort-card',
        role: 'dialog',
        'aria-label': tr('title'),
        style: {
          ...(pos === null
            ? { left: '-9999px', bottom: '0px' }
            : { left: pos.left + 'px', bottom: pos.bottom + 'px' }),
          // The signature Codex feedback: the frame's violet border and glow
          // strengthen with energy.
          borderColor: 'rgba(' + CARD_RGB + ',' + (0.16 + 0.34 * energy).toFixed(3) + ')',
          boxShadow: 'var(--dsw-elevation-prominent),0 0 24px rgba(' + CARD_RGB + ',' + (0.22 * energy).toFixed(3) + ')',
        },
      },
      h('span', { className: 'dsh-effort-title', style: { color: valueColorFor(shownPct, isOff) } }, label),
      // The small line under the level name names the model, the way the
      // reference slider does; the tick row already shows where the knob sits.
      h('span', { className: 'dsh-effort-sub' }, levels.modelName),
      track,
      h('div', { className: 'dsh-effort-ticks', 'data-ces-part': 'ticklabels' }, tickLabelNodes),
      activeLevel !== undefined && typeof activeLevel.description === 'string' && activeLevel.description.length > 0
        ? h('div', { className: 'dsh-effort-note', 'data-ces-part': 'note', title: activeLevel.description }, activeLevel.description)
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
