// apps/web/app/(main)/_home/home-sections.tsx
// `S-003`（ホスト）/ `S-004`（取引先）の Phase 0 表示（docs/04 §S-003 / §S-004 / `F-006`）。
//
// 🔴 Phase 0 は空のダッシュボード（CLAUDE.md §5）。要対応キュー・満了が近い稼働・提案依頼などの
//    セクションは Phase 1 / Phase 2 が追加する（`docs/sprints/SP-03` T-03-06）。ここでは
//    「境界の適用（②）と説明（③）」だけを Phase 0 のうちに成立させる（`F-006` 処理）。
// 🔴 `S-003` / `S-004` は T1（モバイル完結）。単一カラムで、機能の省略をしない（docs/04）。
//    Tailwind の既定ブレークポイントのみを使う（独自定義しない。CLAUDE.md §13.3）。
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ses/ui';
import { t } from '@ses/i18n';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import type { HomeBlock, ScanQuarantineHomeBlock } from '../../../lib/home/types';

/**
 * 🔴 T-05-01: `docs/04` §S-003 の初回空は「`S-012` / `S-007` への導線 2 本」である。
 *    T-03-06 の時点では両画面とも未実装だったため導線を置かなかった（404 のリンクを作らない
 *    判断。T-03-06 の申し送り）。本タスクで `S-007` が実在するようになったので有効化する。
 *    🔴 **`S-012`（案件の登録）は SP-06 まで導線を作らない** —— 存在しない画面へのリンクは、
 *    利用者にとって「壊れている」であって「これから作る」ではない。
 *
 * 🔴 `canRegisterEngineer = false`（`VIEWER`）のときは導線を**描かない**（`docs/04` §S-007
 *    権限差分「`VIEWER` は到達できない」）。到達できない画面へのリンクを出すと、押した利用者は
 *    ホームへ黙って戻されるだけで、何が起きたのか分からない。
 *    ⚠️ これは UI の配慮であって境界の担保ではない。拒否の本体は `#16` の `requireRole` /
 *    `requireNotViewer`（`BR-31` / `F-004 AC-6` / `AC-9`）と `S-007` のリダイレクトである。
 */
export function HostHomeSections({
  canRegisterEngineer,
}: {
  readonly canRegisterEngineer: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('home.host.empty.title')}</CardTitle>
      </CardHeader>
      {canRegisterEngineer ? (
        <CardContent>
          <Link
            className="ses-secondary-link"
            href="/engineers/new"
            data-testid="home-host-register-engineer"
          >
            {t('home.host.empty.registerEngineer')}
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * 🔴 F-006 AC-2: 「自社に見えない情報が存在すること」の説明文を常時表示する。
 *    `noticeText` は固定文言（`home.partner.visibilityNotice`）のみを受け取り、
 *    件数・存在の示唆を一切含まない（呼び出し側で差し込みを行わない）。
 */
/**
 * 🔴 スキャン失敗・隔離の周知（`docs/02` `F-011` 処理④ / `docs/04` §S-008「スキャン失敗 /
 *    感染検出」）。T-05-08。
 *
 * ============================================================================
 * 🔴 なぜホームに出すのか
 * ============================================================================
 * `S-008`（スキルシートの版一覧）には既に状態バッジがあるが、**そのエンジニアの画面を開かないと
 * 見えない**。隔離は「上げ直す」までファイルが一切使えない状態であり、気づかれないまま放置されると
 * 提案の直前に発覚する。`F-011` 処理④ が「担当者に周知する」と定めているのはこのためである。
 *
 * 🔴 **宛先分類によらず必ず描く。** `sandbox` では取引先の担当者宛のメールがモックになる
 *    （`A-22` / `CLAUDE.md` §11.1）ため、パートナーにとってはここが唯一の気づく場所である。
 * 🔴 **ロールで隠さない。** `VIEWER` も見える —— 見せないと「なぜダウンロードできないのか」が
 *    分からないままになる（`S-008` の隔離行に理由を出しているのと同じ判断）。
 * 🔴 氏名を出さない（`BR-27`。ホームは 60 秒ごとに読み直される画面であり、氏名を出すと
 *    `engineer.view` の記録が毎分積まれる）。誰のものかは、行から辿った `S-008` が示す。
 * 🔴 **0 件のときはセクションごと出さない**（`docs/04` §S-004「0 件を出すと圧に見える」と
 *    同じ判断。隔離が無いことは正常であり、常設の空箱は注意を薄める）。
 */
export function ScanQuarantineSection({ blocks }: { readonly blocks: readonly HomeBlock[] }) {
  const block = blocks.find(
    (candidate): candidate is ScanQuarantineHomeBlock => candidate.kind === 'SCAN_QUARANTINE',
  );
  if (block === undefined || block.items.length === 0) return null;

  return (
    <Card className="mb-4 border-red-200 bg-red-50" data-testid="home-scan-quarantine">
      <CardHeader>
        <CardTitle>{t('home.scanQuarantine.title')}</CardTitle>
        <CardDescription className="text-slate-700">
          {t('home.scanQuarantine.lead')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {block.items.map((item) => (
            <li
              key={item.skillSheetId}
              className="text-sm text-slate-800"
              data-testid={`home-scan-quarantine-item-${item.skillSheetId}`}
              data-scan-status={item.scanStatus}
            >
              <span className="mr-2 font-semibold">
                {t(`skillSheets.scanStatus.${item.scanStatus}`)}
              </span>
              <span className="mr-2">
                {t('skillSheets.versions.versionPrefix')}
                {item.version}
              </span>
              {item.detectedAt === null ? null : (
                <span className="mr-2 text-slate-600">{formatDateTimeJst(item.detectedAt)}</span>
              )}
              {/* 🔴 行き止まりにしない —— 次の行動（上げ直す / 削除する）は `S-008` にある。 */}
              <Link
                className="ses-secondary-link"
                href={`/engineers/${item.engineerId}/skill-sheets`}
                data-testid={`home-scan-quarantine-link-${item.skillSheetId}`}
              >
                {t('home.scanQuarantine.open')}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

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
