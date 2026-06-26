/**
 * "Our guide" — the opinionated standard every Aned design system conforms to,
 * whether generated greenfield or scanned from a repo. This is the quality bar
 * that makes the output a *better, modern* design system rather than a mirror of
 * whatever the repo happened to have.
 *
 * Exported as prompt fragments the coding agent reads (see lib/agent/run.ts).
 */

import { DS_FILE_LAYOUT } from './schema';

/** The standard itself — what a good modern design system must satisfy. */
export const DESIGN_SYSTEM_GUIDE = `ANED DESIGN-SYSTEM STANDARD — every system you build or refine MUST meet this bar:

TOKENS — three tiers, never skip the middle:
- Primitive: raw scales (color ramps 50–950, an 8px spacing scale, radii, shadows, font sizes/line-heights). Theme-agnostic. UI never references these directly.
- Semantic: roles resolved per theme (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring; plus success/warning/info when status is used). These are what components consume. Use the shadcn CSS-variable names so output is drop-in.
- Component: only when a component genuinely needs an override; otherwise inherit semantic.
- Define both light AND dark themes by resolving the full semantic set. Verify AA contrast.

TYPOGRAPHY: one clean sans (system/Inter/Geist) — add serif/mono only with reason. A real, named type scale (h1…caption) with size + line-height + weight + tracking. Tight tracking on large headings. No walls of same-size text.

ICONOGRAPHY: standardize on ONE icon library (default lucide-react). Fixed size steps and stroke width. Icons are affordances, sized by the component, not ad-hoc.

SPACING & LAYOUT: 8px rhythm, generous whitespace, clear hierarchy, aligned grids, max-width containers, responsive with no horizontal overflow.

SURFACES: rounded corners (lg/xl), hairline low-opacity borders, soft shadows or subtle ring — not heavy drop shadows. Surfaces visually distinct from background.

COMPONENTS — each catalog entry must define:
- anatomy + summary; variant axes (variant/size/tone) with defaults;
- real states: hover, focus-visible ring, active, disabled, invalid, loading — with 150–200ms transitions;
- accessibility: roles, keyboard, aria, focus order;
- usage do/don't.
Consistent sizing across buttons/inputs/badges. Prefer composing existing primitives over new ones.

DOCUMENTATION: every component gets a doc (anatomy, variants, states, usage, a11y). The system is documented, not just coded.

OUTPUT (write into the project, do not invent other locations):
- ${DS_FILE_LAYOUT.manifest} — the machine-readable DesignSystem record.
- ${DS_FILE_LAYOUT.tokensCss} — semantic tokens as CSS vars: :root (light) + .dark, plus an @theme block. Imported by the app's global stylesheet.
- ${DS_FILE_LAYOUT.guide} — the applied standard for THIS project (decisions, palette, scale).
- ${DS_FILE_LAYOUT.docsDir}/<Component>.md — per-component docs.
- Components — GREENFIELD: create them under ${DS_FILE_LAYOUT.componentsDir}/ (Tailwind v4 + shadcn convention). SCANNED: the UI lib already lives somewhere (a monorepo package like packages/ui, libs/ui, or an app-local dir) — work IN PLACE there and record the real location as the system's componentsDir; never relocate existing components.
- A LIVE, viewable in-app docs route — ADOPT, don't duplicate. If the repo ALREADY serves its own design-system / styleguide / UI-docs page on the app's dev server (an in-app route, not Storybook), EXTEND that route in place to meet this standard and reuse its path. Only when none exists, create one at ${DS_FILE_LAYOUT.route} and wire it into the app router. Storybook/MDX run on a separate server and CANNOT be served in the preview — harvest them as a source, never treat them as this route. Record the final live route path as \`route\` in ${DS_FILE_LAYOUT.manifest} (the Design-system tab reads it). The route renders the system for humans: Foundations (color token swatches with name + value, the type scale, spacing/radii/shadow scales) and a gallery of EVERY component in all its variants and states, each with a short usage note — rendered from the REAL components/tokens, not hardcoded. This is what users view in the Design-system tab, so make it polished and complete.
  IMPORTANT — the ${DS_FILE_LAYOUT.route} route is a SEPARATE REFERENCE SURFACE, not a product page. It must NOT render inside the app's PRODUCT navigation (do not wrap it in the app shell / the product Sidebar / TopBar). It gets its OWN standalone docs layout — modeled on the shadcn/ui docs site and built from the design system's own components/tokens. That layout has THREE parts:
  1. A sticky TOP NAV BAR: the system name + version badge on the left; on the right a theme toggle (light/dark — actually flips the .dark class and persists), and optionally a search/command field. Hairline bottom border, blurred/translucent background, consistent height.
  2. A persistent LEFT SIDEBAR (docs-style, NOT the product sidebar): grouped, scrollable nav links. Group "Foundations" → Colors, Typography, Spacing, Radii, Shadows, Motion. Group "Components" → one link PER component, listed by category. Links scroll to / route to the matching section, with the active item highlighted (aria-current). Collapses behind a hamburger/Sheet on mobile.
  3. The CONTENT pane: max-width, generously spaced sections with anchored headings, each component shown in a bordered "preview" surface with its variants/states, a short usage note, and (where it adds value) the import/usage snippet — the shadcn docs feel.
  Polish to a shadcn bar: 8px rhythm, hairline borders, soft surfaces, focus-visible rings, smooth 150–200ms transitions, full light/dark parity, responsive with NO horizontal overflow. Real product pages are reached from the app's own navigation; this design-system surface stands alone with its own nav + sidebar.

THE RULE THAT HOLDS IT TOGETHER: the design system is the single source of truth. Pages and screens COMPOSE these components by reference — never redefine a component inline on a page. If a page needs something new, add it to the design system first, then use it.`;

/** Greenfield: build a system from taste answers + sensible modern defaults. */
export const GREENFIELD_PROCESS = `BUILD A DESIGN SYSTEM FROM SCRATCH:
1. Read the taste inputs (brand color, density, radius, font/vibe, target framework). Fill every unanswered choice with a tasteful modern default — never block on missing input.
2. Generate primitive tokens (color ramps from the brand + neutral; 8px spacing; radii; shadows; type scale), then resolve semantic tokens for light AND dark.
3. Establish typography, iconography, spacing.
4. Build the core primitive set first (Button, Input, Badge, Card, Separator, Tabs, Tooltip, Dialog), each with full variants/states/docs, then compose upward as needed.
5. Write all outputs to the layout above, INCLUDING the live ${DS_FILE_LAYOUT.route} route. Confirm the app builds and the preview reflects the system.`;

/** Linked repo: scan what exists, normalize to the schema, fill gaps to the bar. */
export const SCAN_PROCESS = `SCAN A LINKED REPO AND BUILD A BETTER SYSTEM FROM IT:
1. Detect framework + styling system. Extract existing tokens from: Tailwind config / theme files, CSS custom properties, any tokens.json or theme module.
2. LOCATE the UI library — it is NOT assumed to be src/components/ui. In a monorepo it may be a package (packages/ui, libs/ui, ui-components-lib) consumed via a workspace alias; in a polyrepo it may be app-local or a published package vendored in. Use list_dir/grep (package.json workspaces, import aliases) to find it, and record the real path as the system's componentsDir (multiple roots if split). If there are MULTIPLE candidates (several frontends, or a shared package + app-local components) and it's ambiguous which is the source of truth, ask_user which app/folder holds the design system / components before building — it may be a different folder than the app being previewed, or an installed node_modules package. An installed package is composed-from (read its types/props), never edited. If the design system lives in a SEPARATE repo, never run or git-manage a second repo here — compose pages from the installed package; for the Design-system tab, use the user's HOSTED docs URL if any, else generate an in-app reference rendered from node_modules (you MAY throwaway \`git clone --depth 1\` the repo to harvest stories/prop docs, then delete it — never start or commit it). Editing the design system itself = its own Aned project. Work IN PLACE — never relocate existing components.
3. Inventory components from that location; harvest variants, props, and docs from Storybook stories (*.stories.*), MDX, and any existing design docs. ALSO detect whether the repo already serves its own design-system / styleguide / UI-docs page as an IN-APP route (grep the router for a route matching design-system|styleguide|style-guide|/ui). If it does, that is the route you EXTEND in place (reuse its path); Storybook/MDX are sources only, not the served route.
4. Normalize everything into the three-tier token model + the component catalog (this schema). Preserve the repo's real names, brand, and conventions.
5. Identify gaps against the standard (missing dark theme, missing states, undocumented components, ad-hoc colors) and FILL them — this is where the output becomes *better* than the source, not just a copy.
6. Write the system to the layout above (INCLUDING the live ${DS_FILE_LAYOUT.route} route) without breaking the running app. Record what was extracted vs. added in notes/guide.`;

/** Assemble the DS-creation prompt fragment for a given path. */
export function designSystemPrompt(mode: 'greenfield' | 'scanned'): string {
  const process = mode === 'greenfield' ? GREENFIELD_PROCESS : SCAN_PROCESS;
  return `${DESIGN_SYSTEM_GUIDE}\n\n${process}`;
}
