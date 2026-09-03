// tests/static/__fixtures__/execute-guard/missing-guard.violation.ts
// 🔴 違反 fixture: 実行系（POST）なのに `requireExecutable` を通していない Route Handler。
//    tests/static/execute-guard.test.ts がこれを検出できることを確かめる（対照）。
//    ⚠️ このファイルはビルド対象外である（tsconfig.tests.json の exclude）。
import { requireRole } from '../../../../apps/web/lib/api/guards';
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

export const POST = withApiRoute(
  { label: 'fixture', guards: [requireRole(['OWNER'])] },
  async () => new Response(null, { status: 204 }),
);
