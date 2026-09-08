// packages/db/src/gate-target.ts
// 🔴 ゲートの対象を DB から読み、`GateInput`（docs/05 §11.3）に組み立てる。T-07-06。
//
// ============================================================================
// 🔴 「何を検査するか」をここで決める（ゲート本体に分岐を持たせない）
// ============================================================================
// 品質ゲートは `forbiddenTerms` と `knownPii` しか見ない。**「その公開範囲で出してはならないか」を
// 判断するのは本ファイルだけ**である。たとえば提案先へ提示する単価（`Proposal.offeredUnitPrice`）は
// 出してよく、案件の内部単価（`Project.internalUnitPrice`）は出してはならない —— この区別を
// ゲート側に持たせると、対象種別が増えるたびに判定が分岐し、どこかで必ず取りこぼす。
//
// ============================================================================
// 🔴 既知値は「欠けたら漏れる」ものである（docs/05 §7.13 ②-2）
// ============================================================================
// `mask()` の既知値置換（主）が拾えなかった表記は、パターン検出（補助）では拾えない
// （氏名に形の手掛かりが無いため）。機械的 PII 検出（§11.4）も同じ集合を使うので、
// **表記が 1 つ欠けると LLM への送信とゲートの検査の両方が同時に漏れる。**
// したがって台帳が持つ氏名の表記は**全部**渡す。
// ⚠️ 現在の `engineers` は氏名の列が `display_name` の 1 本だけである（docs/05 §3.4）。
//    カナ・ローマ字の列を足したら、**必ずここにも足すこと**（足し忘れがそのまま漏れになる）。

import { Prisma } from '@prisma/client';
import type {
  EngineerSkillFacts,
  GateInput,
  GateTargetType,
  ProjectRequirementFacts,
  SnapshotSkillFacts,
} from '@ses/domain';
import type { SystemTenantCtx } from './context.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 🔴 その対象の検査に必要な事実を読み出せない（docs/05 §11.1 / `F-020 AC-1`）。
 *
 * **PASS にも FAIL にも倒さない。** ゲートの結果を 1 行も書かないので、対象は共有状態へ進めない
 * （`ProjectVisibility` は `review_gate_id` NOT NULL、承認 CAS は `execution='DONE' AND 3 層 PASS`）。
 *
 * 🔴 **既知の未解決事項**: パートナー所属エンジニアの提案では、ジョブのホスト文脈
 *    （`systemTenantCtx`。docs/05 §9.2 は常にホスト相当）から `engineers` / `engineer_skills`
 *    （C3 OWNER_SCOPED）が **1 行も読めない**。これは `CLAUDE.md` §3.1 経路 2
 *    （「パートナーのエンジニア台帳全体をホストが読むことはできない」）の帰結であり、
 *    ゲートが自分で緩めてよい制約ではない（§4.4.2「これ以外を作らない」）。
 *    詳細と選択肢は docs/05 §11.9 に記録した。**解消されるまで、その提案はゲートを通せない。**
 */
export class GateFactsUnavailableError extends Error {
  constructor(
    readonly targetType: GateTargetType,
    readonly targetId: string,
    readonly reason: string,
  ) {
    super(
      `ゲートの検査に必要な事実を読み出せません（targetType=${targetType} / targetId=${targetId} / reason=${reason}）。` +
        '検査できない対象を PASS として扱うことはできません（docs/05 §11.1 / F-020 AC-1）。',
    );
    this.name = 'GateFactsUnavailableError';
  }
}

/**
 * 🔴 まだ配線されていない対象種別（Phase 2 / Phase 3、および T-07-09 の範囲）。
 *
 * **「対応していないので PASS」を作らない**（`CLAUDE.md` §11.1 の「未設定ならモック」と同型の事故）。
 */
export class UnsupportedGateTargetError extends Error {
  constructor(readonly targetType: GateTargetType, detail: string) {
    super(
      `targetType='${targetType}' のゲート入力はまだ組み立てられません。${detail}` +
        ' 検査していない対象を共有状態へ進めることはできません（F-020 AC-1）。',
    );
    this.name = 'UnsupportedGateTargetError';
  }
}

/** 対象が見つからない（削除済み / 別テナント）。🔴 存在の有無を呼び出し側へ返すだけ（§4.8）。 */
export type GateTargetLookup = { readonly kind: 'FOUND'; readonly input: GateInput } | { readonly kind: 'NOT_FOUND' };

/** 🔴 `Decimal(12,2)` を「桁だけを見る照合器」（`mask()` の単価ルール）へ渡せる整数表記にする。 */
function unitPriceTerm(value: Prisma.Decimal | null): string[] {
  if (value === null) return [];
  // 🔴 小数点以下を落とす。落とさないと `800000.00` が「80000000」として照合されてしまう
  //    （`mask()` の単価ルールは非数字を取り除いて桁を並べるため）。SES の単価は円単位である。
  const text = value.toFixed(0);
  return text.length === 0 ? [] : [text];
}

function birthDateTerm(value: Date | null): string[] {
  if (value === null) return [];
  // `@db.Date` は UTC の 00:00 で入る。日付だけを `YYYY-MM-DD` にする。
  return [value.toISOString().slice(0, 10)];
}

function nonEmpty(values: readonly (string | null | undefined)[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) unique.add(value);
  }
  return [...unique];
}

type SnapshotSkillRow = {
  readonly skillId?: unknown;
  readonly name?: unknown;
  readonly years?: unknown;
  readonly level?: unknown;
};

/**
 * `EngineerSnapshot.skills`（JSON）を整合層の入力に写す。
 *
 * 🔴 形が壊れていたら**握り潰さない**。整合層は「主張が要件と台帳に裏付けられるか」を見る層であり、
 *    主張を読めないまま PASS にすると `F-020` の中核が空回りする。
 */
function toSnapshotSkills(value: unknown, targetId: string): SnapshotSkillFacts[] {
  if (!Array.isArray(value)) {
    throw new GateFactsUnavailableError('PROPOSAL', targetId, 'SNAPSHOT_SKILLS_NOT_ARRAY');
  }
  return value.map((row: SnapshotSkillRow) => {
    const skillId = row.skillId;
    const name = row.name;
    const years = row.years;
    const level = row.level;
    if (typeof skillId !== 'string' || typeof name !== 'string' || typeof years !== 'number') {
      throw new GateFactsUnavailableError('PROPOSAL', targetId, 'SNAPSHOT_SKILL_SHAPE');
    }
    return {
      skillId,
      // 🔴 `label` は指摘の `excerpt` に出る（docs/05 §11.8 ④）。辞書名であり PII を含まない。
      label: name,
      years,
      level: typeof level === 'number' ? level : null,
    };
  });
}

/**
 * 🔴 対象を読み、`GateInput` を組み立てる（`gate.run` の最初の手順。docs/05 §11.2 の BUILD）。
 *
 * @throws GateFactsUnavailableError 検査に必要な事実が読めないとき（PASS に倒さない）。
 * @throws UnsupportedGateTargetError まだ配線されていない対象種別のとき。
 */
export async function loadGateInput(
  ctx: SystemTenantCtx,
  key: { readonly targetType: GateTargetType; readonly targetId: string; readonly contentHash: string },
): Promise<GateTargetLookup> {
  switch (key.targetType) {
    case 'PROPOSAL':
      return loadProposalGateInput(ctx, key.targetId, key.contentHash);
    case 'PROJECT_PUBLISH':
      return loadProjectPublishGateInput(ctx, key.targetId, key.contentHash);
    case 'SKILL_SHEET_SHARE':
      throw new UnsupportedGateTargetError(
        key.targetType,
        'スキルシートの外部共有の入口（F-011 の共有 URL 発行）は T-07-09 の範囲である。',
      );
    case 'CHAT_ATTACHMENT':
      throw new UnsupportedGateTargetError(key.targetType, 'チャット添付は Phase 2（F-038）である。');
    case 'CONTRACT_DOCUMENT':
      throw new UnsupportedGateTargetError(key.targetType, '契約書は Phase 3（F-047）である。');
    default: {
      // 🔴 `GateTargetType` に値を足したらここでコンパイルエラーになる（取りこぼせない）。
      const exhaustive: never = key.targetType;
      throw new UnsupportedGateTargetError(exhaustive, '未知の対象種別である。');
    }
  }
}

/**
 * 提案（越境経路 2 / 提案先はテナント外の企業）。
 *
 * 🔴 **検査する本文は件名と本文だけ**である。`EngineerSnapshot` は**整合層の照合対象**として使い、
 *    PII 層・商流層の本文には入れない —— スナップショットは経路 2 で**ホストが読む**ための
 *    凍結コピーであり、氏名と所属会社名を持っているのが正常である（`CLAUDE.md` §3.1 経路 2）。
 *    本文に入れると既知値が必ず一致し、**すべての提案が直しようのない PII FAIL になる**。
 *    外部へ出るのは件名・本文であり、そこに氏名が残っていれば FAIL になる（`F-020 AC-5`）。
 */
async function loadProposalGateInput(
  ctx: SystemTenantCtx,
  targetId: string,
  contentHash: string,
): Promise<GateTargetLookup> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<GateTargetLookup> => {
      const proposal = await tx.proposal.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          projectId: true,
          engineerId: true,
          ownerPartnerCompanyId: true,
          subject: true,
          body: true,
        },
      });
      if (proposal === null) return { kind: 'NOT_FOUND' };

      const snapshot = await tx.engineerSnapshot.findUnique({
        where: { proposalId: proposal.id },
        select: { displayName: true, affiliationLabel: true, skills: true },
      });
      if (snapshot === null) {
        // 🔴 提案時点の凍結コピーが無ければ、整合層が照合する「主張」が存在しない。
        throw new GateFactsUnavailableError('PROPOSAL', targetId, 'SNAPSHOT_MISSING');
      }

      const engineer = await tx.engineer.findUnique({
        where: { id: proposal.engineerId },
        select: {
          displayName: true,
          birthDate: true,
          contactEmail: true,
          contactPhone: true,
          affiliationLabel: true,
        },
      });
      if (engineer === null) {
        // 🔴 パートナー所属エンジニア（C3）はホスト文脈から読めない。本ファイル冒頭の 🔴 を参照。
        throw new GateFactsUnavailableError('PROPOSAL', targetId, 'ENGINEER_LEDGER_UNREADABLE');
      }

      const registered = await tx.engineerSkill.findMany({
        where: { engineerId: proposal.engineerId },
        select: { skillId: true, yearsOfExperience: true, level: true },
      });

      const project = await tx.project.findUnique({
        where: { id: proposal.projectId },
        select: { endClientName: true, internalUnitPrice: true },
      });
      if (project === null) throw new GateFactsUnavailableError('PROPOSAL', targetId, 'PROJECT_MISSING');

      const requirements = await tx.projectRequirement.findMany({
        where: { projectId: proposal.projectId },
        select: { kind: true, requiredYears: true, skill: { select: { id: true, name: true } } },
      });

      const partners = await tx.partnerCompany.findMany({ select: { id: true, name: true } });

      const registeredSkills: EngineerSkillFacts[] = registered.map((row) => ({
        skillId: row.skillId,
        years: Number(row.yearsOfExperience),
        level: row.level,
      }));
      const requirementFacts: ProjectRequirementFacts[] = requirements.map((row) => ({
        kind: row.kind === 'MUST' ? 'MUST' : 'NICE',
        skill: row.skill === null ? null : { id: row.skill.id, label: row.skill.name },
        requiredYears: row.requiredYears === null ? null : Number(row.requiredYears),
      }));

      return {
        kind: 'FOUND',
        input: {
          targetType: 'PROPOSAL',
          targetId: proposal.id,
          contentHash,
          // 🔴 提案先は**テナント外の企業**である（取引先＝パートナーではない）。
          audience: { kind: 'EXTERNAL_CLIENT', partnerCompanyIds: [] },
          sections: [
            { field: 'subject', text: proposal.subject ?? '' },
            { field: 'body', text: proposal.body ?? '' },
          ],
          forbiddenTerms: {
            // 🔴 提示単価（`offeredUnitPrice`）は出してよい。禁じるのは案件の**内部単価**である。
            unitPrices: unitPriceTerm(project.internalUnitPrice),
            endClientNames: nonEmpty([project.endClientName]),
            // 🔴 提案元の会社名は「他社」ではなく**エンジニアの現所属会社**（PII 層の担当）である。
            //    ここに入れると同じ箇所が 2 層で二重に指摘される。
            otherCompanyNames: nonEmpty(
              partners
                .filter((partner) => partner.id !== proposal.ownerPartnerCompanyId)
                .map((partner) => partner.name),
            ),
          },
          knownPii: {
            // 🔴 台帳と凍結コピーの**両方**の表記を渡す（片方だけだと改名後に漏れる）。
            fullNames: nonEmpty([engineer.displayName, snapshot.displayName]),
            birthDates: birthDateTerm(engineer.birthDate),
            emails: nonEmpty([engineer.contactEmail]),
            phones: nonEmpty([engineer.contactPhone]),
            affiliations: nonEmpty([
              engineer.affiliationLabel,
              snapshot.affiliationLabel,
              partners.find((partner) => partner.id === proposal.ownerPartnerCompanyId)?.name ?? null,
            ]),
          },
          consistency: {
            subject: {
              snapshot: { skills: toSnapshotSkills(snapshot.skills, targetId) },
              requirements: requirementFacts,
              registeredSkills,
            },
          },
        },
      };
    },
  );
}

/**
 * 案件の公開（越境経路 1）。
 *
 * 🔴 検査するのは `Project.publicSummary` だけである（`F-014` 処理②。公開時に外へ出るのはこれだけ）。
 * 🔴 `endClientName` / `internalUnitPrice` は**内部限定**であり、公開表示に出れば商流層 FAIL
 *    （`F-014 AC-3`）。他社名は「公開先に含まれない取引先の名前」である。
 *
 * ⚠️ **T-07-09 への申し送り**: `audience.partnerCompanyIds` には**現時点で公開済みの相手**を入れている。
 *    `#28`（公開範囲の設定）が「これから公開する相手」を持ち回る手段は SP-06 では作られなかった
 *    （`ProjectVisibility` の行はゲート PASS 後にしか作れない = `review_gate_id` NOT NULL）。
 *    新規公開先を含めるには、その一覧をゲートまで運ぶ経路が要る（docs/05 §11.9 に記録）。
 */
async function loadProjectPublishGateInput(
  ctx: SystemTenantCtx,
  targetId: string,
  contentHash: string,
): Promise<GateTargetLookup> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<GateTargetLookup> => {
      const project = await tx.project.findUnique({
        where: { id: targetId },
        select: { id: true, publicSummary: true, endClientName: true, internalUnitPrice: true },
      });
      if (project === null) return { kind: 'NOT_FOUND' };

      const visibilities = await tx.projectVisibility.findMany({
        where: { projectId: project.id, revokedAt: null },
        select: { partnerCompanyId: true },
      });
      const audienceIds = visibilities.map((row) => row.partnerCompanyId);
      const partners = await tx.partnerCompany.findMany({ select: { id: true, name: true } });

      return {
        kind: 'FOUND',
        input: {
          targetType: 'PROJECT_PUBLISH',
          targetId: project.id,
          contentHash,
          audience: { kind: 'PARTNER', partnerCompanyIds: audienceIds },
          sections: [{ field: 'public_summary', text: project.publicSummary ?? '' }],
          forbiddenTerms: {
            unitPrices: unitPriceTerm(project.internalUnitPrice),
            endClientNames: nonEmpty([project.endClientName]),
            // 🔴 公開先に**含まれない**取引先の名前は出してはならない（`CLAUDE.md` §3.1 の 🔴。
            //    「A に B の存在を知らせない」）。
            otherCompanyNames: nonEmpty(
              partners
                .filter((partner) => !audienceIds.includes(partner.id))
                .map((partner) => partner.name),
            ),
          },
          // 🔴 案件はエンジニアについて何も主張しないので、台帳の PII を照合対象にしない。
          knownPii: { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [] },
          // 🔴 照合する「主張」が無い ＝ 整合層は PASS（docs/05 §11.8 ②）。
          consistency: {},
        },
      };
    },
  );
}
