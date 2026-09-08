// packages/ai/src/roles/gate-inspector.ts
// 🔴 `gate-inspector`（CLAUDE.md §12.2）のロール定義。**責務は 2 つだけ**:
//    ① PII 層（第 1 層）と商流層（第 2 層）の検査の実行
//    ② 整合層（第 3 層）の**警告**の生成
//    🔴 **整合層の合否は判定しない**（`BR-61` / CLAUDE.md §12.3）。それは
//    `packages/domain` の機械的照合（`decideConsistency`。T-07-07）の仕事である。
//
// ============================================================================
// 🔴 「整合層の合否を判定しない」を、出力スキーマで担保している
// ============================================================================
// 整合層の警告は `severity: 'WARN'` の**リテラル**である（`z.literal`）。したがって
// LLM が整合層について `BLOCK` を返す形は **JSON Schema としても Zod としても存在しない**。
// 「プロンプトにそう書いた」だけでは、モデルが違う値を返した瞬間に前提が崩れる。
// 🔴 合否の合成（`decideGate`。T-07-06）は `consistencyWarnings` を `overall` に入れない
//    ——「警告が合否を変えない」の最終的な担保はそちらであり、ここはその手前の門である。
//
// 🔴 プロンプトの文面はここに書かない（`prompts/roles/gate-inspector.v1.ts`。CLAUDE.md §3.2）。
//    ここが持つのは入出力スキーマ・モデル段・上限といった**版に依らない契約**である
//    （プロンプト版を上げるたびに出力スキーマを変えない。docs/05 §7.7）。

import { z } from 'zod';
import {
  GATE_AUDIENCE_KINDS,
  GATE_FINDING_EXCERPT_MAX_LENGTH,
  GATE_FINDING_FIELDS,
  GATE_FINDING_SEVERITIES,
  GATE_VERDICTS,
  ROLE_PURPOSE,
  type GateAudienceKind,
  type GateFindingField,
  type GateFindingKind,
} from '@ses/domain';
import type { MaskedText } from '../mask.js';
import {
  currentGateInspectorPrompt,
  gateInspectorPromptAtVersion,
  MASK_PLACEHOLDER_LIST,
  PROMPT_KIT,
  type GateInspectorPromptFacts,
  type GateInspectorPromptModule,
} from '../prompts.js';
import { defineRoleSpec } from './define.js';
import type { RoleSpec } from './types.js';

// ============================================================================
// 1. 層ごとに使える指摘の種別（docs/05 §3.6 の `GateFinding.kind` の部分集合）
// ============================================================================

/** PII 層（第 1 層）。`BR-11` の 5 種にそのまま対応する。 */
export const GATE_INSPECTOR_PII_KINDS = [
  'FULL_NAME',
  'BIRTH_DATE',
  'CONTACT',
  'PHOTO',
  'AFFILIATION',
] as const satisfies readonly GateFindingKind[];

/** 商流層（第 2 層）。`BR-12` と CLAUDE.md §3.1（他社の露出）に対応する。 */
export const GATE_INSPECTOR_COMMERCE_KINDS = [
  'UNIT_PRICE',
  'END_CLIENT',
  'OTHER_COMPANY',
] as const satisfies readonly GateFindingKind[];

/**
 * 整合層（第 3 層）の**警告**の種別。
 *
 * 🔴 `DUPLICATE_PROPOSAL` を含めない。重複提案は「同一案件 × 近接期間 × 同一人物」の
 *    機械的な照合（`F-037`。Phase 2）で決まるものであり、LLM は本文からそれを知りようがない。
 *    含めると、根拠の無い警告が承認者の判断を濁らせる。
 */
export const GATE_INSPECTOR_CONSISTENCY_KINDS = [
  'MUST_REQUIREMENT_MISMATCH',
  'SKILL_SHEET_MISMATCH',
] as const satisfies readonly GateFindingKind[];

/** 1 層あたりの指摘の上限（出力トークンの暴走と、`ReviewGate.findings` の肥大を防ぐ）。 */
export const GATE_INSPECTOR_MAX_FINDINGS = 30;
/** 警告の上限（同上。警告は合否に効かないので更に絞る）。 */
export const GATE_INSPECTOR_MAX_WARNINGS = 20;
/** 1 回の検査で渡せる欄の数（`GATE_FINDING_FIELDS` の全種を 1 度に渡せる幅）。 */
export const GATE_INSPECTOR_MAX_SECTIONS = GATE_FINDING_FIELDS.length;

// ============================================================================
// 2. 入力（🔴 `MaskedText` 以外を受け取れない）
// ============================================================================

/** 検査する欄 1 つ。🔴 `text` は `mask()` を通した本文である（`BR-11` / `BR-12`）。 */
export type GateInspectorSection = {
  readonly field: GateFindingField;
  readonly text: MaskedText;
};

/**
 * `gate-inspector` の入力（docs/05 §7.1）。
 *
 * 🔴 伏せ字の語彙（`maskedPlaceholders`）を**ここに置かない**。呼び出し側が組み立てる形にすると、
 *    「台帳の氏名を渡す」実装が書けてしまう（`BR-11` を破る経路）。プロンプトには
 *    `buildPrompt` が `mask()` の表から与える（docs/05 §7.13）。
 */
export type GateInspectorInput = {
  readonly audienceKind: GateAudienceKind;
  readonly sections: readonly GateInspectorSection[];
};

/**
 * 🔴 生の `string` を受け付けない（`MaskedText` はブランド型であり、`z.string()` では型が合わない）。
 *    実行時にできる検査は「空でない文字列であること」までであり、**マスキングの強制は型が担う**
 *    （docs/05 §7.10 ①）。ここはその型の下で、前工程の出力が壊れていないことだけを見る。
 */
const maskedTextSchema = z.custom<MaskedText>(
  (value) => typeof value === 'string' && value.length > 0,
  { message: '検査対象の本文が空です（mask() の出力を渡してください）' },
);

const gateInspectorInputSchema: z.ZodType<GateInspectorInput> = z.object({
  audienceKind: z.enum(GATE_AUDIENCE_KINDS),
  sections: z
    .array(z.object({ field: z.enum(GATE_FINDING_FIELDS), text: maskedTextSchema }))
    .min(1)
    .max(GATE_INSPECTOR_MAX_SECTIONS),
});

// ============================================================================
// 3. 出力（docs/05 §7.1: `{ pii, commerce, consistencyWarnings }`）
// ============================================================================

/**
 * 該当箇所のオフセット。
 *
 * 🔴 「特定できない」を `null` で表す（空文字や `-1` を使わない。docs/05 §11.7）。
 *    ⚠️ `minimum` は JSON Schema 側で無視されるため、**受信後の `safeParse` が唯一の担保**である
 *    （docs/03 申し送り 10）。負のオフセットで画面のハイライトが壊れる事故はここで止まる。
 */
const offsetSchema = z.number().int().min(0).nullable();

/** 全層に共通の指摘の形（docs/05 §3.6。🔴 `layer` は含めない —— どの配列に入ったかで決まる）。 */
const commonFindingShape = {
  field: z.enum(GATE_FINDING_FIELDS),
  offsetStart: offsetSchema,
  offsetEnd: offsetSchema,
  /** 🔴 `maxLength` も JSON Schema 側では無視される（受信後に切り詰めず、スキーマ違反として扱う）。 */
  excerpt: z.string().max(GATE_FINDING_EXCERPT_MAX_LENGTH),
} as const;

const piiFindingSchema = z.object({
  kind: z.enum(GATE_INSPECTOR_PII_KINDS),
  ...commonFindingShape,
  severity: z.enum(GATE_FINDING_SEVERITIES),
});

const commerceFindingSchema = z.object({
  kind: z.enum(GATE_INSPECTOR_COMMERCE_KINDS),
  ...commonFindingShape,
  severity: z.enum(GATE_FINDING_SEVERITIES),
});

/** 🔴 整合層の警告。`severity` は `'WARN'` のリテラルであり、**`BLOCK` を返す形が存在しない**。 */
const consistencyWarningSchema = z.object({
  kind: z.enum(GATE_INSPECTOR_CONSISTENCY_KINDS),
  ...commonFindingShape,
  severity: z.literal('WARN'),
});

const piiLayerSchema = z.object({
  verdict: z.enum(GATE_VERDICTS),
  findings: z.array(piiFindingSchema).max(GATE_INSPECTOR_MAX_FINDINGS),
});

const commerceLayerSchema = z.object({
  verdict: z.enum(GATE_VERDICTS),
  findings: z.array(commerceFindingSchema).max(GATE_INSPECTOR_MAX_FINDINGS),
});

type LayerShape = {
  readonly verdict: 'PASS' | 'FAIL';
  readonly findings: readonly { readonly severity: 'BLOCK' | 'WARN'; readonly offsetStart: number | null; readonly offsetEnd: number | null }[];
};

/**
 * 🔴 層の合否と指摘の整合を、**受信後に**検査する（JSON Schema では表現できない）。
 *
 * なぜ必要か: `verdict='PASS'` なのに `BLOCK` の指摘がある応答、`verdict='FAIL'` なのに
 * 根拠が 1 つも無い応答は、承認者に見せる情報として矛盾している（docs/05 §3.6
 * 「`BLOCK` のみが FAIL を作る」）。ここで弾くと `runRole` は**スキーマ違反として再試行**し、
 * 最後まで直らなければ失敗になる ——`gate-inspector` の失敗は PII / 商流を FAIL 扱いにする
 * （docs/05 §7.4）ため、🔴 **矛盾した応答が PASS として通り抜ける経路は無い。**
 */
function checkLayerCoherence(layer: LayerShape, path: string, ctx: z.RefinementCtx): void {
  const hasBlock = layer.findings.some((finding) => finding.severity === 'BLOCK');
  if (layer.verdict === 'FAIL' && !hasBlock) {
    ctx.addIssue({
      code: 'custom',
      path: [path, 'findings'],
      message: 'verdict が FAIL なら severity=BLOCK の指摘が 1 件以上必要です',
    });
  }
  if (layer.verdict === 'PASS' && hasBlock) {
    ctx.addIssue({
      code: 'custom',
      path: [path, 'verdict'],
      message: 'severity=BLOCK の指摘があるのに verdict が PASS です',
    });
  }
}

/** オフセットは「両方 null」か「start < end」のいずれかである（片方だけ埋まる形を許さない）。 */
function checkOffsets(
  findings: readonly { readonly offsetStart: number | null; readonly offsetEnd: number | null }[],
  path: string,
  ctx: z.RefinementCtx,
): void {
  for (const [index, finding] of findings.entries()) {
    const { offsetStart, offsetEnd } = finding;
    if ((offsetStart === null) !== (offsetEnd === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [path, index],
        message: 'offsetStart と offsetEnd は両方が数値か、両方が null でなければなりません',
      });
      continue;
    }
    if (offsetStart !== null && offsetEnd !== null && offsetEnd <= offsetStart) {
      ctx.addIssue({
        code: 'custom',
        path: [path, index],
        message: 'offsetEnd は offsetStart より大きい値でなければなりません',
      });
    }
  }
}

export const gateInspectorOutputSchema = z
  .object({
    pii: piiLayerSchema,
    commerce: commerceLayerSchema,
    /** 🔴 合否ではない。`ReviewGate.aiWarnings`（`findings` とは別の列）に入る。 */
    consistencyWarnings: z.array(consistencyWarningSchema).max(GATE_INSPECTOR_MAX_WARNINGS),
  })
  .superRefine((output, ctx) => {
    checkLayerCoherence(output.pii, 'pii', ctx);
    checkLayerCoherence(output.commerce, 'commerce', ctx);
    checkOffsets(output.pii.findings, 'pii', ctx);
    checkOffsets(output.commerce.findings, 'commerce', ctx);
    checkOffsets(output.consistencyWarnings, 'consistencyWarnings', ctx);
  });

export type GateInspectorOutput = z.infer<typeof gateInspectorOutputSchema>;
/** PII 層の指摘（`kind` は PII の 5 種のみ）。 */
export type GateInspectorPiiFinding = GateInspectorOutput['pii']['findings'][number];
/** 商流層の指摘（`kind` は商流の 3 種のみ）。 */
export type GateInspectorCommerceFinding = GateInspectorOutput['commerce']['findings'][number];
/** 🔴 層をまたいだ扱いをするとき用（`layer` はゲート側が付ける。T-07-06）。 */
export type GateInspectorFinding = GateInspectorPiiFinding | GateInspectorCommerceFinding;
/** 🔴 整合層の警告。`severity` は `'WARN'` しか取り得ない（`BR-61`）。 */
export type GateInspectorWarning = GateInspectorOutput['consistencyWarnings'][number];

// ============================================================================
// 4. ロール定義
// ============================================================================

/**
 * 出力トークンの上限。指摘 30 件 + 警告 20 件が入る幅を見ておく
 * （足りないと `stop_reason: max_tokens` で構造化出力が欠け、スキーマ違反 → 失敗 → FAIL になる）。
 */
export const GATE_INSPECTOR_MAX_OUTPUT_TOKENS = 4_096;

/**
 * 1 試行のタイムアウト。ゲート全体の目標は 30 秒（docs/02 章 7.1）であり、
 * 再試行（最大 3 試行。docs/05 §7.4）の余地を残して 1 試行を 20 秒で切る。
 */
export const GATE_INSPECTOR_TIMEOUT_MS = 20_000;

/**
 * 🔴 ロールの入力を、プロンプトへの入力へ写す。
 *
 * ここが `MASK_PLACEHOLDER_LIST` を与える唯一の地点である（呼び出し側に組み立てさせない）。
 * ⚠️ `GateFindingField` / `GateAudienceKind`（domain）と `PromptGateField` /
 *    `PromptGateAudienceKind`（`@ses/prompts` の写し）が食い違うと、**この代入が
 *    コンパイルエラーになる** —— 欄や共有先の区分を増やしたときに、検査基準（プロンプト）の
 *    更新と版上げを強制するための意図的な設計である（`prompts/roles/contracts.ts`）。
 */
function toPromptFacts(input: GateInspectorInput): GateInspectorPromptFacts {
  return {
    audienceKind: input.audienceKind,
    sections: input.sections,
    maskedPlaceholders: MASK_PLACEHOLDER_LIST,
  };
}

function buildSpec(module: GateInspectorPromptModule): RoleSpec<GateInspectorInput, GateInspectorOutput> {
  return defineRoleSpec<GateInspectorInput, GateInspectorOutput>({
    role: 'gate-inspector',
    // 🔴 手書きしない（`AiUsage.purpose` はロールと 1:1。docs/05 §7.9 ③）。
    purpose: ROLE_PURPOSE['gate-inspector'],
    inputSchema: gateInspectorInputSchema,
    outputSchema: gateInspectorOutputSchema,
    promptVersion: module.version,
    buildPrompt: (input) => module.build(PROMPT_KIT, toPromptFacts(input)),
    // 🔴 モデル ID を直書きしない（CLAUDE.md §12.3）。段だけを指定する。
    defaultModel: 'DEFAULT',
    maxOutputTokens: GATE_INSPECTOR_MAX_OUTPUT_TOKENS,
    timeoutMs: GATE_INSPECTOR_TIMEOUT_MS,
  });
}

/** 🔴 現行版のロール定義（`gate.run` はこれを使う。T-07-06）。 */
export const gateInspectorSpec: RoleSpec<GateInspectorInput, GateInspectorOutput> = buildSpec(
  currentGateInspectorPrompt(),
);

/**
 * 🔴 **生成物に保存された版で同じプロンプトを再現する**（`BR-13` / docs/05 §7.7）。
 *
 * `ReviewGate.promptVersion` / `AiUsage.promptVersion` に残った版を渡すと、そのときと同じ
 * `system` / `user` を組み立てられる。出力スキーマは版に依らず同じである（§7.7）。
 *
 * @throws UnknownPromptVersionError 登録表に無い版のとき（現行版へ倒さない）。
 */
export function gateInspectorSpecAtVersion(version: string): RoleSpec<GateInspectorInput, GateInspectorOutput> {
  return buildSpec(gateInspectorPromptAtVersion(version));
}
