import { generateObject } from 'ai';
import { z } from 'zod';

import { defineSubagent } from '../../../runtime/define';

const REVIEW_SCHEMA = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      file: z.string(),
      line: z.number().optional(),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
  summary: z.string(),
});

export default defineSubagent({
  description:
    'Review the current uncommitted diff before committing/opening a PR. Returns structured, severity-tagged findings (real issues only). Call right before you commit.',
  instructions: 'Structured diff reviewer.',
  // Custom executor: fetch the diff ourselves, then ask for structured findings.
  run: async (message, ctx) => {
    const diff = (
      await ctx.box.exec('git diff HEAD', { cwd: ctx.app, timeoutMs: 20_000 })
    ).stdout;
    if (!diff.trim()) return 'No uncommitted changes to review.';
    ctx.emit({ type: 'tool', name: 'reviewer:git diff' });
    const { object } = await generateObject({
      model: ctx.model,
      schema: REVIEW_SCHEMA,
      prompt: `${message ? `Focus: ${message}\n\n` : ''}Review this uncommitted diff like a strict senior engineer. Report ONLY real bugs, security issues, or regressions — no style nits. For each: severity, file, line (if known), the problem, and the fix.\n\n${diff.slice(0, 60_000)}`,
    });
    return JSON.stringify(object);
  },
});
