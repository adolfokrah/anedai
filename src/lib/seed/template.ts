/**
 * Scratch-mode scaffold: a minimal Vite + React + TS + Tailwind v4 app, written
 * directly into the sandbox (no `create-*` network round-trip). Vite gives a
 * fast dev server + great HMR; the agent then edits this real React source.
 *
 * The Vite server config is tuned for E2B's https proxy:
 *  - `host: true`        bind 0.0.0.0 so the sandbox port is reachable
 *  - `allowedHosts: true` accept the *.e2b.app proxy host
 *  - `hmr.clientPort: 443` HMR websocket connects over the public https port
 */

export const SCRATCH_DEV_PORT = 5173;

export const SCRATCH_TEMPLATE: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {
      name: 'weave-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc -b && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@tailwindcss/vite': '^4.0.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^4.3.4',
        tailwindcss: '^4.0.0',
        typescript: '^5.7.2',
        vite: '^6.0.0',
      },
    },
    null,
    2,
  )}\n`,

  'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: ${SCRATCH_DEV_PORT},
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
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,

  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weave App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,

  'src/index.css': `@import 'tailwindcss';
`,

  'src/App.tsx': `export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Your app is live</h1>
        <p className="mt-3 text-neutral-400">
          Describe a change in the chat and watch it update here.
        </p>
      </div>
    </main>
  );
}
`,

  '.gitignore': `node_modules
dist
*.local
.DS_Store
`,
};
