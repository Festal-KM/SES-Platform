// tests/perf/budget.ts
// 🔴 T-12-02: 負荷測定の判定に使う予算（`CLAUDE.md` §7 / `docs/02` 章 7.1 / `F-009 AC-4` / `F-015 AC-2` / `A-18`）。
//
// 🔴 `packages/config`（環境変数）には置かない。予算は**製品の目標値**であって環境ごとに変える設定ではなく、
//    環境変数にすると「CI のマシンが遅いから上げる」ができてしまう。**ローカル計測が正**であり、値を上げる変更は
//    このファイルの差分としてレビューに出る（判定を緩めない。SP-12 T-12-02 の 🔴）。

/** 複合検索（`GET /api/engineers` / `GET /api/projects`）の p95 予算（ミリ秒）。`CLAUDE.md` §7「1 秒以内（p95）」。 */
export const PERF_P95_BUDGET_MS = 1_000;

/**
 * 匿名候補が混在する候補一覧（`GET /api/engineers?projectId=` = #30 / `S-016`。自社 + 共有スコープの 2 本 +
 * アプリ層マージ）の p95 予算（ミリ秒）。
 *
 * 出典: `CLAUDE.md` §7「マッチング候補の初回提示 3 秒以内（p95）」/ `docs/02` `F-029 AC-5` /
 * [Issue #71](https://github.com/Festal-KM/SES-Platform/issues/71) 既定 A（2026-09-18。SP-12 T-12-19）。
 * 🔴 `S-016` は Phase 2 でスコア順になる同じ画面であり、§7 は「複合検索」と「マッチング候補の初回提示」を
 *    別の行・別の目標として置いている —— 読み替えは緩和ではなく該当する行の選び直しである。
 * 🔴 この予算を使うのは `projectId` ありの混在 2 組だけ。自社スコープ 7 組 / 案件 6 組は `PERF_P95_BUDGET_MS`
 *    （1,000）のまま。⚠️ Issue #71 の回答が B（1 秒のまま）なら本定数を撤去し 2 組も `PERF_P95_BUDGET_MS` で判定する。
 */
export const MATCH_P95_BUDGET_MS = 3_000;

/** `gate.run`（レビュー依頼 → 確定）の p95 予算。`docs/02` 章 7.1 / `A-18`「ゲート実行 p95 30 秒」。 */
export const GATE_RUN_P95_BUDGET_MS = 30_000;

/** `send.proposal`（送信要求 → `SUBMITTED`）の p95 予算。`docs/02` 章 7.1 / `A-18`「送信ジョブ p95 60 秒」。 */
export const SEND_PROPOSAL_P95_BUDGET_MS = 60_000;

/** 検索の 1 条件あたりの標本数（ウォームアップを除く）。T-12-01 の申し送り「N = 50〜100 回」。 */
export const SEARCH_SAMPLE_COUNT = 60;

/** 検索のウォームアップ回数（接続プール・プランキャッシュ・JIT の立ち上がりを標本から除く）。 */
export const SEARCH_WARMUP_COUNT = 5;

/** ジョブ（`gate.run` / `send.proposal`）の標本数。`perf` プリセットの各テナント 1 件（30 テナント）を使う。 */
export const JOB_SAMPLE_COUNT = 30;
