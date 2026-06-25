# Design-First Component Studio — Concept

*A design tool where designers and developers work on one shared component library, and Claude compiles between HTML and React at every handoff.*

---

## The problem

In any real product team, the design system flows like this:

```
designer invents a primitive/component  →  dev builds it  →  team composes pages from it
```

Design **originates**. Code comes second. Two sources of truth (the design file and the codebase) sit on either side of a lossy handoff — a screenshot, a redline, a Figma frame — and they drift apart with every change. What ships never quite matches what was designed.

## Where Claude Design Sync stops

Claude Design Sync collapses that gap by making the design canvas render your **real** components. But it is **code-first**: a component must already exist in code to appear in the tool. It ships the components **compiled and read-only** — designers can *use* them, but can't *edit* them, and can't *create new ones*.

So it covers only the back half of the lifecycle — **compose + maintain**. It cannot support the moment a component is *born*, which is exactly where design actually starts.

## The idea

Deal in **HTML directly** as the editable medium, and **compile both ways**:

- **Pull (design → code):** HTML → React. Claude scaffolds a React component/page from the designed HTML.
- **Push (code → design):** React → HTML. The real component is rendered to editable HTML on the canvas.

Because the medium is plain HTML, designers can **create and edit** components, not just place them. Because Claude compiles, devs get a faithful React starting point instead of a screenshot.

## The symmetric loop

Either side can originate, at either level:

```
DESIGNER originates                          DEV originates
─────────────────                            ──────────────
designs new component                        builds shared component
   │ hand off                                   │ sync to tool
   ▼                                            ▼
dev builds it with Claude (HTML→React)       designer prototypes a PAGE with it
   │                                            │ hand off
   ▼                                            ▼
component is real ──────────────────────►    dev builds page with Claude (HTML→React)
```

Both directions feed the same library. **Claude is the bridge at every handoff.** Nobody is blocked: the designer is never told "you can't make a new component," and the dev never works from a screenshot.

## Who makes what (every cell flows)

| Origin | Artifact | Handoff → Claude builds |
|--------|----------|--------------------------|
| Designer | component | scaffold React → dev adds logic |
| Designer | page | scaffold React → dev wires data |
| Dev | component | syncs to tool → designer prototypes with it |
| Dev | page | already code |

## Why it's architecturally clean

**A page is just a component made of components.** So one mechanism handles both — same `HTML ↔ React` pipe at different scale. You don't build two systems; components and pages are the same primitive.

## The honest boundary

Design owns the **look**; dev owns the **logic** — as it should.

- **Genesis (new component/page):** HTML → React produces a faithful *scaffold*, not a finished component. The dev fills in variants, state, behaviour, a11y. There is no logic to lose yet, so the conversion is clean.
- **Later visual tweaks:** this is the hard part. When a designer nudges an existing component, the dev's logic must survive.

## The hard core (make-or-break)

The round-trip must **not** be two independent compilers. Blind HTML → React is lossy: loops collapse to flat markup, conditionals and handlers vanish, and the component decays a little every trip.

The fix is a **bound round-trip with an origin map**:

1. **On push**, instrument each JSX element with its source origin (e.g. `data-src="button.tsx:8:4"`), then render — the HTML carries origins automatically.
2. **On pull**, diff the edited HTML against the baseline *by origin id*, and apply only the deltas back onto the **original TSX source** (e.g. a className swap patches the className string in place).
3. Logic, hooks, loops and handlers are **never regenerated** — they survive because the source is *patched*, not rebuilt.

Constrain the editable surface first to win ~80%: restyle (Tailwind class swaps), text edits, and show/hide/reorder of existing elements. Defer free-form structural authoring and component-from-scratch composition (the compose-detection problem) — mitigate early by letting designers drop only *known* component instances.

## Positioning, in one line

> **Claude Design Sync** keeps design in sync with code that already exists — *code-first, maintenance.*
> **This tool** lets designers create the components themselves and round-trips both ways — *design-first, full lifecycle.*

## Smallest proof

Instrument `button.tsx` with origin attributes → render to editable HTML → change a className in the HTML → patch it back into `button.tsx` source with its logic intact. If that round-trips cleanly, the thesis holds.
