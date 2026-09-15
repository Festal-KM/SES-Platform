// packages/db/src/gate-engineer-facts.ts
// 🔴 `app_gate_probe` の SECURITY DEFINER 2 関数（`app_gate_proposal_engineer_pii` /
//    `app_gate_proposal_engineer_skills`。migration 20260918000000）を呼ぶ**唯一のファイル**。
//    T-09-13。docs/05 §11.14（Issue #41 = 選択肢 1）。
//
// ============================================================================
// 🔴 何を読むか、なぜ読むか（docs/05 §11.14 ②）
// ============================================================================
// `gate.run` はジョブのホスト文脈で走るため、`engineers` / `engineer_skills`（C3 OWNER_SCOPED）の
// パートナー所有行が 1 行も見えない。既知値（氏名・生年月日・メール・電話・現所属）が無いと
// `mask()` の既知値置換と機械的 PII 検出の両方が同時に外れ、**パートナー所属エンジニアの提案だけ
// PII 層が素通りする**。整合層の裏付け（`registeredSkills`）も空になる。
// 本経路はその 8 列（PII 5 + 整合 3）だけを、**`GATE_RUNNING` の提案 1 件の対象エンジニア 1 人分**
// として読む。ホスト所属・パートナー所属を問わず、提案のゲートはこの 1 経路で台帳を読む。
//
// ============================================================================
// 🔴 汎用のエスケープハッチではない（docs/05 §11.14 ⑤）
// ============================================================================
//   - 引数は `proposalId` の 1 つだけ。`engineer_id` / `partner_company_id` / 表名 / 列名は受け取らない。
//   - 戻り値は固定形の DTO で、**ID を 1 つも含まない**（リレーションを辿って再び開く形が無い）。
//   - `null` = 0 行（対象が無い / `GATE_RUNNING` でない / 別テナント）。理由は区別できない（§4.8 と同じ向き）。
//   - テナント文脈の欠落とパートナー文脈だけは DB が**例外**にする（0 行と区別できないと「対象が無い」と
//     読み違える）。ここでは握り潰さずそのまま上げる。
//   - 🔴 `@ses/db` のバレル（`index.ts`）から export しない。消費者は `gate-target.ts` の
//     `loadProposalGateInput` だけ（`tests/static/gate-engineer-facts-single-path.test.ts` が固定する）。
//   - 🔴 読んだ値をログ・例外メッセージに載せない（docs/05 §11.14 ⑦-4 / §16.2）。
//
// ⚠️ 氏名の表記（カナ・ローマ字）の列を台帳に足したら、**migration の `GRANT` の列 /
//    `RETURNS TABLE` / 本ファイルの写像の 3 箇所**に必ず足すこと（足し忘れがそのまま漏れになる）。

import { Prisma } from '@prisma/client';
import type { EngineerSkillFacts, GateKnownPii } from '@ses/domain';
import type { TenantTransactionClient } from './with-tenant.js';

/**
 * `GATE_RUNNING` の提案 1 件について読んだ、対象エンジニアの台帳由来の事実。
 *
 * 🔴 `knownPii` は `GateInput.knownPii` へそのまま合流できる形（`display_name` は `fullNames` の
 *    1 要素としてしか現れない）。`registeredSkills` の `skillId` はグローバルな `Skill` 辞書の ID であり
 *    個人を指さない。
 */
export type GateEngineerFacts = {
  readonly knownPii: GateKnownPii;
  readonly registeredSkills: readonly EngineerSkillFacts[];
};

type PiiRow = {
  readonly display_name: string | null;
  /** `to_char(birth_date, 'YYYY-MM-DD')`。DateStyle に依存させない。 */
  readonly birth_date: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly affiliation_label: string | null;
};

type SkillRow = {
  readonly skill_id: string;
  /** `numeric(4,1)` を `::text` で受ける（`Prisma.Decimal` の型を経路に持ち込まない）。 */
  readonly years_of_experience: string;
  readonly level: number | null;
};

/** 🔴 空文字・空白だけの値は捨てる（`gate-target.ts` の `nonEmpty` と同じ規律。既知値に空文字が混じると `mask()` が全文を伏せる）。 */
function nonEmpty(values: readonly (string | null | undefined)[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) unique.add(value);
  }
  return [...unique];
}

/**
 * 🔴 `GATE_RUNNING` の提案 1 件について、対象エンジニアの「PII 層の既知値」と「整合層の裏付け」を引く。
 *
 * @param tx `loadProposalGateInput` が開いている同一トランザクション（`app.tenant_id` が立っており、
 *   `app.partner_company_id` が空 = ホスト文脈）。
 * @returns `null` = 0 行（対象が無い / 実行中でない / 別テナント）。呼び出し側は fail-closed に写す
 *   （`GateFactsUnavailableError('ENGINEER_FACTS_UNAVAILABLE')`）。
 * @throws DB がテナント文脈の欠落 / パートナー文脈を検出したときの例外（そのまま上げる）。
 */
export async function readGateEngineerFacts(
  tx: TenantTransactionClient,
  proposalId: string,
): Promise<GateEngineerFacts | null> {
  const piiRows = await tx.$queryRaw<PiiRow[]>(Prisma.sql`
    SELECT display_name,
           to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
           contact_email,
           contact_phone,
           affiliation_label
      FROM app_gate_proposal_engineer_pii(${proposalId}::uuid)`);
  if (piiRows.length === 0) return null;
  const pii = piiRows[0];
  if (pii === undefined || piiRows.length !== 1) {
    // 🔴 関数の契約（0 行または 1 行）が壊れている = migration の不整合。値は載せない。
    throw new Error('app_gate_proposal_engineer_pii が 1 行より多く返しました（migration の不整合）。');
  }

  const skillRows = await tx.$queryRaw<SkillRow[]>(Prisma.sql`
    SELECT skill_id::text AS skill_id,
           years_of_experience::text AS years_of_experience,
           level
      FROM app_gate_proposal_engineer_skills(${proposalId}::uuid)`);

  return {
    knownPii: {
      fullNames: nonEmpty([pii.display_name]),
      birthDates: nonEmpty([pii.birth_date]),
      emails: nonEmpty([pii.contact_email]),
      phones: nonEmpty([pii.contact_phone]),
      affiliations: nonEmpty([pii.affiliation_label]),
    },
    registeredSkills: skillRows.map((row) => ({
      skillId: row.skill_id,
      years: Number(row.years_of_experience),
      level: row.level,
    })),
  };
}
