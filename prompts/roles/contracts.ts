// prompts/roles/contracts.ts
// 🔴 ロールごとの「プロンプトへの入力」の契約。**版をまたいで不変**であり、版を上げても
//    ここは変えない（変えると `packages/ai` の呼び出し側が落ちる = 気づける）。
//
// 🔴 出力スキーマ（`packages/ai/src/roles/**`）はここに置かない。プロンプト版を上げるたびに
//    出力スキーマを変えないこと（Anthropic のスキーマキャッシュ。docs/05 §7.7）。

import type { PromptKit, RolePrompt } from './kit.js';

/**
 * 検査対象の欄（`GateFinding.field`。docs/05 §3.6）。
 *
 * 🔴 `packages/domain` の `GATE_FINDING_FIELDS` と同じ 6 値である。**依存できないので写しである**
 *    （このパッケージは何にも依存しない。`kit.ts` 冒頭）。ずれたら
 *    `packages/ai/src/roles/gate-inspector.ts` の代入がコンパイルエラーになる ——
 *    欄が増えたときにプロンプト（＝ 検査基準）の更新を強制するための意図的な作りである。
 */
export type PromptGateField =
  | 'subject'
  | 'body'
  | 'snapshot'
  | 'attachment'
  | 'public_summary'
  | 'contract_document';

/**
 * 共有先の区分（docs/05 §11.3 `GateInput.audience.kind`）。
 *
 * 🔴 商流層の判定基準は**この区分によって変わる**（CLAUDE.md §3.1 / §3.3）。上と同じ理由で写しであり、
 *    区分が増えたら `packages/ai` 側の代入が落ち、プロンプトの改訂と版上げを強制する。
 */
export type PromptGateAudienceKind = 'PARTNER' | 'EXTERNAL_CLIENT';

/** `gate-inspector` に渡す入力（docs/05 §7.1 の入力スキーマ欄）。 */
export type GateInspectorPromptInput<M extends string> = {
  readonly audienceKind: PromptGateAudienceKind;
  /** 🔴 検査対象の本文。**マスキング済み**（`M`）であり、プロンプトはこれを必ず境界で囲む。 */
  readonly sections: readonly {
    readonly field: PromptGateField;
    readonly text: M;
  }[];
  /**
   * 🔴 マスキングの伏せ字（`[名前]` `[単価]` 等）。**個人情報そのものではない**。
   *
   * ⚠️ docs/05 §7.1 のスケッチは `knownPiiTokens` という名前だったが、その名前は
   *    「台帳の PII の実値を渡す」と読めてしまい、渡した瞬間に `BR-11`（PII を LLM に送らない）を
   *    破る。渡すのは**伏せ字の語彙**であり、値は `packages/ai` が `mask()` の表から与える
   *    （呼び出し側が自由に組み立てられない。docs/05 §7.13）。
   */
  readonly maskedPlaceholders: readonly M[];
};

/**
 * `gate-inspector` のプロンプトモジュール。
 *
 * 🔴 `build` は「入力 → プロンプト」の**純粋関数**である。ロールは自律エージェントではなく
 *    入出力の決まったパイプライン工程であり（CLAUDE.md §12.3）、プロンプト側に分岐や状態を持たせない。
 */
export type GateInspectorPromptModule = {
  readonly role: 'gate-inspector';
  readonly version: string;
  build<M extends string>(kit: PromptKit<M>, input: GateInspectorPromptInput<M>): RolePrompt<M>;
};
