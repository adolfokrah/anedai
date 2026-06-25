# Weave

A **design-first component studio**. Designers craft components and pages as HTML; Weave compiles them to React on the way out and patches edits back on the way in — logic intact. One shared library, two views.

## Why

Existing tools (e.g. Claude Design Sync) are **code-first**: a component must already exist in code to appear in the tool, and it ships **compiled and read-only** — designers can place components, not create or edit them. That only covers the back half of the lifecycle (compose + maintain).

Real teams work design-first: a designer invents a primitive → a dev builds it → the team composes pages from it. Weave supports the whole loop, in **both** directions:

| Origin | Artifact | Handoff |
|--------|----------|---------|
| Designer | component | scaffold React → dev adds logic |
| Designer | page | scaffold React → dev wires data |
| Dev | component | syncs to studio → designer prototypes with it |
| Dev | page | already code |

A page is just a component made of components, so **one mechanism** handles both.

## The core: a bound round-trip (not two compilers)

HTML is lossy — blind `HTML → React` throws away loops, conditionals, handlers. Weave avoids decay with an **origin map**:

1. **Push** — instrument every JSX element with its source origin (`data-weave-src="button.tsx:8:4"`), then *render* it to editable HTML (real render, not static transpile).
2. **Pull** — diff edited HTML against the baseline **by origin**, and patch only the deltas (className swap, text, show/hide) onto the original TSX. Logic is never regenerated.

See [`src/compiler/`](src/compiler/) for the contracts.

## Stack

- React 19 + TanStack Router (SPA) + Vite — single bundler, so user components compile in the same pipeline as the app.
- Tailwind v4 — the medium designers edit (class swaps map cleanly back to `className`).

The repo-connect / sync layer (read a project, bundle its components, push/pull) will be a separate CLI / MCP bridge — not part of this app's bundle.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5273
pnpm check      # typecheck
pnpm lint       # biome
```

## Status

Scaffold + compiler API surface. First proof: instrument `button.tsx` → render to HTML → change a className → patch it back into source with logic intact.
