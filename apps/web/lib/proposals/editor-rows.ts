// apps/web/lib/proposals/editor-rows.ts
// `S-020` 提案の作成・編集の表示値の組み立て（docs/04 §S-020 改訂 10 / `F-019` / `F-011 AC-1`）。T-09-01。
//
// 🔴 画面（`app/(main)/proposals/**`）ではなくここに置く理由は `proposal-requests/detail-rows.ts` と同じ:
//    `app/**` はユニットテストの対象外であり、「提案先が未設定なら明示する」「凍結の予告に経験内容の行数が出る」
//    「添付の選択肢が `CLEAN` の版だけである」「`DRAFT` 以外は読み取り専用である」を固定できる場所が要る。
//    **I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
import { t, type MessageKey } from '@ses/i18n';
import type { ProposalState } from '@ses/domain';
import { formatUnitPriceRange } from '../engineers/detail';
import { formatDateTimeJst } from '../format/datetime';
import { formatThousands } from '../format/number';
import { PROPOSAL_EDIT_HREF_PATTERN, proposalApproveHref, proposalCreateHref, SENDING_DOMAIN_SETTINGS_HREF } from './hrefs';
import type { AttachableSkillSheetView, ProposalCreationTargetView, ProposalEditorView } from './service';
import type { ProposalView } from './views';

/** `Proposal.state` の 14 語（`docs/04` §S-019。`packages/i18n` に集約）。 */
export const PROPOSAL_STATE_MESSAGE_KEYS: Readonly<Record<ProposalState, MessageKey>> = {
  DRAFT: 'proposals.state.DRAFT',
  GATE_RUNNING: 'proposals.state.GATE_RUNNING',
  GATE_FAILED: 'proposals.state.GATE_FAILED',
  APPROVAL_PENDING: 'proposals.state.APPROVAL_PENDING',
  APPROVED: 'proposals.state.APPROVED',
  SUBMITTING: 'proposals.state.SUBMITTING',
  SUBMITTED: 'proposals.state.SUBMITTED',
  SUBMIT_FAILED: 'proposals.state.SUBMIT_FAILED',
  INTERVIEW_SCHEDULED: 'proposals.state.INTERVIEW_SCHEDULED',
  INTERVIEWED: 'proposals.state.INTERVIEWED',
  RESULT_PENDING: 'proposals.state.RESULT_PENDING',
  WON: 'proposals.state.WON',
  LOST: 'proposals.state.LOST',
  WITHDRAWN: 'proposals.state.WITHDRAWN',
};

export function proposalStateLabel(state: ProposalState): string {
  return t(PROPOSAL_STATE_MESSAGE_KEYS[state]);
}

/** フォームの値（入力途中の文字列のまま持つ。`''` = 未指定）。 */
export type ProposalFormValues = {
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  readonly offeredUnitPrice: string;
  readonly offeredStartDate: string;
  readonly workStyle: string;
  readonly subject: string;
  readonly body: string;
  /** 添付する版の ID（`''` = 添付なし）。 */
  readonly skillSheetId: string;
};

export const EMPTY_PROPOSAL_FORM_VALUES: ProposalFormValues = {
  recipientCompanyName: '',
  recipientEmail: '',
  offeredUnitPrice: '',
  offeredStartDate: '',
  workStyle: '',
  subject: '',
  body: '',
  skillSheetId: '',
};

/** 対象（案件 / エンジニア）の表示値。凍結側（編集）と台帳の現在値（新規）の両方をこの形に写す。 */
export type ProposalEditorTargetRows = {
  /** 🔴 取引先で公開が解除された案件は `null`（画面は「案件名は公開されていません」と出す）。 */
  readonly projectName: string | null;
  readonly projectHref: string | null;
  readonly engineerName: string;
  readonly affiliation: string;
  /** ホストが読むときの作成した会社（`HostProposalView.owner`）。取引先の view と新規作成では `null`。 */
  readonly owner: string | null;
  readonly skills: string;
  readonly unitPriceRange: string;
  readonly availableFrom: string;
};

export type ProposalFreezeRows =
  | {
      readonly kind: 'PREVIEW';
      readonly lead: string;
      /** `経験内容 N 行を凍結します。` */
      readonly careers: string;
      /** 🔴 0 行のときだけ（作成をブロックはしない。`F-008 AC-5`）。 */
      readonly zeroCareersNotice: string | null;
      /** `S-007`（経歴の登録）への導線。 */
      readonly engineerEditHref: string;
    }
  | {
      readonly kind: 'FROZEN';
      /** `この提案には YYYY-MM-DD HH:MM JST 時点の情報が使われます。…` */
      readonly notice: string;
      /** `経験内容 N 行を凍結済み` */
      readonly careers: string;
    };

export type ProposalAttachmentOption = {
  readonly id: string;
  readonly label: string;
};

export type ProposalAttachmentRows = {
  /** 🔴 `CLEAN` の版だけ（`listAttachableSkillSheets` の母集団がそう）。空なら `emptyNotice` を出す。 */
  readonly options: readonly ProposalAttachmentOption[];
  readonly cleanOnlyNote: string;
  readonly emptyNotice: string | null;
  readonly sheetsHref: string | null;
  /** 凍結時点の版が添付されているが選択肢に無い（= 自社の台帳ではない）ときの説明。 */
  readonly frozenUnknownNotice: string | null;
};

export type ProposalSendingDomainRows =
  | { readonly kind: 'PARTNER'; readonly note: string }
  | { readonly kind: 'NOT_REQUIRED'; readonly note: string }
  | { readonly kind: 'UNVERIFIED'; readonly notice: string; readonly href: string; readonly linkLabel: string }
  | { readonly kind: 'VERIFIED'; readonly label: string };

export type ProposalSendingDomainFactInput =
  | { readonly kind: 'PARTNER' }
  | { readonly kind: 'NOT_REQUIRED' }
  | { readonly kind: 'UNVERIFIED' }
  | { readonly kind: 'VERIFIED'; readonly domain: string };

export function proposalSendingDomainRows(fact: ProposalSendingDomainFactInput): ProposalSendingDomainRows {
  switch (fact.kind) {
    case 'PARTNER':
      return { kind: 'PARTNER', note: t('proposals.editor.sendingDomain.partnerNote') };
    case 'NOT_REQUIRED':
      return { kind: 'NOT_REQUIRED', note: t('proposals.editor.sendingDomain.notRequired') };
    case 'UNVERIFIED':
      return {
        kind: 'UNVERIFIED',
        notice: t('proposals.editor.sendingDomain.unverified'),
        href: SENDING_DOMAIN_SETTINGS_HREF,
        linkLabel: t('proposals.editor.sendingDomain.open'),
      };
    case 'VERIFIED':
      return {
        kind: 'VERIFIED',
        label: `${t('proposals.editor.sendingDomain.verifiedPrefix')}@${fact.domain}${t('proposals.editor.sendingDomain.verifiedSuffix')}`,
      };
  }
}

function none(): string {
  return t('proposals.editor.valueNone');
}

function careersCount(count: number, prefixKey: MessageKey, suffixKey: MessageKey): string {
  return `${t(prefixKey)}${formatThousands(count)}${t(suffixKey)}`;
}

// ============================================================================
// 新規（`/proposals/new`）
// ============================================================================

export type ProposalCreateRows = {
  readonly projectId: string;
  readonly engineerId: string;
  readonly target: ProposalEditorTargetRows;
  readonly freeze: ProposalFreezeRows;
  readonly attachment: ProposalAttachmentRows;
  readonly initial: ProposalFormValues;
  /** 作成後の遷移先（`{id}` を採番された ID で置き換える。関数は client へ渡せない）。 */
  readonly editHrefPattern: string;
  /** 「候補検索に戻る」。 */
  readonly cancelHref: string;
};

/**
 * 新規作成画面の表示値。🔴 凍結の予告に**経験内容の行数**を出し、0 行なら注意を出す（作成はブロックしない）。
 */
export function proposalCreateRows(view: ProposalCreationTargetView): ProposalCreateRows {
  const latest = view.engineer.latestCleanSkillSheet;
  return {
    projectId: view.project.id,
    engineerId: view.engineer.id,
    target: {
      projectName: view.project.name,
      projectHref: `/projects/${view.project.id}`,
      engineerName: view.engineer.displayName,
      affiliation: view.engineer.affiliationLabel ?? none(),
      owner: null,
      skills: view.engineer.skillNames.length === 0 ? none() : view.engineer.skillNames.join(' / '),
      // 🔴 新規作成では単価レンジ・稼働可能時期を出さない（凍結後に `S-020` 編集で凍結側の値として見る）。
      unitPriceRange: none(),
      availableFrom: none(),
    },
    freeze: {
      kind: 'PREVIEW',
      lead: t('proposals.editor.freeze.previewLead'),
      careers: careersCount(
        view.engineer.careerCount,
        'proposals.editor.freeze.careersPrefix',
        'proposals.editor.freeze.careersSuffix',
      ),
      zeroCareersNotice: view.engineer.careerCount === 0 ? t('proposals.editor.freeze.careersZero') : null,
      engineerEditHref: `/engineers/${view.engineer.id}/edit`,
    },
    attachment: {
      // 🔴 新規作成では最新の `CLEAN` 版が自動で凍結される（`createProposalDraft`）。差し替えは作成後（#37）。
      options: latest === null ? [] : [{ id: latest.id, label: attachmentLabel(latest.version, null) }],
      cleanOnlyNote: t('proposals.editor.attachment.cleanOnly'),
      emptyNotice: latest === null ? t('proposals.editor.attachment.empty') : null,
      sheetsHref: latest === null ? `/engineers/${view.engineer.id}/skill-sheets` : null,
      frozenUnknownNotice: null,
    },
    initial: { ...EMPTY_PROPOSAL_FORM_VALUES, skillSheetId: latest?.id ?? '' },
    editHrefPattern: PROPOSAL_EDIT_HREF_PATTERN,
    cancelHref: `/projects/${view.project.id}/candidates`,
  };
}

// ============================================================================
// 編集（`/proposals/{id}/edit`）
// ============================================================================

export type ProposalEditRows = {
  readonly id: string;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly origin: ProposalView['origin'];
  readonly target: ProposalEditorTargetRows;
  readonly freeze: ProposalFreezeRows;
  readonly attachment: ProposalAttachmentRows;
  readonly initial: ProposalFormValues;
  /** 🔴 提案先が未設定（`view.recipient === null`）。画面は無言で空にせず理由を明示する（`docs/04` §S-020 改訂 10）。 */
  readonly recipientMissing: boolean;
  /** 経路 4 由来の説明（`origin === 'PROPOSAL_REQUEST'` のときだけ）。 */
  readonly originNotice: string | null;
  /** 🔴 `DRAFT` 以外は編集できない。理由（状態の語を含む 1 文）。`DRAFT` なら `null`。 */
  readonly readOnlyNotice: string | null;
  /** `S-016`（案件の候補検索）へ戻る。案件が見えなければ `S-017`（取引先の入口）へ。 */
  readonly cancelHref: string;
  readonly cancelLabel: string;
  /** 🔴 立場として編集できるか（`canEditProposal`）。 */
  readonly canEdit: boolean;
  /** 🔴 T-09-03: `S-021` への導線。`DRAFT` 以外のときだけ（レビューに出した後は承認画面で判断材料を見る）。 */
  readonly approveHref: string | null;
};

function attachmentLabel(version: number, uploadedAt: string | null): string {
  const base = `${t('proposals.editor.attachment.versionPrefix')}${formatThousands(version)}`;
  return uploadedAt === null ? base : `${base}（${formatDateTimeJst(uploadedAt)}）`;
}

function attachmentRows(
  attachableSkillSheets: readonly AttachableSkillSheetView[],
  frozenSkillSheetId: string | null,
): ProposalAttachmentRows {
  const options = attachableSkillSheets.map((sheet) => ({
    id: sheet.id,
    label: attachmentLabel(sheet.version, sheet.uploadedAt),
  }));
  const frozenKnown = frozenSkillSheetId === null || options.some((option) => option.id === frozenSkillSheetId);
  return {
    options,
    cleanOnlyNote: t('proposals.editor.attachment.cleanOnly'),
    emptyNotice: options.length === 0 && frozenSkillSheetId === null ? t('proposals.editor.attachment.empty') : null,
    // 🔴 版の取込（`S-008`）は所有者の台帳にしか無い。選択肢が 0 件で凍結もされていないときだけ導線を出す。
    sheetsHref: null,
    frozenUnknownNotice: frozenKnown ? null : t('proposals.editor.attachment.frozenUnknown'),
  };
}

export function proposalEditRows(editor: ProposalEditorView): ProposalEditRows {
  const sheetsHrefEngineerId = editor.ownedEngineerId;
  const { view } = editor;
  const attachment = attachmentRows(editor.attachableSkillSheets, view.attachment.skillSheetId);
  return {
    id: view.id,
    state: view.state,
    stateLabel: proposalStateLabel(view.state),
    origin: view.origin,
    target: {
      projectName: view.project === null ? null : view.project.name,
      projectHref: view.project === null ? null : `/projects/${view.project.id}`,
      engineerName: view.snapshot.displayName,
      affiliation: view.snapshot.affiliationLabel ?? none(),
      owner:
        view.audience === 'HOST'
          ? view.owner.kind === 'HOST'
            ? t('proposals.editor.owner.host')
            : view.owner.partnerCompanyName
          : null,
      skills: view.snapshot.skills.length === 0 ? none() : view.snapshot.skills.map((skill) => skill.name).join(' / '),
      unitPriceRange: formatUnitPriceRange(view.snapshot.unitPriceMin, view.snapshot.unitPriceMax),
      availableFrom: view.snapshot.availableFrom ?? none(),
    },
    freeze: {
      kind: 'FROZEN',
      notice: `${t('proposals.editor.freeze.noticePrefix')}${formatDateTimeJst(view.snapshot.frozenAt)}${t('proposals.editor.freeze.noticeSuffix')}`,
      careers: careersCount(
        view.snapshot.careerCount,
        'proposals.editor.freeze.frozenCareersPrefix',
        'proposals.editor.freeze.frozenCareersSuffix',
      ),
    },
    attachment: {
      ...attachment,
      sheetsHref:
        attachment.emptyNotice !== null && sheetsHrefEngineerId !== null
          ? `/engineers/${sheetsHrefEngineerId}/skill-sheets`
          : null,
    },
    initial: {
      recipientCompanyName: view.recipient?.companyName ?? '',
      recipientEmail: view.recipient?.email ?? '',
      offeredUnitPrice: view.terms.offeredUnitPrice === null ? '' : String(view.terms.offeredUnitPrice),
      offeredStartDate: view.terms.offeredStartDate ?? '',
      workStyle: view.terms.workStyle ?? '',
      subject: view.content.subject ?? '',
      body: view.content.body ?? '',
      skillSheetId: view.attachment.skillSheetId ?? '',
    },
    recipientMissing: view.recipient === null,
    originNotice: view.origin === 'PROPOSAL_REQUEST' ? t('proposals.editor.recipient.originRequest') : null,
    readOnlyNotice:
      view.state === 'DRAFT'
        ? null
        : `${t('proposals.editor.readOnly.prefix')}${proposalStateLabel(view.state)}${t('proposals.editor.readOnly.suffix')}`,
    cancelHref: view.project === null ? '/proposal-requests' : `/projects/${view.project.id}/candidates`,
    cancelLabel: view.project === null ? t('proposals.editor.backToRequests') : t('proposals.editor.cancel'),
    canEdit: editor.canEdit,
    approveHref: view.state === 'DRAFT' ? null : proposalApproveHref(view.id),
  };
}

/** `S-016` の右パネルからの遷移元（テストの対照用。`S-016` と同じ 1 関数）。 */
export { proposalCreateHref };
