import { z } from 'zod';
import { isSafeIntakeSkill } from '@ses/domain';
import { createIntakeAiRun, failPendingIntakeAiRun, readIntakeAiRun, requireHost } from '@ses/db';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { NotFoundError } from '../../../../lib/api/errors';
import { requireIntakeParseQueue } from '../../../../lib/jobs/intake-parse-queue';

const skills = z.array(z.string().trim().min(1).max(80).refine(isSafeIntakeSkill)).max(50);
const inputSchema = z.object({ kind: z.enum(['PROJECT', 'ENGINEER']), skills }).strict();
const outputSchema = z.object({ skills });
const editable = ['OWNER', 'ADMIN', 'SALES'] as const;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute({
  label: 'POST /api/ai-intake', guards: [requireRole([...editable]), requireExecutable(), requireNotViewer()], body: inputSchema,
}, async ({ ctx, body }) => {
  requireHost(ctx);
  const normalized = [...new Set(body.skills.map((name) => name.normalize('NFKC').trim()))];
  const run = await createIntakeAiRun(ctx, { kind: body.kind, payload: { skills: normalized }, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  try { await requireIntakeParseQueue().enqueue({ tenantId: ctx.tenantId, runId: run.id }); }
  catch (error) { await failPendingIntakeAiRun(ctx, run.id); throw error; }
  return Response.json({ runId: run.id }, { status: 202 });
});

export const GET = withApiRoute({
  label: 'GET /api/ai-intake', guards: [requireRole([...editable]), requireExecutable(), requireNotViewer()], query: z.object({ runId: z.uuid() }).strict(),
}, async ({ ctx, query }) => {
  requireHost(ctx);
  const run = await readIntakeAiRun(ctx, { id: query.runId, now: new Date() });
  if (!run) throw new NotFoundError();
  if (run.status === 'FAILED') return Response.json({ status: 'FAILED' });
  if (run.status !== 'COMPLETED') return Response.json({ status: 'PENDING' });
  const original = outputSchema.parse(run.input).skills;
  const output = outputSchema.parse(run.output).skills;
  const allowed = new Set(original);
  if (new Set(output).size !== output.length || output.some((name) => !allowed.has(name))) throw new Error('スキル整理の応答が不正です');
  return Response.json({ status: 'COMPLETED', skills: original.filter((name) => output.includes(name)) });
});
