'use client';

// apps/web/app/(main)/_home/home-screen.tsx
// 🔴 ホーム（`S-003` ホスト / `S-004` 取引先）の**新フレーム**（`docs/04` §4.1 / §3.1 / §3.4 /
//    §7.1 / §7.2 の改訂 23。人間のモックアップ）。2026-10-02。
//
// ============================================================================
// 🔴 構成（上から。`docs/04` §4.1 改訂 23 の図のとおり）
// ============================================================================
//   帯（`PageHeader`）
//   挨拶行（おはようございます、◯◯さん / 日付 / 一文 / 右端に「◯時◯分 時点」）
//   KPI カード 4 枚（アイコン / ラベル / 件数 / 差分）
//   ✅ 0 共有できないスキルシート（**0 件なら出さない**）
//   タブ（要対応 / 案件 / 人材。🔴 **メッセージは Phase 2 なので置かない**）
//   ┌ 主カラム: セクション群（`SectionHeader` + 行） ┬ 右レール: 予定 / 先に動くもの / ワンポイント ┐
//
// ============================================================================
// 🔴 なぜ 1 つのクライアント部品が主カラムと右レールの両方を描くのか
// ============================================================================
// `docs/04` §4.1 の非同期処理の表現が **🔴「1 回のポーリングで『KPI カード 4 枚 / タブの件数 /
// 全セクションの行 / 優先アクション』を同じ応答から一括で更新する。別々のタイミングで更新して
// はならない」**と定めている（§7.2 ③ の条件 ①〜④ も同じ）。
//
// 🔴 **右レールの「先に動くもの」は要対応キューと同じ 1 本のデータ**（`rows.slice(0, HOME_PRIORITY_ITEM_COUNT)`）であり、
//    別クエリを撃たない。別経路にすると**更新の瞬間に順位と件数が食い違い、どちらも信用されなく
//    なる**（「1 位とキューの 1 行目が違う」は利用者から見れば画面のバグである）。
// 🔴 したがって**ポーリングの口はこの 1 ファイルだけ**である（`./action-queue-section.tsx` は
//    状態を持たない描画部品になった）。`PageBody` の `aside` もここから渡す。
// 🔴 **幅クラスは画面（`page.tsx`）から素通しする**（`widthClass`。検査 (k) は「画面が
//    `widthClass` をちょうど 1 回渡す」を見ており、薄いラッパは明示的に許されている）。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
//   ① 🔴 **ホームで状態機械を動かさない**（`CLAUDE.md` §3.3）。行の操作はすべて**遷移**であり、
//      右レールには当たり判定すら無い（`RankedList` は `href` も `onClick` も受け取らない）。
//   ② 🔴 **匿名化はサーバの値をそのまま描く**（`subjectLabel`）。ホストの `提案依頼の返答待ち` は
//      `案件名 + 共有候補（匿名）`、相手は `—` である（経路 4。`CLAUDE.md` §3.1）。
//      **右レールも同じ文字列を使う**（別の射影を作ると開示の経路が 2 本になる）。
//   ③ 🔴 **タブの選択は URL に載せる**（`?tab=`。戻って同じ面に帰れる。§4.1 の操作表）。
//      🔴 ただし**サーバへの往復はしない**（`history.replaceState` の浅い更新）—— 面の切替で
//      再読込すると、60 秒ポーリングの手元の行が毎回捨てられる。
//   ④ 🔴 **タブを状態の絞り込みに使わない**（§5-13）。3 つは**面**であり、同じ母集団ではない。
//   ⑤ 🔴 **語を持たない**（`packages/i18n` は `./home-props.ts` / `./action-queue-props.ts` が解決）。
//   ⑥ 🔴 `@ses/db` に辿れる値 import を持たない（`client-db-boundary.test.ts`）。型のみ。
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageBody, PageGreeting, KpiCardRow, RailCard, RankedList, Timeline, greetingSlotOf } from '@ses/ui';
import type { PageGreetingAction, PageWidthClass, RankedListItem, TimelineEntry } from '@ses/ui';
import { Tabs } from '@ses/ui/client';
import type { ReactNode } from 'react';
import { isActionQueueRowUrgent } from '../../../lib/home/action-queue-urgency';
import { formatJstHourMinute, jstDayIndex, jstHour } from '../../../lib/home/periods';
// 🔴 型だけを読む（`./schemas.ts` は `zod` を持つ。クライアントバンドルに検証器を引き込まない）。
import type { HomeScope, HomeTab } from '../../../lib/home/schemas';
// 🔴 **タスク生成ロジック**（セクションの割り当て・順・件数）。UI と分離してある
//    （人間の仕様 2026-10-11 の 🔴。`lib/home/sections.ts` は `@ses/i18n` に依存しない）。
import { homeActionsTabCount, toHomeSections } from '../../../lib/home/sections';
import { isHomeAllMetricsZero, isHomeInitialEmpty, kpiCardItems } from '../../../lib/home/summary-view';
import type {
  ActionQueueHomeBlock,
  ActionQueueRow,
  FollowUpHomeBlock,
  HomeBlock,
  SummaryHomeBlock,
} from '../../../lib/home/types';
import { actionQueueRowTimeLabel, type ActionQueueMessages } from './action-row';
import { ActionsTab } from './actions-tab';
import type { HomeScreenMessages } from './home-props';

export type HomeScreenProps = {
  /** 🔴 幅クラス（`docs/04` §7.1 の B = 分割）。**画面から素通しする**（上の 🔴）。 */
  readonly widthClass: PageWidthClass;
  readonly audience: 'HOST' | 'PARTNER';
  /** 挨拶に差し込む氏名（🔴 **サインインしている本人**。エンジニアの氏名ではない。`BR-27`）。 */
  readonly userName: string;
  /** 日付（`2026/10/02（木）`。🔴 サーバが JST で整形したもの）。 */
  readonly dateLabel: string;
  readonly initialQueue: ActionQueueHomeBlock;
  /**
   * ✅ 2026-10-11: `要対応` タブの 2〜4 番目のセクションの行（`返信待ち` / `面談調整中` /
   * `提案後フォロー`）。🔴 **同じ応答（`GET /api/home`）から来る**（別クエリにしない）。
   */
  readonly initialFollowUp: FollowUpHomeBlock;
  readonly initialSummary: SummaryHomeBlock;
  readonly initialChangedSince: string;
  readonly scope: HomeScope;
  readonly scopeHrefs: { readonly mine: string; readonly all: string };
  readonly requestListHref: string;
  /** 🔴 `すべて見る` の遷移先（**セクションごとに 1 つだけ**。§4.1 のセクション見出し）。 */
  readonly queueListHref: string;
  readonly initialTab: HomeTab;
  /** 🔴 タブ → URL（`?tab=`）。値の出所は `page.tsx`（画面が URL を組む）。 */
  readonly tabHrefs: Readonly<Record<HomeTab, string>>;
  /**
   * 🔴 今日の予定（**面談予定のみ**。`docs/04` §4.1 の右レール ①）。
   * ⚠️ Phase 1 は**常に空**である —— 面談の日時を持つ属性が無い（`Proposal` に日時列が無く、
   *    日程調整は Phase 2 の `F-041`）。🔴 **架空の予定でも社内予定でも埋めない**（埋めた瞬間に
   *    この欄は「見ても意味が無い欄」として無視される）。
   */
  readonly schedule: readonly TimelineEntry[];
  readonly messages: HomeScreenMessages;
  readonly queueMessages: ActionQueueMessages;
  /** 60 秒。0 以下ならポーリングしない（render テスト用）。 */
  readonly pollIntervalMs: number;
  /** 送信ドメイン未検証の帯（サーバ描画。ホストの `OW` / `AD` のみ）。 */
  readonly banner: ReactNode;
  /** 帯（パンくず / タイトル / アクション）。🔴 **各画面が本文の先頭で描く**（`PageHeading`）。 */
  /**
   * ✅ **2026-10-13（Issue #92 = A）: 見出し帯をやめ、作成の導線を挨拶行の右端へ移した。**
   * 🔴 **画面タイトルは挨拶そのもの**（`PageGreeting` が `<h1>` を持つ）。
   */
  readonly actions: readonly PageGreetingAction[];
  /** KPI カードの直下の 1 行（ホスト = 利用量 / 取引先 = 見える範囲の説明）。 */
  readonly belowKpi: ReactNode;
  /** ✅ 0 共有できないスキルシート（🔴 **タブより上**。どのタブに居ても見える）。 */
  readonly quarantine: ReactNode;
  /** ✅ 2026-10-11: `メッセージ` タブの面（サーバ描画）。🔴 **未読の件数を持たない**。 */
  readonly messagesPanel: ReactNode;
  /** `案件` タブの面（サーバ描画）。 */
  readonly projectsPanel: ReactNode;
  /** `人材` タブの面（サーバ描画）。 */
  readonly engineersPanel: ReactNode;
  /** 初回空（案件も人材も 0 件）のときに主カラムへ出すもの（`EmptyState`）。 */
  readonly emptyState: ReactNode;
};

type QueueState = {
  readonly rows: readonly ActionQueueRow[];
  /**
   * ✅ 2026-10-11: `FOLLOW_UP` の行。🔴 **毎回全量で差し替える**（差分の合成経路を 2 本
   * 持たない。`lib/home/types.ts` の `FollowUpHomeBlock` の 🔴）。
   */
  readonly followUpRows: readonly ActionQueueRow[];
  readonly availability: ActionQueueHomeBlock['actionAvailability'];
  readonly summary: SummaryHomeBlock;
  readonly changedSince: string;
  readonly changedIds: ReadonlySet<string>;
  readonly pollFailed: boolean;
};

type HomeResponseBody = {
  readonly blocks?: readonly HomeBlock[];
  readonly changedSince?: string;
};

/** 🔴 1 回の応答から**全部**を取り出す（片方だけ更新する経路を作らない。上の 🔴）。 */
type HomeDelta = {
  readonly queue: ActionQueueHomeBlock;
  readonly followUp: FollowUpHomeBlock;
  readonly summary: SummaryHomeBlock;
  readonly changedSince: string;
};

export function homeDeltaOf(body: HomeResponseBody): HomeDelta | null {
  const queue = body.blocks?.find(
    (candidate): candidate is ActionQueueHomeBlock => candidate.kind === 'ACTION_QUEUE',
  );
  const followUp = body.blocks?.find(
    (candidate): candidate is FollowUpHomeBlock => candidate.kind === 'FOLLOW_UP',
  );
  const summary = body.blocks?.find(
    (candidate): candidate is SummaryHomeBlock => candidate.kind === 'SUMMARY',
  );
  // 🔴 1 つでも欠けた応答を部分的に適用しない（数と行が別の時点のものになる）。
  //    ✅ 2026-10-11: `FOLLOW_UP` も同じ扱いである —— KPI カード 2 / 3 の件数と
  //    セクションの行数は同じ応答から来なければ食い違う。
  if (
    queue === undefined ||
    followUp === undefined ||
    summary === undefined ||
    typeof body.changedSince !== 'string'
  ) {
    return null;
  }
  return { queue, followUp, summary, changedSince: body.changedSince };
}

/**
 * 差分を手元の行に重ねる（`targetIds` にあるのに材料が無い行が 1 つでもあれば `null` =
 * 全行の読み直しが要る）。🔴 **T-12-15 から判定を変えていない。**
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

async function fetchHome(scope: HomeScope, changedSince: string | null): Promise<HomeDelta | null> {
  const response = await fetch(homeUrl(scope, changedSince), { cache: 'no-store' });
  if (!response.ok) return null;
  return homeDeltaOf((await response.json()) as HomeResponseBody);
}

/**
 * 🔴 右レールの「先に動くもの」の件数。
 *
 * ✅ 2026-10-11: 人間の仕様「**優先アクション（最大 4 件、順位つき）**」に合わせて **3 → 4**。
 * ⚠️ `docs/04` §4.1 の右レール ② は「上位 3 件」と書いており、**人間の仕様の方が新しい**
 *    （`docs/04` 側の訂正は報告対象。`CLAUDE.md` §8.7）。
 * 🔴 **「最大」である**（行がそれより少なければ少ないまま。足して埋めない）。
 */
export const HOME_PRIORITY_ITEM_COUNT = 4;

/**
 * 🔴 要対応キューの**上位 `HOME_PRIORITY_ITEM_COUNT` 件**を順位つきにする（**同じ 1 本のデータ**。別クエリにしない）。
 * 🔴 **件数を文章に数字で書かない** —— 定数と本文が食い違うコメントは、
 *    `S-022` の並び順の注記（2026-10-04 に「新しい順」と書いてあったが実装は更新日の昇順）と同じ事故である。
 *
 * 🔴 **並びはキューと同一**（サーバが決めた `targetIds` の順。`放置時間 × 取り返しのつかなさ`）。
 *    ここで並べ替えると、画面の 2 箇所で順位が違うという最悪の形になる。
 * 🔴 **実行系の導線を持たない**（`RankedListItem` に `href` も `onClick` も無い。§4.1 の 🔴）。
 */
export function priorityItems(
  rows: readonly ActionQueueRow[],
  nowMs: number,
  messages: ActionQueueMessages,
): readonly RankedListItem[] {
  return rows.slice(0, HOME_PRIORITY_ITEM_COUNT).map((row, index) => ({
    rank: index + 1,
    // 🔴 行と同じ文字列（匿名の行は `案件名 + 共有候補（匿名）` のまま。上の ②）。
    title: row.subjectLabel,
    subtitle: messages.kinds[row.kind],
    // 🔴 時間の語は**キューの行と同じ 1 実装**を通す（`actionQueueRowTimeLabel`）——
    //    同じ行が 2 箇所で違う経過時間を示すと、どちらも信用されなくなる。
    badge: {
      text: actionQueueRowTimeLabel(row, nowMs, messages),
      urgent: isActionQueueRowUrgent(row, nowMs),
    },
  }));
}

/**
 * 挨拶行の一文（🔴 **件数で静的な文言から選ぶ**。AI で生成しない。§4.1 の挨拶行）。
 * 🔴 0 件は「対応が必要なものはありません」の 1 文にする（§4.1）。
 */
export function greetingLead(count: number, messages: HomeScreenMessages): string {
  if (count === 0) return messages.greeting.leadNone;
  return `${messages.greeting.leadPrefix}${String(count)}${messages.greeting.leadSuffix}`;
}

/**
 * 挨拶行の右端（🔴 **データの基準時刻 + 差分の起点**。§4.1「更新したことが画面から読める唯一の
 * 場所であり省略できない」）。
 */
export function asOfLabel(changedSince: string, messages: HomeScreenMessages): string {
  const at = new Date(changedSince);
  if (Number.isNaN(at.getTime())) return messages.greeting.asOfNote;
  const { asOfSuffix, asOfSeparator, asOfNote } = messages.greeting;
  return `${formatJstHourMinute(at)}${asOfSuffix}${asOfSeparator}${asOfNote}`;
}

/**
 * 🔴 今日のワンポイント（**静的な文言集から日替わりで 1 つ**。§4.1 の右レール ③）。
 * 🔴 **乱数を使わない** —— 60 秒ポーリングで文が入れ替わると、読んでいる途中で消える。
 */
export function onePointLine(changedSince: string, lines: readonly string[]): string | null {
  if (lines.length === 0) return null;
  const at = new Date(changedSince);
  const index = Number.isNaN(at.getTime()) ? 0 : jstDayIndex(at) % lines.length;
  return lines[index] ?? null;
}

/**
 * ✅ 2026-10-11: 🔴 **ワンポイントを「当日だけ」閉じるための鍵**（端末に保持する。
 *    `docs/04` §4.1 の右レール ③「閉じた状態は端末に保持し、その日は再表示しない。
 *    🔴 **二度と出ない形にしない**」）。
 *
 * 🔴 **鍵に日付（JST の通日）を含める**ことがその担保である —— 翌日は鍵が変わるので
 *    必ず再表示される。「永久に消す」値を保存できる形にしない。
 * 🔴 **業務データを端末に保存しない**（保存するのは「何日目か」の整数だけ）。
 */
export const HOME_ONE_POINT_DISMISS_STORAGE_KEY = 'ses.home.onePoint.dismissedDay';

export function onePointDismissDay(changedSince: string): string {
  const at = new Date(changedSince);
  return String(Number.isNaN(at.getTime()) ? 0 : jstDayIndex(at));
}

export function HomeScreen({
  widthClass,
  audience,
  userName,
  dateLabel,
  initialQueue,
  initialFollowUp,
  initialSummary,
  initialChangedSince,
  scope,
  scopeHrefs,
  requestListHref,
  queueListHref,
  initialTab,
  tabHrefs,
  schedule,
  messages,
  queueMessages,
  pollIntervalMs,
  banner,
  actions,
  belowKpi,
  quarantine,
  messagesPanel,
  projectsPanel,
  engineersPanel,
  emptyState,
}: HomeScreenProps) {
  const [state, setState] = useState<QueueState>({
    rows: initialQueue.items,
    followUpRows: initialFollowUp.items,
    availability: initialQueue.actionAvailability,
    summary: initialSummary,
    changedSince: initialChangedSince,
    changedIds: new Set(),
    pollFailed: false,
  });
  const [tab, setTab] = useState<HomeTab>(initialTab);

  useEffect(() => {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let since = initialChangedSince;
    let rows: readonly ActionQueueRow[] = initialQueue.items;

    async function poll(): Promise<void> {
      try {
        const delta = await fetchHome(scope, since);
        if (cancelled) return;
        if (delta === null) throw new Error('poll failed');
        let merged = mergeActionQueueDelta(rows, delta.queue);
        let changedIds: ReadonlySet<string> = new Set(delta.queue.items.map((row) => row.targetId));
        let nextSince = delta.changedSince;
        // 🔴 可否はブロック直下に**全量**で来るので、差分応答でもそのまま差し替える。
        let availability = delta.queue.actionAvailability;
        // 🔴 KPI は**毎回全量**来る（差分にしない。`docs/05` §6.11.1）。
        let summary = delta.summary;
        // 🔴 ✅ 2026-10-11: `FOLLOW_UP` も**毎回全量**来る（差分を持たない）。
        let followUpRows = delta.followUp.items;
        if (merged === null) {
          // 🔴 手元にも差分にも無い行がある（時計のずれ等）。1 度だけ全行を読み直す。
          const full = await fetchHome(scope, null);
          if (cancelled) return;
          if (full === null) throw new Error('poll failed');
          const threshold = Date.parse(since);
          merged = full.queue.items;
          changedIds = new Set(
            full.queue.items.filter((row) => row.rowVersion >= threshold).map((row) => row.targetId),
          );
          nextSince = full.changedSince;
          availability = full.queue.actionAvailability;
          summary = full.summary;
          followUpRows = full.followUp.items;
        }
        rows = merged;
        since = nextSince;
        setState({
          rows: merged,
          followUpRows,
          availability,
          summary,
          changedSince: nextSince,
          changedIds,
          pollFailed: false,
        });
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
  }, [initialQueue, initialChangedSince, scope, pollIntervalMs]);

  const nowMs = Date.parse(state.changedSince);
  const queueCount = state.rows.length;
  // 🔴 ✅ 2026-10-11: セクションの組み立ては **`lib/home/sections.ts` の純粋関数 1 本**である
  //    （人間の仕様「タスク生成ロジックと UI を分離する」）。**この部品は並べ替えも選別もしない。**
  //    🔴 入力は**同じ 1 応答**から来た 2 本の行（`ACTION_QUEUE` と `FOLLOW_UP`）であり、
  //    優先度の基準時刻（`nowMs`）も同じ `changedSince` である。
  const sections = toHomeSections(state.rows, state.followUpRows, nowMs);
  // 🔴 タブの件数は**`今日やること` の件数だけ**である（KPI カード 1 と挨拶行の一文と**同じ数**）。
  //    ⚠️ ✅ 2026-10-11（レビュー指摘）: 旧コメントは「**全セクションの合計**（KPI カード 1 とは
  //    別の数）」と書いていたが、**実装と正反対**だった。合計にしない理由 3 つは
  //    `lib/home/sections.ts` の `homeActionsTabCount` に在る（①種別ごとの件数を 1 つの合計に
  //    丸めない ②同じ画面に矛盾する 2 行を作らない ③`返信待ち` は「片付けられるもの」ではない）。
  //    🔴 **注記が実装と逆になる事故は `HANDOFF.md` §6 の 13 / 15 と同じ形である。**
  const actionsTabCount = homeActionsTabCount(sections);
  const initialEmpty = isHomeInitialEmpty(state.summary);
  // 🔴 ✅ 2026-10-03: 4 指標がすべて 0 の日は**カードを描かず 1 行に倒す**
  //    （`lib/home/summary-view.ts` の `isHomeAllMetricsZero` の 🔴。§7.2「0 が並ぶ KPI カードを
  //    出す」は認められていない）。**器（`home-*-summary`）は残す** —— 残量の 1 行（`belowKpi`）が
  //    この器の中に在り、E2E も器の実在を見ている。
  const allMetricsZero = isHomeAllMetricsZero(state.summary);

  /**
   * 🔴 タブの選択を URL に載せる（サーバへ往復しない。上の ③）。
   * 🔴 **既知の値以外を黙って受けない**（`tabHrefs` の鍵が唯一の集合である）。
   */
  function selectTab(next: string): void {
    const value: HomeTab = next in tabHrefs ? (next as HomeTab) : initialTab;
    setTab(value);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', tabHrefs[value]);
  }

  // ✅ 2026-10-11: `要対応` タブの面（**4 セクションを縦に並べる**。`./actions-tab.tsx`）。
  const actionsTab = (
    <ActionsTab
      sections={sections}
      availability={state.availability}
      changedIds={state.changedIds}
      pollFailed={state.pollFailed}
      nowMs={nowMs}
      audience={audience}
      scope={scope}
      scopeHrefs={scopeHrefs}
      requestListHref={requestListHref}
      queueListHref={queueListHref}
      seeAllLabel={messages.seeAll}
      countUnit={messages.kpi.unit}
      sectionMessages={messages.sections}
      messages={queueMessages}
    />
  );

  return (
    <PageBody
      widthClass={widthClass}
      aside={
        // 🔴 右レール 3 ブロック（§4.1 / §3.4）。`lg` 未満では `PageBody` が**本体の下に積む**。
        //    ⚠️ 積む順序（優先アクション → 予定 → ワンポイント）は §3.4 の定めだが、**本実装は
        //    デスクトップでも「先に動くもの」を先に置いている** —— 0 件になりがちな予定より
        //    「次の 1 手」が上に在るほうが、どの幅でも同じ走査順になる（§3.4 の趣旨を満たす）。
        initialEmpty ? undefined : (
          // ✅ **2026-10-13（人間のデザインシステム定義 v1.0 §3.7）: 並びを
          //    `今日のスケジュール` → `優先アクション` → `今日のワンポイント` にした。**
          // 🔴 従来は優先アクションが先頭だった。時刻の軸を持つものを上に置くと、**朝に開いた
          //    ときの「今日はどう進むか」が 1 つ目のカードで分かる**（優先アクションは「何から
          //    やるか」であり、時間の見通しの後に来るほうが順序として自然である）。
          <div className="flex flex-col gap-4" data-testid="home-rail">
            <Timeline
              title={messages.rail.scheduleTitle}
              entries={schedule}
              emptyLabel={messages.rail.scheduleEmpty}
              testIdPrefix="home-rail-schedule-"
            />
            <RankedList
              title={messages.rail.priorityTitle}
              items={priorityItems(state.rows, nowMs, queueMessages)}
              emptyLabel={messages.rail.priorityEmpty}
              testIdPrefix="home-rail-priority-"
            />
            <OnePoint changedSince={state.changedSince} messages={messages} />
          </div>
        )
      }
    >
      {banner}
      {/* 挨拶行（§4.1 改訂 23。🔴 **右端は基準時刻**であり、モックアップの企業の標語は置かない ——
          `Tenant` に標語の属性が無く、架空の文言より差分の起点のほうが判断に効く）。 */}
      <PageGreeting
        greeting={`${messages.greeting.slots[greetingSlot(state.changedSince)]}${userName}${messages.greeting.nameSuffix}`}
        dateLabel={dateLabel}
        lead={greetingLead(queueCount, messages)}
        motto={asOfLabel(state.changedSince, messages)}
        testIdPrefix={audience === 'HOST' ? 'home-host-greeting-' : 'home-partner-greeting-'}
        actions={actions}
        linkComponent={Link}
      />
      {initialEmpty ? (
        emptyState
      ) : (
        <>
          {/* 🔴 KPI カード 4 枚（§7.2 改訂 23 ①）。**`md` 未満は 2×2 に畳む**（部品が持つ）。 */}
          <div
            data-testid={audience === 'HOST' ? 'home-host-summary' : 'home-partner-summary'}
            data-metrics={allMetricsZero ? 'all-zero' : 'present'}
          >
            {allMetricsZero ? (
              <p className="m-0 text-body text-fg-muted" data-testid="home-kpi-all-zero">
                {messages.kpi.allZero}
              </p>
            ) : (
              // 🔴 ✅ 2026-10-11: **カードのクリックで該当セクション / 一覧へ遷移する**
              //    （人間の仕様の中心的な UX）。遷移先は API の応答（`SummaryMetric.href`）が
              //    持ち、**画面は URL を組まない**（`docs/05` §6.11.1）。
              //    🔴 `href` が `null` のカードは押せる見た目にならない（`packages/ui` の
              //    `KpiCard` の 1 箇所が判定する）。
              //    🔴 遷移は `next/link`（URL に状態を持つ。クライアント側の状態にしない）。
              <KpiCardRow
                items={kpiCardItems(state.summary, messages.kpi)}
                testIdPrefix={audience === 'HOST' ? 'home-host-kpi-' : 'home-partner-kpi-'}
                linkComponent={Link}
              />
            )}
            {belowKpi}
          </div>
          {/* 🔴 ✅ 0 はタブより上（§4.1）—— どのタブに居ても見えていなければならない。 */}
          {quarantine}
          <Tabs
            label={messages.tabs.label}
            value={tab}
            onValueChange={selectTab}
            data-testid="home-tabs"
            items={[
              // 🔴 ✅ 2026-10-11: 並びは人間の仕様の **`メッセージ / 要対応 / 案件 / 人材`**。
              //    **既定の選択は `要対応`**（`DEFAULT_HOME_TAB`）であり、並びの先頭とは別である。
              // 🔴 件数は `要対応` にだけ付ける。
              //    - `メッセージ` … 🔴 **未読の実体が無い**（`Message` に既読の列が無い）。
              //      スレッドの総数を出すと「未読が N 件」に読める。
              //    - `案件` / `人材` … 行が Phase 2 で入るまで数が無い（**0 と書くと
              //      「案件が無い」に読める**）。
              {
                value: 'messages',
                label: messages.tabs.messages,
                icon: 'message-square',
                content: messagesPanel,
              },
              {
                value: 'actions',
                label: `${messages.tabs.actions} ${String(actionsTabCount)}`,
                icon: 'list-checks',
                content: actionsTab,
              },
              {
                value: 'projects',
                label: messages.tabs.projects,
                icon: 'briefcase',
                content: projectsPanel,
              },
              {
                value: 'engineers',
                label: messages.tabs.engineers,
                icon: 'users',
                content: engineersPanel,
              },
            ]}
          />
        </>
      )}
    </PageBody>
  );
}

/**
 * 挨拶の時間帯（🔴 **テナントのタイムゾーン（`Asia/Tokyo`）で判定する**。端末の時刻に依らせない ——
 * 移動中の端末設定で挨拶と日付がずれる。`docs/04` §4.1 の挨拶行）。
 *
 * 🔴 **壊れた基準時刻で描画ごと落とさない** —— `changedSince` はサーバが作る ISO 8601 なので
 *    不正値は起こらないが、`greetingSlotOf` は範囲外で例外を投げる（それが正しい）ため、
 *    ここで朝に倒す（ホーム全体が白画面になるより、挨拶が 1 回ずれるほうが軽い）。
 */
function greetingSlot(changedSince: string): 'MORNING' | 'AFTERNOON' | 'EVENING' {
  const at = new Date(changedSince);
  if (Number.isNaN(at.getTime())) return 'MORNING';
  return greetingSlotOf(jstHour(at));
}

/**
 * 🔴 今日のワンポイント（右レール ③）。
 *
 * ~~**`RailCard` に閉じるボタンの口が無い**ため常設である~~ → ✅ 2026-10-11: 人間の仕様
 *    「**今日のワンポイント（Dismiss 可）**」に合わせて `RailCard` に `dismiss` を足した
 *    （`packages/ui`。🔴 **`'use client'` は増えていない** —— ハンドラを受け取るだけの部品は
 *    クライアント境界を作らず、境界はこのファイルが既に持っている）。
 *
 * 🔴 **当日だけ閉じる**（`docs/04` §4.1 の ③「🔴 **二度と出ない形にしない**。翌日は別の 1 文が
 *    出る」）。担保は**鍵に JST の通日を含めること**であり、翌日は鍵が変わって必ず再表示される。
 * 🔴 **`localStorage` は `useEffect` の中でだけ読む** —— サーバ描画時には存在せず、初期描画で
 *    読むと hydration が食い違う（`HANDOFF.md` §6-2 の「制御された入力に React が空を書き戻す」と
 *    同じ種類の事故）。したがって**初回は必ず表示され、閉じていた日はその直後に消える**。
 * 🔴 **業務データを端末に保存しない**（保存するのは「何日目か」の整数だけ）。
 */
function OnePoint({
  changedSince,
  messages,
}: {
  readonly changedSince: string;
  readonly messages: HomeScreenMessages;
}) {
  const day = onePointDismissDay(changedSince);
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissedDay(window.localStorage.getItem(HOME_ONE_POINT_DISMISS_STORAGE_KEY));
    } catch {
      // ⚠️ `localStorage` が使えない設定（プライベートモード等）では常に表示する。
      //    **閉じられないほうが、消えたまま戻らないより軽い。**
      setDismissedDay(null);
    }
  }, [changedSince]);

  const line = onePointLine(changedSince, messages.rail.onePointLines);
  if (line === null || dismissedDay === day) return null;
  return (
    <RailCard
      title={messages.rail.onePointTitle}
      lines={[line]}
      tone="tip"
      dismiss={{
        label: messages.rail.onePointDismiss,
        onDismiss: () => {
          setDismissedDay(day);
          try {
            window.localStorage.setItem(HOME_ONE_POINT_DISMISS_STORAGE_KEY, day);
          } catch {
            // 保存できなくても当日の表示は消す（次に開くと再表示される）。
          }
        },
      }}
      testIdPrefix="home-rail-one-point-"
    />
  );
}
