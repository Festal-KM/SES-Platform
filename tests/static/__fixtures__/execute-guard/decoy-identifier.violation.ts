// tests/static/__fixtures__/execute-guard/decoy-identifier.violation.ts
// 🔴 違反 fixture: `requireExecutable` という名前のローカル関数を自前で定義しただけの偽装。
//    lib/api/guards からの import を伴わない参照は根拠にならないことを確かめる。
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

function requireExecutable(): { stage: 'executable'; run: () => void } {
  return { stage: 'executable', run: () => undefined };
}

export const POST = withApiRoute({ label: 'fixture', guards: [requireExecutable()] }, async () =>
  new Response(null, { status: 204 }),
);
