'use client';

// apps/web/app/(main)/proposals/[id]/proposal-detail-screen.tsx
// `S-023` 提案の詳細と履歴 — 本体（docs/04 §S-023 / `F-024` / `F-025` / `F-021 AC-5` / docs/05 §6.5 #46 / #47）。T-09-09。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-023 / `F-019 AC-5` / `BR-08` / `BR-18`）
// ============================================================================
//   ① 🔴 **概要は `S-021` の判断ヘッダと同じ材料**（提案先 / エンジニア / 案件 / 単価 / 開始日 / 作成者 / 経過時間。凍結側だけ）。
//      モバイルでは「状態 + 提案先 + 単価」を固定ヘッダにし、**状態と単価は折りたたみの外**（`docs/04` §S-023 デバイス別）。
//   ② 🔴 **履歴は `kind` ごとに描き分ける**（作成 / 遷移 / 却下 / 承認〔検査 #…〕/ 再送〔理由〕/ 送信失敗〔種別〕/ 下書きの更新〔項目名〕/
//      メモ）。行は `data-event-kind` を持つ。**自動承認は「システム（全層 PASS のため）」**（`F-021 AC-5`）。
//   ③ 🔴 **凍結内容は凍結された行をそのまま描き、台帳の現在値と混ぜない**（`F-019 AC-5`）。経歴の見出しに凍結日時を必ず添える。
//      「最新の情報に更新する」に相当する操作は無い。
//   ④ 🔴 **状態に応じた導線**（`DRAFT` → `S-020` / `APPROVAL_PENDING` → `S-021` / `APPROVED` → `S-021`「送信する」/ `SUBMIT_FAILED` → `S-022` /
//      商談中 → `S-024`）。却下由来の `DRAFT` には「内容を変更してからレビューに出してください」を添える（T-09-03 の申し送り =
//      内容を変えずに再依頼すると 422 `GATE_ALREADY_COMPLETED`）。**ゲート FAIL を無視して送る導線は無い。**
//   ⑤ 🔴 **メモ（#47）は状態を動かさない。** 成功後は手元で履歴を書き換えず `router.refresh()`（サーバの履歴が正）。
//      導線は `canAddNote`（立場）× `denialMessage === null`（テナントが実行可）のときだけ。
//   ⑥ 🔴 取引先の props に承認者・送信試行・保留・作成会社は**来ない**（`proposalDetailRows` が `null` にする。型の分離は `views.ts`）。
//      重複提案（`F-037`。Phase 2）の欄はこの画面に存在しない。
//   ⑦ ✅ T-12-14 ②③: **セクション 4「ゲート結果の履歴」は実行ごとの履歴**（#40b `readProposalGateResults`。`F-020 AC-7`）。
//      1 実行 = 1 ブロックで、層別結果は「ゲート結果」（現在の結果 = #46 の `gate`）と**同じ描画部品** `GateResultBlock`
//      （view model も同じ `approvalGateRows`）。🔴 整合層の機械照合の合否（`findings`）と AI の警告（`aiWarnings`）は
//      **別の見出し**で描き、`aiFailed` の行は「検査を完了できなかった」の語で PII / 商流の FAIL と区別する（`CLAUDE.md` §3.3 第 3 層）。
//      🔴 履歴タイムラインと履歴の折りたたみは `docs/04` §10.3 の共通規約（直近 10 行 + 「すべて表示」= `@ses/ui` の `FoldedList`）に
//      合流し、本画面固有の例外を作らない。タイムラインは新しい順で、最新行は直近 10 行の先頭にあるため構造的に隠れない。
//
// 🔴 `'use client'` はメモの投稿フォームのためだけである。**`@ses/db` に依存するモジュールから値を import しない**
//    （`tests/static/client-db-boundary.test.ts`）。文言と表示値は props で受け取る。
// 🔴 応答の `messageKey` を UI で解釈しない。文言は応答コード（`error.code`）と HTTP 状態で選ぶ。
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  FoldedList,
  PAGE_BODY_ASIDE_WIDTH_CLASSES,
  SECONDARY_LINK_CLASSES,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from '@ses/ui';
import type { ApprovalGateRows } from '../../../../lib/proposals/approval-rows';
import type { ProposalDetailRows, ProposalGateHistoryRows, ProposalTimelineRow } from '../../../../lib/proposals/detail-rows';
import { gateLayerBadgeAppearance } from '../../../../lib/proposals/gate-layer-badge';

export type ProposalDetailScreenMessages = {
  readonly sectionHeader: string;
  readonly sectionHold: string;
  readonly sectionTimeline: string;
  readonly sectionFrozen: string;
  readonly sectionGate: string;
  /** ✅ T-12-14 ②: セクション 4「ゲート結果の履歴」。 */
  readonly sectionGateHistory: string;
  readonly gateHistoryLead: string;
  /** docs/04 §10.3 の共通規約「すべて表示」。 */
  readonly showAll: string;
  /** HELD の説明（停止理由 + 再開条件。`S-021` と同じ語。`S-038` への導線は出さない = Issue #70 既定）。 */
  readonly gateHeld: string;
  readonly gateHeldResetAtPrefix: string;
  /** 現在の結果が `aiFailed` のとき（`S-021` と同じ語）。 */
  readonly gateAiFailed: string;
  /** 履歴の行が `aiFailed` のとき（「検査を完了できなかった」）。 */
  readonly gateHistoryAiFailed: string;
  readonly sectionActions: string;
  readonly sectionNote: string;
  readonly fieldState: string;
  readonly fieldApprover: string;
  readonly fieldSubmittedAt: string;
  readonly fieldSendAttempts: string;
  readonly fieldLastFailure: string;
  readonly sendAttemptsNone: string;
  readonly frozenSubject: string;
  readonly frozenBody: string;
  readonly frozenAttachment: string;
  readonly careerColumnPeriod: string;
  readonly careerColumnRole: string;
  readonly careerColumnDescription: string;
  readonly careerColumnTechnologies: string;
  readonly gateNotRequested: string;
  readonly gateWarningsTitle: string;
  readonly gateFindingsTitle: string;
  readonly gateFindingsEmpty: string;
  readonly gateWarningsEmpty: string;
  readonly noteLabel: string;
  readonly noteLead: string;
  readonly noteSubmit: string;
  readonly noteSubmitting: string;
  readonly noteAdded: string;
  readonly noteViewerNotice: string;
  readonly noteForbiddenNotice: string;
  readonly noteErrorValidation: string;
  readonly noteErrorForbidden: string;
  readonly noteErrorGeneric: string;
  readonly deniedTitle: string;
  readonly backToList: string;
};

export type ProposalDetailScreenProps = {
  readonly proposalId: string;
  readonly rows: ProposalDetailRows;
  /** ✅ T-12-14 ②: セクション 4「ゲート結果の履歴」（#40b。降順）。`page.tsx` が `readProposalGateResults` を直接呼んで組む。 */
  readonly gateHistory: ProposalGateHistoryRows;
  /** 🔴 `VIEWER` はメモを残せない（`requireNotViewer`）。導線を描かず理由を出す。 */
  readonly isViewer: boolean;
  /** 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は #47 の `requireExecutable`。 */
  readonly denialMessage: string | null;
  readonly listHref: string;
  readonly noteMaxLength: number;
  readonly messages: ProposalDetailScreenMessages;
};

// ============================================================================
// 🔴 SP-22 段④ で削除した 2 本の色の写像
// ============================================================================
// ① `TONE_VARIANTS`（5 値の tone → `BadgeVariant`）: 5 値では `docs/04` §5-1 の 14 状態の
//    塗り / 枠線 / 点線枠を表現できず、**`GATE_FAILED` と `SUBMIT_FAILED` が同じ赤**になっていた
//    （`CLAUDE.md` §4.2「すべて別の状態」）。色は `@ses/ui` の `StatusBadge` が状態名から決める。
// ② `LAYER_VARIANTS`（層 → `BadgeVariant`）: `RUNNING` が `S-020` / `S-021` では `warning`、
//    ここでは `outline` と**画面ごとに食い違っていた**（§5-3「5 種すべてで同じ見せ方を使う」）。
//    出所を `lib/proposals/gate-layer-badge.ts` の 1 つに寄せた。

type NotePhase = { readonly kind: 'IDLE' } | { readonly kind: 'SUBMITTING' } | { readonly kind: 'ADDED' };

type ErrorBody = { readonly error?: { readonly code?: string } };

function TimelineItem({ row }: { readonly row: ProposalTimelineRow }) {
  return (
    <li
      className="border-l-2 border-border pl-4"
      data-testid={`proposal-detail-event-${row.id}`}
      data-event-kind={row.kind}
      data-actor-kind={row.actorKind}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-fg-muted">
        <time>{row.occurredAt}</time>
        <span data-testid={`proposal-detail-event-actor-${row.id}`}>{row.actor}</span>
      </div>
      <div className="text-body font-semibold text-fg" data-testid={`proposal-detail-event-title-${row.id}`}>
        {row.title}
      </div>
      {row.transition === null ? null : <div className="text-body text-fg">{row.transition}</div>}
      {row.detail === null ? null : (
        <p className="whitespace-pre-wrap break-words text-body text-fg" data-testid={`proposal-detail-event-detail-${row.id}`}>
          {row.detail}
        </p>
      )}
      {row.attachment === null ? null : <div className="text-xs text-fg-muted">{row.attachment}</div>}
    </li>
  );
}

/**
 * 層別結果の描画の**置き場**。`CURRENT` = 「ゲート結果」（#46 の `gate`。凍結済みの testid）/ `HISTORY` = セクション 4 の 1 実行
 * （`reviewGateId` で testid を分ける。同じ DOM に同じ testid が複数現れないようにするため）。
 */
type GateBlockScope = { readonly kind: 'CURRENT' } | { readonly kind: 'HISTORY'; readonly id: string };

/**
 * ✅ T-12-14 ②: 層別結果（3 層のバッジ / HELD の停止理由と再開条件 / 判定不能 / 不合格の指摘 / AI の警告）の**唯一の描画部品**。
 *    「ゲート結果」（現在）とセクション 4 の各実行が同じ部品を使う（履歴用の別実装を書かない）。
 * 🔴 不合格の指摘（`findings`）と AI の警告（`warnings`）は**別の見出し・別のリスト**（合否に効かない側を混ぜない）。
 * 🔴 HELD は「検査中」のバッジ + 停止理由 + 再開予定だけ（`S-038` への導線・金額は無い。Issue #70 既定 / `F-027 AC-6`）。
 */
function GateResultBlock({ gate, scope, messages }: { readonly gate: ApprovalGateRows; readonly scope: GateBlockScope; readonly messages: ProposalDetailScreenMessages }) {
  const current = scope.kind === 'CURRENT';
  return (
    <div data-gate-execution={gate.execution} data-ai-failed={gate.aiFailed ? 'true' : 'false'}>
      <ul className="mb-3 flex flex-wrap gap-2">
        {gate.layers.map((layer) => (
          <li
            key={layer.key}
            data-testid={current ? `proposal-detail-gate-layer-${layer.key}` : `proposal-detail-gate-history-layer-${scope.id}-${layer.key}`}
            data-layer-state={layer.state}
          >
            {/* 🔴 層の見え方は `lib/proposals/gate-layer-badge.ts` の 1 箇所が決める（§5-3）。 */}
            <Badge {...gateLayerBadgeAppearance(layer.state)}>
              {layer.label}: {layer.verdictLabel}
            </Badge>
          </li>
        ))}
      </ul>
      {gate.execution === 'HELD_AI_COST_LIMIT' ? (
        <Alert
          role="status"
          variant="warning"
          className="mb-2"
          data-testid={current ? 'proposal-detail-gate-held' : `proposal-detail-gate-history-held-${scope.id}`}
        >
          {messages.gateHeld} {messages.gateHeldResetAtPrefix}
          {gate.heldResetAt}
        </Alert>
      ) : null}
      {gate.aiFailed ? (
        <Alert
          variant="danger"
          className="mb-2"
          data-testid={current ? 'proposal-detail-gate-ai-failed' : `proposal-detail-gate-history-ai-failed-${scope.id}`}
        >
          {current ? messages.gateAiFailed : messages.gateHistoryAiFailed}
        </Alert>
      ) : null}
      {gate.lead === null ? null : <p className="mb-2 text-body text-fg">{gate.lead}</p>}
      {/* 🔴 ✅ 2026-10-03: **0 件のときは見出しも無彩色にする**（`S-021` と同じ直し。
          `docs/04` §10.4 / §7.4「色は意味のあるときだけ」。全層合格の提案を開いたときに
          **赤い見出しが最初に目に入る**状態になっていた —— `HANDOFF.md` §6-12 と同じ種類の
          誤り〔意味色の誤用〕が空状態の側に残っていた）。 */}
      <h4
        className={cn('text-body font-semibold', gate.findings.length === 0 ? 'text-fg-muted' : 'text-danger')}
        data-finding-count={String(gate.findings.length)}
      >
        {messages.gateFindingsTitle}
      </h4>
      {gate.findings.length === 0 ? (
        <p className="mb-2 text-body text-fg-muted">{messages.gateFindingsEmpty}</p>
      ) : (
        <ul
          className="mb-2 list-disc pl-6 text-body text-danger"
          data-testid={current ? 'proposal-detail-gate-findings' : `proposal-detail-gate-history-findings-${scope.id}`}
        >
          {gate.findings.map((finding) => (
            <li key={finding.key}>
              {finding.fieldLabel}: {finding.excerpt}
            </li>
          ))}
        </ul>
      )}
      <h4
        className={cn('text-body font-semibold', gate.warnings.length === 0 ? 'text-fg-muted' : 'text-warning')}
        data-warning-count={String(gate.warnings.length)}
      >
        {messages.gateWarningsTitle}
      </h4>
      {gate.warnings.length === 0 ? (
        <p className="text-body text-fg-muted">{messages.gateWarningsEmpty}</p>
      ) : (
        <ul
          className="list-disc pl-6 text-body text-warning"
          data-testid={current ? 'proposal-detail-gate-warnings' : `proposal-detail-gate-history-warnings-${scope.id}`}
        >
          {gate.warnings.map((warning) => (
            <li key={warning.key}>
              {warning.fieldLabel}: {warning.excerpt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProposalDetailScreen({ proposalId, rows, gateHistory, isViewer, denialMessage, listHref, noteMaxLength, messages }: ProposalDetailScreenProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<NotePhase>({ kind: 'IDLE' });
  const [error, setError] = useState<string | null>(null);

  const canExecute = rows.canAddNote && !isViewer && denialMessage === null;
  const submitting = phase.kind === 'SUBMITTING';

  function errorFor(status: number, code: string | undefined): string {
    if (status === 400 || code === 'VALIDATION') return messages.noteErrorValidation;
    if (status === 403) return messages.noteErrorForbidden;
    return messages.noteErrorGeneric;
  }

  async function submitNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canExecute || submitting) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError(messages.noteErrorValidation);
      return;
    }
    setPhase({ kind: 'SUBMITTING' });
    setError(null);
    try {
      // 🔴 body は `{ kind: 'NOTE', note }` だけ（#47。状態を動かす入力は存在しない）。
      const response = await fetch(`/api/proposals/${proposalId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'NOTE', note: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        setError(errorFor(response.status, body.error?.code));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setNote('');
      setPhase({ kind: 'ADDED' });
      // 🔴 手元で履歴を書き換えず、サーバの履歴を読み直す。
      router.refresh();
    } catch {
      setError(messages.noteErrorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  return (
    <div data-testid="proposal-detail" data-proposal-state={rows.state} data-failure-kind={rows.failureKind ?? ''} data-can-add-note={canExecute ? 'true' : 'false'}>
      {/* ① 固定ヘッダ（状態 + 提案先 + 単価）。折りたたみの外。
          🔴 **状態と単価は折りたたみの外に置き続ける**（`docs/04` §S-023 デバイス別）。
          ⚠️ 面（`bg-surface`）は画面で作れないので、地はページ地（`--color-bg`）を使う ——
             スクロール時に下の行が透けないよう不透明にする必要があり、`Card` では
             「ページ幅の帯」にならない。 */}
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-bg py-2" data-testid="proposal-detail-fixed">
        {/* 🔴 色は状態名から決まる（§5-1 の 14 状態）。画面は渡せない。 */}
        <StatusBadge
          entity="proposal"
          state={rows.state}
          label={rows.stateLabel}
          data-testid="proposal-detail-state"
        />
        <span className="text-body text-fg" data-testid="proposal-detail-fixed-recipient">
          {rows.fixed.recipient}
        </span>
        <span className="text-body font-semibold text-fg" data-testid="proposal-detail-fixed-unit-price">
          {rows.fixed.unitPrice}
        </span>
        <Link className={cn(SECONDARY_LINK_CLASSES, 'ml-auto')} href={listHref} data-testid="proposal-detail-back-to-list">
          {messages.backToList}
        </Link>
      </div>

      {rows.audienceNotice === null ? null : (
        <Alert role="status" variant="neutral" className="mb-4" data-testid="proposal-detail-partner-notice">
          {rows.audienceNotice}
        </Alert>
      )}

      {/* 🔴 **クラス B（分割）の 2 カラム**（`docs/04` §7.1。`page.tsx` が `widthClass="split"` を渡す）。
          副カラムの寸法は `@ses/ui` の `PAGE_BODY_ASIDE_WIDTH_CLASSES`（360 / 400 / 480px 固定）から取る。
          ⚠️ `PageBody` の `aside` スロットを使えないのは、メモ投稿のクライアント状態（`phase` / `error`）が
             同じコンポーネントに在るためである（サーバからクライアント状態の JSX を渡せない）。
          🔴 **副カラムに置くのは「ゲート結果の履歴」だけ**である ——
             ① **判断材料（状態 / 提案先 / 単価 / 概要 / 現在のゲート結果）を 1 つも移さない**（§13.3）
             ② モバイルでは副カラムが本体の下に落ちるが、**履歴は移行前から最後のセクション**であり
                **読む順序が 1 行も変わらない**（`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」）。 */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">

        {/* ① 概要（判断ヘッダと同じ材料）。 */}
        <section className="mb-6" data-testid="proposal-detail-section-header">
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionHeader}</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body sm:grid-cols-2">
            {rows.header.map((row) => (
              <div key={row.field} className="flex gap-3" data-testid={`proposal-detail-header-row-${row.field}`} data-emphasis={row.emphasis}>
                <dt className="w-28 shrink-0 text-fg-muted">{row.label}</dt>
                <dd className={`m-0 break-words ${row.emphasis === 'ATTENTION' ? 'font-semibold text-warning' : 'text-fg'}`}>{row.value}</dd>
              </div>
            ))}
            <div className="flex gap-3" data-testid="proposal-detail-header-row-state">
              <dt className="w-28 shrink-0 text-fg-muted">{messages.fieldState}</dt>
              <dd className="m-0 text-fg">{rows.stateLabel}</dd>
            </div>
            {rows.approver === null ? null : (
              <div className="flex gap-3" data-testid="proposal-detail-approver">
                <dt className="w-28 shrink-0 text-fg-muted">{messages.fieldApprover}</dt>
                <dd className="m-0 text-fg">{rows.approver}</dd>
              </div>
            )}
            {rows.submittedAt === null ? null : (
              <div className="flex gap-3" data-testid="proposal-detail-submitted-at">
                <dt className="w-28 shrink-0 text-fg-muted">{messages.fieldSubmittedAt}</dt>
                <dd className="m-0 text-fg">{rows.submittedAt}</dd>
              </div>
            )}
            {rows.sendAttempts === null ? null : (
              <div className="flex gap-3" data-testid="proposal-detail-send-attempts">
                <dt className="w-28 shrink-0 text-fg-muted">{messages.fieldSendAttempts}</dt>
                <dd className="m-0 text-fg">
                  {rows.sendAttempts.items.length === 0 ? messages.sendAttemptsNone : `${rows.sendAttempts.count} / ${rows.sendAttempts.last ?? ''}`}
                </dd>
              </div>
            )}
            {rows.lastFailureReason === null ? null : (
              <div className="flex gap-3" data-testid="proposal-detail-last-failure">
                <dt className="w-28 shrink-0 text-fg-muted">{messages.fieldLastFailure}</dt>
                <dd className="m-0 text-fg">{rows.lastFailureReason}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 保留（ホストだけ。`SUBMIT_FAILED` とは別の枠）。 */}
        {rows.sendHold === null ? null : (
          <Alert variant="warning" role="status" className="mb-6" data-testid="proposal-detail-send-hold" data-hold-reason={rows.sendHold.reasonKey}>
            <h2 className="mb-1 text-lg font-semibold">{messages.sectionHold}</h2>
            <p className="text-body">{rows.sendHold.message}</p>
            <p className="text-xs">{rows.sendHold.since}</p>
            {rows.sendHold.settingsLink === null ? null : (
              <Link className={cn(SECONDARY_LINK_CLASSES, 'mt-2 inline-block')} href={rows.sendHold.settingsLink.href} data-testid="proposal-detail-send-hold-settings">
                {rows.sendHold.settingsLink.label}
              </Link>
            )}
          </Alert>
        )}

        {/* ④ 状態に応じた導線。 */}
        <section className="mb-6" data-testid="proposal-detail-section-actions">
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionActions}</h2>
          {rows.actionsEmpty === null ? null : (
            <p className="text-body text-fg-muted" data-testid="proposal-detail-actions-empty">
              {rows.actionsEmpty}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {rows.actions.map((action) => (
              <li key={action.key} data-testid={`proposal-detail-action-${action.key}`}>
                {action.lead === null ? null : (
                  <p className="mb-1 text-body text-warning" data-testid={`proposal-detail-action-lead-${action.key}`}>
                    {action.lead}
                  </p>
                )}
                <Link className={SECONDARY_LINK_CLASSES} href={action.href} data-testid={`proposal-detail-action-link-${action.key}`}>
                  {action.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ② 履歴タイムライン（新しい順。11 行以上で直近 10 行 + 「すべて表示」= docs/04 §10.3 の共通規約）。 */}
        <section className="mb-6" data-testid="proposal-detail-section-timeline">
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionTimeline}</h2>
          <FoldedList
            data-testid="proposal-detail-timeline"
            showAllLabel={messages.showAll}
            rows={rows.timeline.map((row) => (
              <TimelineItem key={row.id} row={row} />
            ))}
          />
        </section>

        {/* ⑤ メモ追加（#47）。状態を動かさない。 */}
        <section className="mb-6" data-testid="proposal-detail-section-note">
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionNote}</h2>
          {isViewer ? (
            <p className="text-body text-fg-muted" data-testid="proposal-detail-note-viewer">
              {messages.noteViewerNotice}
            </p>
          ) : !rows.canAddNote ? (
            <p className="text-body text-fg-muted" data-testid="proposal-detail-note-forbidden">
              {messages.noteForbiddenNotice}
            </p>
          ) : denialMessage !== null ? (
            <Alert variant="warning" data-testid="proposal-detail-note-denied">
              <p className="font-semibold">{messages.deniedTitle}</p>
              <p>{denialMessage}</p>
            </Alert>
          ) : (
            <form method="post" onSubmit={(event) => void submitNote(event)} className="flex flex-col gap-3" data-testid="proposal-detail-note-form">
              <p className="text-xs text-fg-muted">{messages.noteLead}</p>
              <Field label={messages.noteLabel}>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={noteMaxLength}
                  rows={3}
                  disabled={submitting}
                  data-testid="proposal-detail-note-input"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={submitting || note.trim().length === 0} data-testid="proposal-detail-note-submit">
                  {submitting ? messages.noteSubmitting : messages.noteSubmit}
                </Button>
                {phase.kind === 'ADDED' ? (
                  <span className="text-body text-success" data-testid="proposal-detail-note-added">
                    {messages.noteAdded}
                  </span>
                ) : null}
              </div>
              {error === null ? null : (
                <p role="alert" className="text-body font-semibold text-danger" data-testid="proposal-detail-note-error">
                  {error}
                </p>
              )}
            </form>
          )}
        </section>

        {/* ③ 凍結内容。 */}
        <section className="mb-6" data-testid="proposal-detail-section-frozen">
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionFrozen}</h2>
          <p className="mb-3 text-xs text-fg-muted" data-testid="proposal-detail-frozen-notice">
            {rows.frozen.notice}
          </p>
          <dl className="mb-4 flex flex-col gap-2 text-body">
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">{messages.frozenSubject}</dt>
              <dd className="m-0 break-words text-fg" data-testid="proposal-detail-frozen-subject">
                {rows.frozen.subject}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">{messages.frozenBody}</dt>
              <dd className="m-0 whitespace-pre-wrap break-words text-fg" data-testid="proposal-detail-frozen-body">
                {rows.frozen.body}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">{messages.frozenAttachment}</dt>
              <dd className="m-0 text-fg" data-testid="proposal-detail-frozen-attachment">
                {rows.frozen.attachment}
              </dd>
            </div>
          </dl>
          <h3 className="mb-2 text-body font-semibold text-fg" data-testid="proposal-detail-frozen-careers-title">
            {rows.frozen.careersTitle}
          </h3>
          {rows.frozen.careersEmpty === null ? (
            <Table data-testid="proposal-detail-frozen-careers">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.careerColumnPeriod}</TableHead>
                  <TableHead>{messages.careerColumnRole}</TableHead>
                  <TableHead>{messages.careerColumnDescription}</TableHead>
                  <TableHead>{messages.careerColumnTechnologies}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.frozen.careers.map((career) => (
                  <TableRow key={career.key} data-testid={`proposal-detail-frozen-career-${career.key}`}>
                    <TableCell>{career.period}</TableCell>
                    <TableCell whitespace="normal">{career.role}</TableCell>
                    <TableCell whitespace="normal">{career.description}</TableCell>
                    <TableCell whitespace="normal">{career.technologies}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-body text-fg-muted" data-testid="proposal-detail-frozen-careers-empty">
              {rows.frozen.careersEmpty}
            </p>
          )}
        </section>

        {/* ゲート結果（現在の結果。#46 の `gate` = #40 と同じ形。3 値）。 */}
        <section className="mb-6" data-testid="proposal-detail-section-gate" data-gate-execution={rows.gate.execution}>
          <h2 className="mb-2 text-lg font-semibold text-fg">{messages.sectionGate}</h2>
          {rows.gate.execution === 'RUNNING' && !rows.gate.layers.some((layer) => layer.state !== 'RUNNING') ? (
            <p className="text-body text-fg-muted" data-testid="proposal-detail-gate-not-requested">
              {messages.gateNotRequested}
            </p>
          ) : (
            <GateResultBlock gate={rows.gate} scope={{ kind: 'CURRENT' }} messages={messages} />
          )}
        </section>
        </div>

        {/* 🔴 副カラム: ④ ゲート結果の履歴（#40b。実行ごと。降順。11 件以上で直近 10 件 + 「すべて表示」）。
            **現在の結果（上の「ゲート結果」）は主カラムに残している** —— 承認の判断に効くのは現在の結果で
            あり、履歴は「誰が・いつ・何を検査したか」の説明材料である（`G-10`）。 */}
        <div className={cn(PAGE_BODY_ASIDE_WIDTH_CLASSES, 'flex flex-col')}>
        {/* 🔴 面（radius / 枠線 / 地）は `@ses/ui` の `Card` だけが持つ（画面で面を作らない）。
            副カラムを面で包むのは、`lg` 以上で主カラムと横に並ぶため境界が要るからである。 */}
        <Card data-testid="proposal-detail-section-gate-history" data-history-count={gateHistory.items.length}>
          <h2 className="border-b border-border px-4 py-3 text-lg font-semibold text-fg">{messages.sectionGateHistory}</h2>
          <CardContent className="pt-4">
            <p className="mb-3 text-xs text-fg-muted">{messages.gateHistoryLead}</p>
            {gateHistory.empty !== null ? (
              <p className="text-body text-fg-muted" data-testid="proposal-detail-gate-history-empty">
                {gateHistory.empty}
              </p>
            ) : (
              <FoldedList
                data-testid="proposal-detail-gate-history"
                showAllLabel={messages.showAll}
                rows={gateHistory.items.map((item) => (
                  <li
                    key={item.reviewGateId}
                    className="rounded-md border border-border p-3"
                    data-testid={`proposal-detail-gate-history-item-${item.reviewGateId}`}
                    data-gate-execution={item.execution}
                    data-matches-current-content={item.matchesCurrentContent ? 'true' : 'false'}
                  >
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-body font-semibold text-fg" data-testid={`proposal-detail-gate-history-title-${item.reviewGateId}`}>
                        {item.title}
                      </h3>
                      <Badge variant={item.matchesCurrentContent ? 'success' : 'neutral'} data-testid={`proposal-detail-gate-history-content-note-${item.reviewGateId}`}>
                        {item.contentNote}
                      </Badge>
                    </div>
                    <GateResultBlock gate={item.gate} scope={{ kind: 'HISTORY', id: item.reviewGateId }} messages={messages} />
                  </li>
                ))}
              />
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
