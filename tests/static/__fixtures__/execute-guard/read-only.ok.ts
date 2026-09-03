// tests/static/__fixtures__/execute-guard/read-only.ok.ts
// 適合 fixture: 読み取り専用（GET だけ）のルートは `requireExecutable` を要求されない。
// 🔴 `CLOSING` でも閲覧はできる（F-004 AC-8）ため、閲覧に状態ゲートを掛けてはならない。
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

export const GET = withApiRoute({ label: 'fixture', guards: [] }, async () =>
  Response.json({ items: [] }),
);
