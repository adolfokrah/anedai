/**
 * Project thumbnails. We screenshot the project's PUBLIC preview URL (tokenless,
 * public:true) with headless Chromium and store one PNG per project. Captured
 * after seed + each build; served by the /thumb route and shown on the projects
 * list. Best-effort — failures never block the build.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data', 'projects');

export function thumbPath(slug: string): string {
  return path.join(DIR, `${slug}.thumb.png`);
}

const capturing = new Set<string>();

/**
 * Screenshot a preview URL → data/projects/<slug>.thumb.png. Fire-and-forget;
 * de-duped per slug so overlapping triggers don't pile up browsers.
 */
export async function captureThumb(slug: string, url?: string): Promise<void> {
  if (!url || capturing.has(slug)) return;
  capturing.add(slug);
  try {
    // Lazy import so Playwright/Chromium only load when a capture runs.
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
      // Let entrance animations settle.
      await page.waitForTimeout(1200);
      await fs.mkdir(DIR, { recursive: true });
      await page.screenshot({ path: thumbPath(slug), fullPage: false });
    } finally {
      await browser.close();
    }
  } catch {
    // headless capture failed (browser missing, preview slow) — ignore
  } finally {
    capturing.delete(slug);
  }
}
