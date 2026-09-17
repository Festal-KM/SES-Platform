'use client';

// apps/web/app/(main)/_home/action-queue-section.tsx
// `S-003` セクション 1 / `S-004` セクション 1・2 の要対応キュー（docs/04 §S-003 / §S-004 / `F-006` / docs/05 §6.3 #9）。T-12-15。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
//   ① 🔴 **1 本のテーブルに束ねる**（docs/04 §S-003「種別ごとにカードを分けると『今日どれから手を付けるか』が判断できない」）。
//      並びはサーバ（`sortActionQueueRows`）が決めた `targetIds` の順をそのまま描く。クライアントで並べ替えない。
//   ② 🔴 **60 秒ポーリングは差分で描き直す**（docs/04 申し送り 6 / docs/05 §6.3 #9 の `changedSince` / `rowVersion`）。
//      `GET /api/home?scope=&changedSince=` は `rowVersion >= changedSince` の行と、いまキューにある全行の `targetIds` を返す。
//      手元の行を `targetId` で上書きし、`targetIds` に無い行を落とし、`targetIds` にあるのに手元にも差分にも無い行があれば
//      （時計のずれ等）1 度だけ全行を読み直す。**`router.refresh()` / 全再読込はしない**（画面全体を再描画しない）。
//      更新のあった行には「新着」の印（`data-changed="true"`）を付ける。
//   ③ 🔴 **モバイルは 1 行 = 種別バッジ + 対象 + 経過時間の 3 要素**（docs/04 §S-003 デバイス別）。`相手` / `期限` は `sm` 以上で出す。
//      **セクションを折りたたまない**（`<details>` を使わない。畳むと期限が見えなくなる）。ブレークポイントは Tailwind の既定のみ。
//   ④ 🔴 **種別ごとの件数を 1 つの合計に丸めない。** 件数の見出し（「N 件」）を出さない —— 4 つの「うまくいかなかった」の混同の表示になる
//      （`F-024 AC-2` / `BR-23`）。並びと種別バッジで足りる。
//   ⑤ 🔴 **0 件でもセクションを消さない**（docs/04 §S-003「要対応 0 件 → 『対応が必要なものはありません』。画面全体を空にしない」）。
//   ⑥ 文言は props（`packages/i18n` はサーバ側 `action-queue-props.ts` で解決）。本ファイルは日本語の語を書かない。
//      経過時間 / 残り時間の丸めは `lib/format/elapsed.ts` / `lib/proposal-requests/remaining.ts` の純粋関数（サーバと同じ 1 実装）。
//   ⑦ 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。型は `lib/home/types.ts` / `schemas.ts` から type-only で読む。
//
// 🔴 時刻の基準は**サーバの応答時刻**（`changedSince`）である。端末時刻を混ぜると、サーバ描画と hydration 後の値が食い違う。
//    次の応答が来るまで経過時間は動かない（60 秒の粒度で足りる。秒を出さない）。
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, type BadgeVariant } from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { formatElapsedWith, type ElapsedLabels } from '../../../lib/format/elapsed';
import type { HomeScope } from '../../../lib/home/schemas';
import type { ActionQueueHomeBlock, ActionQueueKind, ActionQueueRow, HomeBlock } from '../../../lib/home/types';
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
  /** 🔴 種別ラベル。5 種別すべてを持つ（`Record` で割り当て漏れをコンパイラに強制させる）。 */
  readonly kinds: Readonly<Record<ActionQueueKind, string>>;
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
  readonly scope: HomeScope;
  /** トグルの遷移先（`/?scope=mine` / `/?scope=all`）。値の出所は `page.tsx`。 */
  readonly scopeHrefs: { readonly mine: string; readonly all: string };
  readonly messages: ActionQueueMessages;
  /** 60 秒。0 以下ならポーリングしない（render テスト用）。 */
  readonly pollIntervalMs: number;
};

/** 種別バッジの色味。`SEND_FAILED`（障害）と `SEND_HELD`（保留）は**別の色**（docs/05 §10.4「別の表示」）。 */
const KIND_VARIANTS: Readonly<Record<ActionQueueKind, BadgeVariant>> = {
  SEND_FAILED: 'danger',
  APPROVAL_PENDING: 'warning',
  GATE_FAILED: 'danger',
  SEND_HELD: 'outline',
  PROPOSAL_REQUEST_PENDING: 'neutral',
};

type QueueState = {
  readonly rows: readonly ActionQueueRow[];
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
  scope,
  scopeHrefs,
  messages,
  pollIntervalMs,
}: ActionQueueSectionProps) {
  const [state, setState] = useState<QueueState>({
    rows: initial.items,
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
        if (merged === null) {
          // 🔴 手元にも差分にも無い行がある（時計のずれ等）。1 度だけ全行を読み直す。
          const full = await fetchActionQueue(scope, null);
          if (cancelled) return;
          if (full === null) throw new Error('poll failed');
          const threshold = Date.parse(since);
          merged = full.block.items;
          changedIds = new Set(full.block.items.filter((row) => row.rowVersion >= threshold).map((row) => row.targetId));
          nextSince = full.changedSince;
        }
        rows = merged;
        since = nextSince;
        setState({ rows: merged, changedSince: nextSince, changedIds, pollFailed: false });
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
        <CardTitle>{messages.title}</CardTitle>
        <CardDescription className="text-slate-700">{messages.lead}</CardDescription>
        {/* 🔴 「自分の担当のみ」トグル（既定オン）。同期のリンク（URL に載る）。 */}
        <nav aria-label={messages.scopeLegend} className="mt-2 flex flex-wrap gap-2 text-sm" data-testid="home-action-queue-scope">
          <ScopeLink target="mine" active={scope === 'mine'} href={scopeHrefs.mine} label={messages.scopeMine} />
          <ScopeLink target="all" active={scope === 'all'} href={scopeHrefs.all} label={messages.scopeAll} />
        </nav>
      </CardHeader>
      <CardContent>
        {state.pollFailed ? (
          <p className="mb-2 text-sm text-amber-800" role="status" data-testid="home-action-queue-poll-error">
            {messages.pollError}
          </p>
        ) : null}
        {state.rows.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="home-action-queue-empty">
            {messages.empty}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200" data-testid="home-action-queue-list">
            {/* 見出し行（`sm` 以上）。モバイルでは各行の 3 要素だけで読める。 */}
            <li className="hidden py-1 text-xs font-semibold text-slate-500 sm:grid sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,12rem)_7rem_10rem] sm:gap-3" aria-hidden="true">
              <span>{messages.columnKind}</span>
              <span>{messages.columnSubject}</span>
              <span>{messages.columnCounterparty}</span>
              <span>{messages.columnTime}</span>
              <span>{messages.columnDeadline}</span>
            </li>
            {state.rows.map((row) => (
              <ActionQueueRowItem
                key={row.targetId}
                row={row}
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
          ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-white'
          : 'rounded-full border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100'
      }
    >
      {label}
    </Link>
  );
}

/**
 * 1 行。🔴 モバイル = 種別バッジ + 対象 + 経過時間（3 要素）。`相手` / `期限` は `sm` 以上。
 * 時間の欄は、提案依頼の行 = 返答期限までの残り（期限切れが最も痛い）/ それ以外 = 経過時間（放置時間）。
 */
function ActionQueueRowItem({
  row,
  changed,
  nowMs,
  messages,
}: {
  readonly row: ActionQueueRow;
  readonly changed: boolean;
  readonly nowMs: number;
  readonly messages: ActionQueueMessages;
}) {
  const time =
    row.deadline === null ? formatElapsedWith(row.since, nowMs, messages.elapsed) : formatRemaining(row.deadline, nowMs, messages.remaining);
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,12rem)_7rem_10rem] sm:gap-3"
      data-testid={`home-action-queue-row-${row.targetId}`}
      data-kind={row.kind}
      data-changed={changed ? 'true' : 'false'}
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
      <Link
        href={row.href}
        className="truncate font-medium text-slate-900 underline-offset-2 hover:underline"
        data-testid={`home-action-queue-subject-${row.targetId}`}
      >
        {row.subjectLabel}
      </Link>
      <span className="hidden truncate text-slate-700 sm:inline" data-testid={`home-action-queue-counterparty-${row.targetId}`}>
        {row.counterpartyLabel ?? messages.valueNone}
      </span>
      <span className="whitespace-nowrap text-slate-700" data-testid={`home-action-queue-time-${row.targetId}`}>
        {time}
      </span>
      <span className="hidden whitespace-nowrap text-slate-600 sm:inline" data-testid={`home-action-queue-deadline-${row.targetId}`}>
        {row.deadline === null ? messages.valueNone : formatDateTimeJst(row.deadline)}
      </span>
    </li>
  );
}
