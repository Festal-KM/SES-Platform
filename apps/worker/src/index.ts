// apps/worker/src/index.ts
// 🔴 本ファイルは**ジョブ宣言の公開だけ**を行う（import しても起動処理は走らない）。
//    起動エントリポイント（`initializeRuntimeConfig` の呼び出し）は **`src/main.ts`** にある
//    （T-03-12。docs/05 §13.1 / `CLAUDE.md` §11.1）。
//    🔴 ここから `./main.js` を re-export しない —— ジョブ宣言を読むだけのテストが
//    環境変数の検証に落ちる（= 起動と宣言の責務が混ざる）。
export * from './jobs/index.js';
