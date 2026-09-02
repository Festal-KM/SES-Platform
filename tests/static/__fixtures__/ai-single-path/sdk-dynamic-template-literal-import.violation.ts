// 違反: 無置換のテンプレートリテラルによる動的 import で @anthropic-ai/sdk を読み込んでいる
// （CLAUDE.md §3.2 ④）。文字列リテラルのみを見る動的 import 検出セレクタでは素通りしていた。
export const loadSdk = async () => import(`@anthropic-ai/sdk`);
