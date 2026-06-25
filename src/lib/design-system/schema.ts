/**
 * Canonical design-system schema — the single shape BOTH creation paths emit:
 *   1. greenfield (guided generation from taste answers)
 *   2. linked repo (scan existing styles/components/storybook, then normalize)
 *
 * The agent materializes this into a project's sandbox as real files (see
 * `DS_FILE_LAYOUT`). Pages then reference the design system as the source of
 * truth — they compose these components, never define new ones inline.
 *
 * Token model is three-tier and shadcn-compatible (same semantic CSS var names),
 * so generated output and scanned shadcn/Tailwind repos converge on one shape.
 */

export const DS_SCHEMA_VERSION = 1;

/* ─────────────────────────── Tokens ─────────────────────────── */

/** Tier 1 — raw, theme-agnostic values. Never referenced directly by UI. */
export interface PrimitiveTokens {
  /** Color ramps: name → { 50..950 } hex/oklch. e.g. neutral, brand, red. */
  colors: Record<string, Record<string, string>>;
  /** Spacing scale in px, keyed by step (e.g. "1": 4, "2": 8 …). 8px rhythm. */
  spacing: Record<string, number>;
  /** Border radii, e.g. { sm, md, lg, xl, full }. */
  radii: Record<string, string>;
  /** Box shadows, e.g. { sm, md, lg }. */
  shadows: Record<string, string>;
  /** Font size scale, e.g. { xs, sm, base, lg, xl, "2xl" … } → rem. */
  fontSizes: Record<string, string>;
  /** Line-height scale aligned to fontSizes. */
  lineHeights: Record<string, string>;
  /** z-index layers, e.g. { dropdown, sticky, overlay, modal, toast }. */
  zIndex?: Record<string, number>;
  /** Motion: durations + easings, e.g. { fast: "150ms" }, { standard: "cubic-…" }. */
  motion?: {
    durations: Record<string, string>;
    easings: Record<string, string>;
  };
}

/**
 * Tier 2 — semantic roles, resolved per theme to primitive values. These are
 * what components consume. Names mirror shadcn so output drops into a shadcn
 * project and scanning one is lossless.
 */
export interface SemanticTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  /** Extended status roles beyond shadcn's defaults. */
  success?: string;
  successForeground?: string;
  warning?: string;
  warningForeground?: string;
  info?: string;
  infoForeground?: string;
  border: string;
  input: string;
  ring: string;
  /** Optional chart + sidebar role sets (shadcn parity). */
  chart?: Record<string, string>;
  sidebar?: Record<string, string>;
}

export interface ThemeSet {
  /** Each theme resolves the full semantic set. `light`/`dark` are required. */
  light: SemanticTokens;
  dark: SemanticTokens;
  [theme: string]: SemanticTokens;
}

/* ───────────────────── Typography & iconography ───────────────────── */

export interface Typography {
  /** Font families by role. */
  families: { sans: string; serif?: string; mono?: string; heading?: string };
  /** Available weights, e.g. [400, 500, 600, 700]. */
  weights: number[];
  /** Named type styles → scale refs + tracking, e.g. h1/h2/body/caption. */
  styles: Record<
    string,
    { size: string; lineHeight: string; weight: number; tracking?: string }
  >;
}

export interface Iconography {
  /** Icon library the system standardizes on. */
  library: 'lucide' | 'tabler' | 'phosphor' | 'heroicons' | 'custom';
  /** Default render size(s) in px. */
  sizes: number[];
  /** Stroke width for line icons. */
  strokeWidth?: number;
}

/* ─────────────────── Primitives & components ─────────────────── */

export type ComponentCategory =
  | 'primitive' // Button, Input, Badge, Checkbox …
  | 'layout' // Card, Separator, Tabs, Accordion …
  | 'overlay' // Dialog, Sheet, Popover, Tooltip …
  | 'navigation' // Sidebar, Breadcrumb, Pagination …
  | 'data-display' // Table, Avatar, Chart …
  | 'feedback' // Alert, Toast, Skeleton, Progress …
  | 'form'; // composed form controls

export interface ComponentVariantAxis {
  /** Axis name, e.g. "variant", "size". */
  name: string;
  /** Allowed values, e.g. ["default","outline","ghost"]. */
  values: string[];
  /** Default value for the axis. */
  default: string;
}

export interface ComponentDoc {
  name: string;
  category: ComponentCategory;
  /** One-line description. */
  summary: string;
  /** Variant axes (variant/size/tone …). */
  variants: ComponentVariantAxis[];
  /** Interactive states the component must implement + style. */
  states: Array<
    'hover' | 'focus' | 'active' | 'disabled' | 'invalid' | 'loading'
  >;
  /** Prop contract (name → type/description), for the React target. */
  props?: Record<string, string>;
  /** Usage guidance. */
  usage?: { do?: string[]; dont?: string[] };
  /** Accessibility notes (roles, keyboard, aria). */
  a11y?: string[];
  /** Path to the component's source in the project (framework-specific). */
  sourcePath?: string;
}

/* ─────────────────────── The design system ─────────────────────── */

export interface DesignSystem {
  schemaVersion: typeof DS_SCHEMA_VERSION;
  name: string;
  /** How it was produced. */
  origin: 'greenfield' | 'scanned';
  /** Target stack the system is expressed for. */
  stack: {
    framework: 'react';
    styling: 'tailwind-v4';
    base: 'shadcn' | 'custom';
  };
  /**
   * Where the reusable components ACTUALLY live in this project — resolved, not
   * assumed. Greenfield → DS_FILE_LAYOUT.componentsDir. Scanned → wherever the
   * repo already keeps its UI lib (e.g. a monorepo package `packages/ui/src`,
   * `libs/ui`, an app-local dir). Multiple roots allowed for monorepos.
   */
  componentsDir: string;
  componentsRoots?: string[];
  primitives: PrimitiveTokens;
  semantic: ThemeSet;
  typography: Typography;
  iconography: Iconography;
  /** Primitive + composed components, the reusable catalog. */
  components: ComponentDoc[];
  /** Free-form notes the guide/agent recorded (gaps filled, decisions). */
  notes?: string[];
}

/* ─────────────────── On-disk layout (sandbox app) ─────────────────── */

/**
 * Where the agent writes the system inside a project. Real components live in
 * the framework's conventional dir; the DS metadata + tokens + docs live under
 * `design-system/` as the machine-readable source of truth.
 */
export const DS_FILE_LAYOUT = {
  /** Serialized `DesignSystem` (this schema). The canonical record. */
  manifest: 'design-system/design-system.json',
  /** Semantic tokens as CSS vars: `:root` (light) + `.dark`, plus `@theme`. */
  tokensCss: 'design-system/tokens.css',
  /** The applied standard for THIS project (human-readable). */
  guide: 'design-system/guide.md',
  /** Per-component docs: `design-system/docs/<Component>.md`. */
  docsDir: 'design-system/docs',
  /**
   * DEFAULT components location for GREENFIELD projects only. A scanned/linked
   * repo's UI lib may live elsewhere (monorepo `packages/ui`, `libs/ui`, an
   * app-local dir) — DETECT it and record the real path in
   * `DesignSystem.componentsDir`; never relocate existing components here.
   */
  componentsDir: 'src/components/ui',
  /**
   * Live, viewable route rendering the system (Foundations + component
   * gallery). Wired into the app router; this is what the Design-system tab
   * previews. Framework decides the file (Next `app/design-system/page.tsx`,
   * Vite + react-router a route component).
   */
  route: '/design-system',
} as const;
