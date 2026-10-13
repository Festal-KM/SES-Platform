'use client';

// apps/web/app/(main)/_home/action-queue-section.tsx
// `要対応` タブの**セクション 1 = `今日やること`**（docs/04 §S-003 セクション 1 / §S-004 セクション 1・2 /
// `F-006` / docs/05 §6.3 #9 / §6.11.2）。T-12-15 → T-22-09 → T-22-10 → ✅ 2026-10-11。
//
// ============================================================================
// 🔴 このファイルが持つもの / 持たないもの
// ============================================================================
// ✅ 2026-10-11（人間の仕様「5 セクションを縦に並べる」/「1 ファイルにまとめない」）で分割した:
//
//   | 置き場所 | 中身 |
//   |---|---|
//   | **本ファイル** | `今日やること` の器（`Card` + `SectionHeader` + 担当トグル + 注記） |
//   | `./action-section.tsx` | 行の一覧 / 空状態 / 引き出し（**4 セクション共通**） |
//   | `./action-row.tsx` | 行 1 本（2 段の compact な行。落とす境界・色・操作セル） |
//   | `./follow-up-section.tsx` | `返信待ち` / `面談調整中` / `提案後フォロー` の器 |
//   | `./actions-tab.tsx` | 4 セクションを**縦に並べる** |
//   | `lib/home/sections.ts` | 🔴 **タスク生成ロジック**（割り当て・順・件数。UI と分離） |
//
// ============================================================================
// 🔴 このセクションが守るもの（移行前から 1 つも落としていない）
// ============================================================================
//   ① 🔴 **1 本のテーブルに束ねる**（docs/04 §S-003「種別ごとにカードを分けると『今日どれから
//      手を付けるか』が判断できない」）。並びはサーバ（`sortActionQueueRows`）が決めた
//      `targetIds` の順をそのまま描く。**クライアントで並べ替えない。**
//      ⚠️ ここが「セクションを分けたこと」と矛盾しないのは、**5 種別はいずれも「自分に次の行動が
//      あるもの」で 1 つの判断（どれから手を付けるか）に属する**からである。新しい 3 セクションは
//      **別の判断**（相手の返答を待っている / 記録が残っている）に属し、`docs/04` §4.1 が
//      「重複させない」と定めた別の母集団である。
//   ② 🔴 **ポーリングを持たない**（`./home-screen.tsx` が唯一の口）。この部品は渡された行を
//      描くだけであり、順も件数も作らない。
//   ③ 🔴 **種別ごとの件数を 1 つの合計に丸めない**（4 つの「うまくいかなかった」の混同の表示に
//      なる。`F-024 AC-2` / `BR-23`）。見出しの件数バッジは**このセクションの行数**である。
//   ④ 🔴 **0 件でもセクションを消さない**（docs/04 §S-003「要対応 0 件 → 『対応が必要なものは
//      ありません』。画面全体を空にしない」）。
//   ⑤ 🔴 **`すべて見る` の遷移先はセクションの母集団をそのまま開く 1 画面だけ**（`S-019`）。
//      🔴 **`提案依頼の一覧`（`S-017`）への導線は別の 1 本として残す**（凍結済み testid
//      `home-*-proposal-requests`）。
//   ⑥ 文言は props（`packages/i18n` はサーバ側 `./action-queue-props.ts` で解決）。
//   ⑦ 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。
//
// 🔴 時刻の基準は**サーバの応答時刻**（`changedSince`）である。端末時刻を混ぜると、サーバ描画と
//    hydration 後の値が食い違う。次の応答が来るまで経過時間は動かない（60 秒の粒度で足りる）。
import Link from 'next/link';
import { Card, CardContent, SECONDARY_LINK_CLASSES, SectionHeader, type SidebarLinkProps } from '@ses/ui';
import type { HomeSectionRow } from '../../../lib/home/sections';
import type { HomeScope } from '../../../lib/home/schemas';
import type { ActionQueueHomeBlock } from '../../../lib/home/types';
import { ActionSectionBody } from './action-section';
import type { ActionQueueMessages } from './action-row';

// 🔴 既存の import 元を変えない（`./action-queue-props.ts` / `./home-screen.tsx` /
//    render テストは本ファイルから型と関数を読んでいる。**移動は再 export で吸収する**）。
export { actionQueueRowTimeLabel } from './action-row';
export type { ActionQueueMessages } from './action-row';

export type ActionQueueSectionProps = {
  /** 🔴 **描く行**（順はサーバが決めた `targetIds` の順。この部品は並べ替えない）。 */
  readonly rows: readonly HomeSectionRow[];
  /** 🔴 ブロック直下の可否（全エントリ。docs/05 §6.11.2）。 */
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  /** 「新着」の印を付ける行（前回のポーリングで更新があったもの）。 */
  readonly changedIds: ReadonlySet<string>;
  /** 直近のポーリングが失敗したか（手元の行は保ったまま注記だけ出す）。 */
  readonly pollFailed: boolean;
  /** 🔴 経過時間 / 残り時間 / 優先度の基準（**サーバの応答時刻**）。 */
  readonly nowMs: number;
  /** ヘッダ右のリンクの testid を決めるためだけに使う（中身の違いはサーバが決めている）。 */
  readonly audience: 'HOST' | 'PARTNER';
  readonly scope: HomeScope;
  /** トグルの遷移先（`/?scope=mine` / `/?scope=all`）。値の出所は `page.tsx`。 */
  readonly scopeHrefs: { readonly mine: string; readonly all: string };
  /** `S-017`（提案依頼の一覧）。値の出所は `page.tsx`。 */
  readonly requestListHref: string;
  /** ✅ 改訂 23: `すべて見る` の遷移先（`S-019`）と語。🔴 **セクションに 1 つだけ**。 */
  readonly seeAllHref: string;
  readonly seeAllLabel: string;
  /** ✅ 改訂 23: 見出しの件数バッジ（整形済み。🔴 **金額を渡さない**）。 */
  readonly countLabel: string;
  /** 🔴 KPI カードのクリックが飛んでくるフラグメントの移動先（`lib/home/sections.ts`）。 */
  readonly anchorId: string;
  readonly messages: ActionQueueMessages;
};

export function ActionQueueSection({
  rows,
  availability,
  changedIds,
  pollFailed,
  nowMs,
  audience,
  scope,
  scopeHrefs,
  requestListHref,
  seeAllHref,
  seeAllLabel,
  countLabel,
  anchorId,
  messages,
}: ActionQueueSectionProps) {
  return (
    <div id={anchorId} data-testid="home-action-queue" data-scope={scope}>
      <Card>
        {/* 🔴 ✅ 2026-10-03: **節見出しを器の中へ入れた**（`docs/04` §7.2 の「1 画面で最も強調する
            のは要対応キュー」）。見出しだけが面の外に浮いていると、白い器 4 枚のほうが先に
            「まとまり」として読まれる。🔴 見出しの段（16px / 600）は 1px も上げていない。 */}
        <div>
          <SectionHeader
            icon="list-checks"
            title={messages.title}
            count={countLabel}
            link={{ href: seeAllHref, label: seeAllLabel }}
            testIdPrefix="home-action-queue-header-"
            linkComponent={audience === 'HOST' ? HostProposalsLink : PartnerProposalsLink}
            className="mb-0"
          />
        </div>
        <CardContent className="p-0">
          {/* 🔴 「自分の担当のみ」トグル（既定オン）と `提案依頼の一覧`（`S-017`）への入口。
              どちらも**このセクションの文脈に紐づく**導線である（ファイル冒頭 ⑤）。
              🔴 **トグルはこのセクションにだけ効く** —— 他の 3 セクションは KPI カードの件数と
              同じ母集団（担当で絞らない）であり、絞るとカードとセクションの数が食い違う
              （`lib/home/action-queue-read.ts` の `followUpProposalWheres` の 🔴）。 */}
          <nav
            aria-label={messages.scopeLegend}
            className="flex flex-wrap items-center gap-2 px-4 pb-2 text-body"
            data-testid="home-action-queue-scope"
          >
            <ScopeLink target="mine" active={scope === 'mine'} href={scopeHrefs.mine} label={messages.scopeMine} />
            <ScopeLink target="all" active={scope === 'all'} href={scopeHrefs.all} label={messages.scopeAll} />
            <Link
              className={`ml-auto ${SECONDARY_LINK_CLASSES}`}
              href={requestListHref}
              data-testid={audience === 'HOST' ? 'home-host-proposal-requests' : 'home-partner-proposal-requests'}
            >
              {messages.openRequestList}
            </Link>
          </nav>
          {pollFailed ? (
            <p className="px-4 pb-2 text-body text-warning" role="status" data-testid="home-action-queue-poll-error">
              {messages.pollError}
            </p>
          ) : null}
          <ActionSectionBody
            testIdPrefix="home-action-queue-"
            rows={rows}
            availability={availability}
            changedIds={changedIds}
            nowMs={nowMs}
            emptyLabel={messages.empty}
            messages={messages}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 🔴 `すべて見る`（`S-019`）の導線。**凍結済みの testid を文字列リテラルで持つ**
 *    （`tests/static/testid-inventory.test.ts` が静的に解けること）。
 * 🔴 **所属ごとに別の部品**にする —— 1 つの部品で三項にすると `audience` を props で受け渡す
 *    必要があり、`SectionHeader` の `linkComponent` の形（`SidebarLinkProps` だけ）から外れる。
 */
function HostProposalsLink({ href, className, children }: SidebarLinkProps) {
  return (
    <Link href={href} className={className} data-testid="home-host-proposals">
      {children}
    </Link>
  );
}

function PartnerProposalsLink({ href, className, children }: SidebarLinkProps) {
  return (
    <Link href={href} className={className} data-testid="home-partner-proposals">
      {children}
    </Link>
  );
}

/** 🔴 testid は三項演算子の各枝に文字列リテラルで書く（`testid-inventory` が枝ごとに凍結する）。 */
function ScopeLink({
  target,
  active,
  href,
  label,
}: {
  readonly target: HomeScope;
  readonly active: boolean;
  readonly href: string;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      data-testid={target === 'mine' ? 'home-action-queue-scope-mine' : 'home-action-queue-scope-all'}
      data-active={active ? 'true' : 'false'}
      className={
        active
          ? 'inline-block rounded-md border border-brand bg-brand px-3 py-1 text-cell font-medium text-brand-fg'
          : 'inline-block rounded-md border border-border-strong px-3 py-1 text-cell font-medium text-fg'
      }
    >
      {label}
    </Link>
  );
}
