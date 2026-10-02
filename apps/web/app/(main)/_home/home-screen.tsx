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
// 🔴 **右レールの「先に動くもの」は要対応キューと同じ 1 本のデータ**（`rows.slice(0, 3)`）であり、
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
import { useEffect, useState } from 'react';
import { PageBody, PageGreeting, KpiCardRow, RailCard, RankedList, Timeline, greetingSlotOf } from '@ses/ui';
import type { PageWidthClass, RankedListItem, TimelineEntry } from '@ses/ui';
import { Tabs } from '@ses/ui/client';
import type { ReactNode } from 'react';
import { isActionQueueRowUrgent } from '../../../lib/home/action-queue-urgency';
import { formatJstHourMinute, jstDayIndex, jstHour } from '../../../lib/home/periods';
// 🔴 型だけを読む（`./schemas.ts` は `zod` を持つ。クライアントバンドルに検証器を引き込まない）。
import type { HomeScope, HomeTab } from '../../../lib/home/schemas';
import { isHomeInitialEmpty, kpiCardItems } from '../../../lib/home/summary-view';
import type {
  ActionQueueHomeBlock,
  ActionQueueRow,
  HomeBlock,
  SummaryHomeBlock,
} from '../../../lib/home/types';
import {
  ActionQueueSection,
  actionQueueRowTimeLabel,
  type ActionQueueMessages,
} from './action-queue-section';
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
  readonly heading: ReactNode;
  /** KPI カードの直下の 1 行（ホスト = 利用量 / 取引先 = 見える範囲の説明）。 */
  readonly belowKpi: ReactNode;
  /** ✅ 0 共有できないスキルシート（🔴 **タブより上**。どのタブに居ても見える）。 */
  readonly quarantine: ReactNode;
  /** `案件` タブの面（サーバ描画）。 */
  readonly projectsPanel: ReactNode;
  /** `人材` タブの面（サーバ描画）。 */
  readonly engineersPanel: ReactNode;
  /** 初回空（案件も人材も 0 件）のときに主カラムへ出すもの（`EmptyState`）。 */
  readonly emptyState: ReactNode;
};

type QueueState = {
  readonly rows: readonly ActionQueueRow[];
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

/** 🔴 1 回の応答から**両方**を取り出す（片方だけ更新する経路を作らない。上の 🔴）。 */
type HomeDelta = {
  readonly queue: ActionQueueHomeBlock;
  readonly summary: SummaryHomeBlock;
  readonly changedSince: string;
};

export function homeDeltaOf(body: HomeResponseBody): HomeDelta | null {
  const queue = body.blocks?.find(
    (candidate): candidate is ActionQueueHomeBlock => candidate.kind === 'ACTION_QUEUE',
  );
  const summary = body.blocks?.find(
    (candidate): candidate is SummaryHomeBlock => candidate.kind === 'SUMMARY',
  );
  // 🔴 どちらかが欠けた応答を部分的に適用しない（数と行が別の時点のものになる）。
  if (queue === undefined || summary === undefined || typeof body.changedSince !== 'string') return null;
  return { queue, summary, changedSince: body.changedSince };
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

/** 🔴 右レールの「先に動くもの」の件数（`docs/04` §4.1 の右レール ② = **上位 3 件**）。 */
export const HOME_PRIORITY_ITEM_COUNT = 3;

/**
 * 🔴 要対応キューの**上位 3 件**を順位つきにする（**同じ 1 本のデータ**。別クエリにしない）。
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

export function HomeScreen({
  widthClass,
  audience,
  userName,
  dateLabel,
  initialQueue,
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
  heading,
  belowKpi,
  quarantine,
  projectsPanel,
  engineersPanel,
  emptyState,
}: HomeScreenProps) {
  const [state, setState] = useState<QueueState>({
    rows: initialQueue.items,
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
        }
        rows = merged;
        since = nextSince;
        setState({
          rows: merged,
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
  const initialEmpty = isHomeInitialEmpty(state.summary);

  /**
   * 🔴 タブの選択を URL に載せる（サーバへ往復しない。上の ③）。
   * 🔴 **既知の値以外を黙って受けない**（`tabHrefs` の鍵が唯一の集合である）。
   */
  function selectTab(next: string): void {
    const value: HomeTab = next in tabHrefs ? (next as HomeTab) : initialTab;
    setTab(value);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', tabHrefs[value]);
  }

  const queueSection = (
    <ActionQueueSection
      rows={state.rows}
      availability={state.availability}
      changedIds={state.changedIds}
      pollFailed={state.pollFailed}
      nowMs={nowMs}
      audience={audience}
      scope={scope}
      scopeHrefs={scopeHrefs}
      requestListHref={requestListHref}
      seeAllHref={queueListHref}
      seeAllLabel={messages.seeAll}
      countLabel={`${String(queueCount)}${messages.kpi.unit}`}
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
          <div className="flex flex-col gap-4" data-testid="home-rail">
            <RankedList
              title={messages.rail.priorityTitle}
              items={priorityItems(state.rows, nowMs, queueMessages)}
              emptyLabel={messages.rail.priorityEmpty}
              testIdPrefix="home-rail-priority-"
            />
            <Timeline
              title={messages.rail.scheduleTitle}
              entries={schedule}
              emptyLabel={messages.rail.scheduleEmpty}
              testIdPrefix="home-rail-schedule-"
            />
            <OnePoint changedSince={state.changedSince} messages={messages} />
          </div>
        )
      }
    >
      {banner}
      {heading}
      {/* 挨拶行（§4.1 改訂 23。🔴 **右端は基準時刻**であり、モックアップの企業の標語は置かない ——
          `Tenant` に標語の属性が無く、架空の文言より差分の起点のほうが判断に効く）。 */}
      <PageGreeting
        greeting={`${messages.greeting.slots[greetingSlot(state.changedSince)]}${userName}${messages.greeting.nameSuffix}`}
        dateLabel={dateLabel}
        lead={greetingLead(queueCount, messages)}
        motto={asOfLabel(state.changedSince, messages)}
        testIdPrefix={audience === 'HOST' ? 'home-host-greeting-' : 'home-partner-greeting-'}
      />
      {initialEmpty ? (
        emptyState
      ) : (
        <>
          {/* 🔴 KPI カード 4 枚（§7.2 改訂 23 ①）。**`md` 未満は 2×2 に畳む**（部品が持つ）。 */}
          <div className="mb-4" data-testid={audience === 'HOST' ? 'home-host-summary' : 'home-partner-summary'}>
            <KpiCardRow
              items={kpiCardItems(state.summary, messages.kpi)}
              testIdPrefix={audience === 'HOST' ? 'home-host-kpi-' : 'home-partner-kpi-'}
            />
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
              // 🔴 件数は `要対応` にだけ付ける（他の 2 面は Phase 2 で行が入るまで数が無い。
              //    **0 と書くと「案件が無い」に読める**）。
              { value: 'actions', label: `${messages.tabs.actions} ${String(queueCount)}`, content: queueSection },
              { value: 'projects', label: messages.tabs.projects, content: projectsPanel },
              { value: 'engineers', label: messages.tabs.engineers, content: engineersPanel },
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
 * 🔴 今日のワンポイント（右レール ③）。**`RailCard` に閉じるボタンの口が無い**ため常設である
 *    （§4.1 は「閉じられる / 当日は再表示しない」と定めるが、口を増やすのは `packages/ui` の
 *    改訂であり本タスクの射程外。**永久に消す設定は作らない**という定めには反していない）。
 */
function OnePoint({
  changedSince,
  messages,
}: {
  readonly changedSince: string;
  readonly messages: HomeScreenMessages;
}) {
  const line = onePointLine(changedSince, messages.rail.onePointLines);
  if (line === null) return null;
  return <RailCard title={messages.rail.onePointTitle} lines={[line]} testIdPrefix="home-rail-one-point-" />;
}
