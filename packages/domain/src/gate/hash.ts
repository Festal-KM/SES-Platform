// packages/domain/src/gate/hash.ts
// 🔴 ゲート対象の内容のハッシュ（docs/05 §11.5）のうち、**正規化された連結を作る側**。T-07-08。
//
// ============================================================================
// 🔴 なぜ「連結」と「SHA-256」を分けるのか
// ============================================================================
// §11.5 は `gateContentHash()` を domain の純粋関数として描いているが、`packages/domain` は
// `node:crypto` を import できない（`tests/static/domain-purity.test.ts`。docs/05 §17.2 #14）。
// そこで **「何を材料にするか」を domain（本ファイル）に、「SHA-256 を取る」ことを
// `packages/db`（`gate-content-hash.ts`）に**分ける。材料の決め方が分かれると
// 「提案側のハッシュ」と「ゲート側のハッシュ」が別物になり、承認 CAS（§11.5 手順 3）が
// 永久に 0 件更新になる —— 分けてよいのは「取り方」だけである。
//
// ============================================================================
// 🔴 この関数が守るもの
// ============================================================================
// ① **内容が 1 文字でも変われば別の値になる**（＝ 承認が無効になる。§11.5 / `F-021`）。
// ② **同じ内容なら常に同じ値になる**（＝ 同じ `jobId` になり、ゲートが多重化しない。§9.3）。
//    したがって **並び順・区切り・数値の書式のすべてを固定する**。JSON の
//    `JSON.stringify` に頼らない —— キーの順序は入力の作り方（Prisma / jsonb）に依存し、
//    同じ内容でも別の文字列になりうる。
// ③ **区切り文字の混入で別の内容が同じ連結にならない**（衝突を作らない）。
//    値は必ず `長さ:値` の形で書き出すため、値の中に区切りが現れても境界が動かない。
//
// 🔴 **`GATE_HASH_ALGORITHM_VERSION` を変えると、既存の承認待ち・承認済みがすべて
//    「内容が変わった」と判定される**（再検証が要る）。材料や書式を変えるときは必ず上げること。
//    上げ忘れると、**中身が違うのに同じハッシュ**になる版が生まれ、§11.5 が静かに破れる。

import type { GateTargetType } from './types.js';

/** 🔴 正規化の版。材料・書式を変えたら必ず上げる（本ファイル冒頭の 🔴）。 */
export const GATE_HASH_ALGORITHM_VERSION = 'v1';

/** 凍結された主張のスキル 1 件（`EngineerSnapshot.skills` の 1 要素）。 */
export type GateHashSkill = {
  readonly skillId: string;
  /** 辞書名。🔴 PII を入れない（`ConsistencySubject` と同じ規律。docs/05 §11.8 ⑦-2）。 */
  readonly label: string;
  readonly years: number;
  readonly level: number | null;
};

/** 提案に添付された版（`EngineerSnapshot.skillSheetId` が指す `SkillSheet`）。 */
export type GateHashAttachment = {
  readonly skillSheetId: string;
  readonly objectKey: string;
  /**
   * 🔴 §11.5 の「添付の `objectKey` + `versionId`」に対応する。`skill_sheets` は S3 の
   *    版 ID を列として持たない（docs/05 §3.4）ため、**台帳の版番号**（`SkillSheet.version`）を
   *    使う。`objectKey` は版ごとに異なる（§14.1）ので、2 つで版を一意に特定できる。
   */
  readonly version: number;
};

/**
 * 提案時点の凍結コピー（`EngineerSnapshot`）のうち、内容のハッシュに入るもの。
 *
 * 🔴 金額・日付は**文字列で受け取る**（`Decimal` / `Date` の表現を domain に持ち込まない。
 *    書式の決定は読み出す側 = `packages/db` が行い、ここでは受け取った文字列をそのまま綴じる）。
 */
export type GateHashSnapshot = {
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly skills: readonly GateHashSkill[];
  /** 十進の文字列（例: `600000.00`）。 */
  readonly unitPriceMin: string | null;
  readonly unitPriceMax: string | null;
  /** `YYYY-MM-DD`。 */
  readonly availableFrom: string | null;
  readonly attachment: GateHashAttachment | null;
};

/**
 * 提案（`PROPOSAL`）の材料（docs/05 §11.5 の列挙そのもの）。
 *
 * 🔴 **提案先（`recipientCompanyName` / `recipientEmail`）も材料である。** 宛先が変われば
 *    「その公開範囲で出してはならない語」が変わりうるため、内容が同じでも再検証が要る。
 */
export type ProposalGateHashInput = {
  readonly targetType: 'PROPOSAL';
  readonly subject: string | null;
  readonly body: string | null;
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  /** 十進の文字列（例: `800000.00`）。 */
  readonly offeredUnitPrice: string | null;
  /** `YYYY-MM-DD`。 */
  readonly offeredStartDate: string | null;
  readonly workStyle: string | null;
  /** 🔴 `null` は「凍結コピーがまだ無い」。**空の凍結コピーと区別する**（別の連結になる）。 */
  readonly snapshot: GateHashSnapshot | null;
};

/**
 * 🔴 ゲート対象の内容（Phase 1 の対象種別のうち提案）。
 *
 * ⚠️ `PROJECT_PUBLISH`（T-07-09）/ `SKILL_SHEET_SHARE` / `CHAT_ATTACHMENT` / `CONTRACT_DOCUMENT` は
 *    ここに**まだ無い**。足すときは `targetType` で判別する合併にし、`gateHashSource` の
 *    `switch` を網羅させること（足し忘れがコンパイルエラーになる）。
 */
export type GateHashInput = ProposalGateHashInput;

/** 🔴 材料が壊れている（読み出す側で握り潰さない。docs/05 §11.9 ②）。 */
export class GateHashInputError extends RangeError {
  constructor(detail: string) {
    super(`ゲート対象の内容のハッシュを組み立てられません: ${detail}（docs/05 §11.5）。`);
    this.name = 'GateHashInputError';
  }
}

/**
 * 1 つの値を「境界が動かない」形で書き出す。
 *
 * - `null` … `name=-`（長さの前置きは必ず数字なので、`-` と衝突しない）
 * - それ以外 … `name={UTF-16 の長さ}:{値}`
 */
function field(name: string, value: string | null): string {
  return value === null ? `${name}=-` : `${name}=${value.length}:${value}`;
}

/** 年数（1/10 年に丸めた 1 桁小数）。🔴 不正な数値は握り潰さない（`decideConsistency` と同じ規律）。 */
function years(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new GateHashInputError(`経験年数が不正です（${String(value)}）`);
  }
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** レベル（整数）。 */
function level(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    throw new GateHashInputError(`スキルのレベルが整数ではありません（${String(value)}）`);
  }
  return String(value);
}

/**
 * 🔴 スキルの並びをハッシュに影響させない（凍結コピーの JSON の並びは保存経路に依存する）。
 *    比較はコードポイント順の素の比較である（`localeCompare` を使わない。docs/05 §11.8 ③ と同じ理由 ——
 *    ロケールで並びが変わると、同じ内容が別のハッシュになる）。
 */
function sortedSkills(skills: readonly GateHashSkill[]): readonly GateHashSkill[] {
  return [...skills].sort((a, b) => {
    if (a.skillId !== b.skillId) return a.skillId < b.skillId ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    if (a.years !== b.years) return a.years < b.years ? -1 : 1;
    const left = a.level ?? Number.NEGATIVE_INFINITY;
    const right = b.level ?? Number.NEGATIVE_INFINITY;
    if (left !== right) return left < right ? -1 : 1;
    return 0;
  });
}

function snapshotLines(snapshot: GateHashSnapshot | null): readonly string[] {
  if (snapshot === null) return [field('snapshot', null)];
  const skills = sortedSkills(snapshot.skills);
  return [
    field('snapshot', 'present'),
    field('snapshot.displayName', snapshot.displayName),
    field('snapshot.affiliationLabel', snapshot.affiliationLabel),
    field('snapshot.unitPriceMin', snapshot.unitPriceMin),
    field('snapshot.unitPriceMax', snapshot.unitPriceMax),
    field('snapshot.availableFrom', snapshot.availableFrom),
    field('snapshot.skillCount', String(skills.length)),
    ...skills.flatMap((skill, index) => [
      field(`snapshot.skill[${index}].skillId`, skill.skillId),
      field(`snapshot.skill[${index}].label`, skill.label),
      field(`snapshot.skill[${index}].years`, years(skill.years)),
      field(`snapshot.skill[${index}].level`, level(skill.level)),
    ]),
    field('snapshot.attachment', snapshot.attachment === null ? null : 'present'),
    field('snapshot.attachment.skillSheetId', snapshot.attachment?.skillSheetId ?? null),
    field('snapshot.attachment.objectKey', snapshot.attachment?.objectKey ?? null),
    field(
      'snapshot.attachment.version',
      snapshot.attachment === null ? null : String(snapshot.attachment.version),
    ),
  ];
}

/**
 * 🔴 ゲート対象の内容を、正規化された 1 本の文字列にする（docs/05 §11.5）。**純粋関数。**
 *
 * 🔴 これ自体はハッシュではない。SHA-256 を取るのは `packages/db` の `gateContentHash()` であり、
 *    **その 1 実装だけが `ReviewGate.contentHash` / `Proposal.contentHash` の出所である。**
 */
export function gateHashSource(input: GateHashInput): string {
  const targetType: GateTargetType = input.targetType;
  switch (input.targetType) {
    case 'PROPOSAL':
      return [
        `gate-content/${GATE_HASH_ALGORITHM_VERSION}`,
        field('targetType', targetType),
        field('subject', input.subject),
        field('body', input.body),
        field('recipientCompanyName', input.recipientCompanyName),
        field('recipientEmail', input.recipientEmail),
        field('offeredUnitPrice', input.offeredUnitPrice),
        field('offeredStartDate', input.offeredStartDate),
        field('workStyle', input.workStyle),
        ...snapshotLines(input.snapshot),
      ].join('\n');
    default: {
      // 🔴 対象種別を足したらここでコンパイルエラーになる（材料を決めずに通せない）。
      const exhaustive: never = input.targetType;
      throw new GateHashInputError(`未知の対象種別です（${String(exhaustive)}）`);
    }
  }
}
