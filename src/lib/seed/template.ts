/**
 * Scratch-mode scaffolds, written straight into the sandbox (no `create-*`
 * network round-trip). Two stacks, chosen by project kind:
 *
 *  - 'website' → Next.js (App Router) — marketing sites / landing pages. Dev :3000.
 *  - 'app'     → Vite + React + TanStack Router — dashboards / web apps. Dev :5173.
 *
 * BOTH are pre-configured for shadcn/ui (Tailwind v4 + CSS-variable theme +
 * `components.json` + `cn` util + `@/*` alias), so the agent adds components with
 * `npx shadcn@latest add <name>` and composes them rather than hand-rolling.
 */

export type ProjectKind = 'website' | 'app';

const VITE_PORT = 5173;
const NEXT_PORT = 3000;

/** Heuristic: dashboards/web-apps → Vite+TanStack; everything else → Next. */
export function classifyKind(prompt: string): ProjectKind {
  const s = (prompt || '').toLowerCase();
  const app =
    /\b(dashboard|admin|web ?app|portal|crm|saas|console|internal tool|back ?office|panel|analytics|management|platform|workspace|control panel)\b/;
  return app.test(s) ? 'app' : 'website';
}

export interface Scaffold {
  files: Record<string, string>;
  devPort: number;
  /** Whether the dev server needs PREVIEW_HOST in its env (Next allowedDevOrigins). */
  needsPreviewHost: boolean;
}

export function scaffold(kind: ProjectKind): Scaffold {
  return kind === 'app'
    ? { files: VITE_TEMPLATE, devPort: VITE_PORT, needsPreviewHost: false }
    : { files: NEXT_TEMPLATE, devPort: NEXT_PORT, needsPreviewHost: true };
}

/* ────────────────────────── shared shadcn pieces ─────────────────────────── */

/** shadcn/ui Tailwind v4 theme (new-york, neutral base). Used as the app's CSS. */
const SHADCN_CSS = `@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;

const CN_UTIL = `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const componentsJson = (cssPath: string, rsc: boolean) =>
  `${JSON.stringify(
    {
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'new-york',
      rsc,
      tsx: true,
      tailwind: {
        config: '',
        css: cssPath,
        baseColor: 'neutral',
        cssVariables: true,
        prefix: '',
      },
      aliases: {
        components: '@/components',
        utils: '@/lib/utils',
        ui: '@/components/ui',
        lib: '@/lib',
        hooks: '@/hooks',
      },
      iconLibrary: 'lucide',
    },
    null,
    2,
  )}\n`;

/**
 * anedai.json — runtime wiring for the workspace tabs. Scaffold seeds the app's
 * PORT ONLY (no route — the public URL isn't known yet; Aned derives it from the
 * port). The agent fills in full https `route` URLs (and a designSystem entry)
 * once servers are up, since routes in anedai.json are always full URLs.
 */
const anedConfigJson = (port: number) =>
  `${JSON.stringify({ app: { port } }, null, 2)}\n`;

const SHADCN_DEPS = {
  'class-variance-authority': '^0.7.1',
  clsx: '^2.1.1',
  'lucide-react': '^0.460.0',
  'tailwind-merge': '^2.6.0',
};

/* ─────────────────────────── Vite + TanStack Router ─────────────────────── */

const VITE_TEMPLATE: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {
      name: 'aned-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc -b && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        '@tanstack/react-router': '^1.95.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        ...SHADCN_DEPS,
      },
      devDependencies: {
        '@tailwindcss/vite': '^4.0.0',
        '@types/node': '^22.0.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^4.3.4',
        tailwindcss: '^4.0.0',
        'tw-animate-css': '^1.2.0',
        typescript: '^5.7.2',
        vite: '^6.0.0',
      },
    },
    null,
    2,
  )}\n`,

  'vite.config.ts': `import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: true,
    port: ${VITE_PORT},
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
});
`,

  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,

  'components.json': componentsJson('src/index.css', false),
  'anedai.json': anedConfigJson(VITE_PORT),

  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aned App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  // Reports the live route to the Aned workspace (address bar + agent page
  // awareness). Dev/preview only — no-op when not embedded in an iframe.
  'src/aned-route-reporter.ts': `if (typeof window !== 'undefined' && window.parent !== window) {
  const report = () =>
    window.parent.postMessage(
      { type: 'aned:route', path: window.location.pathname + window.location.search },
      '*',
    );
  report();
  window.addEventListener('popstate', report);
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k];
    history[k] = function (this: History, ...args: Parameters<typeof orig>) {
      const r = orig.apply(this, args);
      report();
      return r;
    } as typeof orig;
  }
}
`,

  'src/main.tsx': `import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './aned-route-reporter';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
`,

  // Code-based TanStack Router (no file-based codegen). Add routes here.
  'src/router.tsx': `import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import Home from './routes/Home';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
`,

  'src/routes/Home.tsx': `export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Your app is live</h1>
        <p className="mt-3 text-muted-foreground">
          Describe a change in the chat and watch it update here.
        </p>
      </div>
    </main>
  );
}
`,

  'src/lib/utils.ts': CN_UTIL,
  'src/index.css': SHADCN_CSS,

  '.gitignore': `node_modules
dist
*.local
.DS_Store
`,
};

/* ───────────────────────────── Next.js (App Router) ─────────────────────── */

const NEXT_TEMPLATE: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {
      name: 'aned-site',
      private: true,
      version: '0.0.0',
      scripts: {
        // Bind 0.0.0.0 so the sandbox port is reachable through the proxy.
        dev: `next dev -H 0.0.0.0 -p ${NEXT_PORT}`,
        build: 'next build',
        start: `next start -H 0.0.0.0 -p ${NEXT_PORT}`,
      },
      dependencies: {
        next: '^15.1.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        ...SHADCN_DEPS,
      },
      devDependencies: {
        '@tailwindcss/postcss': '^4.0.0',
        '@types/node': '^22.0.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        tailwindcss: '^4.0.0',
        'tw-animate-css': '^1.2.0',
        typescript: '^5.7.2',
      },
    },
    null,
    2,
  )}\n`,

  // allowedDevOrigins lets Next dev accept the sandbox proxy host (set via the
  // PREVIEW_HOST env when the dev server starts — see seed).
  'next.config.ts': `import type { NextConfig } from 'next';

const host = process.env.PREVIEW_HOST;
const nextConfig: NextConfig = {
  allowedDevOrigins: host ? [host] : undefined,
};

export default nextConfig;
`,

  'postcss.config.mjs': `export default {
  plugins: { '@tailwindcss/postcss': {} },
};
`,

  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    },
    null,
    2,
  )}\n`,

  'components.json': componentsJson('src/app/globals.css', true),
  'anedai.json': anedConfigJson(NEXT_PORT),

  // Reports the live route to the Aned workspace (address bar + agent page
  // awareness). Dev/preview only — no-op when not embedded in an iframe.
  'src/app/aned-route-reporter.tsx': `'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function AnedRouteReporter() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const qs = search.toString();
    window.parent.postMessage(
      { type: 'aned:route', path: pathname + (qs ? '?' + qs : '') },
      '*',
    );
  }, [pathname, search]);
  return null;
}
`,

  'src/app/layout.tsx': `import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnedRouteReporter } from './aned-route-reporter';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aned Site',
  description: 'Built with Aned.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Suspense>
          <AnedRouteReporter />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
`,

  'src/app/page.tsx': `export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Your site is live</h1>
        <p className="mt-3 text-muted-foreground">
          Describe a change in the chat and watch it update here.
        </p>
      </div>
    </main>
  );
}
`,

  'src/lib/utils.ts': CN_UTIL,
  'src/app/globals.css': SHADCN_CSS,

  '.gitignore': `node_modules
.next
out
*.local
.DS_Store
`,
};
