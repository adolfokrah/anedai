import { configuredModels, defaultModel } from '@/lib/agent/provider';

export const dynamic = 'force-dynamic';

/**
 * Which models the UI shows. API keys are server-secret, so the client can't
 * derive availability — it asks here. Returns every model whose provider key is
 * configured, each tagged `available` (false = disabled → shown greyed, not
 * selectable), plus the default for new projects.
 */
export async function GET() {
  return Response.json({
    models: configuredModels(),
    default: defaultModel(),
  });
}
