// apps/web/lib/proposals/service.ts
// 提案の作成・編集と `S-020` の読み取り（docs/05 §6.5 #36 / #37「T-09-01 の決着」/ `F-019` / `S-020`）。T-09-01。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **作成は `createProposalDraft()`（`@ses/db`）の 1 実装を通る。** 凍結（`EngineerSnapshot`）・
//      `ProposalEvent(STATE null→DRAFT)`・`proposal.create` はあちらが書く。#33（応諾。T-08-07）と #36 は同じ
//      関数を呼ぶ。**凍結を迂回した `proposals` の INSERT をここに書かない**（`F-019 AC-2`）。
//   ② 🔴 **編集は `DRAFT` のみ**（#37。他状態は 422 `PROPOSAL_NOT_EDITABLE`）。更新は CAS（`WHERE state = 'DRAFT'`）
//      で、読んでから書くまでの間にレビュー依頼（#39）が `GATE_RUNNING` へ進めていれば 0 件 = 422。
//      **検査した内容と送る内容が食い違う経路を作らない**（§11.5）。
//   ③ 🔴 **提案先の 2 列は空にできない**（スキーマ）。経路 4 由来の `DRAFT` はここで埋まり、#39 は空のままの
//      `DRAFT` を 422 で止める（`hasProposalRecipient` の 1 判定）。
//   ④ 🔴 **添付は `CLEAN` の版に限る**（`F-019 AC-3`）。`skillSheetId` は `withTenant` の内側で
//      「この提案のエンジニアの版か」「`CLEAN` か」を照合する。見えない版は 404、`CLEAN` でなければ 409。
//   ⑤ 🔴 **`S-020` が読むエンジニアの情報は `EngineerSnapshot`（凍結側）だけ**（`F-019 AC-1`）。
//      `readProposalEditor` は `engineer_skills` / `engineer_careers` を読まず、`engineers` は「実行者に見えるか」の
//      存在確認（`select: { id }`）だけに使う。添付できる版の一覧（台帳の現在値）は view とは別のフィールドで返す。
//
// 🔴 母集団はアプリが決めない —— `proposals` / `engineer_snapshots` は RLS の C5（ホストは全件、取引先は自社の行）、
//    `projects` は C4、`engineers` / `skill_sheets` は C3 であり、`where` に `tenantId` / `ownerPartnerCompanyId` を
//    書かない。見えなければ 404（docs/05 §4.8）。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できるようにする。
//    `lib/proposals/gate.ts` と同方針）。
import {
  computeProposalContentHash,
  createProposalDraft,
  toDateOnly,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type ProposalDraftResult,
} from '@ses/db';
import {
  InternalError,
  NotFoundError,
  ProposalEditForbiddenError,
  ProposalNotEditableError,
  SkillSheetNotAttachableError,
} from '../api/errors';
import { readEngineerCareers } from '../engineers/careers';
import { canEditProposal } from './policy';
import { UPDATE_PROPOSAL_FIELDS, type CreateProposalBody, type UpdateProposalBody } from './schemas';
import {
  toHostProposalView,
  toPartnerProposalView,
  type HostProposalOwnerView,
  type ProposalProjectRef,
  type ProposalView,
  type ProposalViewRow,
} from './views';

/**
 * docs/05 §16.1 の `*.update`。#39（`lib/proposals/gate.ts`）と同じ action に畳み、区別は `summary.operation`
 * （🔴 独自 action を作らない。`S-041` の操作種別フィルタは接尾辞一致）。
 */
export const PROPOSAL_AUDIT_ACTION_UPDATE = 'proposal.update';

export const PROPOSAL_AUDIT_OPERATIONS = {
  /** #37 の下書き更新。`summary.fields` に**キー名だけ**を載せる。 */
  draftUpdate: 'DRAFT_UPDATE',
} as const;

/**
 * 🔴 #37 が `ProposalEvent` に残す印（`kind='NOTE'`。`fromState` = `toState` = `DRAFT`）。`note` は
 *    `DRAFT_UPDATED:<変更したキー名>` であり本文・単価・提案先の**値**を含まない（F-019 処理④ / §16.2）。
 *    `kind` の値集合（`STATE` / `NOTE` / `ATTACHMENT`）は DB の CHECK で固定されており、下書きの更新は
 *    状態遷移でも人手のメモでも無いので、機械的な `NOTE` として区別できる印を持たせる。
 * ⚠️ **T-09-09（`S-023` の履歴）への申し送り**: タイムラインはこの接頭辞で始まる `NOTE` を「下書きを更新（項目名）」として
 *    描き、人手のメモ（#47 の `NOTE`）と混ぜない。接頭辞と区切り（`,`）の出所はこの定数と `changedProposalFields` だけである。
 */
export const PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX = 'DRAFT_UPDATED:';

export type ProposalActionMeta = {
  readonly ipAddress: string | null;
};

export type ProposalWriteDeps = {
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: () => Date;
  readonly meta: ProposalActionMeta;
};

/** `withTenant` が `fn` に渡すクライアント（本モジュールが触る部分だけを `Pick` する）。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

// ============================================================================
// #36 `POST /api/proposals`
// ============================================================================

/**
 * `POST /api/proposals`（#36。`F-019` 処理①②④）。
 *
 * 手順は 1 トランザクション（`withTenant`）:
 *   ① 案件を読む（C4。見えなければ 404。取引先は自社に公開された案件にしか作れない）
 *   ② `createProposalDraft`（凍結 + `DRAFT` + `ProposalEvent` + `proposal.create`。台帳の行が見えなければ
 *      `ProposalDraftEngineerNotFoundError` → 404）
 * 🔴 `ownerPartnerCompanyId` は `createProposalDraft` が **ctx** から書く（リクエスト入力ではない）。
 * 🔴 `proposalRequestId` は常に `null`（経路 4 由来は #33 が作る。`schemas.ts` の注記）。
 */
export async function createProposal(
  ctx: AuthenticatedTenantCtx,
  body: CreateProposalBody,
  deps: ProposalWriteDeps,
): Promise<ProposalDraftResult> {
  const now = deps.now();
  return withTenant(ctx, async (db) => {
    const project = await db.project.findFirst({ where: { id: body.projectId }, select: { id: true } });
    if (project === null) throw new NotFoundError();

    return createProposalDraft(db, ctx, {
      projectId: project.id,
      engineerId: body.engineerId,
      proposalRequestId: null,
      recipient: { companyName: body.recipientCompanyName, email: body.recipientEmail },
      terms: {
        offeredUnitPrice: body.offeredUnitPrice,
        offeredStartDate: toDateOnly(body.offeredStartDate),
        workStyle: body.workStyle,
        subject: body.subject,
        body: body.body,
      },
      frozenAt: now,
      ipAddress: deps.meta.ipAddress,
    });
  });
}

// ============================================================================
// #37 `PATCH /api/proposals/{id}`
// ============================================================================

/** `#37` の応答（docs/05 §6.5 #37 の `{ id, contentHash }`）。 */
export type ProposalUpdatedView = {
  readonly id: string;
  /** 🔴 更新後の**現在の内容**のハッシュ（§11.5 ②。`computeProposalContentHash` の再計算）。 */
  readonly contentHash: string;
};

/** body のうち値が指定された（`undefined` でない）キー名。監査と `ProposalEvent.note` に載せる。 */
export function changedProposalFields(body: UpdateProposalBody): readonly (keyof UpdateProposalBody)[] {
  return UPDATE_PROPOSAL_FIELDS.filter((key) => body[key] !== undefined);
}

/**
 * 🔴 添付の版を母集団に照合する（`F-019 AC-3` / `F-011 AC-1`）。
 *    - 見えない（RLS の C3 で 0 件 = 他社の版 / 不存在）か、**この提案のエンジニアの版でない** → 404
 *      （区別しない。docs/05 §4.8。他人のエンジニアの版 ID を当てても存在を教えない）
 *    - `CLEAN` でない → 409 `SKILL_SHEET_NOT_ATTACHABLE`（「無視して添付」は無い）
 */
async function assertAttachableSkillSheet(
  db: Pick<TenantDb, 'skillSheet'>,
  engineerId: string,
  skillSheetId: string,
): Promise<void> {
  const sheet = await db.skillSheet.findFirst({
    where: { id: skillSheetId },
    select: { engineerId: true, scanStatus: true },
  });
  if (sheet === null || sheet.engineerId !== engineerId) throw new NotFoundError();
  if (sheet.scanStatus !== 'CLEAN') throw new SkillSheetNotAttachableError();
}

/**
 * `PATCH /api/proposals/{id}`（#37。`F-019` 処理④）。
 *
 * 手順は 1 トランザクション（`withTenant`）:
 *   ① 行を読む（C5。見えなければ 404）→ `canEditProposal`（作成者 / ホストの営業・管理者。外れたら 403）
 *   ② `DRAFT` でなければ 422 `PROPOSAL_NOT_EDITABLE`
 *   ③ 添付の変更（`null` を含む）は台帳が実行者に見える場合だけ（外れたら 403）→ 版を照合する（上記）
 *   ④ **CAS** `UPDATE … WHERE id = $1 AND state = 'DRAFT'`（0 件なら現在の状態を読み直して 422）
 *   ⑤ `engineer_snapshots.skill_sheet_id`（添付が指定されたときだけ）
 *   ⑥ `ProposalEvent(NOTE, DRAFT→DRAFT, note='DRAFT_UPDATED:…')` + `AuditLog(proposal.update, DRAFT_UPDATE)`
 *   ⑦ 内容のハッシュを再計算して返す（§11.5 ②）
 * 🔴 指定された項目が 0 個なら何も書かない（イベントも監査も残さない。ハッシュだけ返す）。
 * 🔴 監査は業務トランザクションの内側（`writeAuditLog`）。`withApiRoute` の `audit` を使わないのは、起きなかった
 *    更新（403 / 404 / 409 / 422）まで残るため（`gate.ts` と同じ判断）。
 */
export async function updateProposalDraft(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  body: UpdateProposalBody,
  deps: ProposalWriteDeps,
): Promise<ProposalUpdatedView> {
  const now = deps.now();
  return withTenant(ctx, async (db) => {
    const row = await db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, state: true, createdBy: true, engineerId: true },
    });
    if (row === null) throw new NotFoundError();
    // ① 🔴 行を読んでから認可する（ロールだけでは「他人の提案を書き換える」を止められない）。
    if (!canEditProposal(ctx, { createdBy: row.createdBy })) throw new ProposalEditForbiddenError();
    // ② 🔴 `DRAFT` のみ（状態遷移の拒否ではなく、動かせない状態での編集の拒否）。
    if (row.state !== 'DRAFT') throw new ProposalNotEditableError(row.state);

    const fields = changedProposalFields(body);
    if (fields.length === 0) {
      const unchanged = await computeProposalContentHash(db, row.id);
      if (unchanged === null) throw new NotFoundError();
      return { id: row.id, contentHash: unchanged };
    }

    // ③ 添付の照合。
    if (body.skillSheetId !== undefined) {
      // 🔴 添付の変更（外す `null` を含む）は**提案のエンジニアの台帳が実行者に見える場合に限る**
      //    （`readProposalEditor` の `ownedEngineerId` と同じ判定。レビュー指摘 T-09-01 NG-2）。
      //    ホストが取引先作成の `DRAFT` を開くと `skill_sheets` は C3 で 1 行も見えず、「外す」は通るのに
      //    「戻す」は 404 になる一方向の操作になっていた。台帳を持たない側に添付を触らせない。
      //    🔴 判定の順序: 認可（③）→ CAS（④）。ここで拒むときは行・凍結側・イベント・監査のどれも変えない。
      const owned = await db.engineer.findFirst({ where: { id: row.engineerId }, select: { id: true } });
      if (owned === null) throw new ProposalEditForbiddenError();
      // `null` = 添付なし（版の照合は要らない）。
      if (body.skillSheetId !== null) {
        await assertAttachableSkillSheet(db, row.engineerId, body.skillSheetId);
      }
    }

    // ④ CAS。🔴 `data` には指定された列だけを載せる（未指定 = 変更しない）。
    const updated = await db.proposal.updateMany({
      where: { id: row.id, state: 'DRAFT' },
      data: {
        ...(body.recipientCompanyName === undefined ? {} : { recipientCompanyName: body.recipientCompanyName }),
        ...(body.recipientEmail === undefined ? {} : { recipientEmail: body.recipientEmail }),
        ...(body.offeredUnitPrice === undefined ? {} : { offeredUnitPrice: body.offeredUnitPrice }),
        ...(body.offeredStartDate === undefined ? {} : { offeredStartDate: toDateOnly(body.offeredStartDate) }),
        ...(body.workStyle === undefined ? {} : { workStyle: body.workStyle }),
        ...(body.subject === undefined ? {} : { subject: body.subject }),
        ...(body.body === undefined ? {} : { body: body.body }),
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      // 読んでから今までの間にレビュー依頼（#39）が `GATE_RUNNING` へ進めた。現在の状態を読み直して 422。
      const current = await db.proposal.findUnique({ where: { id: row.id }, select: { state: true } });
      throw new ProposalNotEditableError(current?.state ?? row.state);
    }

    // ⑤ 添付（凍結コピー側の列。`ownerPartnerCompanyId` は継承トリガが親の値を保つ）。
    if (body.skillSheetId !== undefined) {
      const snapshot = await db.engineerSnapshot.updateMany({
        where: { proposalId: row.id },
        data: { skillSheetId: body.skillSheetId },
      });
      if (snapshot.count !== 1) {
        // 凍結コピーの無い `Proposal` は `createProposalDraft` の規律上存在しない（不変条件違反）。
        throw new InternalError(`engineer_snapshots が見つかりません（proposalId=${row.id}）。`);
      }
    }

    // ⑥ 履歴と監査（🔴 値を載せない。キー名だけ）。
    const fieldList = fields.join(',');
    await db.proposalEvent.create({
      data: {
        tenantId: ctx.tenantId,
        proposalId: row.id,
        kind: 'NOTE',
        fromState: 'DRAFT',
        toState: 'DRAFT',
        actorUserId: ctx.userId,
        note: `${PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX}${fieldList}`,
        ...(body.skillSheetId === undefined || body.skillSheetId === null ? {} : { attachmentKey: body.skillSheetId }),
        occurredAt: now,
      },
      select: { id: true },
    });
    await writeAuditLog(db, {
      action: PROPOSAL_AUDIT_ACTION_UPDATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Proposal',
      targetId: row.id,
      summary: { operation: PROPOSAL_AUDIT_OPERATIONS.draftUpdate, fields: fieldList },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    // ⑦ 🔴 同じトランザクションの中で、書いた内容から再計算する。
    const contentHash = await computeProposalContentHash(db, row.id);
    if (contentHash === null) throw new InternalError(`内容のハッシュを計算できません（proposalId=${row.id}）。`);
    return { id: row.id, contentHash };
  });
}

// ============================================================================
// `S-020` の読み取り
// ============================================================================

/** 添付できる版（`scanStatus='CLEAN'` の版だけ。`F-011 AC-1`）。🔴 台帳の現在値であり、view には混ぜない。 */
export type AttachableSkillSheetView = {
  readonly id: string;
  readonly version: number;
  /** ISO 8601。 */
  readonly uploadedAt: string;
};

export type ProposalEditorView = {
  readonly view: ProposalView;
  /** 🔴 立場として編集・レビュー依頼ができるか（`canEditProposal`）。状態は `view.state` で別に見る。 */
  readonly canEdit: boolean;
  /**
   * 添付の選択肢。🔴 母集団は `skill_sheets` の RLS（C3）—— ホストがパートナー作成の提案を開いたときは
   *    **0 件**になる（他社の台帳は読めない。添付を差し替えられるのは所有者だけ）。
   */
  readonly attachableSkillSheets: readonly AttachableSkillSheetView[];
  /**
   * 🔴 提案のエンジニアの台帳行が**実行者に見える**ときだけその ID（`S-008` への導線に使う）。見えなければ `null`
   *    （ホストがパートナー作成の提案を開いたとき）。値は `engineers` の RLS（C3）が決め、**台帳の現在値は読まない**
   *    （存在の確認だけ）。`ProposalView` には入れない（凍結側だけの型を保つ）。
   */
  readonly ownedEngineerId: string | null;
};

/**
 * 🔴 `proposals` の `select`。`ProposalViewRow` の型がこの集合を固定する（`engineerId` / `createdBy` は view に
 *    渡さず、認可と添付の照合にだけ使う）。
 */
const PROPOSAL_VIEW_SELECT = {
  id: true,
  state: true,
  proposalRequestId: true,
  recipientCompanyName: true,
  recipientEmail: true,
  offeredUnitPrice: true,
  offeredStartDate: true,
  workStyle: true,
  subject: true,
  body: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SNAPSHOT_VIEW_SELECT = {
  frozenAt: true,
  displayName: true,
  affiliationLabel: true,
  skills: true,
  careers: true,
  unitPriceMin: true,
  unitPriceMax: true,
  availableFrom: true,
  prefecture: true,
  remoteMode: true,
  skillSheetId: true,
} as const;

async function readProjectRef(db: Pick<TenantDb, 'project'>, projectId: string): Promise<ProposalProjectRef | null> {
  // 🔴 リレーション `select` ではなく別クエリ: 取引先では `projects` の C4 が行を消すため、必須リレーションが
  //    `null` になると Prisma が例外を投げる（`proposal-requests/service.ts` と同じ判断）。
  const project = await db.project.findFirst({ where: { id: projectId }, select: { id: true, name: true } });
  return project === null ? null : { id: project.id, name: project.name };
}

/**
 * 🔴 `ProposalView` の外に置く、行の**承認記録**（docs/05 §3.6 `approvedBy` / `approvedBySystem` / `approvedAt`。
 *    `F-021 AC-5`「承認者が `system` として記録される」）。`S-021` が承認者欄を描くために読む。view に混ぜないのは、
 *    `ProposalView` が「凍結情報 + 内容」の型であり、承認の事実は `S-020` の応答に要らないため。
 */
export type ProposalApprovalRecordRow = {
  readonly approvedBy: string | null;
  readonly approvedBySystem: boolean;
  readonly approvedAt: Date | null;
};

/** `readProposalViewInTx` の戻り値（view + 認可・承認記録に要る行の値）。🔴 `engineerId` / `createdBy` は view に渡さない。 */
export type ProposalViewInTx = {
  readonly view: ProposalView;
  readonly createdBy: string;
  readonly engineerId: string;
  readonly approval: ProposalApprovalRecordRow;
};

/**
 * 提案 1 件の view を**開いているトランザクションの中で**読む（`S-020` と `S-021` の共通部。T-09-03 で切り出した）。
 * 🔴 エンジニアの情報は `engineer_snapshots` からだけ読む（`F-019 AC-1`）。母集団は `proposals` の RLS（C5）。
 * 🔴 応答の型は所属で分岐する（`HostProposalView` / `PartnerProposalView`）。分岐の出所は `ctx.partnerCompanyId`。
 * @returns 見えなければ `null`（呼び出し側は 404 に畳む。docs/05 §4.8）。
 */
export async function readProposalViewInTx(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'proposal' | 'engineerSnapshot' | 'project' | 'partnerCompany'>,
  proposalId: string,
): Promise<ProposalViewInTx | null> {
  const row = await db.proposal.findUnique({
    where: { id: proposalId },
    select: {
      ...PROPOSAL_VIEW_SELECT,
      ownerPartnerCompanyId: true,
      projectId: true,
      engineerId: true,
      createdBy: true,
      approvedBy: true,
      approvedBySystem: true,
      approvedAt: true,
    },
  });
  if (row === null) return null;
  const snapshot = await db.engineerSnapshot.findUnique({ where: { proposalId: row.id }, select: SNAPSHOT_VIEW_SELECT });
  if (snapshot === null) {
    throw new InternalError(`engineer_snapshots が見つかりません（proposalId=${row.id}）。`);
  }
  const contentHash = await computeProposalContentHash(db, row.id);
  if (contentHash === null) return null;

  const project = await readProjectRef(db, row.projectId);
  const viewRow: ProposalViewRow = {
    id: row.id,
    state: row.state,
    proposalRequestId: row.proposalRequestId,
    recipientCompanyName: row.recipientCompanyName,
    recipientEmail: row.recipientEmail,
    offeredUnitPrice: row.offeredUnitPrice,
    offeredStartDate: row.offeredStartDate,
    workStyle: row.workStyle,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  const deps = { project, snapshot, contentHash };

  const view: ProposalView =
    ctx.partnerCompanyId === null
      ? toHostProposalView(viewRow, deps, await readOwner(db, row.ownerPartnerCompanyId))
      : toPartnerProposalView(viewRow, deps);

  return {
    view,
    createdBy: row.createdBy,
    engineerId: row.engineerId,
    approval: { approvedBy: row.approvedBy, approvedBySystem: row.approvedBySystem, approvedAt: row.approvedAt },
  };
}

/**
 * `S-020`（編集）が読む経路。🔴 エンジニアの情報は `engineer_snapshots` からだけ読む（`F-019 AC-1`）。
 *
 * 🔴 **境界外・不存在はどちらも 404**（docs/05 §4.8）。母集団は `proposals` の RLS（C5）。
 * 🔴 応答の型は所属で分岐する（`HostProposalView` / `PartnerProposalView`）。分岐の出所は `ctx.partnerCompanyId`。
 */
export async function readProposalEditor(ctx: AuthenticatedTenantCtx, proposalId: string): Promise<ProposalEditorView> {
  return withTenant(ctx, async (db) => {
    const read = await readProposalViewInTx(ctx, db, proposalId);
    if (read === null) throw new NotFoundError();
    const { view, createdBy, engineerId } = read;

    // 🔴 添付の選択肢（台帳の現在値）。view とは別に返す。母集団は `skill_sheets` の C3。
    const sheets = await db.skillSheet.findMany({
      where: { engineerId, scanStatus: 'CLEAN' },
      select: { id: true, version: true, uploadedAt: true },
      orderBy: [{ version: 'desc' }],
    });

    // 🔴 存在の確認だけ（`select: { id }`）。値を view に混ぜない。
    const owned = await db.engineer.findFirst({ where: { id: engineerId }, select: { id: true } });

    return {
      view,
      canEdit: canEditProposal(ctx, { createdBy }),
      attachableSkillSheets: sheets.map((sheet) => ({
        id: sheet.id,
        version: sheet.version,
        uploadedAt: sheet.uploadedAt.toISOString(),
      })),
      ownedEngineerId: owned?.id ?? null,
    };
  });
}

/** 作成した会社（ホスト向け view の `owner`）。社名は `partner_companies`（C5。ホストは全件を読める）。 */
async function readOwner(
  db: Pick<TenantDb, 'partnerCompany'>,
  ownerPartnerCompanyId: string | null,
): Promise<HostProposalOwnerView> {
  if (ownerPartnerCompanyId === null) return { kind: 'HOST' };
  const owner = await db.partnerCompany.findFirst({ where: { id: ownerPartnerCompanyId }, select: { name: true } });
  // FK（Restrict）が保証しているので到達しない。握り潰さず落とす。
  if (owner === null) throw new InternalError(`partner_companies が見つかりません（id=${ownerPartnerCompanyId}）。`);
  return { kind: 'PARTNER', partnerCompanyName: owner.name };
}

// ============================================================================
// `S-020`（新規）の対象の読み取り
// ============================================================================

/** 新規作成画面が凍結の予告に出す、台帳の**現在値**（作成前なので凍結側はまだ無い）。 */
export type ProposalCreationTargetView = {
  readonly project: ProposalProjectRef;
  readonly engineer: {
    readonly id: string;
    readonly displayName: string;
    readonly affiliationLabel: string | null;
    /** 辞書名（`skillId` 昇順）。 */
    readonly skillNames: readonly string[];
    /** 凍結される経歴の行数（0 行は正常。`F-008 AC-5`。画面は注意を出すだけで作成を止めない）。 */
    readonly careerCount: number;
    /** 凍結される版（`is_latest = true` は CHECK により `CLEAN` に限られる）。無ければ `null`。 */
    readonly latestCleanSkillSheet: { readonly id: string; readonly version: number } | null;
  };
};

/**
 * `/proposals/new?projectId=&engineerId=` が読む経路。
 * 🔴 母集団は `projects` の C4 / `engineers` の C3。**どちらか一方でも見えなければ 404**（区別しない。§4.8）。
 *    取引先は他社のエンジニアを、ホストは取引先のエンジニアを、この画面から指定できない。
 * 🔴 経歴は `readEngineerCareers`（台帳の読み取りの 1 実装）で読み、**行数だけ**を返す。
 */
export async function readProposalCreationTarget(
  ctx: AuthenticatedTenantCtx,
  target: { readonly projectId: string; readonly engineerId: string },
): Promise<ProposalCreationTargetView> {
  return withTenant(ctx, async (db) => {
    const project = await readProjectRef(db, target.projectId);
    if (project === null) throw new NotFoundError();
    const engineer = await db.engineer.findFirst({
      where: { id: target.engineerId },
      select: { id: true, displayName: true, affiliationLabel: true },
    });
    if (engineer === null) throw new NotFoundError();

    const skills = await db.engineerSkill.findMany({
      where: { engineerId: engineer.id },
      select: { skill: { select: { name: true } } },
      orderBy: [{ skillId: 'asc' }],
    });
    const careers = await readEngineerCareers(db, engineer.id);
    const latest = await db.skillSheet.findFirst({
      where: { engineerId: engineer.id, isLatest: true, scanStatus: 'CLEAN' },
      select: { id: true, version: true },
    });

    return {
      project,
      engineer: {
        id: engineer.id,
        displayName: engineer.displayName,
        affiliationLabel: engineer.affiliationLabel,
        skillNames: skills.map((row) => row.skill.name),
        careerCount: careers.length,
        latestCleanSkillSheet: latest === null ? null : { id: latest.id, version: latest.version },
      },
    };
  });
}
