'use client';

// apps/web/app/(main)/_home/actions-tab.tsx
// 🔴 `要対応` タブの**面**（4 セクションを**縦に並べる**）。人間の仕様 2026-10-11。
//
// ============================================================================
// 🔴 この面が守るもの
// ============================================================================
//   ① 🔴 **縦に並べる一覧セクションである**（人間の仕様の 🔴「カードでなく一覧セクション」）。
//      **同型の行を横並びのカードにしない**（`UI_GUIDELINES` §1）。
//   ② 🔴 **並びは `lib/home/sections.ts` が決める**（`HOME_SECTIONS` の順 =
//      今日やること → 返信待ち → 面談調整中 → 提案後フォロー）。**この面で並べ替えない。**
//   ③ 🔴 **0 件のセクションは見出しごと描かない**（`docs/04` §4.1 の 🔴）。
//      ⚠️ **例外は `今日やること`** —— 0 件でも「対応が必要なものはありません」を残す
//      （§S-003「要対応 0 件 → 画面全体を空にしない」）。`満了が近い稼働` にも同じ例外が
//      あるが、そのセクションは Phase 2（`Assignment`）であり本実装に存在しない。
//   ④ 🔴 **`稼働開始が近い人材` を出さない**（人間の仕様の 5 番目）。理由:
//      `Assignment` が Phase 2 であり、行はエンジニアの氏名を要する ——
//      **ホームに氏名を出さない**（`BR-27`。60 秒ポーリングで `engineer.view` が毎分積まれる）と
//      **ホームから台帳に触らない**（`tests/static/home-drawer-no-ledger.test.ts` の例外 2 系統）の
//      両方に当たる。🔴 **データが無いものを作らない。**
//   ⑤ 🔴 **語を持たない**（`packages/i18n` の解決は `./home-props.ts`）。
//   ⑥ 🔴 **各セクションの `data-testid` は文字列リテラル**で渡す
//      （`tests/static/testid-inventory.test.ts` が静的に解けること）。
import type { HomeSectionRow, HomeSectionView } from '../../../lib/home/sections';
import {
  FOLLOW_UP_SECTION_ICONS,
  FOLLOW_UP_SECTION_SEE_ALL_HREFS,
  type FollowUpKind,
} from '../../../lib/home/sections';
import type { HomeScope } from '../../../lib/home/schemas';
import type { ActionQueueHomeBlock } from '../../../lib/home/types';
import { ActionQueueSection } from './action-queue-section';
import type { ActionQueueMessages } from './action-row';
import { FollowUpSection } from './follow-up-section';
import type { HomeSectionMessages } from './home-props';

export type ActionsTabProps = {
  /** 🔴 **4 セクション**（0 件のものも含めて渡される。描く判断は本ファイルの ③）。 */
  readonly sections: readonly HomeSectionView[];
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changedIds: ReadonlySet<string>;
  readonly pollFailed: boolean;
  readonly nowMs: number;
  readonly audience: 'HOST' | 'PARTNER';
  readonly scope: HomeScope;
  readonly scopeHrefs: { readonly mine: string; readonly all: string };
  readonly requestListHref: string;
  /** `今日やること` の `すべて見る`（`S-019`）。 */
  readonly queueListHref: string;
  readonly seeAllLabel: string;
  /** 件数バッジの単位（`件`）。🔴 **金額の単位を持たない**。 */
  readonly countUnit: string;
  /** セクション 2〜4 の語（見出し / 1 行の説明 / 0 件の文言）。 */
  readonly sectionMessages: Readonly<Record<FollowUpKind, HomeSectionMessages>>;
  readonly messages: ActionQueueMessages;
};

/** 🔴 `testIdPrefix` は**セクションごとの文字列リテラル**（上の ⑥）。 */
const FOLLOW_UP_TEST_ID_PREFIXES: Readonly<Record<FollowUpKind, string>> = {
  AWAITING_REPLY: 'home-section-awaiting-reply-',
  INTERVIEW_COORDINATION: 'home-section-interview-coordination-',
  PROPOSAL_FOLLOW_UP: 'home-section-proposal-follow-up-',
};

export function ActionsTab({
  sections,
  availability,
  changedIds,
  pollFailed,
  nowMs,
  audience,
  scope,
  scopeHrefs,
  requestListHref,
  queueListHref,
  seeAllLabel,
  countUnit,
  sectionMessages,
  messages,
}: ActionsTabProps) {
  const countLabel = (rows: readonly HomeSectionRow[]): string => `${String(rows.length)}${countUnit}`;
  return (
    // 🔴 セクション間は `--space-4`（16px）。器（`Card`）が面を持つので、間隔は器の外側で取る。
    <div className="flex flex-col gap-4" data-testid="home-actions-tab">
      {sections.map((section) => {
        if (section.section === 'TODAY') {
          return (
            <ActionQueueSection
              key={section.section}
              rows={section.rows}
              availability={availability}
              changedIds={changedIds}
              pollFailed={pollFailed}
              nowMs={nowMs}
              audience={audience}
              scope={scope}
              scopeHrefs={scopeHrefs}
              requestListHref={requestListHref}
              seeAllHref={queueListHref}
              seeAllLabel={seeAllLabel}
              countLabel={countLabel(section.rows)}
              anchorId={section.anchorId}
              messages={messages}
            />
          );
        }
        // 🔴 0 件のセクションは見出しごと描かない（上の ③）。
        if (section.rows.length === 0) return null;
        const kind: FollowUpKind = section.section;
        const bundle = sectionMessages[kind];
        return (
          <FollowUpSection
            key={kind}
            testIdPrefix={FOLLOW_UP_TEST_ID_PREFIXES[kind]}
            anchorId={section.anchorId}
            icon={FOLLOW_UP_SECTION_ICONS[kind]}
            title={bundle.title}
            lead={bundle.lead}
            countLabel={countLabel(section.rows)}
            seeAllHref={FOLLOW_UP_SECTION_SEE_ALL_HREFS[kind]}
            seeAllLabel={seeAllLabel}
            emptyLabel={bundle.empty}
            rows={section.rows}
            availability={availability}
            changedIds={changedIds}
            nowMs={nowMs}
            messages={messages}
          />
        );
      })}
    </div>
  );
}
