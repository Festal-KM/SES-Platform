// apps/web/lib/proposals/approval-rows.ts
// `S-021` 提案の承認の表示値の組み立て（docs/04 §S-021 / §6.1 / `F-021 AC-4` / `BR-49`）。T-09-03。
//
// 🔴 画面（`app/(main)/proposals/[id]/approve/**`）ではなくここに置く理由は `editor-rows.ts` と同じ:
//    `app/**` はユニットテストの対象外であり、「判断ヘッダに提案先・単価・エンジニアの要点が必ず入る」
//    「不合格の指摘と警告が別のリストに分かれる」「状態ごとに承認の可否が決まる」を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 **判断材料は凍結側（`ProposalView.snapshot`）と `ReviewGate` の結果からだけ組む**（台帳の現在値を混ぜない）。
import { t, type MessageKey } from '@ses/i18n';
import {
  isAutoReleasableSendHoldReason,
  isTenantResolvableSendHoldReason,
  type GateFinding,
  type GateLayerState,
  type GateResultView,
  type ProposalState,
  type SendHoldReasonKey,
} from '@ses/domain';
import { formatUnitPriceRange } from '../engineers/detail';
import { formatDateTimeJst } from '../format/datetime';
import { formatElapsedWith, type ElapsedLabels } from '../format/elapsed';
import { formatThousands } from '../format/number';
import type { ProposalApprovalRecordView, ProposalApprovalView } from './approval';
import { proposalStateLabel } from './editor-rows';
import { proposalEditHref, SENDING_DOMAIN_SETTINGS_HREF, USAGE_SETTINGS_HREF } from './hrefs';
import type { ProposalSendAttemptView, ProposalSendHoldView } from './views';

/** 判断ヘッダの 1 行（定義リスト）。`field` は `data-field` に載せる機械名。 */
export type ApprovalHeaderRow = {
  readonly field: string;
  readonly label: string;
  readonly value: string;
  /** 🔴 未設定・要確認の強調（単価が未設定など。承認者が見落とさないため）。 */
  readonly emphasis: 'NONE' | 'ATTENTION';
};

/** プレビューの本文に載せる強調（指摘 / 警告の該当箇所）。`offsetStart` / `offsetEnd` は欄内の UTF-16 オフセット。 */
export type ApprovalHighlight = {
  readonly start: number;
  readonly end: number;
  readonly severity: 'BLOCK' | 'WARN';
  readonly kind: GateFinding['kind'];
};

export type ApprovalPreviewRows = {
  readonly subject: string | null;
  readonly body: string | null;
  readonly subjectHighlights: readonly ApprovalHighlight[];
  readonly bodyHighlights: readonly ApprovalHighlight[];
  /** 添付の表示（無ければ `null`）。 */
  readonly attachment: string | null;
};

export type ApprovalGateFindingRow = {
  readonly key: string;
  readonly fieldLabel: string;
  readonly kind: GateFinding['kind'];
  readonly excerpt: string;
  /** 🔴 箇所を特定できない指摘は `null` ではなく「特定できませんでした」の語を添える（docs/05 §11.7）。 */
  readonly locationNote: string | null;
};

export type ApprovalGateRows = {
  readonly execution: GateResultView['execution'];
  readonly layers: readonly { readonly key: 'pii' | 'commerce' | 'consistency'; readonly label: string; readonly state: GateLayerState; readonly verdictLabel: string }[];
  /** 🔴 不合格の指摘（`findings`。層のブロックを FAIL にする側）。 */
  readonly findings: readonly ApprovalGateFindingRow[];
  /** 🔴 警告（`aiWarnings`。合否に影響しない側）。**別のリスト**である。 */
  readonly warnings: readonly ApprovalGateFindingRow[];
  readonly failed: boolean;
  readonly allPassed: boolean;
  readonly aiFailed: boolean;
  readonly heldResetAt: string | null;
  readonly lead: string | null;
};

/**
 * 状態ごとの画面の形（docs/04 §S-021「承認ゲートを迂回できない設計」①: `APPROVAL_PENDING` 以外では承認アクションを描画しない）。
 * 🔴 T-09-06: `APPROVED` は「送信する」（#43）の対象。`SUBMITTING` / `SUBMITTED` / `SUBMIT_FAILED` は**別々の形**で描く
 *    （送信中 / 送信済み / 送信失敗を混ぜない。`CLAUDE.md` §4.2「失敗と保留を混同しない」）。
 */
export type ApprovalDisposition =
  | { readonly kind: 'PENDING' }
  | { readonly kind: 'APPROVED'; readonly notice: string }
  | { readonly kind: 'SUBMITTING'; readonly notice: string }
  | { readonly kind: 'SUBMITTED'; readonly notice: string }
  | { readonly kind: 'SUBMIT_FAILED'; readonly notice: string }
  | { readonly kind: 'GATE_FAILED'; readonly notice: string }
  | { readonly kind: 'GATE_RUNNING'; readonly notice: string }
  | { readonly kind: 'DRAFT'; readonly notice: string }
  | { readonly kind: 'OTHER'; readonly notice: string };

/**
 * 🔴 T-09-06: 送信の保留の表示（docs/05 §10.4「利用者への提示」）。
 * - `message` … `sendHold.{reasonKey}`（`packages/i18n`）
 * - `autoRelease` … `send.hold-release` が復帰させる理由か（`GATE_STALE` だけ `false` = 人間が「送信する」を選ぶ）
 * - `settingsLink` … テナント側で解消できる理由だけに設定導線を出す。🔴 **`PROVIDER_QUOTA` は `null`**（`S-038` に誘導しない）
 */
export type ApprovalSendHoldRows = {
  readonly reasonKey: SendHoldReasonKey;
  readonly title: string;
  readonly message: string;
  readonly since: string;
  readonly autoRelease: boolean;
  readonly settingsLink: { readonly href: string; readonly label: string } | null;
};

export type ProposalApprovalRows = {
  readonly id: string;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly header: readonly ApprovalHeaderRow[];
  readonly frozenNotice: string;
  readonly gate: ApprovalGateRows;
  readonly preview: ApprovalPreviewRows;
  readonly attachmentNotice: string;
  readonly approver: string | null;
  readonly disposition: ApprovalDisposition;
  /** 🔴 立場として承認・却下ができるか（`canApproveProposal`）。 */
  readonly canApprove: boolean;
  /** 🔴 T-09-06: 立場として送信を要求できるか（`canSubmitProposal`。#43 と同じ判定）。 */
  readonly canSubmit: boolean;
  /** 🔴 T-09-06: 送信の保留（ホストの view にだけある。取引先・保留なしは `null`）。 */
  readonly sendHold: ApprovalSendHoldRows | null;
  /**
   * 🔴 T-12-13 ⑤: `APPROVED` のまま**送信の確定を待っている**か（`isAwaitingSendSettlement` = 送信試行の末尾が `RESERVED`。ホストだけ。
   *    取引先は常に `false`）。`S-021` はこれか保留（`sendHold`）が立っている間、#46 を読み続けて `SUBMITTED` / `SUBMIT_FAILED` への
   *    確定を拾う。#44 の受け付け直後（試行の行がまだ無い窓）は DB の値ではなく `S-022` が残すセッション限定の印
   *    （`lib/proposals/submit-intent.ts`）で `S-021` が `SUBMIT_REQUESTED` に入る。
   */
  readonly awaitingSendSettlement: boolean;
  /** 取引先（◐）向けの注記。ホストなら `null`。 */
  readonly audienceNotice: string | null;
  readonly editorHref: string;
};

/**
 * 🔴 T-12-13 ⑤（SP-09 T-09-11 ①-① の申し送り）: `APPROVED` のまま送信の確定を待っているか
 *    = **送信試行の末尾が未確定（`RESERVED`）** —— 送信ジョブが ④ の予約まで進み ⑥ の確定を残している。**これだけ**を根拠にする。
 *
 * 🔴 `last_failure_reason` を根拠にしない（レビュー指摘。2026-09-18）。#44 の CAS `SUBMIT_FAILED → APPROVED` はこの列を次の確定まで
 *    残すので「`APPROVED` で非 null = 再送の受け付け後・確定前」と読みたくなるが、この列を消すのは ⑥ の確定だけであり、
 *    (a) CAS の後の enqueue が `BLOCKED_BY_FAILED_JOB` で 409 `SEND_JOB_BLOCKED` になった / (b) seq N+1 のジョブが ③ CAS より前に
 *    落ちた（`attempts: 1`）/ (c) キューが失われた、のいずれでも `APPROVED` + 非 null のまま**ジョブが無い**行が残る。それを
 *    「送信中」と断定すると `S-021` が「送信を受け付けました。送信中です」を恒久的に出して「送信する」を描かず、`S-022`
 *    （`SUBMIT_FAILED` 専用）にも `S-023` にも復帰導線が無い行き止まりになる（`CLAUDE.md` §11.1「成功したように見えて実際には
 *    送信されていない」の形）。#44 の 202 の直後（③ CAS の前で試行の行がまだ無い窓）は、DB の値ではなく `S-022` がセッションに
 *    残す印（`submit-intent.ts`）で `S-021` が #43 と同じ `SUBMIT_REQUESTED` に入り、既存の #46 の読み直しが確定を拾う。
 *
 * 🔴 `APPROVED` 以外では常に `false`（`SUBMITTING` は別の効果が読み続ける。確定後は読まない）。
 * 🔴 保留中（`sendHold` が非 null）は `false` —— 保留はジョブが ① / ② で止めた**確定した**状態であり、待っているのは
 *    `send.hold-release`（自動復帰）か人間の「送信する」（`GATE_STALE`）である。`S-021` は保留を別の枠で描き、保留中の
 *    読み直しは画面が `sendHold` で決める（保留中に「送信を受け付けました」を出さない / `GATE_STALE` の「送信する」を消さない）。
 * 取引先の view は試行を持たないので常に `false`。
 */
export function isAwaitingSendSettlement(input: {
  readonly state: ProposalState;
  readonly sendHold: Pick<ProposalSendHoldView, 'reasonKey'> | null;
  readonly sendAttempts: readonly Pick<ProposalSendAttemptView, 'status'>[];
}): boolean {
  if (input.state !== 'APPROVED' || input.sendHold !== null) return false;
  const tail = input.sendAttempts.at(-1);
  return tail !== undefined && tail.status === 'RESERVED';
}

function none(): string {
  return t('proposals.approval.valueNone');
}

/**
 * 経過時間の語（`formatElapsedWith` の入力）。✅ T-12-15: `S-003` / `S-004` の要対応キュー（`'use client'`）が
 * サーバ側で解決した同じ語を props で受け取るため、ここから 1 か所で引く。
 */
export function elapsedLabels(): ElapsedLabels {
  return {
    justNow: t('proposals.approval.elapsed.justNow'),
    minutesSuffix: t('proposals.approval.elapsed.minutesSuffix'),
    hoursSuffix: t('proposals.approval.elapsed.hoursSuffix'),
    daysSuffix: t('proposals.approval.elapsed.daysSuffix'),
    none: none(),
  };
}

/**
 * 経過時間（作成からの時間。判断ヘッダ「経過時間」）。🔴 分・時間・日の 3 段。表示だけであり判定には使わない。
 * `now` は呼び出し側から渡す（`packages/domain` と同じ規律。テストが決定的になる）。
 * ✅ T-12-15: 丸めの本体は `lib/format/elapsed.ts`（純粋関数）へ移し、ここは文言を解決して呼ぶだけの皮にした。
 */
export function formatElapsed(fromIso: string, now: Date): string {
  return formatElapsedWith(fromIso, now.getTime(), elapsedLabels());
}

function fieldLabel(field: GateFinding['field']): string {
  switch (field) {
    case 'subject':
      return t('proposals.approval.gate.field.subject');
    case 'body':
      return t('proposals.approval.gate.field.body');
    case 'snapshot':
      return t('proposals.approval.gate.field.snapshot');
    case 'attachment':
      return t('proposals.approval.gate.field.attachment');
    case 'public_summary':
      return t('proposals.approval.gate.field.public_summary');
    case 'project_name':
      return t('proposals.approval.gate.field.project_name');
    case 'requirement':
      return t('proposals.approval.gate.field.requirement');
    case 'contract_document':
      return t('proposals.approval.gate.field.contract_document');
  }
}

function findingRows(findings: readonly GateFinding[], prefix: string): readonly ApprovalGateFindingRow[] {
  return findings.map((finding, index) => ({
    key: `${prefix}-${finding.layer}-${finding.kind}-${String(index)}`,
    fieldLabel: fieldLabel(finding.field),
    kind: finding.kind,
    excerpt: finding.excerpt,
    locationNote: finding.offsetStart === null || finding.offsetEnd === null ? t('proposals.approval.gate.offsetUnknown') : null,
  }));
}

function highlightsFor(field: 'subject' | 'body', gate: GateResultView): readonly ApprovalHighlight[] {
  const blocking = [gate.layers.pii, gate.layers.commerce, gate.layers.consistency].flatMap((layer) => layer.findings);
  const all = [
    ...blocking.map((finding) => ({ finding, severity: 'BLOCK' as const })),
    ...gate.aiWarnings.map((finding) => ({ finding, severity: 'WARN' as const })),
  ];
  return all
    .filter(({ finding }) => finding.field === field && finding.offsetStart !== null && finding.offsetEnd !== null)
    .map(({ finding, severity }) => ({
      start: finding.offsetStart as number,
      end: finding.offsetEnd as number,
      severity,
      kind: finding.kind,
    }))
    .filter((highlight) => highlight.end > highlight.start && highlight.start >= 0)
    .sort((a, b) => a.start - b.start);
}

function verdictLabel(state: GateLayerState): string {
  switch (state) {
    case 'PASS':
      return t('proposals.approval.gate.verdict.PASS');
    case 'FAIL':
      return t('proposals.approval.gate.verdict.FAIL');
    case 'RUNNING':
    case 'HELD':
      // 🔴 HELD は「検査中」の語で描く（失敗ではない。`F-027 AC-5`）。理由は別の注記が出す。
      return t('proposals.approval.gate.verdict.RUNNING');
  }
}

export function approvalGateRows(gate: GateResultView): ApprovalGateRows {
  const layers = [
    { key: 'pii' as const, label: t('proposals.approval.gate.layer.pii'), state: gate.layers.pii.state },
    { key: 'commerce' as const, label: t('proposals.approval.gate.layer.commerce'), state: gate.layers.commerce.state },
    { key: 'consistency' as const, label: t('proposals.approval.gate.layer.consistency'), state: gate.layers.consistency.state },
  ].map((layer) => ({ ...layer, verdictLabel: verdictLabel(layer.state) }));
  const failed = layers.some((layer) => layer.state === 'FAIL');
  const allPassed = layers.every((layer) => layer.state === 'PASS');
  const blocking = [gate.layers.pii, gate.layers.commerce, gate.layers.consistency].flatMap((layer) => layer.findings);
  return {
    execution: gate.execution,
    layers,
    findings: findingRows(blocking, 'finding'),
    warnings: findingRows(gate.aiWarnings, 'warning'),
    failed,
    allPassed,
    aiFailed: gate.aiFailed,
    heldResetAt: gate.held === undefined ? null : formatDateTimeJst(gate.held.resetAt),
    lead:
      gate.execution !== 'DONE'
        ? null
        : failed
          ? t('proposals.approval.gate.failedLead')
          : allPassed
            ? t('proposals.approval.gate.passedLead')
            : null,
  };
}

function approverLabel(approval: ProposalApprovalRecordView): string | null {
  switch (approval.kind) {
    case 'NONE':
      return null;
    case 'SYSTEM':
      return `${t('proposals.approval.approver.system')} / ${formatDateTimeJst(approval.approvedAt)}`;
    case 'USER':
      return `${approval.approverName ?? t('proposals.approval.approver.unknownUser')} / ${formatDateTimeJst(approval.approvedAt)}`;
  }
}

/** `sendHold.{reasonKey}` の文言キー（7 値。`Record` で漏れをコンパイラに強制させる）。 */
const SEND_HOLD_MESSAGE_KEYS = {
  RATE_LIMIT: 'sendHold.RATE_LIMIT',
  DOMAIN_UNVERIFIED: 'sendHold.DOMAIN_UNVERIFIED',
  ESIGN_DISCONNECTED: 'sendHold.ESIGN_DISCONNECTED',
  TENANT_SUSPENDED: 'sendHold.TENANT_SUSPENDED',
  GATE_STALE: 'sendHold.GATE_STALE',
  AI_COST_LIMIT: 'sendHold.AI_COST_LIMIT',
  PROVIDER_QUOTA: 'sendHold.PROVIDER_QUOTA',
} as const satisfies Record<SendHoldReasonKey, MessageKey>;

/**
 * 🔴 設定導線（docs/05 §10.4）。テナント側で解消できる理由だけ。`PROVIDER_QUOTA` / `TENANT_SUSPENDED` / `GATE_STALE` /
 *    `AI_COST_LIMIT` は `null`（`S-038` に誘導しても打つ手が無い、または導線が別）。
 */
function sendHoldSettingsLink(reasonKey: SendHoldReasonKey): ApprovalSendHoldRows['settingsLink'] {
  if (!isTenantResolvableSendHoldReason(reasonKey)) return null;
  switch (reasonKey) {
    case 'DOMAIN_UNVERIFIED':
      return { href: SENDING_DOMAIN_SETTINGS_HREF, label: t('proposals.approval.sendHold.openSendingDomain') };
    case 'RATE_LIMIT':
      return { href: USAGE_SETTINGS_HREF, label: t('proposals.approval.sendHold.openUsage') };
    default:
      // `ESIGN_DISCONNECTED`（契約書。Phase 3）の導線は SP-17 が置く。提案には立たない。
      return null;
  }
}

export function approvalSendHoldRows(hold: ProposalSendHoldView | null): ApprovalSendHoldRows | null {
  if (hold === null) return null;
  return {
    reasonKey: hold.reasonKey,
    title: t('proposals.approval.sendHold.title'),
    message: t(SEND_HOLD_MESSAGE_KEYS[hold.reasonKey]),
    since: `${t('proposals.approval.sendHold.sincePrefix')}${formatDateTimeJst(hold.since)}`,
    autoRelease: isAutoReleasableSendHoldReason(hold.reasonKey),
    settingsLink: sendHoldSettingsLink(hold.reasonKey),
  };
}

function disposition(state: ProposalState, approver: string | null, submittedAt: string | null): ApprovalDisposition {
  switch (state) {
    case 'APPROVAL_PENDING':
      return { kind: 'PENDING' };
    case 'APPROVED':
      return {
        kind: 'APPROVED',
        notice: `${t('proposals.approval.state.approved.prefix')}${approver ?? none()}${t('proposals.approval.state.approved.suffix')}`,
      };
    case 'SUBMITTING':
      return { kind: 'SUBMITTING', notice: t('proposals.approval.state.submitting') };
    case 'SUBMITTED':
      return {
        kind: 'SUBMITTED',
        notice: `${t('proposals.approval.state.submitted.prefix')}${submittedAt ?? none()}${t('proposals.approval.state.submitted.suffix')}`,
      };
    case 'SUBMIT_FAILED':
      return { kind: 'SUBMIT_FAILED', notice: t('proposals.approval.state.submitFailed') };
    case 'GATE_FAILED':
      return { kind: 'GATE_FAILED', notice: t('proposals.approval.state.gateFailed') };
    case 'GATE_RUNNING':
      return { kind: 'GATE_RUNNING', notice: t('proposals.approval.state.gateRunning') };
    case 'DRAFT':
      return { kind: 'DRAFT', notice: t('proposals.approval.state.draft') };
    default:
      return {
        kind: 'OTHER',
        notice: `${t('proposals.approval.state.other.prefix')}${proposalStateLabel(state)}${t('proposals.approval.state.other.suffix')}`,
      };
  }
}

/**
 * 🔴 判断ヘッダ（docs/04 §S-021 セクション 1）。**提案先 / エンジニア / 案件 / 単価 / 開始日 / 作成者 / 経過時間**を
 *    必ず含む（`F-021 AC-4`）。**折りたたまない・モバイルでも常に見える**のは画面側の責務。
 * 🔴 T-09-09: `S-023`（提案詳細）の概要も同じ関数で組む（判断ヘッダと同じ材料。`Pick` で要る 2 つだけを受ける）。
 */
export function approvalHeaderRows(view: Pick<ProposalApprovalView, 'view' | 'createdByName'>, now: Date): readonly ApprovalHeaderRow[] {
  const { view: proposal } = view;
  const snapshot = proposal.snapshot;
  const affiliation =
    proposal.audience === 'HOST'
      ? proposal.owner.kind === 'HOST'
        ? t('proposals.approval.affiliation.host')
        : t('proposals.approval.affiliation.partner')
      : t('proposals.approval.affiliation.host');
  const rows: ApprovalHeaderRow[] = [
    {
      field: 'recipient',
      label: t('proposals.approval.field.recipient'),
      value: proposal.recipient === null ? t('proposals.approval.recipientUnset') : `${proposal.recipient.companyName} / ${proposal.recipient.email}`,
      emphasis: proposal.recipient === null ? 'ATTENTION' : 'NONE',
    },
    {
      field: 'engineer',
      label: t('proposals.approval.field.engineer'),
      value: `${snapshot.displayName}（${snapshot.affiliationLabel ?? affiliation}）`,
      emphasis: 'NONE',
    },
  ];
  if (proposal.audience === 'HOST' && proposal.owner.kind === 'PARTNER') {
    rows.push({ field: 'owner', label: t('proposals.approval.field.owner'), value: proposal.owner.partnerCompanyName, emphasis: 'NONE' });
  }
  rows.push(
    {
      field: 'project',
      label: t('proposals.approval.field.project'),
      value: proposal.project === null ? t('proposals.approval.projectNotShared') : proposal.project.name,
      emphasis: 'NONE',
    },
    {
      field: 'unit-price',
      label: t('proposals.approval.field.unitPrice'),
      value: proposal.terms.offeredUnitPrice === null ? t('proposals.approval.unitPriceUnset') : formatThousands(proposal.terms.offeredUnitPrice),
      emphasis: proposal.terms.offeredUnitPrice === null ? 'ATTENTION' : 'NONE',
    },
    { field: 'start-date', label: t('proposals.approval.field.startDate'), value: proposal.terms.offeredStartDate ?? none(), emphasis: 'NONE' },
    { field: 'work-style', label: t('proposals.approval.field.workStyle'), value: proposal.terms.workStyle ?? none(), emphasis: 'NONE' },
    {
      field: 'skills',
      label: t('proposals.approval.field.skills'),
      value: snapshot.skills.length === 0 ? none() : snapshot.skills.map((skill) => skill.name).join(' / '),
      emphasis: 'NONE',
    },
    {
      field: 'unit-price-range',
      label: t('proposals.editor.field.unitPriceRange'),
      value: formatUnitPriceRange(snapshot.unitPriceMin, snapshot.unitPriceMax),
      emphasis: 'NONE',
    },
    {
      field: 'career-count',
      label: t('proposals.approval.field.careerCount'),
      value: `${formatThousands(snapshot.careerCount)}${t('proposals.approval.careerCount.unit')}`,
      emphasis: 'NONE',
    },
    { field: 'created-by', label: t('proposals.approval.field.createdBy'), value: view.createdByName ?? t('proposals.approval.createdByUnknown'), emphasis: 'NONE' },
    { field: 'elapsed', label: t('proposals.approval.field.elapsed'), value: formatElapsed(proposal.createdAt, now), emphasis: 'NONE' },
  );
  return rows;
}

/** 🔴 判断ヘッダに**必ず**含まれる欄（`F-021 AC-4` の列挙。テストが固定する）。 */
export const APPROVAL_HEADER_REQUIRED_FIELDS = ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'created-by', 'elapsed'] as const;

export function proposalApprovalRows(view: ProposalApprovalView, now: Date): ProposalApprovalRows {
  const { view: proposal } = view;
  const approver = approverLabel(view.approval);
  return {
    id: proposal.id,
    state: proposal.state,
    stateLabel: proposalStateLabel(proposal.state),
    header: approvalHeaderRows(view, now),
    frozenNotice: `${t('proposals.approval.frozenNotice.prefix')}${formatDateTimeJst(proposal.snapshot.frozenAt)}${t('proposals.approval.frozenNotice.suffix')}`,
    gate: approvalGateRows(view.gate),
    preview: {
      subject: proposal.content.subject,
      body: proposal.content.body,
      subjectHighlights: highlightsFor('subject', view.gate),
      bodyHighlights: highlightsFor('body', view.gate),
      attachment: proposal.attachment.skillSheetId === null ? null : t('proposals.approval.attachment.present'),
    },
    attachmentNotice: proposal.attachment.skillSheetId === null ? t('proposals.approval.attachment.none') : t('proposals.approval.attachment.present'),
    approver,
    disposition: disposition(proposal.state, approver, view.submittedAt === null ? null : formatDateTimeJst(view.submittedAt)),
    canApprove: view.canApprove,
    canSubmit: view.canSubmit,
    sendHold: proposal.audience === 'HOST' ? approvalSendHoldRows(proposal.sendHold) : null,
    awaitingSendSettlement:
      proposal.audience === 'HOST' &&
      isAwaitingSendSettlement({
        state: proposal.state,
        sendHold: proposal.sendHold,
        sendAttempts: view.sendAttempts,
      }),
    audienceNotice: proposal.audience === 'PARTNER' ? t('proposals.approval.partnerNotice') : null,
    editorHref: proposalEditHref(proposal.id),
  };
}
