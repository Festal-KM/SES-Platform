// packages/ai/src/prompts.ts
// 🔴 **製品プロンプトを読む唯一の場所**（CLAUDE.md §2.1「`prompts/` … packages/ai からのみ読む」/
//    §3.2「プロンプトをコード中にベタ書きしない」/ docs/05 §7.7 / Issue #23 決定 A）。
//
// ============================================================================
// 🔴 何をここに閉じるか
// ============================================================================
// ① `@ses/prompts`（= `prompts/roles/**`）を import するのはこのファイルだけである
//    （ESLint が `packages/ai` 以外からの import を禁じ、
//     `tests/static/prompt-registry-single-path.test.ts` がさらにこの 1 本に固定する）。
// ② プロンプトが `MaskedText` を作る手段（`PROMPT_KIT`）をここで与える。プロンプト側は
//    `MaskedText` の作り方を知らないため、**生の `string` がプロンプトへ紛れ込む経路が無い**
//    （docs/05 §7.10 ① / `prompts/roles/kit.ts` 冒頭）。
// ③ 登録された版が `{role}.v{n}` の形であること・ロールと一致することを**読み込み時に**検証する。
//    版が壊れていると生成物から再現できない（`BR-13`）ので、起動の時点で落とす。
//
// 🔴 ここに「プロンプトの文面」を書かない。文面は `prompts/roles/**` にしか無い。

import {
  GATE_INSPECTOR_PROMPTS,
  ROLE_PROMPTS,
  type GateInspectorPromptInput,
  type GateInspectorPromptModule,
  type PromptKit,
  type PromptModuleIdentity,
} from '@ses/prompts';
import { isAiRole, type AiRole } from '@ses/domain';
import { MASK_CATEGORIES, MASK_PLACEHOLDERS, maskedTemplate, type MaskedText } from './mask.js';
import { parsePromptVersion } from './roles/define.js';
import { UNTRUSTED_BOUNDARY_INSTRUCTION, wrapUntrusted } from './untrusted.js';

/** 🔴 登録表そのものが壊れている（起動を止める）。 */
export class PromptRegistryError extends Error {
  constructor(detail: string) {
    super(`prompts/roles の登録表が不正です: ${detail}（docs/05 §7.7）`);
    this.name = 'PromptRegistryError';
  }
}

/**
 * 🔴 生成物に記録された版が引けない（**古い版のファイルを消したときに必ずここで落ちる**）。
 *
 * 現行版へ暗黙にフォールバックしない —— 別の版で再現した内容を「同じ版で再現した」と
 * 見せてしまうと、`BR-13`（後から再現できる）が意味を失う。
 */
export class UnknownPromptVersionError extends Error {
  readonly role: string;
  readonly version: string;

  constructor(role: string, version: string) {
    super(
      `プロンプト版 '${version}'（role=${role}）が登録表にありません。` +
        '古い版のファイルは消さないでください（docs/05 §7.7 / BR-13）。',
    );
    this.name = 'UnknownPromptVersionError';
    this.role = role;
    this.version = version;
  }
}

/** `MaskedText` を区切り文字でつなぐ（材料が `MaskedText` だけなので結果も `MaskedText`）。 */
function joinMasked(parts: readonly MaskedText[], separator: MaskedText): MaskedText {
  let out = maskedTemplate``;
  for (const [index, part] of parts.entries()) {
    out = index === 0 ? maskedTemplate`${part}` : maskedTemplate`${out}${separator}${part}`;
  }
  return out;
}

/**
 * 🔴 プロンプトに渡す道具一式。**`packages/ai` の外へ出さない**（バレルから export しない）。
 *
 * 出すと「任意の文字列を組み立ててプロンプトを自作する」経路が公開 API になり、
 * ロール定義を経ないプロンプトが送れる（docs/05 §7.2）。
 */
export const PROMPT_KIT: PromptKit<MaskedText> = {
  t: maskedTemplate,
  wrapUntrusted,
  boundaryInstruction: UNTRUSTED_BOUNDARY_INSTRUCTION,
  join: joinMasked,
};

/**
 * 🔴 伏せ字の語彙（`mask()` の表そのもの）。プロンプトはこれを受け取り、
 *    「伏せ字を指摘しない・復元しない」を LLM に伝える（docs/05 §7.13）。
 *
 * 🔴 呼び出し側が組み立てる値ではない —— 台帳の PII の実値を渡す経路にしないため、
 *    ロールの入力（`GateInspectorInput`）には含めず、`buildPrompt` がここから与える。
 */
export const MASK_PLACEHOLDER_LIST: readonly MaskedText[] = MASK_CATEGORIES.map(
  (category) => MASK_PLACEHOLDERS[category],
);

/**
 * 登録表の 1 件が「ロール名と版の形」を満たしているかを検査する。
 *
 * 🔴 `packages/ai` の外へは出さない（バレルから export しない）。壊れた登録を検知するための
 *    内部の門であり、外に出すと「検査を通してから自分で登録表を作る」経路を招く。
 */
export function assertPromptModuleIdentity(role: string, module: PromptModuleIdentity): void {
  if (!isAiRole(role)) {
    throw new PromptRegistryError(`'${role}' は AI_ROLES に無いロールです`);
  }
  if (module.role !== role) {
    throw new PromptRegistryError(`登録キー '${role}' とモジュールの role '${module.role}' が一致しません`);
  }
  const parsed = parsePromptVersion(module.version);
  if (parsed === undefined) {
    throw new PromptRegistryError(`version '${module.version}' の形が {role}.v{n} ではありません`);
  }
  if (parsed.role !== role) {
    throw new PromptRegistryError(`version '${module.version}' のロール名が登録キー '${role}' と一致しません`);
  }
}

/**
 * 🔴 読み込み時（= 起動時）に登録表を検証する。
 *
 * ここを関数にして「呼ばれたときだけ検証する」形にすると、呼ばれない経路で壊れた登録が生き残る。
 */
function verifyRegistry(): void {
  for (const [role, module] of Object.entries(ROLE_PROMPTS) as [string, PromptModuleIdentity][]) {
    assertPromptModuleIdentity(role, module);
  }
  // 🔴 全版の表はキー（版番号）とモジュールの version が一致していなければならない。
  //    ずれると「保存された版で再現した」つもりで別の版の文面を使うことになる。
  for (const [version, module] of Object.entries(GATE_INSPECTOR_PROMPTS) as [string, PromptModuleIdentity][]) {
    if (module.version !== version) {
      throw new PromptRegistryError(`全版表のキー '${version}' とモジュールの version '${module.version}' が一致しません`);
    }
    assertPromptModuleIdentity(module.role, module);
  }
}

verifyRegistry();

/** `gate-inspector` の**現行版**（docs/05 §7.7。切替は `prompts/roles/index.ts` の 1 行）。 */
export function currentGateInspectorPrompt(): GateInspectorPromptModule {
  return ROLE_PROMPTS['gate-inspector'];
}

/**
 * 🔴 生成物に保存された版でプロンプトを引く（`BR-13` の再現性の実体）。
 *
 * @throws UnknownPromptVersionError 登録表に無い版のとき（現行版へ倒さない）。
 */
export function gateInspectorPromptAtVersion(version: string): GateInspectorPromptModule {
  const registry: Record<string, GateInspectorPromptModule> = GATE_INSPECTOR_PROMPTS;
  const module = registry[version];
  if (module === undefined) throw new UnknownPromptVersionError('gate-inspector', version);
  return module;
}

/** 登録済みのロール（プロンプトが実装済みのもの）。⚠️ 残る 5 ロールは後続スプリント。 */
export function registeredPromptRoles(): readonly AiRole[] {
  return Object.keys(ROLE_PROMPTS).filter((role): role is AiRole => isAiRole(role));
}

export type GateInspectorPromptFacts = GateInspectorPromptInput<MaskedText>;

/**
 * 🔴 プロンプトモジュールの型は**ここから re-export する**（`packages/ai` の他のファイルが
 *    `@ses/prompts` を直接 import しなくて済むように）。読み込み口が 1 本であることは
 *    `tests/static/prompt-registry-single-path.test.ts` が固定する。
 */
export type { GateInspectorPromptModule };
