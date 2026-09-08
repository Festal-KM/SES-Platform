// packages/domain/src/gate/types.ts
// 🔴 品質ゲート（CLAUDE.md §3.3 / docs/05 §3.6 / §11）の値集合と指摘の構造。T-07-05。
//
// 🔴 なぜ `packages/domain` に置くか（CLAUDE.md §2.1）:
//    ①`gate-inspector` の出力スキーマを組み立てる側（`packages/ai`）②整合層の機械的照合
//    （`decideConsistency`。T-07-07）③`ReviewGate.findings` を保存・整形する側（`packages/db` /
//    `apps/web`）が**同じ 1 つの構造**を見る必要がある。`packages/ai` と `packages/db` は
//    相互に依存できないため、共有点は domain しか無い（`AI_ROLES` と同じ整理。docs/05 §7.9 ⑤）。
//
// 🔴 **`findings` の構造は固定する**（docs/05 §3.6）。承認画面（`S-020` / `S-021`）が
//    該当箇所を示すために依存しており、増減は画面と DB の両方に波及する。

/** 品質ゲートの 3 層（CLAUDE.md §3.3）。 */
export const GATE_LAYERS = ['PII', 'COMMERCE', 'CONSISTENCY'] as const;

export type GateLayer = (typeof GATE_LAYERS)[number];

/** 層ごとの合否（docs/05 §3.6 `GateVerdict`）。🔴 「保留」はここに無い（`ReviewGate.execution` の属性）。 */
export const GATE_VERDICTS = ['PASS', 'FAIL'] as const;

export type GateVerdict = (typeof GATE_VERDICTS)[number];

/**
 * 指摘の種別（docs/05 §3.6）。層との対応:
 * - PII 層: `FULL_NAME` / `BIRTH_DATE` / `CONTACT` / `PHOTO` / `AFFILIATION`
 * - 商流層: `UNIT_PRICE` / `END_CLIENT` / `OTHER_COMPANY`
 * - 整合層: `MUST_REQUIREMENT_MISMATCH` / `DUPLICATE_PROPOSAL` / `SKILL_SHEET_MISMATCH`
 */
export const GATE_FINDING_KINDS = [
  'FULL_NAME',
  'BIRTH_DATE',
  'CONTACT',
  'PHOTO',
  'AFFILIATION',
  'UNIT_PRICE',
  'END_CLIENT',
  'OTHER_COMPANY',
  'MUST_REQUIREMENT_MISMATCH',
  'DUPLICATE_PROPOSAL',
  'SKILL_SHEET_MISMATCH',
] as const;

export type GateFindingKind = (typeof GATE_FINDING_KINDS)[number];

/** 指摘が指す欄。🔴 `offsetStart` / `offsetEnd` は**この欄の中の** UTF-16 オフセットである（docs/05 §11.7）。 */
export const GATE_FINDING_FIELDS = [
  'subject',
  'body',
  'snapshot',
  'attachment',
  'public_summary',
  'contract_document',
] as const;

export type GateFindingField = (typeof GATE_FINDING_FIELDS)[number];

/** 🔴 `BLOCK` のみが FAIL を作る。`WARN` は `aiWarnings` 側にのみ入る（docs/05 §3.6 / `BR-61`）。 */
export const GATE_FINDING_SEVERITIES = ['BLOCK', 'WARN'] as const;

export type GateFindingSeverity = (typeof GATE_FINDING_SEVERITIES)[number];

/**
 * 該当箇所の抜粋の最大長（docs/05 §3.6「最大 80 文字。PII はマスク済み」）。
 *
 * 🔴 上限を持つ理由は 2 つ: ①画面が該当箇所を示すためのもので本文の複製ではない
 *    ②長い抜粋は `ReviewGate.findings`（JSON）に本文をそのまま溜め込む経路になる。
 */
export const GATE_FINDING_EXCERPT_MAX_LENGTH = 80;

/** 共有先の区分（docs/05 §11.3 `GateInput.audience.kind`）。🔴 商流層の判定基準がこれで変わる。 */
export const GATE_AUDIENCE_KINDS = ['PARTNER', 'EXTERNAL_CLIENT'] as const;

export type GateAudienceKind = (typeof GATE_AUDIENCE_KINDS)[number];

/**
 * ゲートの指摘（docs/05 §3.6）。`ReviewGate.findings` / `ReviewGate.aiWarnings` に入る形。
 *
 * 🔴 `offsetStart` / `offsetEnd` は「箇所を特定できない」ときに `null` を入れる。
 *    空文字や `-1` を使わない（画面は `null` を「箇所を特定できませんでした」と表示する。docs/05 §11.7）。
 */
export type GateFinding = {
  readonly layer: GateLayer;
  readonly kind: GateFindingKind;
  readonly field: GateFindingField;
  readonly offsetStart: number | null;
  readonly offsetEnd: number | null;
  readonly excerpt: string;
  readonly severity: GateFindingSeverity;
};
