// packages/db/src/gate-content-hash.ts
// 🔴 ゲート対象の内容のハッシュ（docs/05 §11.5）の**唯一の出所**。T-07-08。
//
// ============================================================================
// 🔴 なぜ 1 実装でなければならないか
// ============================================================================
// §11.5 は 3 箇所で同じ値を突き合わせる:
//   ① ゲート実行時 … `ReviewGate.contentHash` に保存する（`gate.run` の payload に載る）
//   ② 内容の更新時 … `PATCH /api/proposals/{id}`（#37）が `Proposal.contentHash` を再計算する
//   ③ 承認の CAS  … `WHERE content_hash = $2 AND EXISTS (… review_gates.content_hash = $2 …)`
// ①②が別実装になると、③は**常に 0 件更新**になる（内容を変えていないのに
// 「内容が変更されたため再検証が必要です」が出続け、承認が永久にできない）。逆に
// 材料の取り方が片方だけ緩いと、**内容が変わったのに承認が通る**（§11.5 が守る当のもの）。
// したがって「材料の並べ方」は `packages/domain` の `gateHashSource()` 1 つ、
// 「SHA-256 を取ること」と「行から材料を読むこと」は本ファイル 1 つに閉じる。
//
// 🔴 `packages/domain` に置けないのは `node:crypto` を import できないためだけである
//    （`tests/static/domain-purity.test.ts`。docs/05 §17.2 #14 / §11.9 ⑧-1）。
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  gateHashSource,
  GateHashInputError,
  type GateHashAttachment,
  type GateHashInput,
  type GateHashSkill,
  type GateHashSnapshot,
  type ProposalGateHashInput,
} from '@ses/domain';
import { withTenant } from './with-tenant.js';

/**
 * 🔴 内容のハッシュ（SHA-256 の hex）。**この関数以外で `ReviewGate.contentHash` /
 *    `Proposal.contentHash` の値を作らない。**
 */
export function gateContentHash(input: GateHashInput): string {
  return createHash('sha256').update(gateHashSource(input), 'utf8').digest('hex');
}

/**
 * 材料を読むのに要るデリゲートだけ（`audit.ts` の `AuditLogWriter` と同じ手法）。
 * 🔴 `TenantDb` そのものを export しない（docs/05 §4.3 実装の規約 3）。
 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];
export type ProposalContentHashReader = Pick<TenantDbArg, 'proposal' | 'engineerSnapshot'>;

/** `Decimal(12,2)` を桁の揺れない十進文字列にする（`800000` と `800000.00` を同一視する）。 */
function decimal(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** `@db.Date`（UTC の 00:00 で入る）を `YYYY-MM-DD` にする。 */
function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

type SnapshotSkillRow = {
  readonly skillId?: unknown;
  readonly name?: unknown;
  readonly years?: unknown;
  readonly level?: unknown;
};

/**
 * `EngineerSnapshot.skills`（JSON）を材料に写す。
 *
 * 🔴 形が壊れていたら**握り潰さない**（`gate-target.ts` の `toSnapshotSkills` と同じ規律）。
 *    黙って読み飛ばすと「スキルが 1 件消えたのにハッシュが同じ」= 再検証を経ずに承認できる、
 *    という §11.5 が防いでいる事故そのものになる。
 */
function toHashSkills(value: unknown): readonly GateHashSkill[] {
  if (!Array.isArray(value)) {
    throw new GateHashInputError('EngineerSnapshot.skills が配列ではありません');
  }
  return value.map((row: SnapshotSkillRow) => {
    if (typeof row.skillId !== 'string' || typeof row.name !== 'string' || typeof row.years !== 'number') {
      throw new GateHashInputError('EngineerSnapshot.skills の要素の形が不正です');
    }
    return {
      skillId: row.skillId,
      label: row.name,
      years: row.years,
      level: typeof row.level === 'number' ? row.level : null,
    };
  });
}

type SkillSheetRow = { readonly id: string; readonly objectKey: string; readonly version: number };

function toAttachment(sheet: SkillSheetRow | null): GateHashAttachment | null {
  return sheet === null
    ? null
    : { skillSheetId: sheet.id, objectKey: sheet.objectKey, version: sheet.version };
}

/**
 * 🔴 提案の内容のハッシュの材料を読む（#37 / #39 / 承認 CAS が**同じこの関数**を通る）。
 *
 * 🔴 母集団はアプリが決めない —— `proposals` / `engineer_snapshots` は RLS の C5 であり、
 *    パートナー文脈からは自社の行しか見えない。**見えなければ `null`**（＝ 呼び出し側は 404。§4.8）。
 */
export async function readProposalGateHashInput(
  db: ProposalContentHashReader,
  proposalId: string,
): Promise<ProposalGateHashInput | null> {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: {
      subject: true,
      body: true,
      recipientCompanyName: true,
      recipientEmail: true,
      offeredUnitPrice: true,
      offeredStartDate: true,
      workStyle: true,
    },
  });
  if (proposal === null) return null;

  const snapshot = await db.engineerSnapshot.findUnique({
    where: { proposalId },
    select: {
      displayName: true,
      affiliationLabel: true,
      skills: true,
      unitPriceMin: true,
      unitPriceMax: true,
      availableFrom: true,
      skillSheet: { select: { id: true, objectKey: true, version: true } },
    },
  });

  const frozen: GateHashSnapshot | null =
    snapshot === null
      ? null
      : {
          displayName: snapshot.displayName,
          affiliationLabel: snapshot.affiliationLabel,
          skills: toHashSkills(snapshot.skills),
          unitPriceMin: decimal(snapshot.unitPriceMin),
          unitPriceMax: decimal(snapshot.unitPriceMax),
          availableFrom: dateOnly(snapshot.availableFrom),
          attachment: toAttachment(snapshot.skillSheet),
        };

  return {
    targetType: 'PROPOSAL',
    subject: proposal.subject,
    body: proposal.body,
    recipientCompanyName: proposal.recipientCompanyName,
    recipientEmail: proposal.recipientEmail,
    offeredUnitPrice: decimal(proposal.offeredUnitPrice),
    offeredStartDate: dateOnly(proposal.offeredStartDate),
    workStyle: proposal.workStyle,
    snapshot: frozen,
  };
}

/**
 * 🔴 提案の**現在の内容**のハッシュ。対象が見えなければ `null`（存在しないのと同じ）。
 *
 * 🔴 `Proposal.contentHash` 列の値を読むのではなく、**その場で計算する**。列は
 *    「最後にレビュー依頼した時点の内容」であり、承認 CAS はその列と `review_gates` を
 *    突き合わせる（§11.5 手順 3）。ここが列を読み返す実装になっていると、
 *    「内容が変わったこと」を誰も検出できなくなる。
 */
export async function computeProposalContentHash(
  db: ProposalContentHashReader,
  proposalId: string,
): Promise<string | null> {
  const input = await readProposalGateHashInput(db, proposalId);
  return input === null ? null : gateContentHash(input);
}
