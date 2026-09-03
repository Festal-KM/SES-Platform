// tests/static/__fixtures__/execute-guard/alias-spoof.violation.ts
// 🔴 違反 fixture: **別のガードを `requireExecutable` という名前で import した偽装**。
//    `import { requireRole as requireExecutable }` は、ファイル中に `requireExecutable` という
//    識別子を作り出すが、実体は `requireRole` であり**テナント状態ゲートは掛かっていない**。
//    import の「元名」で判定しないと、この形が静かに素通りする（code-reviewer 指摘）。
//    ⚠️ このファイルはビルド対象外である（tsconfig.tests.json の exclude）。
import { requireRole as requireExecutable } from '../../../../apps/web/lib/api/guards';
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

export const POST = withApiRoute(
  { label: 'fixture', guards: [requireExecutable(['OWNER'])] },
  async () => new Response(null, { status: 204 }),
);
