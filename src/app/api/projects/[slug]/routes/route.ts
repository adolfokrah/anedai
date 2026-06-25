import { NextResponse } from 'next/server';

import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Best-effort list of preview-able routes.
 *  - Next (file-based): App Router `app/**\/page.*` + Pages Router `pages/**`.
 *  - SPA (react-router / tanstack): grep real `path="…"` route definitions in
 *    source — NOT filenames (a `pages/` folder there is just components).
 * Always includes "/". Returns paths like "/", "/accounts".
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const box = await connectBox(manifest);
    const app = await appDir(box);

    let pkg: { dependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(await box.readFile(`${app}/package.json`));
    } catch {
      // ignore
    }
    const hasNext = 'next' in { ...pkg.dependencies };

    const routes = new Set<string>(['/']);

    if (hasNext) {
      const r = await box.exec(
        `cd ${app} && find app src/app pages src/pages -type f \\( -name 'page.tsx' -o -name 'page.jsx' -o -name 'page.ts' -o -name 'page.js' \\) -o -path '*/pages/*.tsx' -o -path '*/pages/*.jsx' 2>/dev/null | head -200 || true`,
        { timeoutMs: 15_000 },
      );
      for (const line of r.stdout.split('\n')) {
        const route = fileToRoute(line.trim());
        if (route) routes.add(route);
      }
    } else {
      // SPA: extract route path strings from source (react-router / tanstack).
      const r = await box.exec(
        `cd ${app} && grep -rhoE "path\\s*[:=]\\s*[\\"'][^\\"']+[\\"']" src 2>/dev/null | head -300 || true`,
        { timeoutMs: 15_000 },
      );
      for (const line of r.stdout.split('\n')) {
        const route = pathStringToRoute(line.trim());
        if (route) routes.add(route);
      }
    }

    return NextResponse.json([...routes].sort());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Map a Next router file path to its URL route, or null. */
function fileToRoute(file: string): string | null {
  if (!file) return null;
  let p = file.replace(/^(\.\/)?(src\/)?/, '');

  if (p.startsWith('app/')) {
    if (!/\/page\.(t|j)sx?$/.test(p)) return null;
    p = p.replace(/^app\//, '').replace(/\/?page\.(t|j)sx?$/, '');
  } else if (p.startsWith('pages/')) {
    p = p.replace(/^pages\//, '').replace(/\.(t|j)sx?$/, '');
    if (/^(_app|_document|_error)$/.test(p) || p.startsWith('api/'))
      return null;
    p = p.replace(/\/index$/, '').replace(/^index$/, '');
  } else {
    return null;
  }

  p = p
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg)) // drop route groups
    .join('/');
  return normalize(p);
}

/** Pull the route path from a grep hit like `path="/accounts"`. */
function pathStringToRoute(line: string): string | null {
  const m = line.match(/[:=]\s*["']([^"']+)["']/);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  // Skip catch-alls, params-only, and obvious non-routes.
  if (!raw || raw === '*' || raw === '/*' || raw.includes(':')) return null;
  if (/\.(css|tsx?|jsx?|svg|png|json)$/i.test(raw)) return null;
  return normalize(raw.replace(/^\.?\//, ''));
}

function normalize(p: string): string {
  return `/${p}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
}
