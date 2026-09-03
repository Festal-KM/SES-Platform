// apps/web/lib/auth/two-factor-throttle.ts
// 2 要素認証の**検証試行のスロットル**（docs/04 §S-001「ロックアウトは残り時間を明示する」/
// `code-reviewer` 指摘 T-03-02）。
//
// 🔴 なぜ要るか: 6 桁の TOTP は 10^6 通りしかない。試行が無制限なら、パスワードを奪った攻撃者が
//    総当たりで第 2 要素を突破できる ＝ 2 要素認証が実質的に成立しない。
//
// 🔴 本モジュールは**純粋関数だけ**である（現在時刻も DB も持たない。`now` と失敗時刻の配列を
//    引数で受け取る）。窓の境界・残り時間の算出をテストで固定できるようにするため
//    （`packages/domain` の「決定性」の規律に倣う。ここに置くのは apps/web の認証層の
//    ローカルな判定であり、ドメインモデルではないため）。
//
// ⚠️ **閾値と窓は暫定値である。** docs/02 / docs/05 に恒久的な値・ロックの持続時間・
//    UI の残り時間表示の仕様が無いため、`code-reviewer` の指示（暫定 15 分 / 5 回）で置いた。
//    確定したら `packages/config` の設定値へ移し、テナント / プランごとの上書きに載せる
//    （オーケストレーターが起票した Issue で追従する）。**呼び出し側にリテラルを散らさない。**

/** ⚠️ 暫定値。恒久値は Issue の決定を待って docs/02 / docs/05 → `packages/config` へ移す。 */
export const TWO_FACTOR_THROTTLE_POLICY = {
  /** 失敗を数える時間窓（分）。 */
  windowMinutes: 15,
  /** 窓内でこの回数の失敗に達したら、それ以上検証しない。 */
  maxFailures: 5,
} as const;

export type TwoFactorThrottlePolicy = {
  readonly windowMinutes: number;
  readonly maxFailures: number;
};

export type TwoFactorThrottleState = {
  /** 🔴 真なら**コードの検証を行わずに**拒否する。 */
  readonly locked: boolean;
  /** 窓内の失敗回数（監査ログに残す。上限で頭打ち）。 */
  readonly failures: number;
  /** 解除までの秒数（`locked` が偽なら 0）。docs/04 §S-001「残り時間を明示」。 */
  readonly retryAfterSeconds: number;
};

/** 窓の開始時刻（この時刻以降の失敗だけを数える）。DB へ渡す `since`。 */
export function twoFactorThrottleWindowStart(
  now: Date,
  policy: TwoFactorThrottlePolicy = TWO_FACTOR_THROTTLE_POLICY,
): Date {
  return new Date(now.getTime() - policy.windowMinutes * 60_000);
}

/**
 * 失敗時刻の配列からロック状態を決める。
 *
 * 🔴 窓外（`now - windowMinutes` より古い）失敗は数えない。**古い失敗が永久に残って
 *    利用者を締め出すことがない**（監査ログは消えないため、ここで必ず窓を適用する）。
 * 🔴 解除時刻は「窓内で最も古い失敗 + 窓」である（スライディングウィンドウ）。
 *    最も古い失敗が窓から外れた瞬間に、失敗回数が閾値を下回る。
 */
export function evaluateTwoFactorThrottle(
  failureTimestamps: readonly Date[],
  now: Date,
  policy: TwoFactorThrottlePolicy = TWO_FACTOR_THROTTLE_POLICY,
): TwoFactorThrottleState {
  const windowStartMs = twoFactorThrottleWindowStart(now, policy).getTime();
  const inWindow = failureTimestamps
    .map((timestamp) => timestamp.getTime())
    .filter((timestamp) => timestamp >= windowStartMs)
    .sort((a, b) => a - b);

  if (inWindow.length < policy.maxFailures) {
    return { locked: false, failures: inWindow.length, retryAfterSeconds: 0 };
  }

  const oldest = inWindow[0] as number;
  const windowSeconds = policy.windowMinutes * 60;
  const unlockAtMs = oldest + windowSeconds * 1000;
  // 🔴 0 秒（= 即再試行可能）を返さない。境界では最低 1 秒を返す。
  // 🔴 窓を超える値も返さない。失敗の時刻は DB が打つため、アプリとの時計のずれや
  //    未来日時の行があると「何時間も待て」と表示されかねない（ロックの実効期間は
  //    定義上どれだけ長くても窓 1 つ分である）。返す値は必ず窓の中に収める。
  const retryAfterSeconds = Math.min(
    windowSeconds,
    Math.max(1, Math.ceil((unlockAtMs - now.getTime()) / 1000)),
  );
  return { locked: true, failures: inWindow.length, retryAfterSeconds };
}
