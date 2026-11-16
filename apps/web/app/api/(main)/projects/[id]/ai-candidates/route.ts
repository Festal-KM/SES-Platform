import { z } from 'zod';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { readAiCandidates, startAiCandidates } from '../../../../../../lib/candidates/ai-service';
import { candidateProjectParamsSchema } from '../../../../../../lib/candidates/schemas';
import { PROJECT_EDITOR_ROLES } from '../../../../../../lib/projects/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute({
  label: 'POST /api/projects/{id}/ai-candidates',
  guards: [requireRole([...PROJECT_EDITOR_ROLES]), requireExecutable(), requireNotViewer()],
  params: candidateProjectParamsSchema,
  body: z.object({ message: z.string().trim().max(1000) }).strict(),
}, async ({ ctx, params, body }) => {
  const meta = await readRequestMeta();
  return Response.json(await startAiCandidates(ctx, params.id, body.message, meta.ipAddress), { status: 202 });
});

export const GET = withApiRoute({
  label: 'GET /api/projects/{id}/ai-candidates',
  guards: [requireRole([...PROJECT_EDITOR_ROLES]), requireExecutable(), requireNotViewer()],
  params: candidateProjectParamsSchema,
  query: z.object({ runId: z.uuid() }).strict(),
}, async ({ ctx, params, query }) => {
  const meta = await readRequestMeta();
  return Response.json(await readAiCandidates(ctx, params.id, query.runId, meta.ipAddress));
});
