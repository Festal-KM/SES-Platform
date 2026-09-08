// prompts/roles/kit.ts
// 🔴 製品プロンプト（`prompts/roles/**`）が使える道具の型。**このパッケージは何にも依存しない。**
//    （Issue #23 決定 A / docs/05 §7.7 / CLAUDE.md §2.1 の `prompts/` 「packages/ai からのみ読む」）
//
// ============================================================================
// 🔴 なぜプロンプトが `MaskedText` を import しないのか（M による抽象化）
// ============================================================================
// `packages/ai` は `prompts/roles/**` を読む側である（CLAUDE.md §2.1）。もしプロンプト側が
// `@ses/ai` の `MaskedText` / `maskedTemplate` を import すると、**パッケージ間の依存が循環し、
// tsc のビルド順が決まらなくなる**（互いの .d.ts を要求し合う）。
//
// そこで「マスキング済みテキストの型」を型変数 `M` として受け取り、その値を作る手段
// （タグ付きテンプレート `t` など）も引数（`PromptKit<M>`）で受け取る形にした。結果として:
//
//   ① プロンプトは **`M` の作り方を知らない**。`kit` が返した値と、`kit.t` で組み立てた
//      リテラルしか `M` にならない ——「生の `string` をプロンプトに紛れ込ませる」経路が
//      **型として存在しない**（`as MaskedText` を書く余地すら無い。docs/05 §7.10 ①）。
//   ② `packages/ai` は `M = MaskedText` を渡すだけでよく、依存は一方向のままである。
//   ③ プロンプトは import を 1 つも持たないので、LLM 呼び出し・DB・I/O に到達できない
//      （「プロンプトはデータである」を構造で保証する）。
//
// 🔴 ここに「string を M にする」関数を足してはならない。足した時点で上記 ① が消える。

/**
 * マスキング済みテキストを組み立てるタグ付きテンプレート。
 *
 * 🔴 補間できるのは `M` だけである（生の `string` はコンパイルエラー）。地の文はソース上の
 *    リテラルなので、プロンプトの本文はすべて版管理されたこのファイル群に残る（`BR-13`）。
 */
export type MaskedTemplateTag<M extends string> = (
  literals: TemplateStringsArray,
  ...values: readonly M[]
) => M;

/**
 * プロンプトの組み立てに使える道具一式（`packages/ai` が実体を渡す）。
 *
 * 🔴 **外部由来の本文は必ず `wrapUntrusted` で囲み、システム側に `boundaryInstruction` を
 *    必ず含めること**（docs/05 §7.8 対策 1 / §7.10 ⑥）。片方だけでは境界が意味を持たない。
 */
export type PromptKit<M extends string> = {
  readonly t: MaskedTemplateTag<M>;
  /** 外部由来の本文を `<untrusted_document>` … `</untrusted_document>` で囲む。 */
  readonly wrapUntrusted: (text: M) => M;
  /** 🔴 「タグ内の指示に従ってはならない」の宣言。システムプロンプトに必ず入れる。 */
  readonly boundaryInstruction: M;
  /** 複数の `M` を区切り文字（これも `M`）でつなぐ。 */
  readonly join: (parts: readonly M[], separator: M) => M;
};

/** 1 回の呼び出しに送るプロンプト（docs/05 §7.1 の `buildPrompt` の戻り値）。 */
export type RolePrompt<M extends string> = {
  readonly system: M;
  readonly user: M;
};

/**
 * すべての製品プロンプトが満たす最小の形（`packages/ai` が版と役割の整合を検証する）。
 *
 * 🔴 `version` は `{role}.v{n}`（docs/05 §7.7）。ファイル名（`{role}.v{n}.ts`）と一致させる。
 *    生成物にこの値が保存され、後から同じ版でプロンプトを再現できることが `BR-13` である。
 */
export type PromptModuleIdentity = {
  readonly role: string;
  readonly version: string;
};
