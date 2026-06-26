/**
 * Inject a dev-only "route reporter" into the running app(s) so the workspace
 * address bar tracks the live URL. The preview iframe is cross-origin, so the
 * parent can't read its URL — the app must postMessage it. We wire that in
 * ourselves (no agent, no framework guessing): a repo-wide sweep injects an
 * inline <script> into every index.html (Vite/CRA/Astro/any SPA) and a client
 * component into every Next App Router layout. Covering ALL apps means a
 * redirect from one app to another (different port = different origin) keeps
 * reporting — whichever app is shown posts its own full URL.
 *
 * Kept OUT of git (edited files marked assume-unchanged), best-effort, idempotent.
 */

import type { Box } from '@/lib/runtime/types';

const REPORTER_BASENAME = 'aned-route-reporter';

export interface ReporterResult {
  injected: number;
  already: number;
  files: string[];
  reason?: string;
}

/** Inline reporter (index.html). Marker comment keeps idempotency working. */
const REPORTER_INLINE = `// ${REPORTER_BASENAME}: report the URL to the Aned workspace.
(function () {
  if (typeof window === 'undefined' || window.parent === window) return;
  function report() {
    window.parent.postMessage({ type: 'aned:route', url: window.location.href }, '*');
  }
  report();
  window.addEventListener('popstate', report);
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = window.history[k];
    window.history[k] = function () {
      var r = orig.apply(this, arguments);
      report();
      return r;
    };
  });
})();`;

const NEXT_REPORTER_TSX = `'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

// ${REPORTER_BASENAME}: report the URL to the Aned workspace. No-op outside an iframe.
export function AnedRouteReporter() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    void pathname;
    void search;
    window.parent.postMessage(
      { type: 'aned:route', url: window.location.href },
      '*',
    );
  }, [pathname, search]);
  return null;
}
`;

const PRUNE =
  "-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*'";

async function readFile(box: Box, path: string): Promise<string> {
  return box.readFile(path).catch(() => '');
}

function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Mark a tracked file assume-unchanged so our edit never shows in git. */
async function freezeInGit(box: Box, gitRoot: string, rel: string) {
  await box
    .exec(`git update-index --assume-unchanged ${shellArg(rel)}`, {
      cwd: gitRoot,
    })
    .catch(() => {});
}

/** `find` matching files under the repo (relative paths, capped). */
async function find(
  box: Box,
  gitRoot: string,
  expr: string,
): Promise<string[]> {
  const r = await box
    .exec(`find . ${expr} ${PRUNE} 2>/dev/null | head -40`, { cwd: gitRoot })
    .catch(() => ({ stdout: '' }));
  return r.stdout
    .split('\n')
    .map((s) => s.trim().replace(/^\.\//, ''))
    .filter(Boolean);
}

export async function ensureRouteReporter(
  box: Box,
  gitRoot: string,
): Promise<ReporterResult> {
  const out: ReporterResult = { injected: 0, already: 0, files: [] };
  try {
    // 1) Every index.html — inject the inline reporter.
    for (const rel of await find(box, gitRoot, '-name index.html')) {
      const abs = `${gitRoot}/${rel}`;
      const cur = await readFile(box, abs);
      if (!cur) continue;
      if (cur.includes(REPORTER_BASENAME)) {
        out.already++;
        continue;
      }
      const tag = `<script>\n${REPORTER_INLINE}\n</script>`;
      const next = cur.includes('</head>')
        ? cur.replace('</head>', `${tag}\n</head>`)
        : cur.includes('</body>')
          ? cur.replace('</body>', `${tag}\n</body>`)
          : `${tag}\n${cur}`;
      await box.writeFile(abs, next);
      await freezeInGit(box, gitRoot, rel);
      out.injected++;
      out.files.push(rel);
    }

    // 2) Every Next App Router layout — inject the client component.
    for (const rel of await find(box, gitRoot, "-path '*app/layout.tsx'")) {
      const abs = `${gitRoot}/${rel}`;
      const cur = await readFile(box, abs);
      if (!cur) continue;
      if (cur.includes(REPORTER_BASENAME)) {
        out.already++;
        continue;
      }
      const body = cur.match(/<body[^>]*>/);
      if (!body) continue;
      const dir = rel.slice(0, rel.lastIndexOf('/'));
      await box.writeFile(
        `${gitRoot}/${dir}/${REPORTER_BASENAME}.tsx`,
        NEXT_REPORTER_TSX,
      );
      const next =
        `import { AnedRouteReporter } from './${REPORTER_BASENAME}';\n${cur}`.replace(
          body[0],
          `${body[0]}<AnedRouteReporter />`,
        );
      await box.writeFile(abs, next);
      await box
        .exec(
          `grep -qxF '**/${REPORTER_BASENAME}.tsx' .git/info/exclude 2>/dev/null || echo '**/${REPORTER_BASENAME}.tsx' >> .git/info/exclude`,
          { cwd: gitRoot },
        )
        .catch(() => {});
      await freezeInGit(box, gitRoot, rel);
      out.injected++;
      out.files.push(rel);
    }

    if (!out.injected && !out.already)
      out.reason = 'no index.html or Next app/layout.tsx found in the repo';
    console.log('[route-reporter]', JSON.stringify(out));
    return out;
  } catch (e) {
    out.reason = e instanceof Error ? e.message : String(e);
    console.log('[route-reporter] error', out.reason);
    return out;
  }
}
