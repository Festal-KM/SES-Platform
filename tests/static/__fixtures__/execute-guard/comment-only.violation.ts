// tests/static/__fixtures__/execute-guard/comment-only.violation.ts
// 🔴 違反 fixture: コメントで requireExecutable に言及しているだけで、コードでは通していない。
//    AST 走査（識別子の参照）で見るため、コメントは根拠にならないことを確かめる。
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

// TODO: requireExecutable() をあとで付ける
export const DELETE = withApiRoute({ label: 'fixture', guards: [] }, async () =>
  new Response(null, { status: 204 }),
);
