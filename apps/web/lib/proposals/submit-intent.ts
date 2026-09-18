// apps/web/lib/proposals/submit-intent.ts
// `S-022` → `S-021` の「送信を受け付けた」印（T-12-13 ⑤。レビュー指摘の修正。2026-09-18）。
//
// 🔴 何のためにあるか: #44（再送）の 202 の直後、送信ジョブが ③ CAS `APPROVED → SUBMITTING` に到達するまでの窓では、行は `APPROVED` で
//    送信試行の行がまだ無い。この窓を DB の値（`last_failure_reason`）で「送信中」と読むと、enqueue が 409 `SEND_JOB_BLOCKED` で
//    止まった / ジョブが ③ CAS より前に落ちた行まで恒久的に「送信中」になり復帰導線が無くなる（`approval-rows.ts` の
//    `isAwaitingSendSettlement` の注記）。そこで **この窓は `S-022` がセッションに残す印**で埋め、`S-021` はマウント時に印を
//    消費して #43 と同じ `SUBMIT_REQUESTED`（セッション限定の枠）に入る。既存の #46 の読み直しが `SUBMITTING` / `SUBMITTED` /
//    `SUBMIT_FAILED` / 保留で枠を閉じる。リロードで枠が消えて「送信する」が戻るのは #43 と同じ既定挙動（押しても同じ
//    `attemptSeq` で 1 本に畳まれる）。
// 🔴 純粋関数。ストレージは **thunk**（`() => window.sessionStorage`）で受ける —— storage を無効化したブラウザでは
//    `window.sessionStorage` の**プロパティアクセス自体**が throw するので、取得も読み書きも同じ `try/catch` の内側に置く。
//    印は UI の補助であり、例外を画面に漏らさない（テストは素の Map で代替できる）。
// 🔴 `@ses/db` に依存しない（`'use client'` の画面から値 import される。`tests/static/client-db-boundary.test.ts`）。

/** `window.sessionStorage` の構造的な部分型（DOM の `Storage` に依存しない）。 */
export type SubmitIntentStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** ストレージの取得（呼ぶまで評価しない。取得で throw しても呼び出し側に漏れない）。 */
export type SubmitIntentStorageSource = () => SubmitIntentStorage;

const KEY_PREFIX = 'ses.proposal.submit-requested:';

/** 印の値。`submitIntentKey` と対で E2E が `sessionStorage` を直接読む・置くときに使う（書式を spec に写さない）。 */
export const SUBMIT_INTENT_MARK = '1';

/** 印のキー（提案ごと）。 */
export function submitIntentKey(proposalId: string): string {
  return `${KEY_PREFIX}${proposalId}`;
}

/** `S-022` が #44 の 202 を受けて `S-021` へ遷移する直前に置く。 */
export function markSubmitRequested(storage: SubmitIntentStorageSource, proposalId: string): void {
  try {
    storage().setItem(submitIntentKey(proposalId), SUBMIT_INTENT_MARK);
  } catch {
    // 印は補助であり、置けなくても遷移を止めない。
  }
}

/**
 * `S-021` がマウント時に呼ぶ。印があれば**消してから** `true`。別の提案の印には触れない。
 * 🔴 1 回しか `true` にならない（同じ画面の再マウント・別タブでの再訪で枠が復活しない）。
 */
export function consumeSubmitRequested(storage: SubmitIntentStorageSource, proposalId: string): boolean {
  try {
    const target = storage();
    const key = submitIntentKey(proposalId);
    if (target.getItem(key) !== SUBMIT_INTENT_MARK) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
