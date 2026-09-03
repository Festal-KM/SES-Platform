// apps/web/app/(main)/_home/home-sections.tsx
// `S-003`（ホスト）/ `S-004`（取引先）の Phase 0 表示（docs/04 §S-003 / §S-004 / `F-006`）。
//
// 🔴 Phase 0 は空のダッシュボード（CLAUDE.md §5）。要対応キュー・満了が近い稼働・提案依頼などの
//    セクションは Phase 1 / Phase 2 が追加する（`docs/sprints/SP-03` T-03-06）。ここでは
//    「境界の適用（②）と説明（③）」だけを Phase 0 のうちに成立させる（`F-006` 処理）。
// 🔴 `S-003` / `S-004` は T1（モバイル完結）。単一カラムで、機能の省略をしない（docs/04）。
//    Tailwind の既定ブレークポイントのみを使う（独自定義しない。CLAUDE.md §13.3）。
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ses/ui';
import { t } from '@ses/i18n';

export function HostHomeSections() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('home.host.empty.title')}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * 🔴 F-006 AC-2: 「自社に見えない情報が存在すること」の説明文を常時表示する。
 *    `noticeText` は固定文言（`home.partner.visibilityNotice`）のみを受け取り、
 *    件数・存在の示唆を一切含まない（呼び出し側で差し込みを行わない）。
 */
export function PartnerHomeSections({ noticeText }: { readonly noticeText: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('home.partner.empty.title')}</CardTitle>
        </CardHeader>
      </Card>
      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="pt-4">
          <CardDescription className="text-slate-600">{noticeText}</CardDescription>
        </CardContent>
      </Card>
    </div>
  );
}
