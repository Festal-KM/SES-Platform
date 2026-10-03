'use client';

// apps/web/app/(main)/proposal-requests/proposal-request-screen.tsx
// `S-017` 提案依頼の一覧 — 本体（docs/04 §S-017 / `F-018` / docs/05 §6.5 #32 / #35）。T-08-06
// → **SP-22 段④（提案まわりの刷新。2026-10-03）**。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-017 / `F-018` / `CLAUDE.md` §3.1 経路 4）
// ============================================================================
//   ① 🔴 **ホストの行に依頼先の社名・`engineer_id`・辞退の理由を出す欄が無い。** 行の型
//      （`ProposalRequestRowView`）にそのフィールドが**存在しない**ので、描く枝が書けない（`F-018 AC-1`）。
//      候補列は「共有候補（匿名）」の一語（`row.candidate`。組み立ては `lib/proposal-requests/list-rows.ts`）。
//   ② 🔴 **`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` は別のバッジ**（`F-018 AC-5` / `BR-60`）。
//      状態フィルタも 5 値 + 「すべて」であり、「失効」のような畳んだ選択肢を持たない。
//   ③ 🔴 **取り下げは確認 1 段で、`REQUESTED` の行にだけ導線がある**（`docs/04` §S-017「操作と結果」）。
//      判定は `row.canWithdraw`（状態）× `canAct`（ロール）× `denialMessage === null`（テナント状態）の 3 つ。
//      ⚠️ これは UI の配慮であり、拒否の本体は `#35` の 3 本のガードと `transition()` + CAS である。
//   ④ 取引先の応諾・辞退は `S-018`（T-08-07。`/proposal-requests/{id}`）。取引先の行の詳細パネルに導線を置く
//      （`row.respondHref`。ホストの行は `null` で描かれない）。応諾・辞退の可否は `S-018` 側が状態で決める。
//   ⑤ 🔴 T-08-07: **ホストの一覧は 60 秒ごとに読み直す**（`docs/04` §S-017「ホスト側の一覧はポーリングで反映
//      （60 秒）」）。実装は `page.tsx` が置く `PollingRefresher`（`router.refresh()`）であり、本コンポーネントは
//      選択状態を保ったままサーバの行が差し替わる。
//
// ============================================================================
// 🔴 SP-22 段④ で何が変わったか（**見せ方だけ**）
// ============================================================================
// | 変えたもの | 一次資料 | 🔴 変えていないもの |
// |---|---|---|
// | 実色 → §7.9 の semantic トークン / `text-sm`→`--text-body` / `text-base`→`--text-lg` | §7.9 / 検査 (a)(g) | 🔴 **6 列の集合・並び・間引きの境界**（`hidden sm:` 2 列 / `hidden lg:` 1 列） |
// | 状態バッジ → `@ses/ui` の **`StatusBadge`**（`entity="proposalRequest"`） | §5-1 / §5-13 | 🔴 **5 状態が別の見た目であること**（② はむしろ強まった。下の 🔴） |
// | 絞り込みを **`Card`（白い面）**に入れ、**件数バー**（母集団 + 並び順の説明）を `Toolbar` に持たせた | §5-13 / §3.2-2 / 段④ の `S-005` `S-010` `S-015` と同じ作法 | 🔴 **条件の集合（`state` の 5 値 + すべて）・`name`・送り先・`method="get"`** |
// | 空状態 → `EmptyState` / ページ送り → `Pagination` / パネルの面 → `Card` | §5-13 / §10.1 | 🔴 **空状態 3 通りの出し分けと文言**（ホスト初回空 / 取引先 / 絞込 0 件） |
// | **操作列**（`内容を見る`）を足した | §7.1「既定 8 列 + 操作列」/ §7.8 の統一語 | 🔴 **行クリックでの選択も残す**（`role="button"` の行は到達手段として維持） |
// | 幅 → `page.tsx` の `PageBody widthClass="split"`（🔴 **改訂 26 でクラス B**）。旧 `max-w-6xl` を撤去 | §7.1 / `U-23` / 検査 (c)(k) | 🔴 **母集団に件数を入れない**（`HANDOFF.md` §3.3） |
//
// 🔴 **API / 取得経路 / 権限判定 / URL / ルーティングは 1 つも変えていない。**
// 🔴 **`STATE_BADGE_VARIANTS`（画面がローカルに持っていた色の写像）を削除した。** 旧実装は
//    `EXPIRED: 'danger'`（赤）/ `REQUESTED: 'warning'`（橙）/ `WITHDRAWN_BY_HOST: 'outline'` であり、
//    **`docs/04` §5-1 の表（`REQUESTED` = ブランド藍 / 塗り・`EXPIRED` = 無彩色 / 点線枠）と食い違っていた。**
//    §5-1 の 🔴 は「**障害（赤・塗り）= `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` のみ**」であり、
//    期限切れ（業務的な終わり）を赤で描くのは意味の取り違えである。`StatusBadge` に寄せたことで
//    **色は状態名から 1 箇所（`STATUS_BADGE_APPEARANCES`）で決まり、画面は色を渡せない。**
//
// 🔴 **副カラム（選択した依頼）の寸法は `@ses/ui` の `PAGE_BODY_ASIDE_WIDTH_CLASSES` から取る**
//    （画面で `20rem` のような寸法を決めない。`docs/05` §2.3.4）。`PageBody` の `aside` スロットを
//    使えないのは、**パネルが表と同じクライアント状態（選択行・確認ステップ）を共有する**ためである
//    （`page.tsx`〔サーバ〕からクライアント状態で組んだ JSX を渡せない）。
//
// 🔴 **T1（モバイル完結）**（docs/04 §S-017 デバイス別 / `CLAUDE.md` §13.3）。
//    モバイル = 案件名 + 状態 + 残り時間の 3 列 + 操作列。**取り下げは詳細パネルにあり、モバイルでも押せる。**
//    間引くのは補助列（候補 / 依頼日 / 最終更新）だけで、ブレークポイントは Tailwind の既定（`sm` / `lg`）のみ。
//
// 🔴 期限までの残りは**クライアントで毎分再計算する**（`docs/04` §S-017 非同期処理の表現）。初回はサーバの時刻
//    （`nowMs`）で描き（hydration の不一致を作らない）、mount 後に端末時刻へ切り替える。
//    計算は `lib/proposal-requests/remaining.ts` の**同じ 1 関数**（サーバ側の行組み立てと二重にしない）。
// 🔴 変更後はページを再読込する（`engineer-share-screen.tsx` と同じ）。状態はサーバだけが正である。
// 🔴 `'use client'` は行の選択・確認ステップ・毎分更新のためだけである。**`@ses/db` に依存するモジュールから
//    値を import しない**（`tests/static/client-db-boundary.test.ts`）。文言は props（`packages/i18n`）で受け取る。
import { useEffect, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  CardContent,
  EmptyState,
  Field,
  PAGE_BODY_ASIDE_WIDTH_CLASSES_FROM_2XL,
  Pagination,
  SECONDARY_LINK_CLASSES,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toolbar,
  cn,
  type EmptyStateLinkProps,
  type PaginationLinkProps,
} from '@ses/ui';
import type { ProposalRequestRowView } from '../../../lib/proposal-requests/list-rows';
import { formatRemaining, type RemainingLabels } from '../../../lib/proposal-requests/remaining';
import { FILTER_ACTIONS_CLASSES, FILTER_FORM_CLASSES } from '../_shared/filter-form-classes';

export type ProposalRequestScreenMessages = {
  readonly lead: string;
  /** 🔴 件数バーの母集団の 1 行（§3.2-2）。**件数を含めない**（`HANDOFF.md` §3.3）。 */
  readonly population: string;
  /** 件数バーの右端（並び順の説明）。🔴 選べる形にしない（`?sort=` が無い）。 */
  readonly orderNote: string;
  /** ✅ 2026-10-03: 表が器に収まらない幅での 1 行（`Table` の `overflowNote`）。 */
  readonly overflowNote: string;
  readonly filterLegend: string;
  readonly filterState: string;
  readonly filterApply: string;
  readonly columnProject: string;
  readonly columnCandidate: string;
  readonly columnCreatedAt: string;
  readonly columnRemaining: string;
  readonly columnState: string;
  readonly columnUpdatedAt: string;
  /** 操作列の見出しと語（§7.1 / §7.8 の統一語 `内容を見る`）。 */
  readonly columnAction: string;
  readonly panelOpen: string;
  readonly emptyTitle: string;
  /** ホストの初回空にだけ出す説明と導線（取引先・絞込 0 件は `null`）。 */
  readonly emptyLead: string | null;
  readonly emptyOpenProjects: string | null;
  readonly detailTitle: string;
  readonly detailSelect: string;
  readonly detailMessage: string;
  readonly detailExpiresAt: string;
  readonly detailCreatedAt: string;
  readonly detailUpdatedAt: string;
  readonly detailOpenProject: string;
  /** 🔴 T-08-07: 取引先の行から `S-018` へ進む導線の文言（行の `respondHref` が `null` でないときだけ描く）。 */
  readonly partnerRespond: string;
  readonly withdraw: string;
  readonly withdrawConfirmTitle: string;
  readonly withdrawConfirmLead: string;
  readonly withdrawConfirmSubmit: string;
  readonly withdrawConfirmCancel: string;
  readonly withdrawSubmitting: string;
  readonly withdrawError: string;
  readonly withdrawErrorState: string;
  readonly deniedTitle: string;
  readonly remaining: RemainingLabels;
  readonly remainingNone: string;
  readonly nextPage: string;
  readonly firstPage: string;
};

export type ProposalRequestScreenProps = {
  readonly rows: readonly ProposalRequestRowView[];
  readonly stateOptions: readonly { readonly value: string; readonly label: string }[];
  /** 選択中の状態フィルタ（`''` = すべて）。 */
  readonly stateValue: string;
  /** 絞り込みが効いているか（空状態の文言が変わる）。 */
  readonly filtered: boolean;
  /** 🔴 取り下げを行えるロールか（`PROPOSAL_REQUEST_ISSUER_ROLES`）。取引先・`VIEWER` は `false`。 */
  readonly canAct: boolean;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。
   *    **拒否の本体は `#35` の `requireExecutable`** であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  /** サーバのリクエスト時刻（epoch ms）。初回描画の残り時間に使う。 */
  readonly nowMs: number;
  readonly projectsHref: string;
  readonly listHref: string;
  readonly nextPageHref: string | null;
  readonly firstPageHref: string | null;
  readonly messages: ProposalRequestScreenMessages;
};

/** モバイルで間引く補助列（判断材料ではない。`docs/04` §S-017 デバイス別）。 */
const TABLET_UP = 'hidden sm:table-cell';
const DESKTOP_ONLY = 'hidden lg:table-cell';

/**
 * ============================================================================
 * 🔴 ✅ 2026-10-03: **テキスト列の下限幅**（1 文字ずつ縦に折り返す事故の再発防止）
 * ============================================================================
 * **何が起きていたか（デモ環境の実測。1280px）**: 本画面は幅クラス B であり、右パネル 400px に
 * よって表の器が **582px** になる。表は `table-layout: auto` なので、
 * **`whitespace-nowrap` の日時列（`2026-09-23 11:11 JST` = 約 149px）が折り返さずに幅を確保し続け、
 * 折り返してよいテキスト列（案件 / 候補）だけが min-content まで潰れていた。**
 * 日本語の min-content は **1 文字**なので、「業務システムのクラウド移行」が
 * **1 文字 1 行で 10 行**になり、行の高さが 160〜180px に膨らんで表として読めなかった。
 * 🔴 **1920px では再現しない**（器が広く潰れない）ため、広い画面でだけ見ていると気づけない。
 *
 * 🔴 **直し方として「日時列を折り返させる」は採らなかった**（実測で比較した）:
 *    折り返すと min-content は `2026-09-23` の約 92px に下がるが、**全行の日時が 2 行になり
 *    行の高さが 36px → 約 55px に増える**。一覧は「50 行を縦に走査する場」であり
 *    （`docs/04` §7.1）、**全行を背が高くする代償のほうが大きい**。
 * 🔴 **「列を落とす」も採らなかった**（§7.1「列を削らないことが先」/ 改訂 26 の 🔴）。
 * 🔴 採ったのは **①テキスト列に下限幅を与える ②副カラムの並置を `2xl` まで遅らせる** の 2 つ。
 *    ②で 1280px の主カラムが 582 → **1,008px** になり、下限幅の総和（約 865px）が**収まる**。
 *
 * 値の出所: 案件名は `docs/04` §10.3 の名称列の下限 **10rem**（`NAME_CELL_MIN_WIDTH_CLASS` と同値）。
 * 候補は「共有候補（匿名）」の 8 文字（13px × 8 = 104px）+ セルの内側 `px-3` × 2 = **8rem**。
 */
const PROJECT_COLUMN_MIN_WIDTH = 'min-w-40';
const CANDIDATE_COLUMN_MIN_WIDTH = 'min-w-32';

const REMAINING_TICK_MS = 60_000;

/**
 * ページ送りのリンク。🔴 **凍結済み testid の維持**（`docs/04` `U-22`）: `Pagination` は
 * `proposal-request-pagination-prev` / `…-next` を出すが、凍結されている値は
 * **`proposal-request-first` / `proposal-request-next`** である（`S-019` と同じ形・同じ理由）。
 */
function RequestPagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId === undefined || testId.endsWith('-prev') ? 'proposal-request-first' : 'proposal-request-next'}
    >
      {children}
    </Link>
  );
}

/**
 * 初回空の Secondary（`S-010` へ戻る導線）。🔴 **凍結済み testid の維持**（`U-22`）:
 * `EmptyState` は `…-empty-state-secondary` を出すが、凍結されている値は
 * **`proposal-request-empty-open-projects`** である。
 */
function RequestEmptyLink({ href, className, children }: EmptyStateLinkProps) {
  return (
    <Link href={href} className={className} data-testid="proposal-request-empty-open-projects">
      {children}
    </Link>
  );
}

function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="w-24 shrink-0 text-fg-muted">{label}</dt>
      <dd className="m-0 break-words text-fg" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

export function ProposalRequestScreen({
  rows,
  stateOptions,
  stateValue,
  filtered,
  canAct,
  denialMessage,
  nowMs,
  projectsHref,
  listHref,
  nextPageHref,
  firstPageHref,
  messages,
}: ProposalRequestScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔴 初回はサーバの時刻（props）。mount 後に端末時刻へ切り替え、以後 1 分ごとに進める。
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REMAINING_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const canExecute = canAct && denialMessage === null;

  function remainingOf(row: ProposalRequestRowView): string {
    return row.state === 'REQUESTED'
      ? formatRemaining(row.expiresAtIso, now, messages.remaining)
      : messages.remainingNone;
  }

  function select(id: string): void {
    setError(null);
    setConfirming(false);
    setSelectedId(id);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(id);
    }
  }

  async function withdraw(id: string): Promise<void> {
    if (submitting || !canExecute) return;
    setSubmitting(true);
    setError(null);
    try {
      // 🔴 body を送らない（#35 は `{}` すら取らない。送るものが無い操作に入力を作らない）。
      const response = await fetch(`/api/proposal-requests/${id}/withdraw`, { method: 'POST' });
      if (!response.ok) {
        setSubmitting(false);
        // 🔴 422 = `REQUESTED` 以外からの取り下げ（遷移表に無い）。状態が動いたことを伝える。
        setError(response.status === 422 ? messages.withdrawErrorState : messages.withdrawError);
        return;
      }
      // 🔴 サーバの状態を読み直す（手元で行を書き換えない）。
      window.location.reload();
    } catch {
      setSubmitting(false);
      setError(messages.withdrawError);
    }
  }

  return (
    <div data-testid="proposal-request-screen">
      {/* 🔴 帯の「説明 1 行」（`docs/04` §3.1）。**母集団がホストと取引先で違うので文も違う**（§3.2-2）。 */}
      <p className="mb-4 text-body text-fg-muted" data-testid="proposal-request-lead">
        {messages.lead}
      </p>

      {/* 🔴 取り下げの権限は持つがテナント状態で止まっているときだけ理由を出す（`S-015` と同じ形）。 */}
      {canAct && denialMessage !== null ? (
        <Alert variant="warning" className="mb-4" data-testid="proposal-request-denied">
          <p className="font-semibold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </Alert>
      ) : null}

      {/* 🔴 §5-13 の `Toolbar`: **絞り込みの帯と母集団の 1 行の置き場所をここに固定する**
          （画面ごとに位置が変わらないことが条文の趣旨である）。
          ✅ SP-22 段④: 条件を `Card`（白い面）に入れ、件数バーの右端に並び順の説明を置いた。 */}
      <Toolbar
        testIdPrefix="proposal-request-"
        population={messages.population}
        note={
          <p className="text-xs text-fg-muted" data-testid="proposal-request-order-note">
            {messages.orderNote}
          </p>
        }
        filters={
          // 🔴 面・余白・radius は `Card` の中にしか無い（画面に `rounded-md border …` を書かない）。
          <Card className="w-full">
            {/* `CardContent` は `p-4 pt-0`。見出しを持たないカードなので上の余白を戻す。 */}
            <CardContent className="pt-4">
              {/* セクション 1: 状態フィルタ（同期の GET。`S-005` と同じ） */}
              <form
                className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full')}
                method="get"
                action={listHref}
                data-testid="proposal-request-filters"
              >
                <fieldset className="contents">
                  <legend className="sr-only">{messages.filterLegend}</legend>
                  <Field label={messages.filterState}>
                    <Select name="state" defaultValue={stateValue} data-testid="proposal-request-filter-state">
                      {stateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className={cn(FILTER_ACTIONS_CLASSES, 'justify-end')}>
                    <Button type="submit" data-testid="proposal-request-filter-apply">
                      {messages.filterApply}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        }
      />

      {/* 🔴 副カラムの寸法は `@ses/ui` から取る（画面が寸法を決めない。ファイル冒頭の 🔴）。
          `lg` 未満では表の下に落ちる（遮断しない。§13.3）。 */}
      {/* 🔴 ✅ 2026-10-03: **副カラムの並置は `2xl` から**（上の `PROJECT_COLUMN_MIN_WIDTH` の 🔴）。
          `2xl` 未満では表の下に積む（遮断しない。§13.3）。`PageBody` の `asideFrom='2xl'` と
          同じ境界であり、寸法は `@ses/ui` から取る（画面が寸法を決めない）。 */}
      <div className="mt-4 flex flex-col gap-6 2xl:flex-row">
        {/* セクション 2: テーブル */}
        <div className="min-w-0 flex-1">
          {rows.length === 0 ? (
            // ⚠️ 器の `data-testid` は凍結済みの `proposal-request-empty` である（`U-22`）。
            <div data-testid="proposal-request-empty">
              <EmptyState
                testIdPrefix="proposal-request-empty-state-"
                description={messages.emptyLead === null ? messages.emptyTitle : `${messages.emptyTitle}${messages.emptyLead}`}
                secondary={
                  filtered || messages.emptyOpenProjects === null
                    ? undefined
                    : { href: projectsHref, label: messages.emptyOpenProjects }
                }
                linkComponent={RequestEmptyLink}
              />
            </div>
          ) : (
            <Table data-testid="proposal-request-table" overflowNote={messages.overflowNote}>
              <TableHeader>
                <TableRow>
                  <TableHead className={PROJECT_COLUMN_MIN_WIDTH}>{messages.columnProject}</TableHead>
                  <TableHead className={cn(TABLET_UP, CANDIDATE_COLUMN_MIN_WIDTH)}>{messages.columnCandidate}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnCreatedAt}</TableHead>
                  <TableHead>{messages.columnRemaining}</TableHead>
                  <TableHead>{messages.columnState}</TableHead>
                  <TableHead className={DESKTOP_ONLY}>{messages.columnUpdatedAt}</TableHead>
                  {/* 🔴 操作列はどのブレークポイントでも隠さない（§7.1）。 */}
                  <TableHead>{messages.columnAction}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={row.id === selectedId}
                    className="cursor-pointer"
                    data-state={row.id === selectedId ? 'selected' : undefined}
                    onClick={() => select(row.id)}
                    onKeyDown={(event) => onRowKeyDown(event, row.id)}
                    data-testid={`proposal-request-row-${row.id}`}
                    data-request-state={row.state}
                  >
                    <TableCell
                      className={PROJECT_COLUMN_MIN_WIDTH}
                      whitespace="normal"
                      data-testid={`proposal-request-project-${row.id}`}
                    >
                      {row.projectName}
                    </TableCell>
                    <TableCell
                      className={cn(TABLET_UP, CANDIDATE_COLUMN_MIN_WIDTH)}
                      whitespace="normal"
                      data-testid={`proposal-request-candidate-${row.id}`}
                    >
                      {row.candidate}
                    </TableCell>
                    <TableCell className={TABLET_UP}>{row.createdAt}</TableCell>
                    <TableCell data-testid={`proposal-request-remaining-${row.id}`}>{remainingOf(row)}</TableCell>
                    <TableCell>
                      {/* 🔴 色は `StatusBadge` が状態名から決める（画面は渡せない。§5-1 / §5-13）。 */}
                      <StatusBadge
                        entity="proposalRequest"
                        state={row.state}
                        label={row.stateLabel}
                        data-testid={`proposal-request-state-${row.id}`}
                      />
                    </TableCell>
                    <TableCell className={DESKTOP_ONLY}>{row.updatedAt}</TableCell>
                    {/* 🔴 操作列（§7.1「既定 8 列 + 操作列」）。行クリックと同じ「選ぶ」操作であり、
                        **押せるものが押せると分かる形**にするために置く（`role="button"` の行だけだと
                        キーボード・読み上げで見つけにくい）。語は §7.8 の統一語（`内容を見る`）。 */}
                    <TableCell>
                      <button
                        type="button"
                        className={SECONDARY_LINK_CLASSES}
                        onClick={() => select(row.id)}
                        data-testid={`proposal-request-panel-open-${row.id}`}
                        aria-label={`${messages.panelOpen}: ${row.projectName}`}
                      >
                        {messages.panelOpen}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* 🔴 カーソルページング。「全 N ページ中 M ページ目」を出さない（docs/05 §4.8）。
              ⚠️ 器の `data-testid` は凍結済みの `proposal-request-paging` である（`U-22`）。 */}
          {nextPageHref === null && firstPageHref === null ? null : (
            <div className="mt-4" data-testid="proposal-request-paging">
              <Pagination
                testIdPrefix="proposal-request-"
                nextHref={nextPageHref}
                nextLabel={messages.nextPage}
                prevHref={firstPageHref}
                prevLabel={messages.firstPage}
                linkComponent={RequestPagingLink}
              />
            </div>
          )}
        </div>

        {/* セクション 3: 選択した依頼の詳細パネル（lg 以上は右、未満は一覧の下。取り下げはここ） */}
        <div className={PAGE_BODY_ASIDE_WIDTH_CLASSES_FROM_2XL}>
          <Card data-testid="proposal-request-detail-panel">
            <h2 className="border-b border-border px-4 py-3 text-lg font-semibold text-fg">{messages.detailTitle}</h2>
            <CardContent className="pt-4">
              {selected === null ? (
                <p className="m-0 text-body text-fg-muted" data-testid="proposal-request-detail-empty">
                  {messages.detailSelect}
                </p>
              ) : (
                <div data-testid="proposal-request-detail">
                  <p className="mb-1 text-lg font-semibold text-fg" data-testid="proposal-request-detail-project">
                    {selected.projectName}
                  </p>
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-body text-fg" data-testid="proposal-request-detail-candidate">
                    <span>{selected.candidate}</span>
                    <StatusBadge entity="proposalRequest" state={selected.state} label={selected.stateLabel} />
                  </p>
                  <dl className="mb-3 text-body">
                    <DetailRow label={messages.detailMessage} value={selected.message} field="message" />
                    <DetailRow label={messages.detailExpiresAt} value={`${selected.expiresAt}（${remainingOf(selected)}）`} field="expires-at" />
                    <DetailRow label={messages.detailCreatedAt} value={selected.createdAt} field="created-at" />
                    <DetailRow label={messages.detailUpdatedAt} value={selected.updatedAt} field="updated-at" />
                  </dl>
                  {selected.projectId === null ? null : (
                    <Link className={SECONDARY_LINK_CLASSES} href={`/projects/${selected.projectId}`} data-testid="proposal-request-detail-open-project">
                      {messages.detailOpenProject}
                    </Link>
                  )}

                  {/* 🔴 T-08-07: 取引先の行は `S-018`（応諾・辞退）へ進む。ホストの行は `respondHref` が null で描かれない。 */}
                  {selected.respondHref === null ? null : (
                    <div className="mt-4">
                      <Link
                        className={cn(SECONDARY_LINK_CLASSES, 'inline-block font-semibold')}
                        href={selected.respondHref}
                        data-testid="proposal-request-detail-respond"
                      >
                        {messages.partnerRespond}
                      </Link>
                    </div>
                  )}

                  {/* 🔴 取り下げ（ホスト × REQUESTED × 実行可）。確認は 1 段。 */}
                  {selected.canWithdraw && canExecute ? (
                    <div className="mt-4">
                      {confirming ? (
                        <Alert variant="warning" data-testid="proposal-request-withdraw-confirm">
                          <p className="font-semibold">{messages.withdrawConfirmTitle}</p>
                          <p>{messages.withdrawConfirmLead}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-4">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={submitting}
                              onClick={() => withdraw(selected.id)}
                              data-testid="proposal-request-withdraw-submit"
                            >
                              {submitting ? messages.withdrawSubmitting : messages.withdrawConfirmSubmit}
                            </Button>
                            <button
                              type="button"
                              className={SECONDARY_LINK_CLASSES}
                              onClick={() => setConfirming(false)}
                              data-testid="proposal-request-withdraw-cancel"
                            >
                              {messages.withdrawConfirmCancel}
                            </button>
                          </div>
                        </Alert>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={submitting}
                          onClick={() => {
                            setError(null);
                            setConfirming(true);
                          }}
                          data-testid="proposal-request-withdraw"
                        >
                          {messages.withdraw}
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {error === null ? null : (
                    <p role="alert" className="mt-3 mb-0 text-body text-danger" data-testid="proposal-request-withdraw-error">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
