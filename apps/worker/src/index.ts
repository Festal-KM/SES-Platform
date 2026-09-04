// apps/worker/src/index.ts
// 🔴 起動エントリポイント（`loadAppEnv` / `resolveConnectorSelection` の呼び出し）は
//    **T-03-12** が実装する（docs/sprints/SP-03 §4 T-03-12 / `CLAUDE.md` §11.1）。
//    本ファイルは現時点では**ジョブ宣言の公開だけ**を行う。
export * from './jobs/index.js';
