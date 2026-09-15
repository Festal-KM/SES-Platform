// apps/web/lib/proposals/approval-rows.ts
// `S-021` 提案の承認の表示値の組み立て（docs/04 §S-021 / §6.1 / `F-021 AC-4` / `BR-49`）。T-09-03。
//
// 🔴 画面（`app/(main)/proposals/[id]/approve/**`）ではなくここに置く理由は `editor-rows.ts` と同じ:
//    `app/**` はユニットテストの対象外であり、「判断ヘッダに提案先・単価・エンジニアの要点が必ず入る」
//    「不合格の指摘と警告が別のリストに分かれる」「状態ごとに承認の可否が決まる」を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 **判断材料は凍結側（`ProposalView.snapshot`）と `ReviewGate` の結果からだけ組む**（台帳の現在値を混ぜない）。
import { t } from '@ses/i18n';
import type { GateFinding, GateLayerState, GateResultView, ProposalState } from '@ses/domain';
import { formatUnitPriceRange } from '../engineers/detail';
import { formatDateTimeJst } from '../format/datetime';
import { formatThousands } from '../format/number';
import type { ProposalApprovalRecordView, ProposalApprovalView } from './approval';
import { proposalStateLabel } from './editor-rows';
import { proposalEditHref } from './hrefs';

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

/** 状態ごとの画面の形（docs/04 §S-021「承認ゲートを迂回できない設計」①: `APPROVAL_PENDING` 以外では承認アクションを描画しない）。 */
export type ApprovalDisposition =
  | { readonly kind: 'PENDING' }
  | { readonly kind: 'APPROVED'; readonly notice: string }
  | { readonly kind: 'GATE_FAILED'; readonly notice: string }
  | { readonly kind: 'GATE_RUNNING'; readonly notice: string }
  | { readonly kind: 'DRAFT'; readonly notice: string }
  | { readonly kind: 'OTHER'; readonly notice: string };

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
  /** 取引先（◐）向けの注記。ホストなら `null`。 */
  readonly audienceNotice: string | null;
  readonly editorHref: string;
};

function none(): string {
  return t('proposals.approval.valueNone');
}

/**
 * 経過時間（作成からの時間。判断ヘッダ「経過時間」）。🔴 分・時間・日の 3 段。表示だけであり判定には使わない。
 * `now` は呼び出し側から渡す（`packages/domain` と同じ規律。テストが決定的になる）。
 */
export function formatElapsed(fromIso: string, now: Date): string {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return none();
  const minutes = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (minutes < 1) return t('proposals.approval.elapsed.justNow');
  if (minutes < 60) return `${formatThousands(minutes)}${t('proposals.approval.elapsed.minutesSuffix')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${formatThousands(hours)}${t('proposals.approval.elapsed.hoursSuffix')}`;
  return `${formatThousands(Math.floor(hours / 24))}${t('proposals.approval.elapsed.daysSuffix')}`;
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

function disposition(state: ProposalState, approver: string | null): ApprovalDisposition {
  switch (state) {
    case 'APPROVAL_PENDING':
      return { kind: 'PENDING' };
    case 'APPROVED':
      return {
        kind: 'APPROVED',
        notice: `${t('proposals.approval.state.approved.prefix')}${approver ?? none()}${t('proposals.approval.state.approved.suffix')}`,
      };
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
 */
export function approvalHeaderRows(view: ProposalApprovalView, now: Date): readonly ApprovalHeaderRow[] {
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
    disposition: disposition(proposal.state, approver),
    canApprove: view.canApprove,
    audienceNotice: proposal.audience === 'PARTNER' ? t('proposals.approval.partnerNotice') : null,
    editorHref: proposalEditHref(proposal.id),
  };
}
