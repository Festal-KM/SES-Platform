'use client';

// apps/web/app/(main)/_home/action-queue-section.tsx
// `S-003` セクション 1 / `S-004` セクション 1・2 の要対応キュー（docs/04 §S-003 / §S-004 / `F-006` / docs/05 §6.3 #9 / §6.11.2）。T-12-15 → T-22-09。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
//   ① 🔴 **1 本のテーブルに束ねる**（docs/04 §S-003「種別ごとにカードを分けると『今日どれから手を付けるか』が判断できない」）。
//      並びはサーバ（`sortActionQueueRows`）が決めた `targetIds` の順をそのまま描く。クライアントで並べ替えない。
//      ⚠️ T-22-09: 器は `@ses/ui` の `DataTable` **ではない**（理由は下の `ROW_GRID_CLASSES` の ⚠️ ——
//      列の下限幅がブレークポイントを持てず、モバイルで器の内側が横スクロールする）。
//      **ローカルの `<table>` も作らない**（`<ul>` + grid のまま。T-12-15 の形を保つ）。
//   ② 🔴 **60 秒ポーリングは差分で描き直す**（docs/04 申し送り 6 / docs/05 §6.3 #9 の `changedSince` / `rowVersion`）。
//      `GET /api/home?scope=&changedSince=` は `rowVersion >= changedSince` の行と、いまキューにある全行の `targetIds` を返す。
//      手元の行を `targetId` で上書きし、`targetIds` に無い行を落とし、`targetIds` にあるのに手元にも差分にも無い行があれば
//      （時計のずれ等）1 度だけ全行を読み直す。**`router.refresh()` / 全再読込はしない**（画面全体を再描画しない）。
//      更新のあった行には「新着」の印（`data-changed="true"`）を付ける。
//      🔴 T-22-09: **`actionAvailability` は毎回の応答で差し替える**（ブロック直下に全量で来る。docs/05 §6.11.2 ——
//      ドメイン検証の完了・ロール変更・停止の解除は行の `updated_at` を動かさないので差分に乗らない）。
//      🔴 **別の更新周期を作らない。** 件数（`SUMMARY`）は**同じ応答**に同梱されており、
//      ポーリングの経路はこの 1 本だけである（`SummaryStrip` は**サーバ描画のまま**で独自の周期を持たない ——
//      `'use client'` を増やさないため。次の遷移・再訪で更新される）。
//   ③ 🔴 **モバイルは 1 行 = 種別バッジ + 対象 + 経過時間の 3 要素**（docs/04 §S-003 デバイス別）。
//      `相手` / `期限` は `sm` 以上、✅ T-22-09 で足した `状態` / `操作` は `xl` 以上に出す
//      （下の `ROW_GRID_CLASSES` の実測。**横スクロールさせない**ほうを選んだ）。**セクションを折りたたまない**
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
//
// 🔴 時刻の基準は**サーバの応答時刻**（`changedSince`）である。端末時刻を混ぜると、サーバ描画と hydration 後の値が食い違う。
//    次の応答が来るまで経過時間は動かない（60 秒の粒度で足りる。秒を出さない）。
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  NAME_CELL_LINK_CLASSES,
  SECONDARY_LINK_CLASSES,
  StatusBadge,
  type BadgeVariant,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { formatElapsedWith, type ElapsedLabels } from '../../../lib/format/elapsed';
import { isActionQueueRowUrgent } from '../../../lib/home/action-queue-urgency';
import type { HomeScope } from '../../../lib/home/schemas';
import type {
  ActionQueueActionKind,
  ActionQueueHomeBlock,
  ActionQueueKind,
  ActionQueueRow,
  HomeBlock,
} from '../../../lib/home/types';
import { formatRemaining, type RemainingLabels } from '../../../lib/proposal-requests/remaining';

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
  readonly valueNone: string;
  readonly changed: string;
  readonly pollError: string;
  readonly elapsed: ElapsedLabels;
  readonly remaining: RemainingLabels;
};

export type ActionQueueSectionProps = {
  readonly initial: ActionQueueHomeBlock;
  /** 初回描画時の `changedSince`（サーバの読み取り時刻）。差分ポーリングの基準であり、経過時間の基準でもある。 */
  readonly initialChangedSince: string;
  /** ✅ T-22-09: ヘッダ右のリンクの testid を決めるためだけに使う（中身の違いはサーバが決めている）。 */
  readonly audience: 'HOST' | 'PARTNER';
  readonly scope: HomeScope;
  /** トグルの遷移先（`/?scope=mine` / `/?scope=all`）。値の出所は `page.tsx`。 */
  readonly scopeHrefs: { readonly mine: string; readonly all: string };
  /** `S-017`（提案依頼の一覧）。値の出所は `page.tsx`。 */
  readonly requestListHref: string;
  readonly messages: ActionQueueMessages;
  /** 60 秒。0 以下ならポーリングしない（render テスト用）。 */
  readonly pollIntervalMs: number;
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

type QueueState = {
  readonly rows: readonly ActionQueueRow[];
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changedSince: string;
  readonly changedIds: ReadonlySet<string>;
  readonly pollFailed: boolean;
};

type HomeResponseBody = {
  readonly blocks?: readonly HomeBlock[];
  readonly changedSince?: string;
};

function actionQueueOf(body: HomeResponseBody): { readonly block: ActionQueueHomeBlock; readonly changedSince: string } | null {
  const block = body.blocks?.find((candidate): candidate is ActionQueueHomeBlock => candidate.kind === 'ACTION_QUEUE');
  if (block === undefined || typeof body.changedSince !== 'string') return null;
  return { block, changedSince: body.changedSince };
}

/**
 * 差分を手元の行に重ねる（ファイル冒頭 ②）。`targetIds` にあるのに材料が無い行が 1 つでもあれば `null`（全行の読み直しが要る）。
 */
export function mergeActionQueueDelta(
  previous: readonly ActionQueueRow[],
  delta: ActionQueueHomeBlock,
): readonly ActionQueueRow[] | null {
  const known = new Map(previous.map((row) => [row.targetId, row]));
  for (const row of delta.items) known.set(row.targetId, row);
  const merged: ActionQueueRow[] = [];
  for (const targetId of delta.targetIds) {
    const row = known.get(targetId);
    if (row === undefined) return null;
    merged.push(row);
  }
  return merged;
}

function homeUrl(scope: HomeScope, changedSince: string | null): string {
  const params = new URLSearchParams({ scope });
  if (changedSince !== null) params.set('changedSince', changedSince);
  return `/api/home?${params.toString()}`;
}

async function fetchActionQueue(
  scope: HomeScope,
  changedSince: string | null,
): Promise<{ readonly block: ActionQueueHomeBlock; readonly changedSince: string } | null> {
  const response = await fetch(homeUrl(scope, changedSince), { cache: 'no-store' });
  if (!response.ok) return null;
  return actionQueueOf((await response.json()) as HomeResponseBody);
}

export function ActionQueueSection({
  initial,
  initialChangedSince,
  audience,
  scope,
  scopeHrefs,
  requestListHref,
  messages,
  pollIntervalMs,
}: ActionQueueSectionProps) {
  const [state, setState] = useState<QueueState>({
    rows: initial.items,
    availability: initial.actionAvailability,
    changedSince: initialChangedSince,
    changedIds: new Set(),
    pollFailed: false,
  });

  useEffect(() => {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let since = initialChangedSince;
    let rows: readonly ActionQueueRow[] = initial.items;

    async function poll(): Promise<void> {
      try {
        const delta = await fetchActionQueue(scope, since);
        if (cancelled) return;
        if (delta === null) throw new Error('poll failed');
        let merged = mergeActionQueueDelta(rows, delta.block);
        let changedIds: ReadonlySet<string> = new Set(delta.block.items.map((row) => row.targetId));
        let nextSince = delta.changedSince;
        // 🔴 可否はブロック直下に**全量**で来るので、差分応答でもそのまま差し替える（ファイル冒頭 ②）。
        let availability = delta.block.actionAvailability;
        if (merged === null) {
          // 🔴 手元にも差分にも無い行がある（時計のずれ等）。1 度だけ全行を読み直す。
          const full = await fetchActionQueue(scope, null);
          if (cancelled) return;
          if (full === null) throw new Error('poll failed');
          const threshold = Date.parse(since);
          merged = full.block.items;
          changedIds = new Set(full.block.items.filter((row) => row.rowVersion >= threshold).map((row) => row.targetId));
          nextSince = full.changedSince;
          availability = full.block.actionAvailability;
        }
        rows = merged;
        since = nextSince;
        setState({ rows: merged, availability, changedSince: nextSince, changedIds, pollFailed: false });
      } catch {
        // 次の周期で読み直す。手元の行は保つ（消さない）。
        if (!cancelled) setState((previous) => ({ ...previous, pollFailed: true }));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), pollIntervalMs);
    }
    timer = setTimeout(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [initial, initialChangedSince, scope, pollIntervalMs]);

  const nowMs = Date.parse(state.changedSince);

  return (
    <Card className="mb-4" data-testid="home-action-queue" data-scope={scope}>
      <CardHeader>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <CardTitle>{messages.title}</CardTitle>
          {/* 🔴 セクションに紐づく入口（`S-017`）。**独立したナビゲーションリンクの塊を作らない**
              （docs/04 §S-003「セクションのヘッダ右のテキストリンクは可」）。キューには
              `提案依頼の返答待ち` の行が載るので、その全体（辞退・期限切れを含む）への入口は
              このセクションの文脈である。 */}
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={requestListHref}
            data-testid={audience === 'HOST' ? 'home-host-proposal-requests' : 'home-partner-proposal-requests'}
          >
            {messages.openRequestList}
          </Link>
        </div>
        <CardDescription>{messages.lead}</CardDescription>
        {/* 🔴 「自分の担当のみ」トグル（既定オン）。同期のリンク（URL に載る）。 */}
        <nav aria-label={messages.scopeLegend} className="mt-2 flex flex-wrap gap-2 text-body" data-testid="home-action-queue-scope">
          <ScopeLink target="mine" active={scope === 'mine'} href={scopeHrefs.mine} label={messages.scopeMine} />
          <ScopeLink target="all" active={scope === 'all'} href={scopeHrefs.all} label={messages.scopeAll} />
        </nav>
      </CardHeader>
      <CardContent>
        {state.pollFailed ? (
          <p className="mb-2 text-body text-warning" role="status" data-testid="home-action-queue-poll-error">
            {messages.pollError}
          </p>
        ) : null}
        {state.rows.length === 0 ? (
          // ⚠️ 器の `data-testid`（`home-action-queue-empty`）は凍結済みの値であり、`EmptyState` が出す
          //    `{prefix}root` / `{prefix}description` は**追加**である（改名ではない。`U-22` / `T-22-06`〜`08` と同じ作法）。
          <div data-testid="home-action-queue-empty">
            {/* 🔴 **0 件は説明のみ**（Primary / Secondary を置かない。§5-13 / §10.4 ——
                0 件は正常であり、行動を促す相手がいない）。 */}
            <EmptyState testIdPrefix="home-action-queue-empty-state-" description={messages.empty} />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="home-action-queue-list">
            {/* 見出し行（`sm` 以上）。モバイルでは各行の 3 要素だけで読める。 */}
            <li className={`hidden py-1 text-xs font-medium text-fg-muted ${ROW_GRID_CLASSES}`} aria-hidden="true">
              <span>{messages.columnKind}</span>
              <span>{messages.columnSubject}</span>
              <span>{messages.columnCounterparty}</span>
              <span>{messages.columnTime}</span>
              <span>{messages.columnDeadline}</span>
              <span className={COLUMN_XL_CLASSES}>{messages.columnState}</span>
              <span className={COLUMN_XL_CLASSES}>{messages.columnAction}</span>
            </li>
            {state.rows.map((row) => (
              <ActionQueueRowItem
                key={row.targetId}
                row={row}
                availability={state.availability}
                changed={state.changedIds.has(row.targetId)}
                nowMs={nowMs}
                messages={messages}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 🔴 行と見出しの列（**7 列** = 種別 / 対象 / 相手 / 経過時間 / 期限 / 状態 / 操作。docs/04 §S-003 改訂 16）。
 *
 * 🔴 **列を落とす境界は 2 段**（`docs/04` §10.3 の `S-005` と同じ作法。優先度の低い列から落とす）:
 *   - `xl` 未満 … ✅ T-22-09 で足した `状態` / `操作` を落とす（**5 列**。移行前と同じ見え方）
 *   - `sm` 未満 … さらに `相手` / `期限` を落とす（**モバイルは 3 要素** = 種別バッジ + 対象 + 経過時間）
 *
 * 🔴 **横スクロールさせない**（`docs/04` §S-003 タブレット「横スクロールさせず列を落とす」）。
 *    ⚠️ **なぜ `lg` ではなく `xl` なのか（実測）**: `S-003` は幅クラス **B（分割）**であり、
 *    主カラムの幅は `lg`（1024px）で **1024 − サイドバー 56 − gutter 48 − カードの余白 32 = 888px** である。
 *    7 列の固定トラックの和（8+7+5+10+7+8 = 45rem = 720px）+ `gap-3` × 6（72px）= 792px を引くと
 *    `対象` に 96px しか残らず、**案件名 + エンジニア名が読めない**（切り詰めても意味が残らない）。
 *    `xl`（1280px）ではサイドバーが 224px に広がるが主カラムは 976px あり、`対象` に 184px 残る。
 *    🔴 **「列を落とす」と「横スクロールさせない」を守るほうを選び、`状態` / `操作` を `xl` に置いた。**
 *
 * ⚠️ **`@ses/ui` の `DataTable` を使わなかった理由**（`T-22-07` が `A-005` / `A-006` で `Table`
 *    プリミティブに留めたのと同じ判断）: `DataTable` の列の下限幅は `style={{minWidth}}` の
 *    固定値であり**ブレークポイントを持てない**。モバイルでも 3 列の下限の和（種別バッジは
 *    `whitespace-nowrap` で ≒148px + 対象 + 経過時間）が 375px を超え、器（`overflow-x-auto`）の
 *    内側が横スクロールする。`docs/04` §S-003 の「モバイルは 3 要素」は**対象を 2 行目に全幅で置く**
 *    ことで初めて成立する（下の `ActionQueueRowItem` の `order-last basis-full`）。
 *    🔴 **ローカルの `<table>` も作らない**（T-12-15 の `<ul>` + grid のまま。§5-13 の二重実装禁止）。
 *    器の拡張（列の下限幅をブレークポイント別にする）は `docs/05` §2.3.5 の改訂が要るので、
 *    実装側で先取りしない（申し送りとして完了記録に残す）。
 */
const ROW_GRID_CLASSES =
  'sm:grid sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,12rem)_7rem_10rem] sm:gap-3 ' +
  'xl:grid-cols-[8rem_minmax(0,1fr)_7rem_5rem_10rem_7rem_8rem]';

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
}: {
  readonly row: ActionQueueRow;
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly changed: boolean;
  readonly nowMs: number;
  readonly messages: ActionQueueMessages;
}) {
  const time =
    row.deadline === null
      ? formatElapsedWith(row.since, nowMs, messages.elapsed)
      : formatRemaining(row.deadline, nowMs, messages.remaining);
  const urgent = isActionQueueRowUrgent(row, nowMs);
  const overdue = row.deadline !== null && Date.parse(row.deadline) < nowMs;
  return (
    <li
      // 🔴 モバイル（sm 未満）は 3 要素 = 種別バッジ + 対象 + 経過時間（docs/04 §S-003 デバイス別）。バッジと経過時間を 1 行目、
      //    対象は 2 行目に全幅で置く（3 列の grid だと対象が 100px 程度に潰れ、折り返し検出器が wrapped-short-label で落ちる）。
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-2 pl-2 text-cell ${
        urgent ? 'border-l-2 border-l-warning' : 'border-l-2 border-l-transparent'
      } ${ROW_GRID_CLASSES}`}
      data-testid={`home-action-queue-row-${row.targetId}`}
      data-kind={row.kind}
      data-changed={changed ? 'true' : 'false'}
      data-urgent={urgent ? 'true' : 'false'}
    >
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
      {/* 🔴 docs/04 §10.3「長い名称」: lg 以上 = 1 行切り詰め + title（導線はこのリンク自身）/ lg 未満 = 折り返し
          （触端末ではツールチップを開けず、切り詰めると対象の末尾が読めない。CLAUDE.md §13.3）。
          CI の折り返し検出器（expectNoBrokenLabels）がモバイルの `truncate` を clipped-x として捕まえた（f03abf2）。 */}
      <Link
        href={row.href}
        title={row.subjectLabel}
        // 🔴 見た目（下線・文字色・フォーカスリング）は `@ses/ui` の 1 実装から取る
        //    （`NAME_CELL_LINK_CLASSES`）—— 画面側に `hover:` / `focus-visible:` を書かない（§7.10 / 検査 (j)）。
        className={`${NAME_CELL_LINK_CLASSES} order-last min-w-0 basis-full whitespace-normal break-words sm:order-none sm:basis-auto lg:truncate`}
        data-testid={`home-action-queue-subject-${row.targetId}`}
      >
        {row.subjectLabel}
      </Link>
      <span
        className={`min-w-0 whitespace-normal break-words text-fg lg:truncate ${COLUMN_SM_CLASSES}`}
        title={row.counterpartyLabel ?? undefined}
        data-testid={`home-action-queue-counterparty-${row.targetId}`}
      >
        {row.counterpartyLabel ?? messages.valueNone}
      </span>
      <span className="ml-auto whitespace-nowrap text-fg sm:ml-0" data-testid={`home-action-queue-time-${row.targetId}`}>
        {time}
      </span>
      {/* 🔴 期限超過は**このセルの文字色だけ**で示す（行の背景を塗らない）。🔴 赤ではなく橙。 */}
      <span
        className={`whitespace-nowrap ${overdue ? 'text-warning' : 'text-fg-muted'} ${COLUMN_SM_CLASSES}`}
        data-testid={`home-action-queue-deadline-${row.targetId}`}
      >
        {row.deadline === null ? messages.valueNone : formatDateTimeJst(row.deadline)}
      </span>
      {/* 🔴 状態は `StatusBadge`（`エンティティ + 状態` の組）。**画面側で色を決めない**（§5-13 / §7.4）。 */}
      <span className={COLUMN_XL_CLASSES}>
        {row.stateBadge.entity === 'PROPOSAL' ? (
          <StatusBadge
            entity="proposal"
            state={row.stateBadge.state}
            label={messages.proposalStates[row.stateBadge.state] ?? row.stateBadge.state}
            data-testid={`home-action-queue-state-${row.targetId}`}
          />
        ) : (
          <StatusBadge
            entity="proposalRequest"
            state={row.stateBadge.state}
            label={messages.proposalRequestStates[row.stateBadge.state] ?? row.stateBadge.state}
            data-testid={`home-action-queue-state-${row.targetId}`}
          />
        )}
      </span>
      <span className={COLUMN_XL_CLASSES}>
        <ActionCell row={row} availability={availability} messages={messages} />
      </span>
    </li>
  );
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
