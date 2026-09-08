// packages/domain/src/gate/consistency.ts
// 🔴 品質ゲート第 3 層（整合層）の**機械的照合**。T-07-07。
//    一次資料: `CLAUDE.md` §3.3 / §12.3 / `BR-61` / docs/02 `F-020` 処理③・`AC-3`・`AC-4`・
//    章 8.5 / docs/05 §11.3 / §11.4 / §11.8。
//
// ============================================================================
// 🔴 この関数の存在理由は「合否を LLM から切り離すこと」である
// ============================================================================
// `gate-inspector`（AI）は PII 層・商流層を検査し、整合層については**警告だけ**を出す。
// 整合層の合否を決めるのは本関数**だけ**であり、その担保は 3 つ重ねてある:
//   ① 出力スキーマ … AI は整合層について `severity: 'WARN'` しか返せない
//      （`packages/ai/src/roles/gate-inspector.ts`。docs/05 §7.13 ④）
//   ② 🔴 **引数型** … 本関数の引数に AI 由来の型・自由文が 1 つも現れない（下記 `ConsistencyInput`）。
//      これを `tests/static/gate-consistency-purity.test.ts`（docs/05 §17.2 #9）が型で検査する
//   ③ 合否の合成 … `decideGate`（T-07-06）が `aiWarnings` を `overall` の計算に入れない
// 「プロンプトにそう書いた」でも「レビューで気をつける」でもなく、**渡せる型が無い**ことが根拠である。
//
// 🔴 **同一入力に対して常に同じ結果**（`F-020 AC-3`）。純粋関数であることに加えて、
//    ①入力配列の並びに依存しない（skillId で束ねてから照合し、指摘は決定的な順に整列する）
//    ②警告のみが存在する状態は PASS である（`F-020 AC-4`。警告はそもそもここに入って来ない）。
//
// ============================================================================
// 🔴 Phase 1 が照合するのは 2 項目だけである（docs/02 章 8.5）
// ============================================================================
// | # | 照合 | Phase | 本関数 |
// |---|---|---|---|
// | ① | 案件の**必須要件**（`MUST`）と提案が主張する内容（`EngineerSnapshot`）の突合 | Phase 1 | ✅ |
// | ② | 重複提案（`F-037`。同一案件 × 近接期間 × 同一人物） | 🔴 **Phase 2** | ❌ 継ぎ目のみ |
// | ③ | 提案が主張する内容と**登録スキル**の矛盾（登録値どうしの突合） | Phase 1 | ✅ |
//
// 🔴 ②は「型として空配列しか渡せない」形で継ぎ目だけを開けてある（`duplicateFindings`）。
//    フィールドを普通の配列型で置いて中身を無視すると、`F-037` を有効化した日に
//    **何も起きないのに検査したつもりになる**（静かな機能欠損）。SP-15 は型と照合を同時に足す。

import {
  GATE_FINDING_EXCERPT_MAX_LENGTH,
  type GateFinding,
  type GateFindingKind,
  type GateVerdict,
} from './types.js';

// ============================================================================
// 1. 入力（🔴 ここに AI の出力・自由文・単価・氏名を 1 つも置かない）
// ============================================================================

/**
 * 案件の要件 1 件（`ProjectRequirement`。docs/05 §3.5）。
 *
 * 🔴 `kind` は `packages/db` の `REQUIREMENT_KINDS`（`'MUST' | 'NICE'`）と同じ union をここに
 *    書き写している。`packages/domain` は何にも依存できない（`CLAUDE.md` §2.1）ためだが、
 *    値が増減すれば**呼び出し側の代入がコンパイルエラーになる**ので、ずれは静かには起きない。
 *
 * 🔴 `skill` が `null`（フリーテキストだけの要件）は**機械的に照合できない**ため対象外である。
 *    「照合できないから FAIL」にはしない —— 直せる元データが無い FAIL は、`BR-18`
 *    （FAIL の解消手段は元データの修正のみ）を空回りさせるだけである。
 *    フリーテキスト要件との意味的な齟齬は `gate-inspector` が**警告**として併記する
 *    （`F-020` 処理③の「AI は補助的に指摘するだけ」がまさにこの領分）。
 */
export type ProjectRequirementFacts = {
  readonly kind: 'MUST' | 'NICE';
  /** 辞書のスキルに紐づく要件だけが照合対象。`label` は `Skill.name`（🔴 PII を入れない）。 */
  readonly skill: { readonly id: string; readonly label: string } | null;
  /** `ProjectRequirement.requiredYears`。`null` は「年数の指定なし」。 */
  readonly requiredYears: number | null;
};

/** `EngineerSnapshot.skills`（提案時点の凍結コピー）の 1 件。 */
export type SnapshotSkillFacts = {
  readonly skillId: string;
  /** 🔴 指摘の `excerpt` に出る（docs/05 §3.6「PII はマスク済み」）。辞書名を渡すこと。 */
  readonly label: string;
  readonly years: number;
  /** `1..5`。`null` は「レベルの主張なし」。 */
  readonly level: number | null;
};

/**
 * 提案が**テナント外へ主張する**エンジニア情報（`EngineerSnapshot`）。
 *
 * 🔴 氏名・所属会社名・単価をここに持たせない。整合層は「主張が要件と台帳に裏付けられるか」だけを
 *    見る層であり、PII と商流は別の層（`gate-inspector`）の担当である。
 */
export type EngineerSnapshotFacts = {
  readonly skills: readonly SnapshotSkillFacts[];
};

/** 台帳の登録スキル（`EngineerSkill`）1 件。🔴 裏付けの側なので表示名を持たない。 */
export type EngineerSkillFacts = {
  readonly skillId: string;
  readonly years: number;
  readonly level: number | null;
};

/**
 * 照合の対象（提案）。
 *
 * 🔴 **3 つを 1 つの束にしている**（docs/05 §11.3 のスケッチは 3 つを独立した任意項目として
 *    書いていた。差分は §11.8 に記録）。理由は 1 つで、`requirements` だけが渡って `snapshot` が
 *    渡らない形を**作れなくする**ためである。その形を許すと「必須要件の照合が黙って行われない」
 *    という最悪の壊れ方（`F-020` の中核が空回りしても PASS）が型の上で成立してしまう。
 *
 * 案件の公開・スキルシートの外部共有のように、エンジニアについて何も主張しない対象では
 * `ConsistencyInput.subject` 自体を渡さない（＝ 照合するものが無い ＝ PASS）。
 */
export type ConsistencySubject = {
  readonly snapshot: EngineerSnapshotFacts;
  readonly requirements: readonly ProjectRequirementFacts[];
  readonly registeredSkills: readonly EngineerSkillFacts[];
};

/**
 * 🔴 整合層の合否判定の入力（docs/05 §11.3）。
 *
 * **ここに現れてよいのは、DB に永続化された値だけである。** LLM の出力（層の判定・指摘・警告）、
 * および検査対象の自由文（件名・本文・公開サマリ）は 1 つも入らない —— 自由文を入れると
 * 「同じ入力で同じ結果」は保てても「合否が本文の書きぶりで揺れる」ことになり、
 * 結局 AI と同じ不安定さを機械側に持ち込む。
 */
export type ConsistencyInput = {
  readonly subject?: ConsistencySubject;
  /**
   * 🔴 **Phase 2（`F-037` / SP-15）の継ぎ目**。Phase 1 では**空配列しか渡せない**
   *    （`never[]` なので要素を 1 つでも書くとコンパイルエラーになる）。
   *
   * SP-15 は「型を `readonly DuplicateFinding[]` に広げる」ことと「照合を実装する」ことを
   * 同時にしか行えない。普通の配列型で置いて中身を無視する実装にすると、`F-037` を
   * 有効化した日に**検知結果が黙って捨てられる**（`CLAUDE.md` §7 の「重複提案」が
   * 検知できているのにゲートが素通りする）。
   */
  readonly duplicateFindings?: readonly never[];
};

/** 整合層の判定結果（docs/05 §11.3）。🔴 `verdict` は `findings` から一意に決まる。 */
export type ConsistencyDecision = {
  readonly verdict: GateVerdict;
  readonly findings: readonly GateFinding[];
};

// ============================================================================
// 2. 指摘の作り方（docs/05 §3.6 / §11.7）
// ============================================================================

/**
 * 🔴 整合層の指摘が指す欄は常に `snapshot` である（Phase 1）。
 *
 * 本文中の位置ではなく「凍結された主張そのもの」の不一致なので、`offsetStart` / `offsetEnd` は
 * `null`（＝ 画面は「箇所を特定できませんでした」と表示する。docs/05 §11.7）。
 * ⚠️ Phase 3 の契約書（`field='contract_document'`。docs/05 §11.1）は差し込みの未解決項目を
 *    照合する別の入力であり、そのとき欄が増える。
 */
const CONSISTENCY_FIELD = 'snapshot';

/** 🔴 整合層の機械的照合は**必ず `BLOCK`**（＝ FAIL を作る）。`WARN` は AI 側の `aiWarnings` にしか無い。 */
const CONSISTENCY_SEVERITY = 'BLOCK';

/** 抜粋の区切り。🔴 `{主張}/{裏付け（または要求）}` の 1 形式に統一する（docs/05 §11.8 ④）。 */
const CLAIM_SEPARATOR = '/';

/** 値が無いことの表示。`excerpt` はロケールに依存しないデータ表記にする（文言は `packages/i18n`）。 */
const ABSENT = '-';

type FindingRow = {
  readonly kind: GateFindingKind;
  /** 並びを決定的にするためのキー（指摘そのものには載らない）。 */
  readonly skillId: string;
  readonly excerpt: string;
};

/**
 * 年数の内部表現は 1/10 年（`Decimal(4,1)` に対応する整数）。
 *
 * 🔴 浮動小数のまま比較しない。`2.9 < 3.0` のような比較は今の桁数なら偶然通るが、
 *    「通ってしまう」ことに依存した合否は、桁が増えた日に静かに壊れる。
 */
function toTenths(field: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} は有限の数値である必要があります（受け取った値: ${value}）。`);
  }
  if (value < 0) {
    throw new RangeError(`${field} は 0 以上である必要があります（受け取った値: ${value}）。`);
  }
  return Math.round(value * 10);
}

function toTenthsOrNull(field: string, value: number | null): number | null {
  return value === null ? null : toTenths(field, value);
}

function toLevel(field: string, value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
  return value;
}

/** 「主張として強い方」を採る（`null` = 主張なし が最も弱い）。 */
function stronger(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** 「裏付けとして弱い方」を採る（`null` = 裏付けなし が最も弱い）。 */
function weaker(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.min(a, b);
}

/** 表示名が食い違ったときは辞書順で小さい方を採る（入力の並びで結果を変えないため）。 */
function stableLabel(a: string, b: string): string {
  return a <= b ? a : b;
}

function formatTenths(tenths: number | null): string {
  return tenths === null ? ABSENT : (tenths / 10).toFixed(1);
}

function formatLevel(level: number | null): string {
  return level === null ? ABSENT : `L${level}`;
}

/** 🔴 `excerpt` は最大 80 文字（docs/05 §3.6）。**数値の側を残し、名前の側を詰める。** */
function buildExcerpt(label: string, detail: string | undefined): string {
  if (detail === undefined) return truncate(label, GATE_FINDING_EXCERPT_MAX_LENGTH);
  const budget = GATE_FINDING_EXCERPT_MAX_LENGTH - detail.length - 1;
  if (budget <= 0) return truncate(detail, GATE_FINDING_EXCERPT_MAX_LENGTH);
  return `${truncate(label, budget)} ${detail}`;
}

/**
 * UTF-16 長で切り詰める。
 *
 * 🔴 サロゲートペアを割らない。割ると壊れた単独サロゲートが `ReviewGate.findings`（JSON）に入り、
 *    保存・表示・比較のどこで落ちるかが環境依存になる。
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(max - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, max - 1) : cut;
}

function toFinding(row: FindingRow): GateFinding {
  return {
    layer: 'CONSISTENCY',
    kind: row.kind,
    field: CONSISTENCY_FIELD,
    offsetStart: null,
    offsetEnd: null,
    excerpt: row.excerpt,
    severity: CONSISTENCY_SEVERITY,
  };
}

/** 指摘の並び。🔴 入力の並びに依存させない（`localeCompare` は使わない —— ロケールで変わる）。 */
function compareRows(a: FindingRow, b: FindingRow): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.skillId !== b.skillId) return a.skillId < b.skillId ? -1 : 1;
  if (a.excerpt !== b.excerpt) return a.excerpt < b.excerpt ? -1 : 1;
  return 0;
}

// ============================================================================
// 3. 入力の正規化（skillId で束ねる）
// ============================================================================

type ClaimedSkill = {
  readonly skillId: string;
  readonly label: string;
  /** 1/10 年。 */
  readonly years: number;
  readonly level: number | null;
};

type BackedSkill = { readonly years: number; readonly level: number | null };

type RequiredSkill = {
  readonly skillId: string;
  readonly label: string;
  /** 1/10 年。`null` は年数指定なし。 */
  readonly requiredYears: number | null;
};

/**
 * 提案が主張しているスキル。同じ `skillId` が複数あれば**強い方の主張**に束ねる。
 *
 * 🔴 「強い方」を採るのは、外部に出るのが最も強い主張だからである。弱い方に束ねると、
 *    誇張された主張が照合をすり抜ける。
 */
function collectClaimed(skills: readonly SnapshotSkillFacts[]): Map<string, ClaimedSkill> {
  const claimed = new Map<string, ClaimedSkill>();
  for (const skill of skills) {
    const years = toTenths('snapshot.skills[].years', skill.years);
    const level = toLevel('snapshot.skills[].level', skill.level);
    const previous = claimed.get(skill.skillId);
    claimed.set(
      skill.skillId,
      previous === undefined
        ? { skillId: skill.skillId, label: skill.label, years, level }
        : {
            skillId: skill.skillId,
            label: stableLabel(previous.label, skill.label),
            years: Math.max(previous.years, years),
            level: stronger(previous.level, level),
          },
    );
  }
  return claimed;
}

/** 台帳の裏付け。同じ `skillId` が複数あれば**弱い方**に束ねる（裏付けは控えめに見る）。 */
function collectBacked(rows: readonly EngineerSkillFacts[]): Map<string, BackedSkill> {
  const backed = new Map<string, BackedSkill>();
  for (const row of rows) {
    const years = toTenths('registeredSkills[].years', row.years);
    const level = toLevel('registeredSkills[].level', row.level);
    const previous = backed.get(row.skillId);
    backed.set(
      row.skillId,
      previous === undefined
        ? { years, level }
        : { years: Math.min(previous.years, years), level: weaker(previous.level, level) },
    );
  }
  return backed;
}

/**
 * 🔴 **`MUST` だけ**を集める（`NICE` は足切りにも整合層にも効かない。`F-029` 処理①と同じ区分）。
 *    同じスキルへの `MUST` が複数あれば**最も厳しい年数**に束ねる。
 */
function collectRequired(
  requirements: readonly ProjectRequirementFacts[],
): Map<string, RequiredSkill> {
  const required = new Map<string, RequiredSkill>();
  for (const requirement of requirements) {
    if (requirement.kind !== 'MUST') continue;
    const skill = requirement.skill;
    if (skill === null) continue; // フリーテキストのみ = 機械的に照合できない（上の 🔴 参照）
    const requiredYears = toTenthsOrNull('requirements[].requiredYears', requirement.requiredYears);
    const previous = required.get(skill.id);
    required.set(
      skill.id,
      previous === undefined
        ? { skillId: skill.id, label: skill.label, requiredYears }
        : {
            skillId: skill.id,
            label: stableLabel(previous.label, skill.label),
            requiredYears: stronger(previous.requiredYears, requiredYears),
          },
    );
  }
  return required;
}

// ============================================================================
// 4. 照合（① 必須要件 / ③ 登録スキルとの矛盾）
// ============================================================================

/** ① 案件の必須要件との齟齬（docs/02 章 8.5 ①）。 */
function checkMustRequirements(
  required: Map<string, RequiredSkill>,
  claimed: Map<string, ClaimedSkill>,
): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const requirement of required.values()) {
    const claim = claimed.get(requirement.skillId);
    if (claim === undefined) {
      rows.push({
        kind: 'MUST_REQUIREMENT_MISMATCH',
        skillId: requirement.skillId,
        excerpt: buildExcerpt(requirement.label, yearsDetail(null, requirement.requiredYears)),
      });
      continue;
    }
    if (requirement.requiredYears !== null && claim.years < requirement.requiredYears) {
      rows.push({
        kind: 'MUST_REQUIREMENT_MISMATCH',
        skillId: requirement.skillId,
        excerpt: buildExcerpt(claim.label, yearsDetail(claim.years, requirement.requiredYears)),
      });
    }
  }
  return rows;
}

/**
 * ③ 提案の主張と登録スキルの矛盾（docs/02 章 8.5 ③「登録値どうしの突合」）。
 *
 * 🔴 **見るのは「主張が台帳の裏付けを超えていないか」の一方向だけ**である。
 *    台帳の方が大きい（控えめな主張）を不一致にしてはならない —— 提案は作成時点で凍結され、
 *    以後の台帳更新は提案内容を変えない（`F-019 AC-2`）。台帳は時間とともに増えるので、
 *    両方向を見ると**古い提案がすべて FAIL になり、しかも直す手段が無い**。
 */
function checkAgainstLedger(
  claimed: Map<string, ClaimedSkill>,
  backed: Map<string, BackedSkill>,
): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const claim of claimed.values()) {
    const backing = backed.get(claim.skillId);
    if (backing === undefined) {
      // 台帳に無いスキルを外部へ主張している（裏付けが 1 件も無い）。
      rows.push({
        kind: 'SKILL_SHEET_MISMATCH',
        skillId: claim.skillId,
        excerpt: buildExcerpt(claim.label, undefined),
      });
      continue;
    }
    if (claim.years > backing.years) {
      rows.push({
        kind: 'SKILL_SHEET_MISMATCH',
        skillId: claim.skillId,
        excerpt: buildExcerpt(claim.label, yearsDetail(claim.years, backing.years)),
      });
      continue;
    }
    if (claim.level !== null && (backing.level === null || claim.level > backing.level)) {
      rows.push({
        kind: 'SKILL_SHEET_MISMATCH',
        skillId: claim.skillId,
        excerpt: buildExcerpt(claim.label, levelDetail(claim.level, backing.level)),
      });
    }
  }
  return rows;
}

/** `{主張}/{要求 or 裏付け}`。両方無いときは付けない（名前だけの抜粋になる）。 */
function yearsDetail(claimed: number | null, expected: number | null): string | undefined {
  if (claimed === null && expected === null) return undefined;
  return `${formatTenths(claimed)}${CLAIM_SEPARATOR}${formatTenths(expected)}`;
}

function levelDetail(claimed: number | null, backed: number | null): string {
  return `${formatLevel(claimed)}${CLAIM_SEPARATOR}${formatLevel(backed)}`;
}

/**
 * 🔴 Phase 2 の継ぎ目が使われていないことの実行時の保険（型では `never[]` が既に禁じている）。
 *
 * 型を握り潰して渡された場合に**黙って無視しない**。整合層で「渡されたのに見なかった」は、
 * 重複提案が検知されているのにゲートが素通りすることを意味する。
 */
function assertDuplicateSeamUnused(duplicateFindings: readonly never[] | undefined): void {
  if (duplicateFindings !== undefined && duplicateFindings.length > 0) {
    throw new RangeError(
      '重複提案の照合は Phase 2（F-037 / SP-15）で有効化されます。' +
        'duplicateFindings に要素を渡すには、decideConsistency 側の照合を同時に実装してください（docs/05 §11.8 ⑤）。',
    );
  }
}

// ============================================================================
// 5. 公開関数
// ============================================================================

/**
 * 🔴 整合層の合否（純粋関数。`F-020 AC-3` / `BR-61`）。
 *
 * - 不一致が 1 件でもあれば `FAIL`、無ければ `PASS`（docs/02 章 8.5「機械的照合で不一致があれば FAIL」）。
 * - 返す指摘はすべて `severity='BLOCK'`。**警告は 1 つも返さない**（警告は `gate-inspector` の
 *   出力であり、`ReviewGate.aiWarnings` という別の列に入る。合否には効かない = `F-020 AC-4`）。
 * - 🔴 **AI が失敗しても、上限で呼べなくても、本関数の結果は変わらない**（`F-027 AC-5`。
 *   HELD のときも `ReviewGate.consistencyVerdict` は確定値として保持される）。
 *
 * @throws RangeError 年数・レベルが数値として不正なとき（黙って PASS に倒さない）。
 */
export function decideConsistency(input: ConsistencyInput): ConsistencyDecision {
  assertDuplicateSeamUnused(input.duplicateFindings);

  const subject = input.subject;
  if (subject === undefined) {
    // 案件の公開・スキルシートの外部共有など、エンジニアについて何も主張しない対象。
    return { verdict: 'PASS', findings: [] };
  }

  const claimed = collectClaimed(subject.snapshot.skills);
  const backed = collectBacked(subject.registeredSkills);
  const required = collectRequired(subject.requirements);

  const rows = [
    ...checkMustRequirements(required, claimed),
    ...checkAgainstLedger(claimed, backed),
  ].sort(compareRows);

  return {
    verdict: rows.length === 0 ? 'PASS' : 'FAIL',
    findings: rows.map(toFinding),
  };
}
