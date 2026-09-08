// prompts/roles/index.ts — 製品プロンプトの登録表（docs/05 §7.7 / Issue #23 決定 A）。
//
// 🔴 読んでよいのは `packages/ai` だけである（CLAUDE.md §2.1。ESLint の `no-restricted-imports` が
//    `@ses/prompts` の import 元を `packages/ai` に限定し、`tests/static/prompt-registry-single-path.test.ts`
//    がさらに `packages/ai/src/prompts.ts` の 1 本に固定する）。
//
// 🔴 **版の切替は `CURRENT` の 1 行だけ**を書き換える。古い版のファイルは消さない ——
//    生成物（`ReviewGate.promptVersion` / `AiUsage.promptVersion`）に保存された版から、
//    後でそのときのプロンプトを再現するためである（`BR-13` / docs/05 §7.7）。

import { prompt as gateInspectorV1 } from './gate-inspector.v1.js';
import type { GateInspectorPromptModule } from './contracts.js';

export type {
  GateInspectorPromptInput,
  GateInspectorPromptModule,
  PromptGateAudienceKind,
  PromptGateField,
} from './contracts.js';
export type { MaskedTemplateTag, PromptKit, PromptModuleIdentity, RolePrompt } from './kit.js';

/**
 * `gate-inspector` の**全版**（🔴 消さない。版番号 → モジュール）。
 *
 * 生成物に保存された `promptVersion` からの再現は、この表を引くことで成立する。
 */
export const GATE_INSPECTOR_PROMPTS = {
  'gate-inspector.v1': gateInspectorV1,
} as const satisfies Record<string, GateInspectorPromptModule>;

export type GateInspectorPromptVersion = keyof typeof GATE_INSPECTOR_PROMPTS;

/**
 * 🔴 **現行版の登録表**（docs/05 §7.7「版の切替は `prompts/roles/index.ts` の 1 行を書き換える」）。
 *
 * ⚠️ ここに現れるのは**プロンプトが実装済みのロールだけ**である。残る 5 ロール
 *    （`sheet-parser` / `skill-normalizer` / `match-explainer` / `proposal-drafter` /
 *    `renewal-advisor`）は後続スプリントで追加される。`packages/ai` は未登録のロールを
 *    引かれたら例外にする（既定のプロンプトへ暗黙にフォールバックしない）。
 */
export const ROLE_PROMPTS = {
  'gate-inspector': GATE_INSPECTOR_PROMPTS['gate-inspector.v1'],
} as const;

export type RegisteredPromptRole = keyof typeof ROLE_PROMPTS;
