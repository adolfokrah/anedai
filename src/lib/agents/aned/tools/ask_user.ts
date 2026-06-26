import { z } from 'zod';

import { defineTool } from '../../runtime/define';

export default defineTool({
  description:
    'Ask the user clarifying questions to gather their preferences/decisions before proceeding (e.g. design direction, theme, content choices). Each question shows selectable options plus an optional free-text "other". Calling this PRESENTS a form and ENDS your turn — the user picks answers and you continue on the NEXT turn. Use 2–5 focused questions; provide your recommended option first.',
  inputSchema: z.object({
    questions: z.array(
      z.object({
        id: z.string(),
        question: z.string(),
        options: z.array(z.string()),
        allowOther: z.boolean().optional(),
        multi: z.boolean().optional(),
      }),
    ),
  }),
  execute: ({ questions }, ctx) => {
    ctx.onAsk?.(questions);
    return 'Questions presented to the user. STOP now — wait for their reply (it arrives as the next message).';
  },
});
