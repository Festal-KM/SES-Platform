'use client';

// apps/web/app/(main)/_home/action-queue-section.tsx
// `S-003` セクション 1 / `S-004` セクション 1・2 の要対応キュー（docs/04 §S-003 / §S-004 / `F-006` / docs/05 §6.3 #9 / §6.11.2）。T-12-15 → T-22-09。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
//   ① 🔴 **1 本のテーブルに束ねる**（docs/04 §S-003「種別ごとにカードを分けると『今日どれから手を付けるか』が判断できない」）。
//      並びはサーバ（`sortActionQueueRows`）が決めた `targetIds` の順をそのまま描く。クライアントで並べ替えない。
//      ⚠️ T-22-09: 器は `@ses/ui` の `DataTable` **ではない**（列の下限幅がブレークポイントを持てず、
//      モバイルで器の内側が横スクロールする）。**ローカルの `<table>` も作らない**（`<ul>` のまま）。
//      ✅ 2026-10-02（改訂 23）: **列の grid もやめた**（行は 2 段の compact な行。下の
//      `ActionQueueRowItem` の 🔴 —— 右レールが実在したことで 7 列の固定トラックが主カラムに
//      収まらなくなり、**行が右レールの下に潜って `内容を見る` が押せなくなっていた**）。
//   ② 🔴 **ポーリングを持たない**（✅ 2026-10-02 / 改訂 23 で `./home-screen.tsx` へ移した）。
//      理由: `docs/04` §4.1 は **「KPI カード 4 枚 / タブの件数 / 全セクションの行 / 優先アクション を
//      同じ応答から一括で更新する。別々のタイミングで更新してはならない」**と定めており、
//      右レールの「先に動くもの」が**この行と同じ 1 本のデータ**であるため、状態の持ち主を
//      1 つにする必要がある。🔴 **この部品は渡された行を描くだけ**であり、順も件数も作らない。
//      差分の合成（`mergeActionQueueDelta`）と `actionAvailability` の全量差し替えは `./home-screen.tsx`。
//   ③ 🔴 **モバイルは 1 行 = 種別バッジ + 対象 + 経過時間の 3 要素**（docs/04 §S-003 デバイス別）。
//      `相手` / `期限` は `sm` 以上、✅ T-22-09 で足した `状態` / `操作` は `xl` 以上に出す
//      （✅ 改訂 23 で**2 段目の補足行**へ移したが、落とす境界は 1 つも変えていない）。
//      🔴 **横スクロールさせない**（溢れる代わりに段を折る）。**セクションを折りたたまない**
//      （`<details>` を使わない。畳むと期限が見えなくなる）。ブレークポイントは Tailwind の既定のみ。
//      🔴 **承認そのものはモバイルでも完結する**（Tier 1）—— `対象` のリンクが `S-021` へ行く。`操作` 列は
//      デスクトップで「どれから手を付けるか」を 1 手に縮める補助である。
//   ④ 🔴 **種別ごとの件数を 1 つの合計に丸めない。** 件数の見出し（「N 件」）を出さない —— 4 つの「うまくいかなかった」の混同の表示になる
//      （`F-024 AC-2` / `BR-23`）。並びと種別バッジで足りる。
//   ⑤ 🔴 **0 件でもセクションを消さない**（docs/04 §S-003「要対応 0 件 → 『対応が必要なものはありません』。画面全体を空にしない」）。
//      🔴 T-22-09: 空状態は `EmptyState`（3 段構造）で描くが、**`要対応 0 件` は説明のみでアクションを置かない**
//      （0 件は正常であり、行動を促す相手がいない。§5-13 / §10.4）。
//   ⑥ 文言は props（`packages/i18n` はサーバ側 `action-queue-props.ts` で解決）。本ファイルは日本語の語を書かない。
//      経過時間 / 残り時間の丸めは `lib/format/elapsed.ts` / `lib/proposal-requests/remaining.ts` の純粋関数（サーバと同じ 1 実装）。
//   ⑦ 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。型は `lib/home/types.ts` / `schemas.ts` から type-only で読む。
//   ⑧ 🔴 **色は「期限超過」と「経過時間が閾値超」の行だけ**（T-22-09。docs/04 §S-003 改訂 16）。
//      **赤は使わない**（赤は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 状態専用。§7.4。
//      放置された承認待ちは「外部で何かが起きた」ではない）。**行の背景を塗らない**（50 行のうち大半が
//      色付きになると色が意味を失う）—— **期限セルの文字色と、行頭 2px の縦バーだけ**である。
//   ⑨ 🔴 **`操作` はサーバが決めた `action` と `actionAvailability` の 2 項だけを見る**（docs/05 §6.11.2）。
//      画面はロールも状態も見ない。🔴 **`enabled === false` はボタンを描かず理由テキストを置く**（`disabled` にしない。§7.10 / `U-10`）。
//   ⑪ ✅ 2026-10-02（改訂 23）: 🔴 **見出しは `SectionHeader`**（アイコン + 見出し + 件数バッジ +
//      右端に `すべて見る >`）。アイコンは §7.5 の許可④（`S-003` / `S-004` のセクション見出しのみ）。
//      🔴 **`すべて見る` の遷移先はセクションの母集団をそのまま開く 1 画面だけ**（`S-019`）。
//      🔴 **`提案依頼の一覧`（`S-017`）への導線は別の 1 本として残す**（凍結済み testid
//      `home-*-proposal-requests`。キューに `提案依頼の返答待ち` の行が載るので、その全体への
//      入口はこのセクションの文脈である。§4.1「セクションのヘッダ右のテキストリンクは可」）。
//   ⑩ ✅ T-22-10: 🔴 **行の `内容を見る`（`Drawer`）は読み取りだけである**（docs/04 §4.1 / §5-13 / §11-25）。
//      引き出しの中身は `./action-queue-drawer.tsx` と `lib/home/drawer.ts` が持ち、**実行系のアクションを
//      型として置けない**（`ActionQueueDrawerView` に `action` のキーが無い / `@ses/ui` の `Drawer` が
//      `children` も `onClick` も受け取らない）。**台帳には触らない**（読むのは行の値と提案詳細〔#46〕の履歴だけ）。
//      🔴 **引き出しは 1 つだけ据える**（行ごとに 50 個のポータルを作らない）。開いている行は `openTargetId` が持ち、
//      **閉じたら一覧の位置とスクロールが保たれる**（遷移しない。フォーカスは Radix が `内容を見る` に戻す）。
//
// 🔴 時刻の基準は**サーバの応答時刻**（`changedSince`）である。端末時刻を混ぜると、サーバ描画と hydration 後の値が食い違う。
//    次の応答が来るまで経過時間は動かない（60 秒の粒度で足りる。秒を出さない）。
import Link from 'next/link';
import { useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Icon,
  IconButton,
  NAME_CELL_LINK_CLASSES,
  SECONDARY_LINK_CLASSES,
  SectionHeader,
  StatusBadge,
  type BadgeVariant,
  type SidebarLinkProps,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { formatElapsedWith, type ElapsedLabels } from '../../../lib/format/elapsed';
import { isActionQueueRowUrgent } from '../../../lib/home/action-queue-urgency';
import type { ActionQueueDrawerValues } from '../../../lib/home/drawer';
import type { HomeScope } from '../../../lib/home/schemas';
import type {
  ActionQueueActionKind,
  ActionQueueHomeBlock,
  ActionQueueKind,
  ActionQueueRow,
} from '../../../lib/home/types';
import { formatRemaining, type RemainingLabels } from '../../../lib/proposal-requests/remaining';
import { ActionQueueDrawer, type ActionQueueDrawerMessageBundle } from './action-queue-drawer';

export type ActionQueueMessages = {
  readonly title: string;
  readonly lead: string;
  readonly empty: string;
  readonly scopeLegend: string;
  readonly scopeMine: string;
  readonly scopeAll: string;
  readonly columnKind: string;
  readonly columnSubject: string;
  readonly columnCounterparty: string;
  readonly columnTime: string;
  readonly columnDeadline: string;
  /** ✅ T-22-09: `状態` 列 / `操作` 列の語（docs/04 改訂 16）。 */
  readonly columnState: string;
  readonly columnAction: string;
  /** 🔴 種別ラベル。5 種別すべてを持つ（`Record` で割り当て漏れをコンパイラに強制させる）。 */
  readonly kinds: Readonly<Record<ActionQueueKind, string>>;
  /** ✅ T-22-09: `操作` の語（4 つ）。🔴 1 行につき 1 つ（配列にしない = 一括操作を作らない）。 */
  readonly actions: Readonly<Record<ActionQueueActionKind, string>>;
  /**
   * ✅ T-22-09: 状態バッジの語（`Proposal` の 14 + `ProposalRequest` の 5）。
   * 🔴 **色はここに無い** —— `StatusBadge` が状態名から導出する（§5-13。画面側で色を指定しない）。
   */
  readonly proposalStates: Readonly<Record<string, string>>;
  readonly proposalRequestStates: Readonly<Record<string, string>>;
  /**
   * ✅ T-22-09: 操作が不能な理由の語（`MessageKey` → 解決済みの文言）。
   * 🔴 **サーバが返した `reasonKey` をそのまま引く**（画面が理由を組み立てない。docs/05 §6.11.2）。
   */
  readonly denied: Readonly<Record<string, string>>;
  /** ✅ T-22-09: セクションのヘッダ右のテキストリンク（`S-017` への入口）。 */
  readonly openRequestList: string;
  /**
   * ✅ T-22-10: 行の `内容を見る`（`Drawer`）の語。
   * 🔴 **実行系の語を 1 つも持たない**（承認 / 送信 / 再送 / 応諾 の語は上の `actions` にあり、
   *    引き出しの束には入れない。docs/04 §11-25）。
   */
  readonly drawer: ActionQueueDrawerMessageBundle;
  readonly valueNone: string;
  readonly changed: string;
  readonly pollError: string;
  readonly elapsed: ElapsedLabels;
  readonly remaining: RemainingLabels;
};

export type ActionQueueSectionProps = {
  /** 🔴 **描く行**（順はサーバが決めた `targetIds` の順。この部品は並べ替えない）。 */
  readonly rows: readonly ActionQueueRow[];
  /** 🔴 ブロック直下の可否（4 エントリ全量。docs/05 §6.11.2）。 */
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  /** 「新着」の印を付ける行（前回のポーリングで更新があったもの）。 */
  readonly changedIds: ReadonlySet<string>;
  /** 直近のポーリングが失敗したか（手元の行は保ったまま注記だけ出す）。 */
  readonly pollFailed: boolean;
  /** 🔴 経過時間 / 残り時間の基準（**サーバの応答時刻**。端末時刻を混ぜない）。 */
  readonly nowMs: number;
  /** ✅ T-22-09: ヘッダ右のリンクの testid を決めるためだけに使う（中身の違いはサーバが決めている）。 */
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
  readonly messages: ActionQueueMessages;
};

/**
 * 種別バッジの色味。
 * 🔴 T-22-09: **§7.4 の意味の割り当てに合わせた**（移行前は `GATE_FAILED` が赤 / `APPROVAL_PENDING` が橙だった）。
 *    - `SEND_FAILED` = **赤**（§7.4 が赤を許す 3 状態のうちの `SUBMIT_FAILED`。外部に到達したか分からない）
 *    - `GATE_FAILED` = **橙**（🔴 赤にしない —— 外部では何も起きておらず「直せば進む」。
 *      赤にすると「品質管理を強化するほど画面が赤くなる」逆の動機が生まれる）
 *    - `APPROVAL_PENDING` / `PROPOSAL_REQUEST_PENDING` = **ブランド藍**（「次はあなたの番」）
 *    - `SEND_HELD` = **無彩色の枠線**（保留は失敗ではない。docs/05 §10.4）
 * 🔴 `SEND_FAILED` と `SEND_HELD` は**別の語・別の色**のままである。
 */
const KIND_VARIANTS: Readonly<Record<ActionQueueKind, BadgeVariant>> = {
  SEND_FAILED: 'danger',
  APPROVAL_PENDING: 'brand',
  GATE_FAILED: 'warning',
  SEND_HELD: 'outline',
  PROPOSAL_REQUEST_PENDING: 'brand',
};

/**
 * ✅ 2026-10-02（改訂 23）: 時間の欄の語（**行・引き出し・右レールで同じ 1 実装**）。
 *
 * 提案依頼の行 = 返答期限までの残り（期限切れが最も痛い）/ それ以外 = 経過時間（放置時間）。
 * 🔴 **`./home-screen.tsx` の右レールもこれを呼ぶ** —— 同じ行が 2 箇所で違う時間を示すと、
 *    どちらも信用されなくなる。
 */
export function actionQueueRowTimeLabel(
  row: ActionQueueRow,
  nowMs: number,
  messages: ActionQueueMessages,
): string {
  return row.deadline === null
    ? formatElapsedWith(row.since, nowMs, messages.elapsed)
    : formatRemaining(row.deadline, nowMs, messages.remaining);
}

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
  messages,
}: ActionQueueSectionProps) {
  /**
   * ✅ T-22-10: 開いている行（`内容を見る`）。🔴 **引き出しは 1 つだけ据える**（ファイル冒頭 ⑩）。
   * 🔴 ポーリングで行が消えたら引き出しも閉じる（下の `openRow` が `null` になる）—— 承認済みの行の
   *    要約を開いたまま残さない。
   */
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);

  const openRow = rows.find((row) => row.targetId === openTargetId) ?? null;

  return (
    <div data-testid="home-action-queue" data-scope={scope}>
      {/* ✅ 改訂 23: セクション見出し（アイコン + 見出し + 件数 + `すべて見る >`）。ファイル冒頭 ⑪。
          🔴 `すべて見る` は**凍結済みの testid**（`home-*-proposals`）を持つ —— 改訂 16 では
             `SummaryStrip` の `進行中の提案` の値が `S-019` への入口だったが、改訂 23 で
             ストリップが無くなったため、**同じ遷移先を持つこの導線が引き継いだ**（`U-22`:
             testid の削除・改名は不可。値は 1 つも消していない）。 */}
      <Card>
      {/* 🔴 ✅ 2026-10-03: **節見出しを器の中へ入れた**（`docs/04` §7.2 の「1 画面で最も強調するのは
          要対応キュー」）。デモ巡回の実測では **KPI 帯が白い器 4 枚で常に 240px 先に在り、
          件数が 24px / 600 でホーム内最大**という状態で、条文（🔴「件数を、その画面で最も
          強調される要素より強くしない」）に反していた。強さの順序を戻すために 2 つを同時に行う:
          ①KPI カードの件数を `--text-lg` に落とし、器を `p-3` に詰める（`@ses/ui` の `KpiCard`）
          ②**見出しを行と同じ面の上に載せ、下 border で 1 つの塊にする**（見出しだけが面の外に
          浮いていると、白い器 4 枚のほうが先に「まとまり」として読まれる）。
          🔴 **見出しの段（`--text-lg` = 16px / 600）は 1px も上げていない**（`SectionHeader` は
          サイズの prop を持たない。§7.3「画面タイトルより強くしない」）。 */}
      <div className="border-b border-border px-4 pt-4 pb-3">
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
      <CardContent className="pt-4">
        {/* 🔴 「自分の担当のみ」トグル（既定オン）と `提案依頼の一覧`（`S-017`）への入口。
            どちらも**このセクションの文脈に紐づく**導線である（ファイル冒頭 ⑪）。 */}
        <nav aria-label={messages.scopeLegend} className="mb-2 flex flex-wrap items-center gap-2 text-body" data-testid="home-action-queue-scope">
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
          <p className="mb-2 text-body text-warning" role="status" data-testid="home-action-queue-poll-error">
            {messages.pollError}
          </p>
        ) : null}
        {rows.length === 0 ? (
          // ⚠️ 器の `data-testid`（`home-action-queue-empty`）は凍結済みの値であり、`EmptyState` が出す
          //    `{prefix}root` / `{prefix}description` は**追加**である（改名ではない。`U-22` / `T-22-06`〜`08` と同じ作法）。
          <div data-testid="home-action-queue-empty">
            {/* 🔴 **0 件は説明のみ**（Primary / Secondary を置かない。§5-13 / §10.4 ——
                0 件は正常であり、行動を促す相手がいない）。 */}
            <EmptyState testIdPrefix="home-action-queue-empty-state-" description={messages.empty} />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="home-action-queue-list">
            {/* ✅ 2026-10-02（改訂 23）: **列の見出し行を外した。**
                🔴 理由（実測）: `S-003` は幅クラス **B（分割）**であり、改訂 23 で**右レールが実在
                した**ことで主カラムが `lg` = 約 504px / `xl` = 約 552px / `2xl` = 約 728px になった。
                7 列の固定トラックの和（47rem + gap = 808px）は**どの幅にも収まらない** ——
                収めようとすると `対象` が 0〜64px に潰れる。改訂 23 の §4.1 は行の構成を
                **「件名（太字）+ 補足 + 時刻・期限 + 状態バッジ + 操作 + `…`」の 6 要素**と定め直して
                おり（列のテーブルではない）、本実装はその形に合わせた。
                🔴 **列が無いので見出しの語も無い**（`messages.columnKind` 等のキーは
                **引き出しの項目名**として引き続き使われる。`./action-queue-props.ts`）。
                ⚠️ 旧実装（固定トラックの grid）では、行が主カラムから溢れて**右レールの下に潜り、
                `内容を見る` が押せなくなっていた**（`anonymous-share.spec.ts` が
                「`<aside>` intercepts pointer events」で検出した）。 */}
            {rows.map((row) => (
              <ActionQueueRowItem
                key={row.targetId}
                row={row}
                availability={availability}
                changed={changedIds.has(row.targetId)}
                nowMs={nowMs}
                messages={messages}
                onOpenDrawer={setOpenTargetId}
              />
            ))}
          </ul>
        )}
      </CardContent>
      {/* ✅ T-22-10: 行の `内容を見る` の引き出し（**1 つだけ**。ファイル冒頭 ⑩）。
          🔴 実行系のアクションを持たない（型で担保。`lib/home/drawer.ts`）。 */}
      {openRow !== null ? (
        <ActionQueueDrawer
          row={openRow}
          values={drawerValues(openRow, nowMs, messages)}
          messages={messages.drawer}
          onClose={() => setOpenTargetId(null)}
        />
      ) : null}
      </Card>
    </div>
  );
}

/**
 * ✅ 2026-10-02（改訂 23）: **行は 2 段の compact な行である**（固定トラックの grid をやめた）。
 *
 * 🔴 **1 段目** … 種別バッジ / 件名（太字のリンク）/ 時刻・期限 / `内容を見る`
 * 🔴 **2 段目（補足）** … 相手 / 期限 / 状態バッジ / 操作
 *
 * 🔴 **なぜ段を分けるのか（実測）**: 右レール（副カラム 360〜480px）が実在したことで主カラムは
 *    `lg` ≈ 504px / `xl` ≈ 552px / `2xl` ≈ 728px になった。7 列の固定トラックの和は 808px で
 *    **どの幅にも入らず**、行が主カラムから溢れて**右レールの下に潜る**（`内容を見る` が
 *    クリックできなくなる = Tier 1 の遮断）。改訂 23 の行の定義（6 要素 + `…`）がこの形である。
 * 🔴 **横スクロールさせない**（`docs/04` §S-003 タブレット）。溢れる代わりに**段を折る**。
 * 🔴 **落とす境界は 2 段のまま**（移行前と同じ判定。render テスト ③ が固定している）:
 *    - `sm` 未満 … `相手` / `期限` を落とす（モバイルは 種別 + 件名 + 時刻 + `内容を見る`）
 *    - `xl` 未満 … `状態` / `操作` を落とす
 * 🔴 **行の高さが内容量で変わらない** —— 2 段目は該当が無くても同じ項目を `—` で描く
 *    （`HANDOFF.md` §3.3 の 1 件目: 高さの差は、それ自体が開示項目になる）。
 * ⚠️ **`内容を見る` はどのブレークポイントでも落とさない**（T-22-10。Tier 1 の条件）。
 */
/** 🔴 `sm` 未満で落ちる列（`相手` / `期限`）。 */
const COLUMN_SM_CLASSES = 'hidden sm:inline';
/** 🔴 `xl` 未満で落ちる列（✅ T-22-09 で足した `状態` / `操作`。上の ⚠️ の実測）。 */
const COLUMN_XL_CLASSES = 'hidden xl:inline';

/**
 * 1 行。🔴 モバイル = 種別バッジ + 対象 + 経過時間（3 要素）。`相手` / `期限` は `sm` 以上、
 * `状態` / `操作` は `xl` 以上（上の 🔴）。
 * 時間の欄は、提案依頼の行 = 返答期限までの残り（期限切れが最も痛い）/ それ以外 = 経過時間（放置時間）。
 *
 * 🔴 **色は「期限超過」と「経過時間が閾値超」の行だけ**（`isActionQueueRowUrgent`）。
 *    **行の背景を塗らず、行頭 2px の縦バーと期限セルの文字色だけ**に留める（ファイル冒頭 ⑧）。
 *    色の無い行も同じ 2px を持つ（`border-l-transparent`）—— 幅が変わると 50 行の左端が揃わない。
 */
function ActionQueueRowItem({
  row,
  availability,
  changed,
  nowMs,
  messages,
  onOpenDrawer,
}: {
  readonly row: ActionQueueRow;
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changed: boolean;
  readonly nowMs: number;
  readonly messages: ActionQueueMessages;
  readonly onOpenDrawer: (targetId: string) => void;
}) {
  const time = actionQueueRowTimeLabel(row, nowMs, messages);
  const urgent = isActionQueueRowUrgent(row, nowMs);
  const overdue = row.deadline !== null && Date.parse(row.deadline) < nowMs;
  // 🔴 種別と状態が同じ語になる行がある（下の 🔴）。語の一致だけで判定し、状態の集合を列挙しない
  //    —— 列挙すると `ActionQueueKind` を足した人がここを直し忘れ、また 2 回出る。
  const kindLabel = messages.kinds[row.kind];
  const stateLabel = rowStateLabel(row, messages);
  return (
    <li
      className={`flex flex-col gap-1 py-2 pl-2 text-cell ${
        urgent ? 'border-l-2 border-l-warning' : 'border-l-2 border-l-transparent'
      }`}
      data-testid={`home-action-queue-row-${row.targetId}`}
      data-kind={row.kind}
      data-changed={changed ? 'true' : 'false'}
      data-urgent={urgent ? 'true' : 'false'}
    >
      {/* 1 段目: 種別 / 件名 / 時刻 / `内容を見る`。🔴 モバイルでは件名が全幅の 2 行目に回る
          （`basis-full`）—— 切り詰めると対象の末尾が読めず、触端末ではツールチップを開けない
          （`CLAUDE.md` §13.3。CI の折り返し検出器がモバイルの `truncate` を clipped-x で捕まえた）。 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1">
          <Badge variant={KIND_VARIANTS[row.kind]} data-testid={`home-action-queue-kind-${row.targetId}`}>
            {messages.kinds[row.kind]}
          </Badge>
          {changed ? (
            <Badge variant="success" data-testid={`home-action-queue-changed-${row.targetId}`}>
              {messages.changed}
            </Badge>
          ) : null}
        </span>
        <Link
          href={row.href}
          title={row.subjectLabel}
          // 🔴 見た目（下線・文字色・フォーカスリング）は `@ses/ui` の 1 実装から取る
          //    （`NAME_CELL_LINK_CLASSES`）—— 画面側に `hover:` / `focus-visible:` を書かない（§7.10 / 検査 (j)）。
          className={`${NAME_CELL_LINK_CLASSES} order-last min-w-0 basis-full font-medium whitespace-normal break-words sm:order-none sm:basis-auto sm:flex-1 lg:truncate`}
          data-testid={`home-action-queue-subject-${row.targetId}`}
        >
          {row.subjectLabel}
        </Link>
        <span
          className="ml-auto shrink-0 whitespace-nowrap text-fg sm:ml-0"
          data-testid={`home-action-queue-time-${row.targetId}`}
        >
          {time}
        </span>
        {/* ✅ T-22-10: 行の `内容を見る`（`Drawer` を開く）。
            🔴 **アイコンだけで意味が通る操作**（§7.5 の許可①。語は `aria-label` が持つ）。
            🔴 **`ghost`** にする —— この画面の primary は帯の `案件を登録` 1 つだけであり（§7.6）、
               50 行ぶんの枠線が並ぶと行の境界が読めなくなる。
            🔴 **遷移ではない**（`<a>` にしない）—— 押しても URL は変わらず、一覧の位置は保たれる。
            🔴 **どのブレークポイントでも落とさない**（Tier 1）。 */}
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Icon name="eye" />}
          aria-label={messages.drawer.open}
          onClick={() => onOpenDrawer(row.targetId)}
          data-testid={`home-action-queue-drawer-open-${row.targetId}`}
        />
      </div>
      {/* 2 段目（補足）: 相手 / 期限 / 状態 / 操作。🔴 落とす境界は移行前と同じ 2 段である。 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span
          className={`min-w-0 whitespace-normal break-words text-fg-muted lg:truncate ${COLUMN_SM_CLASSES}`}
          title={row.counterpartyLabel ?? undefined}
          data-testid={`home-action-queue-counterparty-${row.targetId}`}
        >
          {row.counterpartyLabel ?? messages.valueNone}
        </span>
        {/* 🔴 期限超過は**このセルの文字色だけ**で示す（行の背景を塗らない）。🔴 赤ではなく橙。 */}
        <span
          className={`whitespace-nowrap ${overdue ? 'text-warning' : 'text-fg-muted'} ${COLUMN_SM_CLASSES}`}
          data-testid={`home-action-queue-deadline-${row.targetId}`}
        >
          {row.deadline === null ? messages.valueNone : formatDateTimeJst(row.deadline)}
        </span>
        {/* 🔴 状態は `StatusBadge`（`エンティティ + 状態` の組）。**画面側で色を決めない**（§5-13 / §7.4）。
            🔴 ✅ 2026-10-03（再監査）: **種別バッジと同じ語になる行では描かない。**
            実測: `APPROVAL_PENDING` の行は「承認待ち」が種別と状態の 2 箇所に、取引先の
            `GATE_FAILED` の行は「差し戻し（検査で不合格）」が 2 箇所に出ていた。
            🔴 **情報は 1 つも失われない** —— 種別と状態が同じ語になるのは「その状態であること
            そのものが行がキューに載った理由」だからであり（`GATE_FAILED` / `APPROVAL_PENDING` /
            `SEND_FAILED`）、色も `KIND_VARIANTS` と `STATUS_BADGE_APPEARANCES` で一致している
            （`SEND_FAILED` = 赤 / `GATE_FAILED` = 橙 / `APPROVAL_PENDING` = 藍）。
            🔴 **語が違う行では必ず両方出す**（`SEND_HELD` の行の `APPROVED` / 提案依頼の
            `REQUESTED` など。種別 = 何をすべきか / 状態 = いまどこか、で意味が別）。 */}
        {stateLabel === kindLabel ? null : (
          <span className={COLUMN_XL_CLASSES}>
            {row.stateBadge.entity === 'PROPOSAL' ? (
              <StatusBadge
                entity="proposal"
                state={row.stateBadge.state}
                label={stateLabel}
                data-testid={`home-action-queue-state-${row.targetId}`}
              />
            ) : (
              <StatusBadge
                entity="proposalRequest"
                state={row.stateBadge.state}
                label={stateLabel}
                data-testid={`home-action-queue-state-${row.targetId}`}
              />
            )}
          </span>
        )}
        <span className={COLUMN_XL_CLASSES}>
          <ActionCell row={row} availability={availability} messages={messages} />
        </span>
      </div>
    </li>
  );
}

/**
 * ✅ T-22-10: 状態の語（**行と引き出しで同じ 1 実装**）。
 * 🔴 写像は `action-queue-props.ts` が既存の `PROPOSAL_STATE_MESSAGE_KEYS` /
 *    `PROPOSAL_REQUEST_STATE_MESSAGE_KEYS` から解決したものであり、ここで語を作らない。
 */
function rowStateLabel(row: ActionQueueRow, messages: ActionQueueMessages): string {
  const map =
    row.stateBadge.entity === 'PROPOSAL' ? messages.proposalStates : messages.proposalRequestStates;
  return map[row.stateBadge.state] ?? row.stateBadge.state;
}

/** ✅ T-22-10: 引き出しに渡す値（🔴 **行の表示と同じ文字列**。食い違うと「同じものを見た」確認にならない）。 */
function drawerValues(
  row: ActionQueueRow,
  nowMs: number,
  messages: ActionQueueMessages,
): ActionQueueDrawerValues {
  return {
    kind: messages.kinds[row.kind],
    state: rowStateLabel(row, messages),
    time: actionQueueRowTimeLabel(row, nowMs, messages),
  };
}

/**
 * 🔴 `操作` セル。**画面が見るのは 2 項だけ**である（docs/05 §6.11.2）:
 *    `row.action !== null && availability[row.action.kind].enabled`。**どちらもサーバの与えた事実**であり、
 *    ロールも状態も画面が見ない。
 *
 * 🔴 **`enabled === false` のときボタンを描かず、その位置に理由テキストを置く**（`disabled` にしない。§7.10 / `U-10`）。
 * 🔴 `action` が `null`（ホストの `提案依頼の返答待ち`）は**不能ではなく「操作が無い」**ので、
 *    理由ではなく `—` を置く（無い操作の理由を書くと、権限で消えたように読める）。
 * ⚠️ 見た目は**テキストの導線**（`SECONDARY_LINK_CLASSES`）である —— 行の操作は secondary であり、
 *    この画面の primary は帯の `案件を登録` 1 つだけである（§7.6「1 画面の primary は 1 つ」）。
 */
function ActionCell({
  row,
  availability,
  messages,
}: {
  readonly row: ActionQueueRow;
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly messages: ActionQueueMessages;
}) {
  if (row.action === null) {
    return <span data-testid={`home-action-queue-action-none-${row.targetId}`}>{messages.valueNone}</span>;
  }
  const entry = availability[row.action.kind];
  if (!entry.enabled) {
    return (
      <span className="text-fg-muted" data-testid={`home-action-queue-action-denied-${row.targetId}`}>
        {messages.denied[entry.reasonKey]}
      </span>
    );
  }
  return (
    <Link
      className={SECONDARY_LINK_CLASSES}
      href={row.action.href}
      data-testid={`home-action-queue-action-${row.targetId}`}
    >
      {messages.actions[row.action.kind]}
    </Link>
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

/** 🔴 testid は三項演算子の各枝に文字列リテラルで書く（`tests/static/testid-inventory.test.ts` が枝ごとに凍結する。識別子渡しにしない）。 */
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
          ? 'inline-block rounded-sm border border-brand bg-brand px-3 py-1 text-body text-brand-fg'
          : 'inline-block rounded-sm border border-border-strong px-3 py-1 text-body text-fg'
      }
    >
      {label}
    </Link>
  );
}
