// packages/domain/src/quota/email-rate.ts
// 🔴 テナント単位のメール送信上限の判定（`CLAUDE.md` §3.4 / docs/05 §8.7 / `F-027 AC-2`）。T-04-03。
//
// 🔴 **アプリ層でガードする。外部 API の 429 に頼らない**（`CLAUDE.md` §3.4）。SES が受け付けて
//    しまってから気づく設計だと、上限は「事故が起きた後の説明」にしかならない。
//
// 🔴 **日次超過（停止）と分次超過（待機）を区別する**（docs/05 §8.7 / `F-027 AC-2`）。
//    - 日次 = そのテナントがその日にもう送れない → `BLOCK`。待っても解消しない。
//    - 分次 = 瞬間のバーストを均すだけ → `DEFER`。同じ `attemptSeq` のまま後で送る（§10.5）。
//    混ぜると「上限に達したので明日まで送れません」と「30 秒後に送ります」が同じ扱いになり、
//    利用者への案内（`S-038`）も監視（`A-005`）も誤る。
//
// 🔴 送信基盤（SES アカウント）全体の 24h 枠（`decideProviderQuota`。docs/05 §8.3-Q。T-04-04）とは
//    **別の枠**である。対処する相手が違う（こちらはテナントの利用量、あちらは環境の枠）。

/** 分次のスライディングウィンドウ幅（docs/05 §8.7「分 = スライディング 60 秒」）。 */
export const EMAIL_MINUTE_WINDOW_MS = 60_000;

/**
 * 判定結果。
 *
 * - `ALLOW`: 送ってよい。`dailyRemaining` は `F-027` の残量表示（SP-10）が使う。
 * - `DEFER`: 🔴 **待機**（分次超過）。`retryAfterSec` 後に**同じ `attemptSeq` のまま**再スケジュールする。
 *   状態を進めない・失敗にしない（docs/05 §10.5「遅延保留（状態にしない）」）。
 * - `BLOCK`: 🔴 **停止**（日次超過）。外部を呼ばない。再スケジュールもしない。
 */
export type EmailRateDecision =
  | { readonly kind: 'ALLOW'; readonly dailyRemaining: number }
  | { readonly kind: 'DEFER'; readonly retryAfterSec: number }
  | { readonly kind: 'BLOCK'; readonly dailyLimit: number };

export type EmailRateInput = {
  /** `EMAIL_DAILY_LIMIT_PER_TENANT`（`packages/config`。既定 500。プランで上書き可）。 */
  readonly dailyLimit: number;
  /** `UsageCounter(DAY,'EMAIL_COUNT')` の確定値（docs/05 §8.7「`UsageCounter`（DB）が正」）。 */
  readonly dailySent: number;
  /** `EMAIL_MINUTE_LIMIT_PER_TENANT`（既定 30）。 */
  readonly minuteLimit: number;
  /** 直近 60 秒のスライディングウィンドウ内の送信数。 */
  readonly minuteSent: number;
  /**
   * ウィンドウ内で**最も古い**送信の時刻。`retryAfterSec` はここから決まる
   * （その 1 件がウィンドウから外れれば 1 枠空く）。ウィンドウが空なら `null`。
   */
  readonly minuteWindowOldestAt: Date | null;
  /** 🔴 現在時刻は引数で受け取る（本パッケージは `Date.now` を参照しない。docs/05 §17.2 #14）。 */
  readonly now: Date;
};

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} は 1 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * ウィンドウが 1 枠空くまでの秒数。
 *
 * 🔴 **0 を返さない**（0 秒後の再スケジュールは実質的な即時リトライであり、
 *    同じ判定で跳ね返り続ける busy loop になる）。上限もウィンドウ幅で頭打ちにする。
 */
function retryAfterSec(oldestAt: Date | null, now: Date): number {
  if (oldestAt === null) return EMAIL_MINUTE_WINDOW_MS / 1000;
  const elapsedMs = now.getTime() - oldestAt.getTime();
  const remainingMs = EMAIL_MINUTE_WINDOW_MS - elapsedMs;
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 1) return 1;
  if (seconds > EMAIL_MINUTE_WINDOW_MS / 1000) return EMAIL_MINUTE_WINDOW_MS / 1000;
  return seconds;
}

/**
 * 🔴 メール送信の上限判定（docs/05 §8.7）。純粋関数。
 *
 * 判定順は **日次 → 分次**である。日次に達しているテナントを分次で `DEFER` すると、
 * 10 分ごとに再判定しては同じ結論に戻る往復を一日中繰り返す（`send.hold-release` と
 * 同じ理由で、解消しない条件に待機を割り当てない）。
 *
 * 🔴 これは**判定**であって**消費**ではない。実際の枠の消費は
 * `reserveEmailDailyQuota`（`packages/db`。`ON CONFLICT DO UPDATE ... WHERE` の原子的な予約）が
 * 行う。並行実行での取りこぼしはそちらが閉じる。
 */
export function decideEmailRate(input: EmailRateInput): EmailRateDecision {
  assertPositiveInt('dailyLimit', input.dailyLimit);
  assertPositiveInt('minuteLimit', input.minuteLimit);
  assertNonNegativeInt('dailySent', input.dailySent);
  assertNonNegativeInt('minuteSent', input.minuteSent);

  if (input.dailySent >= input.dailyLimit) {
    return { kind: 'BLOCK', dailyLimit: input.dailyLimit };
  }
  if (input.minuteSent >= input.minuteLimit) {
    return { kind: 'DEFER', retryAfterSec: retryAfterSec(input.minuteWindowOldestAt, input.now) };
  }
  return { kind: 'ALLOW', dailyRemaining: input.dailyLimit - input.dailySent };
}
