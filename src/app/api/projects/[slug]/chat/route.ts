import { type ChatImage, runProjectChat } from '@/lib/agent/run';
import { runProjectChatAISDK } from '@/lib/agents';
import { resolveAnedConfig } from '@/lib/aned-config';
import { getGithubToken } from '@/lib/auth';
import { DS_FILE_LAYOUT } from '@/lib/design-system';
import { authedRemote, findOpenPullRequest, parseRepo } from '@/lib/github';
import { ensureRouteReporter } from '@/lib/route-reporter';
import type { Box } from '@/lib/runtime/types';
import { appDir, workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';
import { ndjsonResponse } from '@/lib/stream';
import { captureThumb } from '@/lib/thumb';
import type { ProjectManifest } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatBody {
  message: string;
  model?: string;
  images?: ChatImage[];
  viewing?: string;
  mode?: 'build' | 'plan';
  skill?: string;
}

function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const loaded = await getProject(slug);
  if (!loaded) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  const manifest: ProjectManifest = loaded;
  const body = (await req.json().catch(() => ({}))) as ChatBody;
  if (!body.message?.trim()) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Bridge the request's abort signal to the agent's AbortController (Stop).
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());

  // The connected user's GitHub token (or env fallback) — the agent uses it.
  const ghToken = await getGithubToken(req);

  return ndjsonResponse(async (emit) => {
    let box: Box;
    try {
      box = await connectBox(manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'done', ok: false, manifest, error: message });
      return;
    }

    const app = await appDir(box);

    // Preconfigure the sandbox so the AGENT can do git itself: committer
    // identity + an authenticated `origin` (token embedded). `gh` reads
    // GH_TOKEN, injected into the agent's run_cmd env (see runProjectChat).
    try {
      let setup =
        'git config user.email agent@aned.dev && git config user.name Aned';
      if (manifest.repoUrl && ghToken) {
        const { owner, repo } = parseRepo(manifest.repoUrl);
        const remote = authedRemote(owner, repo, ghToken);
        setup += ` && (git remote set-url origin ${shellArg(remote)} || git remote add origin ${shellArg(remote)})`;
      }
      await box.exec(setup, { cwd: app });
    } catch {
      // best-effort
    }

    const planning = body.mode === 'plan';
    // Agent engine: AI SDK (multi-provider) when AGENT_ENGINE=aisdk, else the
    // claude-agent-sdk path. Same signature + event stream, so the flag is the
    // only difference the route sees.
    const engine =
      process.env.AGENT_ENGINE === 'aisdk'
        ? runProjectChatAISDK
        : runProjectChat;
    const result = await engine(box, manifest, body.message, emit, {
      resume: manifest.sessionId,
      model: body.model,
      images: body.images,
      viewing: body.viewing,
      skill: body.skill,
      githubToken: ghToken ?? undefined,
      abortController,
      mode: body.mode,
    });

    let updated = result.sessionId
      ? await updateProject(slug, { sessionId: result.sessionId })
      : manifest;

    // The AGENT owns git (branch/commit/push/PR). Aned only DISCOVERS the
    // result so the toolbar can show View PR / Merge: record the current branch
    // and look up the open PR the agent opened (read-only — Aned doesn't push or
    // open PRs itself).
    if (result.ok && !planning) {
      try {
        const base = manifest.baseBranch ?? 'main';
        const cur = (
          await box.exec('git branch --show-current', { cwd: app })
        ).stdout.trim();
        const patch: Partial<ProjectManifest> = {};
        if (cur && cur !== base) patch.branch = cur;

        if (manifest.repoUrl && ghToken && cur && cur !== base) {
          const { owner, repo } = parseRepo(manifest.repoUrl);
          const pr = await findOpenPullRequest(owner, repo, cur, ghToken).catch(
            () => null,
          );
          if (pr) {
            patch.prUrl = pr.url;
            patch.prNumber = pr.number;
          }
        }
        if (Object.keys(patch).length)
          updated = await updateProject(slug, patch);
      } catch {
        // best-effort
      }

      // design-system.json records the in-app DS route (same-server case).
      try {
        const work = await workDir(box, manifest);
        const raw = await box
          .readFile(`${work}/${DS_FILE_LAYOUT.manifest}`)
          .catch(() => '');
        const route = raw ? (JSON.parse(raw) as { route?: string }).route : '';
        if (route && route !== updated.designRoute)
          updated = await updateProject(slug, { designRoute: route });
      } catch {
        // no design system yet, or unparseable — ignore
      }

      // anedai.json is the authoritative runtime wiring: which server (port +
      // route) backs the Pages tab vs a SEPARATE design-system/docs server.
      // Resolve it to public URLs and persist so the tabs hit the right ports.
      try {
        const work = await workDir(box, manifest);
        const r = await resolveAnedConfig(box, work);
        const patch: Partial<ProjectManifest> = {};
        if (r.previewUrl && r.previewUrl !== updated.previewUrl)
          patch.previewUrl = r.previewUrl;
        if (r.devPort && r.devPort !== updated.devPort)
          patch.devPort = r.devPort;
        if (r.docsPreviewUrl && r.docsPreviewUrl !== updated.docsPreviewUrl)
          patch.docsPreviewUrl = r.docsPreviewUrl;
        if (r.docsPort && r.docsPort !== updated.docsPort)
          patch.docsPort = r.docsPort;
        if (r.backendUrl && r.backendUrl !== updated.backendUrl)
          patch.backendUrl = r.backendUrl;
        if (r.backendPort && r.backendPort !== updated.backendPort)
          patch.backendPort = r.backendPort;
        if (Object.keys(patch).length)
          updated = await updateProject(slug, patch);
      } catch {
        // no anedai.json yet — the live start_app wiring still applies
      }

      // Once the app is running, inject the dev-only route reporter so the
      // workspace address bar tracks the live page (cross-origin iframes can't
      // be read directly). One-time, idempotent, kept out of git, best-effort.
      if (updated.previewUrl && !updated.routeReporter) {
        try {
          const r = await ensureRouteReporter(box, app);
          if (r.injected || r.already)
            updated = await updateProject(slug, { routeReporter: true });
        } catch {
          // best-effort — manual address-bar navigation still works
        }
      }

      // Refresh the project thumbnail to reflect the new UI (best-effort).
      void captureThumb(slug, updated.previewUrl);
    }

    emit({
      type: 'done',
      ok: result.ok,
      manifest: updated,
      sessionId: result.sessionId,
      error: result.error,
    });
  });
}
