// packages/domain/src/export/closing-return.ts
// 🔴 返却データ（`CLOSING` 中の CSV 返却。`F-064 AC-5` / `AC-6` / docs/04 §S-042 / docs/05 §9.6 `export.generate`）の
//    **ファイル一覧と列の契約**。T-10-09。
//
// ============================================================================
// 🔴 何を固定するか
// ============================================================================
//   - ファイル名と列の並びは**この 1 箇所**にあり、`closing-return.test.ts` のスナップショットが固定する
//     （列が 1 つ増減したら落ちる。返却データは顧客がそのまま保管する成果物であり、版ごとに形が揺れてはならない）。
//   - 対象範囲は docs/04 §S-042「エンジニア台帳・案件・提案履歴・稼働」+ 取引先の一覧（ID の解釈に要る自社の台帳）。
//   - 🔴 **経歴は別ファイル**（`engineer_careers.csv` = 1 行 1 経歴。`engineer_id` で結合。T-09-12 / docs/05 §9.6）。
//     凍結コピー（`engineer_snapshots.careers` / `.skills`）も同じ理由で別ファイルに展開する（1 セルに JSON を詰めない）。
//   - 🔴 **匿名候補の CSV は存在しない**（`F-008 AC-7` / `BR-55`）。匿名候補は自社データではなく、返却の対象に
//     そもそも含まれない。「経歴の列を 1 つも作らない」は、ファイルそのものが無いことで成立する。
//
// ============================================================================
// 🔴 二重境界（`F-064 AC-6`）は**この層では判定しない**
// ============================================================================
// ここが受け取る `ClosingReturnDataset` は、`packages/db` が **RLS + Prisma 拡張（`withTenant` と同じ型）** で
// 読んだ結果である。ホストの文脈では `engineers`（C3 OWNER_SCOPED）に自社の行しか無く、取引先が持ち込んだ
// エンジニアは `Proposal` の凍結コピー（`engineer_snapshots`。越境経路 2）としてだけ現れる。この層は
// 「読めた行を CSV にする」だけであり、行を選ばない（選ぶ層を 2 つ作ると片方が緩む）。

import { encodeCsv, type CsvCell } from './csv.js';
import { encodeUtf8 } from './utf8.js';
import { buildZipArchive, type ZipEntry } from './zip.js';

/** ISO 8601 の文字列（`Date` は `packages/db` が文字列にしてから渡す）。 */
export type IsoDateTime = string;
/** `YYYY-MM-DD`。 */
export type IsoDate = string;
/** 十進の文字列（単価。`Decimal` を数値に丸めない）。 */
export type DecimalText = string;

export type ReturnEngineerRow = {
  readonly id: string;
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly availability: string;
  readonly availableFrom: IsoDate | null;
  readonly unitPriceMin: DecimalText | null;
  readonly unitPriceMax: DecimalText | null;
  readonly prefecture: string | null;
  readonly city: string | null;
  readonly remoteMode: string | null;
  readonly preferenceNote: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly birthDate: IsoDate | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
};

export type ReturnEngineerSkillRow = {
  readonly engineerId: string;
  readonly skillName: string;
  readonly yearsOfExperience: DecimalText;
  readonly level: number | null;
  readonly source: string;
};

export type ReturnEngineerCareerRow = {
  readonly engineerId: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  readonly source: string;
};

export type ReturnProjectRow = {
  readonly id: string;
  readonly name: string;
  readonly endClientName: string | null;
  readonly internalUnitPrice: DecimalText | null;
  readonly publicSummary: string | null;
  readonly unitPriceMin: DecimalText | null;
  readonly unitPriceMax: DecimalText | null;
  readonly startDate: IsoDate | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly headcount: number;
  readonly status: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
};

export type ReturnProjectRequirementRow = {
  readonly projectId: string;
  readonly kind: string;
  readonly skillName: string | null;
  readonly freeText: string | null;
  readonly requiredYears: DecimalText | null;
};

export type ReturnPartnerCompanyRow = {
  readonly id: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly suspendedAt: IsoDateTime | null;
  readonly invitedAt: IsoDateTime;
};

export type ReturnProposalRow = {
  readonly id: string;
  readonly projectId: string;
  /** 🔴 不透明な ID。取引先が持ち込んだエンジニアなら `engineers.csv` に行は無く、`engineer_snapshots.csv` にだけ現れる。 */
  readonly engineerId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly proposalRequestId: string | null;
  readonly state: string;
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  readonly offeredUnitPrice: DecimalText | null;
  readonly offeredStartDate: IsoDate | null;
  readonly workStyle: string | null;
  readonly subject: string | null;
  readonly body: string | null;
  readonly approvedAt: IsoDateTime | null;
  readonly submittedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
};

export type ReturnEngineerSnapshotRow = {
  readonly proposalId: string;
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly unitPriceMin: DecimalText | null;
  readonly unitPriceMax: DecimalText | null;
  readonly availableFrom: IsoDate | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly frozenAt: IsoDateTime;
};

export type ReturnEngineerSnapshotSkillRow = {
  readonly proposalId: string;
  readonly skillName: string;
  readonly years: number;
  readonly level: number | null;
};

export type ReturnEngineerSnapshotCareerRow = {
  readonly proposalId: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

export type ReturnProposalEventRow = {
  readonly proposalId: string;
  readonly kind: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly actorUserId: string | null;
  readonly note: string | null;
  readonly occurredAt: IsoDateTime;
};

export type ReturnAssignmentRow = {
  readonly id: string;
  readonly engineerId: string;
  readonly projectId: string;
  readonly proposalId: string | null;
  readonly counterpartyPartnerCompanyId: string | null;
  readonly state: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate | null;
  readonly actualLeaveDate: IsoDate | null;
  readonly unitPrice: DecimalText | null;
  readonly reviewOpenedAt: IsoDateTime | null;
};

/** `packages/db` が二重境界の内側で読んだ行（この層は選ばない）。 */
export type ClosingReturnDataset = {
  readonly engineers: readonly ReturnEngineerRow[];
  readonly engineerSkills: readonly ReturnEngineerSkillRow[];
  readonly engineerCareers: readonly ReturnEngineerCareerRow[];
  readonly projects: readonly ReturnProjectRow[];
  readonly projectRequirements: readonly ReturnProjectRequirementRow[];
  readonly partnerCompanies: readonly ReturnPartnerCompanyRow[];
  readonly proposals: readonly ReturnProposalRow[];
  readonly engineerSnapshots: readonly ReturnEngineerSnapshotRow[];
  readonly engineerSnapshotSkills: readonly ReturnEngineerSnapshotSkillRow[];
  readonly engineerSnapshotCareers: readonly ReturnEngineerSnapshotCareerRow[];
  readonly proposalEvents: readonly ReturnProposalEventRow[];
  readonly assignments: readonly ReturnAssignmentRow[];
};

type FileSpec<K extends keyof ClosingReturnDataset> = {
  readonly name: `${string}.csv`;
  readonly columns: readonly string[];
  readonly source: K;
  readonly cells: (row: ClosingReturnDataset[K][number]) => readonly CsvCell[];
};

function file<K extends keyof ClosingReturnDataset>(spec: FileSpec<K>): FileSpec<K> {
  return spec;
}

/**
 * 🔴 返却ファイルの契約（名前・列・出所）。並びは ZIP 内の並びでもある。
 *    列は snake_case（DB の列名と同じ語。返却先が DB の項目と突き合わせられるように）。
 */
export const CLOSING_RETURN_FILES = [
  file({
    name: 'engineers.csv',
    source: 'engineers',
    columns: [
      'id', 'display_name', 'affiliation_label', 'availability', 'available_from', 'unit_price_min', 'unit_price_max',
      'prefecture', 'city', 'remote_mode', 'preference_note', 'contact_email', 'contact_phone', 'birth_date',
      'created_at', 'updated_at',
    ],
    cells: (r) => [
      r.id, r.displayName, r.affiliationLabel, r.availability, r.availableFrom, r.unitPriceMin, r.unitPriceMax,
      r.prefecture, r.city, r.remoteMode, r.preferenceNote, r.contactEmail, r.contactPhone, r.birthDate,
      r.createdAt, r.updatedAt,
    ],
  }),
  file({
    name: 'engineer_skills.csv',
    source: 'engineerSkills',
    columns: ['engineer_id', 'skill_name', 'years_of_experience', 'level', 'source'],
    cells: (r) => [r.engineerId, r.skillName, r.yearsOfExperience, r.level, r.source],
  }),
  // 🔴 1 行 = 1 経歴。`engineer_id` で `engineers.csv` に結合する（T-09-12 / docs/05 §9.6）。
  file({
    name: 'engineer_careers.csv',
    source: 'engineerCareers',
    columns: ['engineer_id', 'period_from', 'period_to', 'role', 'description', 'technologies', 'source'],
    cells: (r) => [r.engineerId, r.periodFrom, r.periodTo, r.role, r.description, r.technologies, r.source],
  }),
  file({
    name: 'projects.csv',
    source: 'projects',
    columns: [
      'id', 'name', 'end_client_name', 'internal_unit_price', 'public_summary', 'unit_price_min', 'unit_price_max',
      'start_date', 'prefecture', 'remote_mode', 'headcount', 'status', 'created_at', 'updated_at',
    ],
    cells: (r) => [
      r.id, r.name, r.endClientName, r.internalUnitPrice, r.publicSummary, r.unitPriceMin, r.unitPriceMax,
      r.startDate, r.prefecture, r.remoteMode, r.headcount, r.status, r.createdAt, r.updatedAt,
    ],
  }),
  file({
    name: 'project_requirements.csv',
    source: 'projectRequirements',
    columns: ['project_id', 'kind', 'skill_name', 'free_text', 'required_years'],
    cells: (r) => [r.projectId, r.kind, r.skillName, r.freeText, r.requiredYears],
  }),
  file({
    name: 'partner_companies.csv',
    source: 'partnerCompanies',
    columns: ['id', 'name', 'contact_name', 'contact_email', 'suspended_at', 'invited_at'],
    cells: (r) => [r.id, r.name, r.contactName, r.contactEmail, r.suspendedAt, r.invitedAt],
  }),
  file({
    name: 'proposals.csv',
    source: 'proposals',
    columns: [
      'id', 'project_id', 'engineer_id', 'owner_partner_company_id', 'proposal_request_id', 'state',
      'recipient_company_name', 'recipient_email', 'offered_unit_price', 'offered_start_date', 'work_style',
      'subject', 'body', 'approved_at', 'submitted_at', 'created_at', 'updated_at',
    ],
    cells: (r) => [
      r.id, r.projectId, r.engineerId, r.ownerPartnerCompanyId, r.proposalRequestId, r.state,
      r.recipientCompanyName, r.recipientEmail, r.offeredUnitPrice, r.offeredStartDate, r.workStyle,
      r.subject, r.body, r.approvedAt, r.submittedAt, r.createdAt, r.updatedAt,
    ],
  }),
  // 🔴 越境経路 2 で開示済みの凍結コピー。取引先が持ち込んだエンジニアの実名は**ここにだけ**現れる。
  file({
    name: 'engineer_snapshots.csv',
    source: 'engineerSnapshots',
    columns: [
      'proposal_id', 'display_name', 'affiliation_label', 'unit_price_min', 'unit_price_max', 'available_from',
      'prefecture', 'remote_mode', 'frozen_at',
    ],
    cells: (r) => [
      r.proposalId, r.displayName, r.affiliationLabel, r.unitPriceMin, r.unitPriceMax, r.availableFrom,
      r.prefecture, r.remoteMode, r.frozenAt,
    ],
  }),
  file({
    name: 'engineer_snapshot_skills.csv',
    source: 'engineerSnapshotSkills',
    columns: ['proposal_id', 'skill_name', 'years', 'level'],
    cells: (r) => [r.proposalId, r.skillName, r.years, r.level],
  }),
  file({
    name: 'engineer_snapshot_careers.csv',
    source: 'engineerSnapshotCareers',
    columns: ['proposal_id', 'period_from', 'period_to', 'role', 'description', 'technologies'],
    cells: (r) => [r.proposalId, r.periodFrom, r.periodTo, r.role, r.description, r.technologies],
  }),
  file({
    name: 'proposal_events.csv',
    source: 'proposalEvents',
    columns: ['proposal_id', 'kind', 'from_state', 'to_state', 'actor_user_id', 'note', 'occurred_at'],
    cells: (r) => [r.proposalId, r.kind, r.fromState, r.toState, r.actorUserId, r.note, r.occurredAt],
  }),
  file({
    name: 'assignments.csv',
    source: 'assignments',
    columns: [
      'id', 'engineer_id', 'project_id', 'proposal_id', 'counterparty_partner_company_id', 'state', 'start_date',
      'end_date', 'actual_leave_date', 'unit_price', 'review_opened_at',
    ],
    cells: (r) => [
      r.id, r.engineerId, r.projectId, r.proposalId, r.counterpartyPartnerCompanyId, r.state, r.startDate,
      r.endDate, r.actualLeaveDate, r.unitPrice, r.reviewOpenedAt,
    ],
  }),
] as const;

export type ClosingReturnFileName = (typeof CLOSING_RETURN_FILES)[number]['name'];

export type ClosingReturnArchive = {
  readonly archive: Uint8Array;
  readonly fileCount: number;
  /** ファイル名 → データ行数（ヘッダを除く）。`AuditLog(data_export.*)` の `summary.rowCounts` の材料。 */
  readonly rowCounts: Readonly<Record<ClosingReturnFileName, number>>;
};

/** 返却データセットを CSV 一式の ZIP にする（決定的。同じ入力から同じバイト列）。 */
export function buildClosingReturnArchive(dataset: ClosingReturnDataset): ClosingReturnArchive {
  const entries: ZipEntry[] = [];
  const rowCounts = {} as Record<ClosingReturnFileName, number>;
  for (const spec of CLOSING_RETURN_FILES) {
    const rows = dataset[spec.source] as readonly ClosingReturnDataset[typeof spec.source][number][];
    const cells = rows.map((row) => (spec.cells as (r: typeof row) => readonly CsvCell[])(row));
    entries.push({ name: spec.name, data: encodeUtf8(encodeCsv(spec.columns, cells)) });
    rowCounts[spec.name] = rows.length;
  }
  return { archive: buildZipArchive(entries), fileCount: entries.length, rowCounts };
}
