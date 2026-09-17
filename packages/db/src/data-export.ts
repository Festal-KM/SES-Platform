// packages/db/src/data-export.ts
// 🔴 `CLOSING` 中の返却（docs/05 §6.7 #77 / #78 / §9.6 `export.generate` / docs/02 `F-064 AC-5`〜`AC-8` / docs/04 §S-042）。T-10-09。
//
// ============================================================================
// 🔴 二重境界（`F-064 AC-6`）は**この 1 実装**で成立する
// ============================================================================
// 返却データの読み出し（`readClosingReturnDataset`）は `runInTenantTransaction`（= `withTenant` と同じ RLS + Prisma 拡張）で
// 行う。**エクスポートだけ別の読み出しを書かない。** ホスト文脈（ジョブの `systemTenantCtx`。`partner_company_id = ''`）では
//   - `engineers` / `engineer_skills` / `engineer_careers` / `skill_sheets`（C3 OWNER_SCOPED）… **自社の行だけ**
//   - `proposals` / `engineer_snapshots` / `proposal_events`（越境経路 2。ホストは全行）… 取引先が持ち込んだエンジニアの
//     実名は **`Proposal` の凍結コピー（`engineer_snapshots`）にだけ**現れる
//   - `projects` / `assignments` / `partner_companies`（C2 HOST_ONLY）… 全行
// が読める。`where` にテナント・パートナーを足さない（母集団は RLS が決める。docs/05 §4.8）。
// 🔴 削除スコープ（`app.purge_scope`）は**使わない**。返却は利用者に見える範囲の複製であり、削除の到達範囲ではない。
//
// ============================================================================
// 🔴 `DataExportRequest.status` の CAS
// ============================================================================
//   QUEUED ──`export.generate` が claim──> RUNNING ─┬─ 成功 ─> READY（`objectKey` / `readyAt` / `expiresAt`）
//                                                  └─ 失敗 ─> FAILED
//   READY ──`expiresAt` 超過を #78 が観測──> EXPIRED（410）
// `attempts: 2` の 2 度目は `QUEUED → RUNNING` が 0 件で `NOT_QUEUED` になり、生成を繰り返さない。

import { Prisma } from '@prisma/client';
import { tenantMachine, type ClosingReturnDataset, type TenantLifecycleState } from '@ses/domain';
import { writeAuditLog, type AuditSummary } from './audit.js';
import type { AuthenticatedTenantCtx, SystemTenantCtx } from './context.js';
import type { DataExportKind, DataExportStatus } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

/** docs/05 §16.1。`data_export.create` は `*.create`（`S-041` の CREATE_UPDATE_DELETE）、`data_export.download` は DL の記録。 */
export const DATA_EXPORT_AUDIT_ACTIONS = {
  create: 'data_export.create',
  download: 'data_export.download',
} as const;

/** #77 の `kind`。Phase 1 は `CLOSING_RETURN` だけ（`OPERATIONAL` は `F-052`。Phase 3）。 */
export const CLOSING_RETURN_EXPORT_KIND = 'CLOSING_RETURN' satisfies DataExportKind;

/** #77 の `scope`（docs/04 §S-042「対象範囲: エンジニア台帳・案件・提案履歴・稼働」。Phase 1 は固定で全部）。 */
export const CLOSING_RETURN_SCOPE = ['ENGINEERS', 'PROJECTS', 'PROPOSALS', 'ASSIGNMENTS'] as const;
export type ClosingReturnScope = (typeof CLOSING_RETURN_SCOPE)[number];

/** 🔴 `CLOSING` 以外のテナントで返却を依頼した（`F-064 AC-5` の前提。API 境界は 422）。 */
export class DataExportNotAllowedError extends Error {
  constructor(readonly lifecycleState: TenantLifecycleState) {
    super(`返却は CLOSING のテナントだけが依頼できます（現在: ${lifecycleState}。docs/02 F-064 AC-5）。`);
    this.name = 'DataExportNotAllowedError';
  }
}

function scopeOf(ctx: AuthenticatedTenantCtx) {
  return { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId };
}

async function readLifecycleState(tx: TenantTransactionClient, tenantId: string): Promise<TenantLifecycleState> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { lifecycleState: true } });
  if (tenant === null) throw new Error('data-export: テナント行を読めませんでした（文脈が不正です）。');
  if (!tenantMachine.isState(tenant.lifecycleState)) throw new Error(`data-export: 不明な契約状態です（${tenant.lifecycleState}）。`);
  return tenant.lifecycleState;
}

export type TenantRetentionState = {
  readonly lifecycleState: TenantLifecycleState;
  /** `CLOSING` に入った時刻（`S-042` の「あと N 日」の起点）。`CLOSING` 以外では `null` でありうる。 */
  readonly closingEnteredAt: Date | null;
};

/**
 * 自テナントの契約状態と `closing_entered_at`（`S-042` の分岐。`ctx.lifecycleState` はセッション確立時の値なので行を読む）。
 * 🔴 `AuthenticatedTenantCtx` で読める（`readTenantClosingSchedule` は `HostTenantCtx` 専用で、`apps/web` は `requireHost` を
 *    限られたルートでしか呼べない。docs/05 §17.2 #20）。名前は返さない（`S-042` に要らない）。
 */
export async function readTenantRetentionState(ctx: AuthenticatedTenantCtx): Promise<TenantRetentionState> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { lifecycleState: true, closingEnteredAt: true },
    });
    if (tenant === null) throw new Error('data-export: テナント行を読めませんでした（文脈が不正です）。');
    if (!tenantMachine.isState(tenant.lifecycleState)) throw new Error(`data-export: 不明な契約状態です（${tenant.lifecycleState}）。`);
    return { lifecycleState: tenant.lifecycleState, closingEnteredAt: tenant.closingEnteredAt };
  });
}

export type DataExportRequestView = {
  readonly id: string;
  readonly kind: DataExportKind;
  readonly status: DataExportStatus;
  readonly requestedAt: Date;
  readonly readyAt: Date | null;
  readonly expiresAt: Date | null;
};

export type CreateDataExportInput = {
  readonly now: Date;
  /** 監査ログに残す実行環境。 */
  readonly ipAddress: string | null;
};

/**
 * #77。`DataExportRequest(QUEUED)` を作り `AuditLog(data_export.create)` を同じトランザクションで書く（`F-064 AC-8`）。
 * 🔴 `CLOSING` 以外は `DataExportNotAllowedError`（422）。**判定は DB の行**で行う（`ctx.lifecycleState` はセッション確立時の値）。
 * 🔴 `scope` は Phase 1 では固定（`CLOSING_RETURN_SCOPE`）。入力から受け取らない。
 */
export async function createDataExportRequest(ctx: AuthenticatedTenantCtx, input: CreateDataExportInput): Promise<DataExportRequestView> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const lifecycleState = await readLifecycleState(tx, ctx.tenantId);
    if (lifecycleState !== 'CLOSING') throw new DataExportNotAllowedError(lifecycleState);
    const id = uuidV7(input.now);
    const created = await tx.dataExportRequest.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        kind: CLOSING_RETURN_EXPORT_KIND,
        scope: [...CLOSING_RETURN_SCOPE],
        status: 'QUEUED',
        requestedBy: ctx.userId,
        requestedAt: input.now,
      },
      select: { id: true, kind: true, status: true, requestedAt: true, readyAt: true, expiresAt: true },
    });
    await writeAuditLog(tx, {
      action: DATA_EXPORT_AUDIT_ACTIONS.create,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'DataExportRequest',
      targetId: id,
      summary: { kind: CLOSING_RETURN_EXPORT_KIND, scope: CLOSING_RETURN_SCOPE.join(',') },
      ipAddress: input.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return toView(created);
  });
}

type RequestRow = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly requestedAt: Date;
  readonly readyAt: Date | null;
  readonly expiresAt: Date | null;
};

function toView(row: RequestRow): DataExportRequestView {
  return {
    id: row.id,
    kind: row.kind as DataExportKind,
    status: row.status as DataExportStatus,
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
  };
}

/** `S-042` セクション 3 / 4（生成済み・生成中・失敗・期限切れの一覧。新しい順）。 */
export async function listDataExportRequests(ctx: AuthenticatedTenantCtx): Promise<readonly DataExportRequestView[]> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const rows = await tx.dataExportRequest.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, kind: true, status: true, requestedAt: true, readyAt: true, expiresAt: true },
    });
    return rows.map(toView);
  });
}

export type DataExportClaim =
  | { readonly kind: 'CLAIMED'; readonly exportKind: DataExportKind }
  | { readonly kind: 'NOT_QUEUED'; readonly status: DataExportStatus }
  | { readonly kind: 'NOT_FOUND' };

/** `export.generate` の入口。`QUEUED → RUNNING` の CAS（2 度目は `NOT_QUEUED`）。 */
export async function claimDataExportRun(ctx: SystemTenantCtx, exportRequestId: string): Promise<DataExportClaim> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const updated = await tx.dataExportRequest.updateMany({
      where: { id: exportRequestId, tenantId: ctx.tenantId, status: 'QUEUED' },
      data: { status: 'RUNNING' },
    });
    const row = await tx.dataExportRequest.findUnique({
      where: { id: exportRequestId },
      select: { kind: true, status: true },
    });
    if (row === null) return { kind: 'NOT_FOUND' };
    if (updated.count === 1) return { kind: 'CLAIMED', exportKind: row.kind as DataExportKind };
    return { kind: 'NOT_QUEUED', status: row.status as DataExportStatus };
  });
}

export type DataExportSettlement =
  | { readonly status: 'READY'; readonly objectKey: string; readonly readyAt: Date; readonly expiresAt: Date }
  | { readonly status: 'FAILED' };

/** `RUNNING → READY | FAILED` の CAS（0 件なら例外 = 誰かが先に確定させた）。 */
export async function settleDataExport(ctx: SystemTenantCtx, exportRequestId: string, settlement: DataExportSettlement): Promise<void> {
  await runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const updated = await tx.dataExportRequest.updateMany({
      where: { id: exportRequestId, tenantId: ctx.tenantId, status: 'RUNNING' },
      data:
        settlement.status === 'READY'
          ? { status: 'READY', objectKey: settlement.objectKey, readyAt: settlement.readyAt, expiresAt: settlement.expiresAt }
          : { status: 'FAILED' },
    });
    if (updated.count !== 1) {
      throw new Error(`data-export: DataExportRequest(${exportRequestId}) を RUNNING から ${settlement.status} に確定できませんでした。`);
    }
  });
}

export type DataExportDownloadTarget =
  | { readonly kind: 'READY'; readonly objectKey: string }
  /** `expiresAt` を過ぎていた（この呼び出しで `EXPIRED` に確定させた）。API 境界は 410。 */
  | { readonly kind: 'EXPIRED' }
  /** `QUEUED` / `RUNNING` / `FAILED` / `EXPIRED`。API 境界は 409。 */
  | { readonly kind: 'NOT_READY'; readonly status: DataExportStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * #78 の対象の確定（`issueDownloadUrl` の `loadSubject` から呼ぶ。同じトランザクション）。
 * 🔴 `READY` かつ `expiresAt > now` のときだけ `objectKey` を返す。超過は **CAS で `EXPIRED` に確定**させてから返す
 *    （`objectKey` は残す = `PURGED` で実体ごと消す対象。docs/05 §14.1）。
 */
export async function resolveDataExportDownload(
  tx: Pick<TenantTransactionClient, 'dataExportRequest'>,
  input: { readonly tenantId: string; readonly exportRequestId: string; readonly now: Date },
): Promise<DataExportDownloadTarget> {
  const row = await tx.dataExportRequest.findUnique({
    where: { id: input.exportRequestId },
    select: { status: true, objectKey: true, expiresAt: true },
  });
  if (row === null) return { kind: 'NOT_FOUND' };
  if (row.status !== 'READY') return { kind: 'NOT_READY', status: row.status as DataExportStatus };
  if (row.expiresAt === null || row.expiresAt.getTime() <= input.now.getTime()) {
    await tx.dataExportRequest.updateMany({
      where: { id: input.exportRequestId, tenantId: input.tenantId, status: 'READY' },
      data: { status: 'EXPIRED' },
    });
    return { kind: 'EXPIRED' };
  }
  // 🔴 `READY` なのに実体のキーが無い = `PURGED` で実体ごと消えた（`PURGE_SPEC` の `data_export_requests`）。410 と同じ扱い。
  if (row.objectKey === null) return { kind: 'EXPIRED' };
  return { kind: 'READY', objectKey: row.objectKey };
}

/** `AuditLog(data_export.download)` の `summary`（`F-064 AC-8`。内容を載せない）。 */
export function dataExportDownloadSummary(exportRequestId: string): AuditSummary {
  return { kind: CLOSING_RETURN_EXPORT_KIND, exportRequestId };
}

// ---------------------------------------------------------------------------
// 返却データの読み出し（🔴 `withTenant` と同じ型 = RLS + Prisma 拡張。エクスポートだけ別の読み出しを書かない）
// ---------------------------------------------------------------------------

function isoDateTime(value: Date): string {
  return value.toISOString();
}

function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

type FrozenSkillJson = { readonly name?: unknown; readonly years?: unknown; readonly level?: unknown };
type FrozenCareerJson = {
  readonly periodFrom?: unknown;
  readonly periodTo?: unknown;
  readonly role?: unknown;
  readonly description?: unknown;
  readonly technologies?: unknown;
};

function asArray(value: Prisma.JsonValue): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * 🔴 返却データセット（`F-064 AC-5` / `AC-6`）。**`SystemTenantCtx`（ホスト）でしか呼べない**（型）。
 *    依頼できるのはホストの `OWNER` / `ADMIN` だけであり（#77）、ジョブのホスト文脈と読める範囲が一致する。
 */
export async function readClosingReturnDataset(ctx: SystemTenantCtx): Promise<ClosingReturnDataset> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const [engineers, engineerSkills, engineerCareers, projects, projectRequirements, partnerCompanies, proposals, snapshots, proposalEvents, assignments] =
      await Promise.all([
        tx.engineer.findMany({ orderBy: { id: 'asc' } }),
        tx.engineerSkill.findMany({ orderBy: { id: 'asc' }, include: { skill: { select: { name: true } } } }),
        tx.engineerCareer.findMany({ orderBy: [{ engineerId: 'asc' }, { periodFrom: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
        tx.project.findMany({ orderBy: { id: 'asc' } }),
        tx.projectRequirement.findMany({ orderBy: { id: 'asc' }, include: { skill: { select: { name: true } } } }),
        tx.partnerCompany.findMany({ orderBy: { id: 'asc' } }),
        tx.proposal.findMany({ orderBy: { id: 'asc' } }),
        tx.engineerSnapshot.findMany({ orderBy: { proposalId: 'asc' } }),
        tx.proposalEvent.findMany({ orderBy: [{ proposalId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }] }),
        tx.assignment.findMany({ orderBy: { id: 'asc' } }),
      ]);
    return {
      engineers: engineers.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        affiliationLabel: r.affiliationLabel,
        availability: r.availability,
        availableFrom: isoDate(r.availableFrom),
        unitPriceMin: decimalText(r.unitPriceMin),
        unitPriceMax: decimalText(r.unitPriceMax),
        prefecture: r.prefecture,
        city: r.city,
        remoteMode: r.remoteMode,
        preferenceNote: r.preferenceNote,
        contactEmail: r.contactEmail,
        contactPhone: r.contactPhone,
        birthDate: isoDate(r.birthDate),
        createdAt: isoDateTime(r.createdAt),
        updatedAt: isoDateTime(r.updatedAt),
      })),
      engineerSkills: engineerSkills.map((r) => ({
        engineerId: r.engineerId,
        skillName: r.skill.name,
        yearsOfExperience: r.yearsOfExperience.toString(),
        level: r.level,
        source: r.source,
      })),
      engineerCareers: engineerCareers.map((r) => ({
        engineerId: r.engineerId,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        role: r.role,
        description: r.description,
        technologies: r.technologies,
        source: r.source,
      })),
      projects: projects.map((r) => ({
        id: r.id,
        name: r.name,
        endClientName: r.endClientName,
        internalUnitPrice: decimalText(r.internalUnitPrice),
        publicSummary: r.publicSummary,
        unitPriceMin: decimalText(r.unitPriceMin),
        unitPriceMax: decimalText(r.unitPriceMax),
        startDate: isoDate(r.startDate),
        prefecture: r.prefecture,
        remoteMode: r.remoteMode,
        headcount: r.headcount,
        status: r.status,
        createdAt: isoDateTime(r.createdAt),
        updatedAt: isoDateTime(r.updatedAt),
      })),
      projectRequirements: projectRequirements.map((r) => ({
        projectId: r.projectId,
        kind: r.kind,
        skillName: r.skill?.name ?? null,
        freeText: r.freeText,
        requiredYears: decimalText(r.requiredYears),
      })),
      partnerCompanies: partnerCompanies.map((r) => ({
        id: r.id,
        name: r.name,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        suspendedAt: r.suspendedAt === null ? null : isoDateTime(r.suspendedAt),
        invitedAt: isoDateTime(r.invitedAt),
      })),
      proposals: proposals.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        engineerId: r.engineerId,
        ownerPartnerCompanyId: r.ownerPartnerCompanyId,
        proposalRequestId: r.proposalRequestId,
        state: r.state,
        recipientCompanyName: r.recipientCompanyName,
        recipientEmail: r.recipientEmail,
        offeredUnitPrice: decimalText(r.offeredUnitPrice),
        offeredStartDate: isoDate(r.offeredStartDate),
        workStyle: r.workStyle,
        subject: r.subject,
        body: r.body,
        approvedAt: r.approvedAt === null ? null : isoDateTime(r.approvedAt),
        submittedAt: r.submittedAt === null ? null : isoDateTime(r.submittedAt),
        createdAt: isoDateTime(r.createdAt),
        updatedAt: isoDateTime(r.updatedAt),
      })),
      engineerSnapshots: snapshots.map((r) => ({
        proposalId: r.proposalId,
        displayName: r.displayName,
        affiliationLabel: r.affiliationLabel,
        unitPriceMin: decimalText(r.unitPriceMin),
        unitPriceMax: decimalText(r.unitPriceMax),
        availableFrom: isoDate(r.availableFrom),
        prefecture: r.prefecture,
        remoteMode: r.remoteMode,
        frozenAt: isoDateTime(r.frozenAt),
      })),
      engineerSnapshotSkills: snapshots.flatMap((r) =>
        asArray(r.skills).map((skill) => {
          const s = skill as FrozenSkillJson;
          return { proposalId: r.proposalId, skillName: text(s.name), years: nullableNumber(s.years) ?? 0, level: nullableNumber(s.level) };
        }),
      ),
      engineerSnapshotCareers: snapshots.flatMap((r) =>
        asArray(r.careers).map((career) => {
          const c = career as FrozenCareerJson;
          return {
            proposalId: r.proposalId,
            periodFrom: text(c.periodFrom),
            periodTo: nullableText(c.periodTo),
            role: text(c.role),
            description: text(c.description),
            technologies: text(c.technologies),
          };
        }),
      ),
      proposalEvents: proposalEvents.map((r) => ({
        proposalId: r.proposalId,
        kind: r.kind,
        fromState: r.fromState,
        toState: r.toState,
        actorUserId: r.actorUserId,
        note: r.note,
        occurredAt: isoDateTime(r.occurredAt),
      })),
      assignments: assignments.map((r) => ({
        id: r.id,
        engineerId: r.engineerId,
        projectId: r.projectId,
        proposalId: r.proposalId,
        counterpartyPartnerCompanyId: r.counterpartyPartnerCompanyId,
        state: r.state,
        startDate: isoDate(r.startDate) ?? '',
        endDate: isoDate(r.endDate),
        actualLeaveDate: isoDate(r.actualLeaveDate),
        unitPrice: decimalText(r.unitPrice),
        reviewOpenedAt: r.reviewOpenedAt === null ? null : isoDateTime(r.reviewOpenedAt),
      })),
    };
  });
}
