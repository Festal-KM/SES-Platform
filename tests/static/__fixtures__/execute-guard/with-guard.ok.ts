// tests/static/__fixtures__/execute-guard/with-guard.ok.ts
// 適合 fixture: 実行系（POST）が `requireExecutable` を通している Route Handler。
import { requireExecutable, requireRole } from '../../../../apps/web/lib/api/guards';
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

export const POST = withApiRoute(
  { label: 'fixture', guards: [requireRole(['OWNER']), requireExecutable()] },
  async () => new Response(null, { status: 204 }),
);
