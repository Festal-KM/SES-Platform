// packages/db/src/proposal-draft.ts
// 🔴 `Proposal(DRAFT)` の作成と `EngineerSnapshot` の凍結の**唯一の実装**（docs/05 §3.6 / §6.5
//    「#33 / #34 と `proposal-request.expire` の実装の決着」/ `F-019` 処理①②④ / `F-018 AC-3`）。T-08-07。
//
// ============================================================================
// 🔴 なぜ `packages/db` に置くか
// ============================================================================
//   ① **2 実装にしない。** 呼び出し元は #33（提案依頼の応諾。T-08-07）と #36（`POST /api/proposals`。
//      SP-09 `T-09-01`）の 2 つであり、どちらも**この 1 関数**を通る（`docs/sprints/SP-08` T-08-07）。
//   ② **凍結を迂回した `proposals` の INSERT を `packages/db` の外から書けなくする。** 提案は越境経路 2 の
//      実体であり（`CLAUDE.md` §3.1）、`EngineerSnapshot` の無い `Proposal` はホストが読む凍結情報を持たない
//      「開示の抜け殻」になる（`completeReviewGate` / `settleProjectPublish` と同じ規律）。
//   ③ **呼び出し側の 1 トランザクションの内側で書く**（引数に `db` を取る。`upsertProjectPublishRequest` と同じ形）。
//      #33 は「`ACCEPTED` への CAS」と本関数を**同じトランザクション**で行い、片方だけ成立する状態を作らない
//      （`docs/02` `program-design` 申し送り 12）。
//
// ============================================================================
// 🔴 凍結は「値の複製」である（docs/05 §3.6）
// ============================================================================
// 台帳行への参照（FK）を持たず、**その時点の値を写す**。以後の台帳更新は提案の内容を変えない（`F-019 AC-2`）。
//
// ✅ **T-09-12（`EngineerCareer`。[Issue #35](https://github.com/Festal-KM/SES-Platform/issues/35) = A）で行複製に置き換えた**:
//    `freezeCareers()` は `engineer_careers` を §3.4.1 の全順序（`periodFrom` 降順 → `createdAt` 昇順 →
//    `id` 昇順 = `ENGINEER_CAREER_ORDER_BY`）で読み、`FrozenCareer[]`（5 項目。**行 ID を持たない**）に値ごと写す。
//    0 行は `[]` を保存する（`null` にしない。0 行は正常な状態であり、「凍結し忘れ」と区別できる必要がある。
//    §3.6 / `F-008 AC-5`）。0 行を理由に失敗させない（#36 の 🔴「経験内容 0 行を理由に 422 にしない」）。
//    🔴 母集団は `engineer_careers` の RLS（C3。親と同じ）が決める —— `where` は `engineerId` だけである。
import { Prisma } from '@prisma/client';
import { toFrozenCareer, type FrozenCareer as DomainFrozenCareer } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx } from './context.js';
import type { withTenant } from './with-tenant.js';

/** `withTenant` が `fn` に渡すクライアントのうち、本関数が触る部分。 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];
export type ProposalDraftWriter = Pick<
  TenantDbArg,
  | 'engineer'
  | 'engineerSkill'
  | 'engineerCareer'
  | 'skillSheet'
  | 'proposal'
  | 'engineerSnapshot'
  | 'proposalEvent'
  | 'auditLog'
>;

/**
 * docs/05 §16.1 の `*.create`。🔴 独自 action（`proposal.draft`）を作らない（`S-041` の操作種別フィルタは
 * 接尾辞一致。`proposal_request.create` と同じ整理）。
 */
export const PROPOSAL_AUDIT_ACTION_CREATE = 'proposal.create';

/**
 * 🔴 `AuditLog.targetType`（提案）。T-09-09 で定数にした —— 表記が `'Proposal'`（#36 / #37 / #41 / #42 / #43 / #44 / #48）と
 *    `'PROPOSAL'`（`gate.run` の `GATE_RESULT`）で揺れており、#45 / #46 / #47 の**読み書きはこの 1 定数**を使う。
 *    ✅ T-12-13 ①（SP-12）: 書き込み側（`apps/web/lib/proposals/**` / `packages/db/src/proposal-{approval,send}.ts` /
 *    `apps/worker/src/jobs/gate-run.ts` / `seed/presets/demo.ts`）を全部この定数に寄せ、既存行は migration
 *    20260929000000 が `UPDATE audit_logs SET target_type = 'Proposal' WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%'`
 *    で移した。`audit_logs.targetType` に `'Proposal'` / `'PROPOSAL'` のリテラルを書く箇所は
 *    `tests/static/audit-target-type-literal.test.ts` が非テストソースで 0 件に固定する。
 *    `review_gates.target_type` / `send_attempts.entity_type` の `'PROPOSAL'`（`GateTargetType` / `PROPOSAL_SEND_ENTITY_TYPE`）は
 *    別の列であり、この定数とは独立である。
 */
export const PROPOSAL_AUDIT_TARGET_TYPE = 'Proposal' as const;

/** `ProposalEvent.kind`（`'STATE'|'NOTE'|'ATTACHMENT'`。schema.prisma の CHECK）。 */
const PROPOSAL_EVENT_KIND_STATE = 'STATE';

/** `Proposal.state` の初期値（`CLAUDE.md` §4.2 の始点）。 */
const PROPOSAL_INITIAL_STATE = 'DRAFT';

/**
 * 提案先（テナント外の企業）。
 * 🔴 #33（応諾）は提案先を決められる主体が居ないため**空文字**を渡す（docs/05 §6.5「T-08-07 の決着」）。
 *    列は `NOT NULL`（§3.6）であり、埋めるのは `S-020`（#37。SP-09）である。
 */
export type ProposalDraftRecipient = {
  readonly companyName: string;
  readonly email: string;
};

/** 提案条件と本文（#36 が渡す。#33 は渡さない ＝ すべて `null`）。 */
export type ProposalDraftTerms = {
  readonly offeredUnitPrice?: number | null;
  /** `YYYY-MM-DD`（`@db.Date`）。 */
  readonly offeredStartDate?: Date | null;
  readonly workStyle?: string | null;
  readonly subject?: string | null;
  readonly body?: string | null;
};

export type ProposalDraftInput = {
  readonly projectId: string;
  /**
   * 凍結する台帳の行。🔴 母集団は `engineers` の RLS（C3 OWNER_SCOPED）が決める —— 取引先は自社の行、
   *    ホストは自社所有の行だけが見え、見えなければ `ProposalDraftEngineerNotFoundError`（404 に写像）。
   *    **他社の台帳を凍結する経路は存在しない**（`BR-06`）。
   */
  readonly engineerId: string;
  /** 経路 4 由来なら依頼の ID（`Proposal.proposalRequestId`。docs/05 §3.6）。 */
  readonly proposalRequestId: string | null;
  readonly recipient: ProposalDraftRecipient;
  readonly terms?: ProposalDraftTerms;
  /** 凍結時刻（`EngineerSnapshot.frozenAt` / `ProposalEvent.occurredAt`）。🔴 呼び出し側が渡す。 */
  readonly frozenAt: Date;
  /** 監査ログの補助情報（IP はリクエストから）。 */
  readonly ipAddress: string | null;
};

/**
 * 戻り値（#36 の応答 `{ id, snapshot: { frozenAt, careerCount } }` と同じ形。docs/05 §6.5 #36）。
 * 🔴 凍結した値そのもの（実名など）は返さない —— 読むのは `#46` の凍結側 API である。
 */
export type ProposalDraftResult = {
  readonly id: string;
  readonly snapshot: {
    readonly frozenAt: Date;
    /** 凍結した経歴の行数（0 行は `0`。`null` にしない。docs/05 §6.5 #36）。 */
    readonly careerCount: number;
  };
};

/**
 * 🔴 凍結する台帳の行が見えない（RLS の C3 で 0 件 ＝ 他社の行 / 削除済み / 存在しない）。
 *    区別しない（区別すると存在を教える。docs/05 §4.8）。API 境界は **404** に写像する。
 */
export class ProposalDraftEngineerNotFoundError extends Error {
  constructor() {
    super(
      '凍結するエンジニアが見つかりません（docs/05 §4.8「見えない ＝ 存在しない」）。' +
        '404 として扱ってください。',
    );
    this.name = 'ProposalDraftEngineerNotFoundError';
  }
}

/** `EngineerSnapshot.skills` の 1 件（docs/05 §3.6 `[{ skillId, name, years, level }]`）。 */
type FrozenSkill = {
  readonly skillId: string;
  readonly name: string;
  readonly years: number;
  readonly level: number | null;
};

/**
 * `EngineerSnapshot.careers` の 1 行（docs/05 §3.6 `FrozenCareer`。🔴 台帳の行 ID を持たない）。
 * 出所は `@ses/domain`（`packages/domain/src/ledger/careers.ts`）。ゲート（`gate-target.ts`）と画面が
 * 同じ形を読むため、ここでは別名として re-export する。
 */
export type FrozenCareer = DomainFrozenCareer;

/**
 * 🔴 台帳の表示順そのもの（docs/05 §3.4.1）。`period_from DESC → created_at ASC → id ASC` の全順序で、
 *    索引 `(tenant_id, engineer_id, period_from DESC, created_at, id)` がそのまま供給する。
 *    #17（`apps/web/lib/engineers/careers.ts`）と凍結が**同じ並び**を使う（配列順 = 表示順）ためここに置く。
 *    `period_to` を並びに使わない（継続中 = NULL の扱いが実装ごとにずれる）。
 */
export const ENGINEER_CAREER_ORDER_BY = [
  { periodFrom: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const satisfies readonly Prisma.EngineerCareerOrderByWithRelationInput[];

/**
 * 🔴 凍結は行単位の値の複製である（docs/05 §3.6 / §6.5「#36 / #46 / #46b の経験内容の凍結」）。
 *    台帳の行 ID を持ち込まない。0 行は `[]`（`null` を返さない）。
 */
async function freezeCareers(
  db: Pick<ProposalDraftWriter, 'engineerCareer'>,
  engineerId: string,
): Promise<readonly FrozenCareer[]> {
  const rows = await db.engineerCareer.findMany({
    where: { engineerId },
    select: { periodFrom: true, periodTo: true, role: true, description: true, technologies: true },
    orderBy: [...ENGINEER_CAREER_ORDER_BY],
  });
  return rows.map(toFrozenCareer);
}

function toPrismaJson(value: readonly FrozenSkill[] | readonly FrozenCareer[]): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

/**
 * 🔴 `Proposal(DRAFT)` を作り、その時点の台帳を `EngineerSnapshot` に凍結する（1 トランザクションの内側）。
 *
 * 手順:
 *   ① 台帳の行を読む（RLS が母集団。見えなければ例外）
 *   ② 登録スキル（辞書名 + 経験年数 + レベル。`skillId` 昇順の決定的順序）と、最新の `CLEAN` な版を読む
 *      （`is_latest = true` は CHECK により `scan_status = 'CLEAN'` に限られる。`F-019 AC-3`）
 *   ③ `proposals` に `DRAFT` で INSERT（`ownerPartnerCompanyId` は **ctx**。リクエスト入力ではない）
 *   ④ `engineer_snapshots` に値を写す（`careers` は `engineer_careers` の行単位の複製。0 行は `[]`）
 *   ⑤ `proposal_events` に `STATE`（`null → DRAFT`）を 1 行
 *   ⑥ `AuditLog(proposal.create)`。🔴 `summary` は `{ projectId, proposalRequestId }` だけ ——
 *      `engineer_id` / 実名 / 依頼先を載せない（運営者が横断検索する。`CLAUDE.md` §10.5）
 *
 * 🔴 どれかが失敗すれば呼び出し側のトランザクションごと巻き戻る（本関数は途中の状態を返さない）。
 */
export async function createProposalDraft(
  db: ProposalDraftWriter,
  ctx: AuthenticatedTenantCtx,
  input: ProposalDraftInput,
): Promise<ProposalDraftResult> {
  // ① 🔴 `where` に `tenantId` / `ownerPartnerCompanyId` を書かない（母集団は RLS と Prisma 拡張が決める）。
  const engineer = await db.engineer.findFirst({
    where: { id: input.engineerId },
    select: {
      id: true,
      displayName: true,
      affiliationLabel: true,
      unitPriceMin: true,
      unitPriceMax: true,
      availableFrom: true,
      prefecture: true,
      remoteMode: true,
    },
  });
  if (engineer === null) throw new ProposalDraftEngineerNotFoundError();

  // ② スキルと最新 CLEAN 版。
  const skillRows = await db.engineerSkill.findMany({
    where: { engineerId: engineer.id },
    select: { skillId: true, yearsOfExperience: true, level: true, skill: { select: { name: true } } },
    orderBy: [{ skillId: 'asc' }],
  });
  const skills: FrozenSkill[] = skillRows.map((row) => ({
    skillId: row.skillId,
    name: row.skill.name,
    years: Number(row.yearsOfExperience.toString()),
    level: row.level,
  }));
  const latestSheet = await db.skillSheet.findFirst({
    where: { engineerId: engineer.id, isLatest: true, scanStatus: 'CLEAN' },
    select: { id: true },
  });
  const careers = await freezeCareers(db, engineer.id);

  // ③ Proposal（DRAFT）。
  const terms = input.terms ?? {};
  const proposal = await db.proposal.create({
    data: {
      tenantId: ctx.tenantId,
      // 🔴 作成した会社は認証コンテキストから（`F-008 AC-2` と同じ規律）。RLS の C5（`WITH CHECK`）が
      //    別の値での INSERT を DB 側でも拒否する。
      ownerPartnerCompanyId: ctx.partnerCompanyId,
      projectId: input.projectId,
      engineerId: engineer.id,
      proposalRequestId: input.proposalRequestId,
      state: PROPOSAL_INITIAL_STATE,
      recipientCompanyName: input.recipient.companyName,
      recipientEmail: input.recipient.email,
      offeredUnitPrice: terms.offeredUnitPrice ?? null,
      offeredStartDate: terms.offeredStartDate ?? null,
      workStyle: terms.workStyle ?? null,
      subject: terms.subject ?? null,
      body: terms.body ?? null,
      createdBy: ctx.userId,
    },
    select: { id: true },
  });

  // ④ 凍結（値の複製。`ownerPartnerCompanyId` は継承トリガが親の値で上書きする。`careers` は
  //    台帳の行 ID を持たない 5 項目の配列で、配列順 = 凍結時点の表示順）。
  await db.engineerSnapshot.create({
    data: {
      tenantId: ctx.tenantId,
      proposalId: proposal.id,
      displayName: engineer.displayName,
      affiliationLabel: engineer.affiliationLabel,
      skills: toPrismaJson(skills),
      careers: toPrismaJson(careers),
      unitPriceMin: engineer.unitPriceMin,
      unitPriceMax: engineer.unitPriceMax,
      availableFrom: engineer.availableFrom,
      prefecture: engineer.prefecture,
      remoteMode: engineer.remoteMode,
      skillSheetId: latestSheet?.id ?? null,
      frozenAt: input.frozenAt,
    },
    select: { id: true },
  });

  // ⑤ 履歴（`F-019` 処理④）。
  await db.proposalEvent.create({
    data: {
      tenantId: ctx.tenantId,
      proposalId: proposal.id,
      kind: PROPOSAL_EVENT_KIND_STATE,
      fromState: null,
      toState: PROPOSAL_INITIAL_STATE,
      actorUserId: ctx.userId,
      occurredAt: input.frozenAt,
    },
    select: { id: true },
  });

  // ⑥ 監査（同じトランザクション。書けなければ作成も成立しない）。
  await writeAuditLog(db, {
    action: PROPOSAL_AUDIT_ACTION_CREATE,
    actorKind: 'USER',
    actorId: ctx.userId,
    targetType: PROPOSAL_AUDIT_TARGET_TYPE,
    targetId: proposal.id,
    summary: { projectId: input.projectId, proposalRequestId: input.proposalRequestId },
    ipAddress: input.ipAddress,
    deviceKind: ctx.deviceKind,
  });

  return { id: proposal.id, snapshot: { frozenAt: input.frozenAt, careerCount: careers.length } };
}
