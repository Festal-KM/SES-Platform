// apps/web/app/api/(main)/engineer-shares/route.ts
// `GET /api/engineer-shares`（docs/05 §6.4 #29。`F-016` / `S-015`）。T-08-02。
//
// 🔴 **`PARTNER_ADMIN` / `PARTNER_SALES` のみ。ホストは 403**（docs/05 §6.4 #29 の備考 /
//    `docs/04` §S-015 権限差分「ホスト側ロールにはこの画面が存在しない」）。
//    経路 4 の**主導権は最後まで取引先にある**（`F-016` 関連ロール）。
//    ⚠️ 403 はロールの一覧だけで決まる（`requireRole` は ctx しか見ない）。所属の軸は
//    `listEngineerShares` の `assertPartnerContext` が二重に見る。
//
// 🔴 **`POST` / `PUT` / `DELETE` をここに置かない。** 共有の変更は
//    `PUT /api/engineers/{id}/share` の **1 件単位**だけであり、コレクションに対する
//    書き込み（＝ 一括で全件をオンにできる形）を作らない（`F-016 AC-1` / `BR-53`）。
//
// 🔴 **`AuditLog` を書かない。** `BR-27` / `F-008 AC-4` の記録対象は「エンジニア**詳細**の閲覧」
//    であり、本画面は自社の台帳の氏名と共有状態の一覧である（`GET /api/engineers`（#15）と
//    同じ線引き。docs/05 §6.4「#15 の実装の決着（T-05-09）」）。記録するのは
//    **共有の開始・停止**（`F-016 AC-4`）であり、それは `#29` の PUT が業務トランザクション内で書く。
//
// 🔴 読み取り専用なので `requireExecutable` / `requireNotViewer` を掛けない
//    （`CLOSING` でも閲覧できる = `F-004 AC-8`）。
import { requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { ENGINEER_SHARE_ROLES } from '../../../../lib/engineer-shares/policy';
import { listEngineerShares } from '../../../../lib/engineer-shares/service';
import { toJstIsoDay } from '../../../../lib/format/datetime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/engineer-shares',
    guards: [requireRole(ENGINEER_SHARE_ROLES)],
  },
  // 🔴 基準日は**呼び出し側**が作る（`packages/domain` に現在時刻を持ち込まない。
  //    docs/05 §4.6.1）。`toJstIsoDay` を通すのは `AnonymousCandidateView.updatedOn` と
  //    粒度・基準をそろえるためである（同 §4.6.3 の申し送り）。
  async ({ ctx }) => Response.json(await listEngineerShares(ctx, toJstIsoDay(new Date()))),
);
