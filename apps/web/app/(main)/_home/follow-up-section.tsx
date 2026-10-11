'use client';

// apps/web/app/(main)/_home/follow-up-section.tsx
// 🔴 `要対応` タブの**セクション 2〜4**（`返信待ち` / `面談調整中` / `提案後フォロー`）。
//    人間の仕様 2026-10-11「5 セクションを縦に並べる」。
//
// ============================================================================
// 🔴 このセクションが守るもの
// ============================================================================
//   ① 🔴 **`今日やること` と同じ行・同じ器**（`./action-row.tsx` / `./action-section.tsx`）。
//      セクションごとに行の見た目を変えない —— **同じものを 4 通りに描くと、どれが同じ種類の
//      仕事なのかが読めなくなる**（`UI_GUIDELINES` §1「階層が一目で分かる」）。
//   ② 🔴 **カードで並べない。一覧セクションである**（人間の仕様の 🔴）。
//   ③ 🔴 **0 件のセクションは見出しごと描かない**（`docs/04` §4.1 の 🔴「`すべて見る` だけが
//      残る空セクションを作らない」）。判断は `./actions-tab.tsx` の 1 箇所に置き、
//      **この部品は渡されたら描く**。
//   ④ 🔴 **`すべて見る` の遷移先はセクションの母集団をそのまま開く 1 画面 + フィルタだけ**
//      （`S-019` の状態フィルタ。`docs/04` §4.1 のセクション見出しの 🔴）。
//   ⑤ 🔴 **件数は自社スコープの数である**（取引先の母集団は RLS（C5 PARTY）が閉じており、
//      他社の提案は 1 件も数に入らない。`BR-07` / `F-004 AC-4`）。
//   ⑥ 🔴 **「自分の担当のみ」トグルを持たない** —— このセクションの母集団は KPI カード 2 / 3 と
//      同じ（担当で絞らない）であり、絞るとカードの件数と行数が食い違う
//      （`lib/home/action-queue-read.ts` の `followUpProposalWheres` の 🔴）。
//   ⑦ 文言は props（`packages/i18n` の解決は `./home-props.ts`）。本ファイルは語を書かない。
import { Card, CardContent, SectionHeader } from '@ses/ui';
import type { IconName } from '@ses/ui';
import type { HomeSectionRow } from '../../../lib/home/sections';
import type { ActionQueueHomeBlock } from '../../../lib/home/types';
import { ActionSectionBody } from './action-section';
import type { ActionQueueMessages } from './action-row';

export type FollowUpSectionProps = {
  /**
   * 🔴 `data-testid` の接頭辞。**呼び出し側（`./actions-tab.tsx`）が文字列リテラルで渡す**
   *    （`tests/static/testid-inventory.test.ts` が静的に解ける形）。
   */
  readonly testIdPrefix: string;
  /** 🔴 KPI カードのクリックが飛んでくるフラグメントの移動先（`lib/home/sections.ts`）。 */
  readonly anchorId: string;
  /** 🔴 `packages/ui` の閉じたアイコン写像の名前（§7.5 の許可④ = セクション見出しのみ）。 */
  readonly icon: IconName;
  readonly title: string;
  /** 見出し直下の 1 行（何が出るセクションなのか）。 */
  readonly lead: string;
  /** 件数バッジ（整形済み。🔴 **金額を渡さない**）。 */
  readonly countLabel: string;
  /** `すべて見る` の遷移先と語（🔴 **セクションに 1 つだけ**）。 */
  readonly seeAllHref: string;
  readonly seeAllLabel: string;
  readonly emptyLabel: string;
  readonly rows: readonly HomeSectionRow[];
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changedIds: ReadonlySet<string>;
  readonly nowMs: number;
  readonly messages: ActionQueueMessages;
};

export function FollowUpSection({
  testIdPrefix,
  anchorId,
  icon,
  title,
  lead,
  countLabel,
  seeAllHref,
  seeAllLabel,
  emptyLabel,
  rows,
  availability,
  changedIds,
  nowMs,
  messages,
}: FollowUpSectionProps) {
  return (
    <div id={anchorId} data-testid={`${testIdPrefix}root`} data-row-count={rows.length}>
      <Card>
        {/* 🔴 **器と節見出しは `今日やること` と同一の作法**（面を持つものと持たないものを
            並べない。`docs/04` §7.2 改訂 27 の 🔴 ——「面の有無」でも強さの規約は破れる）。 */}
        <div className="border-b border-border px-4 pt-4 pb-3">
          <SectionHeader
            icon={icon}
            title={title}
            count={countLabel}
            link={{ href: seeAllHref, label: seeAllLabel }}
            testIdPrefix={`${testIdPrefix}header-`}
            className="mb-0"
          />
          {/* 🔴 **「どういう行が出る面か」を 1 行で置く**（`今日やること` との違いが読めないと、
              同じ行が 2 箇所に出ていると誤解される）。段は補助テキスト（12px）であり、
              見出しより強くならない。 */}
          <p className="m-0 text-xs text-fg-muted" data-testid={`${testIdPrefix}lead`}>
            {lead}
          </p>
        </div>
        <CardContent className="pt-4">
          <ActionSectionBody
            testIdPrefix={testIdPrefix}
            rows={rows}
            availability={availability}
            changedIds={changedIds}
            nowMs={nowMs}
            emptyLabel={emptyLabel}
            messages={messages}
          />
        </CardContent>
      </Card>
    </div>
  );
}
