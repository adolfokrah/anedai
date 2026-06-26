/**
 * Headless-browser console capture (server-side, like lib/thumb.ts). Loads a
 * preview URL with Chromium and collects what only shows up in the BROWSER —
 * console messages, uncaught page errors, and failed network requests — which
 * the server-side dev log (.aned-dev.log) never sees.
 */

export interface ConsoleMessage {
  type: string;
  text: string;
}
export interface FailedRequest {
  url: string;
  reason: string;
}
export interface ConsoleCapture {
  ok: boolean;
  logs: ConsoleMessage[];
  pageErrors: string[];
  failed: FailedRequest[];
  /** Set if the page itself failed to load. */
  loadError?: string;
}

export async function captureConsole(
  url: string,
  waitMs = 2500,
): Promise<ConsoleCapture> {
  // Lazy import so Playwright/Chromium only load when this tool runs.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const logs: ConsoleMessage[] = [];
  const pageErrors: string[] = [];
  const failed: FailedRequest[] = [];
  let loadError: string | undefined;
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => pageErrors.push(e.stack || e.message));
    page.on('requestfailed', (r) =>
      failed.push({
        url: r.url(),
        reason: r.failure()?.errorText ?? 'request failed',
      }),
    );
    try {
      // `domcontentloaded`, not `networkidle`: a dev server's HMR socket keeps
      // the network busy so networkidle would always time out. We catch
      // runtime/hydration errors during the settle wait below instead.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
    // Let client-side render + effects run so runtime errors surface.
    await page.waitForTimeout(Math.min(Math.max(waitMs, 0), 8000));
    return { ok: !loadError, logs, pageErrors, failed, loadError };
  } finally {
    await browser.close();
  }
}
