// packages/ai/src/mask.ts
// 🔴 LLM に渡してよいテキストを表すブランド型（docs/05 §7.8 / docs/03 §4.2 / CLAUDE.md §3.2）。
//
// 🔴 なぜ「ただの string」にしないか:
//    `runRole` に渡せるのが `MaskedText` だけであれば、**マスキングを迂回する入力経路が
//    型として存在しなくなる**（`BR-11` / `F-032 AC-1` / `CLAUDE.md` §7「PII 未マスキングでの
//    LLM 送信 0 件」）。実行時のチェックは後から足せるが、経路そのものを消せるのは型だけである。
//
// ⚠️ **T-07-01 の射程はブランド型（＝ `runRole` の入力の形）までである。**
//    `MaskedText` を生成できる唯一の関数 `mask(raw, known)` と `KnownPiiValues` は **T-07-02**
//    がこのファイルに追加する（docs/05 §7.8）。したがって現時点で `MaskedText` を作れる関数は
//    存在せず、**プロダクションコードから偶然生成されることもない**。
//    🔴 ここに「string を無条件で `MaskedText` にする」関数（`unsafeAsMasked` 等）を
//    足してはならない。足した時点で、上記の型による担保が全部無効になる。

declare const MaskedBrand: unique symbol;

/**
 * マスキング済みテキスト。
 *
 * 🔴 `string` の部分型なので、そのままプロンプトに埋め込める。逆方向（`string` → `MaskedText`）は
 *    `mask()`（T-07-02）だけが行う。
 */
export type MaskedText = string & { readonly [MaskedBrand]: true };

/**
 * LLM に送るコンテンツブロック（docs/05 §7.2）。
 *
 * 🔴 **`image` / `document` を持たない。** 画像は顔写真を含みうるがテキストマスキングでは
 *    扱えないため、「送らない」のではなく「**送れない**」構造にする（docs/03 §4.2 のリスク回避欄）。
 *    PDF もコード側でテキスト化してからマスキングを通す（docs/03 §3.3.2 の `sheet-parser`）。
 */
export type ContentBlock = {
  readonly type: 'text';
  readonly text: MaskedText;
};
