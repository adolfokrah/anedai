import { type ChatImage, runProjectChat } from '@/lib/agent/run';
import { getGithubToken } from '@/lib/auth';
import { commitAll, ensureBranch, pullBase, push } from '@/lib/git';
import { getPullRequestState, openPullRequest, parseRepo } from '@/lib/github';
import type { Box } from '@/lib/runtime/types';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';
import { ndjsonResponse } from '@/lib/stream';
import type { ProjectManifest } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatBody {
  message: string;
  model?: string;
  images?: ChatImage[];
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
  let manifest: ProjectManifest = loaded;
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

  // GitHub token for auto push/PR (the connected user's, or env fallback).
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

    // If the recorded PR was merged/closed (e.g. merged on GitHub), this
    // session is done — start a FRESH branch off the updated base so new work
    // isn't stuck on a merged branch with no PR.
    if (manifest.repoUrl && ghToken && manifest.prNumber) {
      try {
        const { owner, repo } = parseRepo(manifest.repoUrl);
        const st = await getPullRequestState(
          owner,
          repo,
          manifest.prNumber,
          ghToken,
        );
        if (st.merged || st.state === 'closed') {
          const app = await appDir(box);
          const base = manifest.baseBranch ?? 'main';
          await pullBase(box, app, base, manifest.repoUrl, ghToken);
          const n = (manifest.sessionN ?? 1) + 1;
          const branch = `aned/${slug}-${n}`;
          await ensureBranch(box, app, branch, base);
          manifest = await updateProject(slug, {
            branch,
            sessionN: n,
            prUrl: undefined,
            prNumber: undefined,
          });
          emit({
            type: 'log',
            line: `previous PR ${st.merged ? 'merged' : 'closed'} — started ${branch}`,
          });
        }
      } catch {
        // best-effort; fall through
      }
    }

    // Guard: never edit on the base branch. Ensure we're on the working
    // branch (created off base if missing) BEFORE the agent touches files.
    try {
      const app = await appDir(box);
      await ensureBranch(
        box,
        app,
        manifest.branch,
        manifest.baseBranch ?? 'main',
      );
    } catch (err) {
      emit({
        type: 'log',
        line: `git: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const result = await runProjectChat(box, manifest, body.message, emit, {
      resume: manifest.sessionId,
      model: body.model,
      images: body.images,
      abortController,
    });

    let updated = result.sessionId
      ? await updateProject(slug, { sessionId: result.sessionId })
      : manifest;

    // After a successful task: commit to the working branch; push if there's a
    // remote. Best-effort — never fail the turn on a git hiccup.
    if (result.ok) {
      try {
        const app = await appDir(box);
        // Conventional Commit subject from the agent (fallback to chore:).
        const subject = conventional(result.summary, body.message);
        const committed = await commitAll(box, app, subject);
        if (committed && updated.repoUrl && ghToken) {
          await push(box, app, updated.branch, updated.repoUrl, ghToken);
          emit({ type: 'log', line: `pushed ${updated.branch}` });
        } else if (committed) {
          emit({ type: 'log', line: `committed to ${updated.branch}` });
        }
        // Auto-open a PR once connected, so View PR / Merge appear without a
        // manual Ship. Reuses the open one if it already exists.
        if (updated.repoUrl && ghToken && !updated.prNumber) {
          const { owner, repo } = parseRepo(updated.repoUrl);
          const pr = await openPullRequest({
            owner,
            repo,
            head: updated.branch,
            base: updated.baseBranch ?? 'main',
            title: subject,
            body: 'Changes generated in an Aned sandbox.',
            token: ghToken,
          });
          await updateProject(slug, { prUrl: pr.url, prNumber: pr.number });
          emit({ type: 'log', line: 'opened pull request' });
        }
      } catch (err) {
        emit({
          type: 'log',
          line: `git: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      updated = (await getProject(slug)) ?? updated;
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

const CONVENTIONAL =
  /^(feat|fix|chore|refactor|docs|style|test|perf|build|ci)(\(.+?\))?!?:\s+.+/i;

/** Agent's conventional subject, else a chore: fallback from the request. */
function conventional(summary: string | undefined, message: string): string {
  if (summary && CONVENTIONAL.test(summary)) return summary.slice(0, 72);
  return `chore: ${message.trim().slice(0, 60)}`;
}
