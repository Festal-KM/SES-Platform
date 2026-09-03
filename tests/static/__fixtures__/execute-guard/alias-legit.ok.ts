// tests/static/__fixtures__/execute-guard/alias-legit.ok.ts
// 適合 fixture: **本体を alias して使う**正当な形（`requireExecutable as executableGuard`）。
//    元名が一致するので束縛を追跡でき、ローカル名の参照で PASS しなければならない
//    （偽装の検出を厳しくした結果、正当な alias を誤検知していないことの対照）。
import {
  requireExecutable as executableGuard,
  requireRole,
} from '../../../../apps/web/lib/api/guards';
import { withApiRoute } from '../../../../apps/web/lib/api/withApiRoute';

export const PATCH = withApiRoute(
  { label: 'fixture', guards: [requireRole(['OWNER']), executableGuard()] },
  async () => new Response(null, { status: 204 }),
);
