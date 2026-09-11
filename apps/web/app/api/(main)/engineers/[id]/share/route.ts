// apps/web/app/api/(main)/engineers/[id]/share/route.ts
// `PUT /api/engineers/{id}/share`（docs/05 §6.4 #29。`F-016` / `S-015`）。T-08-02。
//
// 🔴 **越境経路 4（`CLAUDE.md` §3.1）を開閉する唯一の書き込み経路である。**
//
// 🔴 **`PARTNER_ADMIN` / `PARTNER_SALES` のみ。ホストは 403**（docs/05 §6.4 #29 /
//    `F-016` 関連ロール「ホスト側ロールはこの設定を変更できない」）。`VIEWER` も同様に
//    このロール一覧に無いため 403 になる（`docs/04` §S-015「パートナー VIEWER は変更不可」）。
//
// 🔴 **`{id}` は操作対象の指定であって実行者のスコープではない。** 母集団は `engineers` の
//    RLS（C3 OWNER_SCOPED）が決め、境界外の ID は 404 になる（docs/05 §4.8
//    「見えない ＝ 存在しない」）。したがって**他パートナーのエンジニアを共有可にできない**
//    —— ID を知っていても、そのエンジニアは自分の文脈で実在しない。
//
// 🔴 **一括経路を作らない**（`F-016 AC-1` / `BR-53`）。対象は path の 1 件だけであり、
//    body は `{ shared: boolean }` の 1 項目である（`lib/engineer-shares/schemas.ts`）。
//
// 🔴 **`withApiRoute` の `audit` オプションを使わない。** 記録は
//    `setEngineerShare` の**業務トランザクション内**（`writeAuditLog`）で書く。理由は 2 つで、
//    どちらも `skill_sheet.*` / `skill_alias.update` と同じである（docs/05 §16.1）:
//      ①`audit` はハンドラの前に別トランザクションで書くため、**起きなかった操作**
//        （404 / 冪等な no-op）まで「共有を開始した」として残る
//      ②開始（`engineer_share.create`）と停止（`engineer_share.update`）の区別は
//        **既存行の有無**であり、行を読むまで決まらない
//
// 🔴 `requireExecutable` を掛ける（`F-004 AC-7` / `AC-8`。`tests/static/execute-guard.test.ts` が
//    全ての実行系ルートに要求する）。停止中・解約手続き中のテナントで共有の設定を動かせない
//    のは、共有が「ホストの候補一覧に人を出す」実行系の操作だからである。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { ENGINEER_SHARE_ROLES } from '../../../../../../lib/engineer-shares/policy';
import {
  engineerShareBodySchema,
  engineerShareParamsSchema,
} from '../../../../../../lib/engineer-shares/schemas';
import { setEngineerShare } from '../../../../../../lib/engineer-shares/service';
import { toJstIsoDay } from '../../../../../../lib/format/datetime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/engineers/{id}/share',
    guards: [
      requireRole(ENGINEER_SHARE_ROLES),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: engineerShareParamsSchema,
    body: engineerShareBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await setEngineerShare(
        ctx,
        params.id,
        body.shared,
        { ipAddress: meta.ipAddress },
        toJstIsoDay(new Date()),
      ),
    );
  },
);
