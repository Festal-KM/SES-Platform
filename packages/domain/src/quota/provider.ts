// packages/domain/src/quota/provider.ts
// 🔴 送信基盤（SES アカウント）**全体**の 24 時間ローリング枠の判定（docs/05 §8.3-Q ② / `F-059 AC-7`）。T-04-04。
//
// ============================================================================
// 🔴 テナントの日次上限（`decideEmailRate`）とは別の枠である
// ============================================================================
// - `decideEmailRate`（§8.7）… **テナントの利用量**。超過は `SUPPRESSED(RATE_LIMIT)` で、
//   利用者への案内は `S-038`（プランの上限）。対処するのはテナントである。
// - `decideProviderQuota`（本ファイル）… **環境全体の枠**（`sandbox` は SES サンドボックスのまま
//   200 通 / 24h。`production` の SES 枠にも同じ機構が効く）。超過は `HELD_PROVIDER_QUOTA` で
//   **保留**し、枠が回復したら `send.hold-release` が自動で送る。対処するのは運営者である。
// 🔴 混ぜると「環境枠で止まったテナントに `S-038` を案内する」誤りが起きる（§8.3-Q ⑥）。
//
// 🔴 **`Date.now` / `process.env` を参照しない**（docs/05 §17.2 #14 / #19-③）。
//    現在時刻も上限値も引数で受け取る。上限は `MAIL_PROVIDER_DAILY_QUOTA`（`packages/config`）で
//    あり、**ここにハードコードしない**（環境ごとに違い、SES 側の枠が増えれば変わる）。

/**
 * 送信基盤（アカウント）全体の 24h 枠の観測値（`EmailSender.getQuota()` の結果）。
 *
 * 🔴 `packages/connectors` の `ProviderQuota` と**構造的に一致**させてある。
 *    `packages/domain` は何にも依存できない（`CLAUDE.md` §2.1）ため import できず、
 *    型の重複は避けられない。判定は本ファイルの 1 実装だけであり、connectors 側は
 *    値を運ぶだけである（判定を 2 箇所に持たない）。
 */
export type ProviderQuotaObservation = {
  /** SES に付与された 24h の送信上限（サンドボックスは 200）。 */
  readonly max24h: number;
  /** SES が数えた直近 24h の送信数。 */
  readonly sentLast24h: number;
  readonly observedAt: Date;
};

export type ProviderQuotaInput = {
  /**
   * `MAIL_PROVIDER_DAILY_QUOTA`（`packages/config`）。
   * 🔴 SES に付与された枠を超えて設定しても `min` で SES 側の値に丸まる（§8.3-Q ②）。
   */
  readonly envLimit: number;
  /**
   * `EmailSender.getQuota()` の結果。
   * 🔴 **取得に失敗したら `null`** を渡す。止めない側に倒さず、手元のカウンタだけで判定を続ける
   *    （§8.3-Q ③）。`null` を「枠が無限」と解釈しない。
   */
  readonly provider: ProviderQuotaObservation | null;
  /**
   * 手元のカウンタ（Redis ZSET `mail:provider:sent24h`）が数えた直近 24h の**実送信**数。
   * 🔴 モック sink に流した分は含まない（SES の枠を消費していないため。§8.3-Q ③）。
   */
  readonly localSent24h: number;
  /**
   * 🔴 現在時刻は引数で受け取る（`Date.now` を参照しないため）。
   *
   * ⚠️ 現在の判定規則（§8.3-Q ②）は時刻を使わない。それでも必須引数に残すのは、
   *    ①docs/05 §8.3-Q ② が定めるシグネチャそのものであること
   *    ②「時刻を使う規則を足したくなったときに、`Date.now` を書く誘惑を最初から断つ」ため。
   *    受け取った値は不正値の検査にだけ使う（黙って通さない）。
   */
  readonly now: Date;
};

/**
 * 判定結果（docs/05 §8.3-Q ②）。
 *
 * - `ALLOW`: 送ってよい。`headroom` は **これから何通送れるか**であり、
 *   `send.hold-release` が「一度に復帰させる件数」の上限に使う（§9.4）。
 * - `HOLD`: 🔴 **外部を 1 回も呼ばずに保留する**（`HELD_PROVIDER_QUOTA`）。
 *   失敗ではない（送信を試みていない）ので `FAILED` にせず `failureReason` も書かない。
 */
export type ProviderQuotaDecision =
  | { readonly kind: 'ALLOW'; readonly headroom: number }
  | { readonly kind: 'HOLD' };

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} は 1 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * 実効的な上限と消費量（`decideProviderQuota` の内部計算を、監視（`A-005` 項目 13。SP-11）が
 * そのまま読めるように公開したもの）。
 *
 * 🔴 判定と表示で別々に計算しない —— 別々に書くと「保留されているのに残量が余って見える」
 *    ような食い違いが起き、運営者が誤った判断をする。
 */
export type ProviderQuotaUsage = {
  readonly limit: number;
  readonly consumed: number;
  /** `consumed / limit`（0〜。1 を超えうる = SES 側が既に枠を超えて数えている場合）。 */
  readonly consumptionRate: number;
};

/** 🔴 `limit = min(envLimit, provider?.max24h)` / `consumed = max(local, provider?.sent)`（§8.3-Q ②）。 */
export function providerQuotaUsage(input: ProviderQuotaInput): ProviderQuotaUsage {
  assertPositiveInt('envLimit', input.envLimit);
  assertNonNegativeInt('localSent24h', input.localSent24h);
  if (Number.isNaN(input.now.getTime())) {
    throw new RangeError('now が不正な Date です。');
  }
  if (input.provider !== null) {
    assertPositiveInt('provider.max24h', input.provider.max24h);
    assertNonNegativeInt('provider.sentLast24h', input.provider.sentLast24h);
  }

  // 🔴 小さいほうを採る。設定が SES の枠より大きくても、実際に送れるのは SES の枠までである。
  const limit = Math.min(input.envLimit, input.provider?.max24h ?? input.envLimit);
  // 🔴 大きいほうを採る。手元のカウンタは揮発しうる（Redis）ので過小になりえ、
  //    provider 側は最大 60 秒古い（キャッシュ）ので過小になりうる。安全側は「多いほう」である。
  const consumed = Math.max(input.localSent24h, input.provider?.sentLast24h ?? 0);
  return { limit, consumed, consumptionRate: consumed / limit };
}

/**
 * 🔴 送信基盤の枠に対する 1 通分の判定（docs/05 §8.3-Q ②）。純粋関数。
 *
 * 🔴 **判定であって消費ではない。** 実際の消費は実送信の成功時に
 *    `ProviderSendCounter.record`（`packages/connectors`。単一経路の内側）が行う。
 *    ここで消費すると、保留・失敗した分まで枠を食う。
 */
export function decideProviderQuota(input: ProviderQuotaInput): ProviderQuotaDecision {
  const { limit, consumed } = providerQuotaUsage(input);
  // 🔴 「この 1 通を足したら上限を超えるか」で判定する（§8.3-Q ②）。
  if (consumed + 1 > limit) return { kind: 'HOLD' };
  return { kind: 'ALLOW', headroom: limit - consumed };
}

/**
 * 上限への接近（`MAIL_PROVIDER_QUOTA_WARN_RATIO`。既定 0.8）。
 * 🔴 到達（`HOLD`）とは別物である。接近は**まだ送れている**状態であり、送信を止めない。
 *    表示先は `A-005` 項目 13（`F-059 AC-7`。実装は SP-11 の T-11-04）。
 */
export function isProviderQuotaWarning(usage: ProviderQuotaUsage, warnRatio: number): boolean {
  if (!Number.isFinite(warnRatio) || warnRatio < 0 || warnRatio > 1) {
    throw new RangeError(`warnRatio は 0〜1 である必要があります（受け取った値: ${warnRatio}）。`);
  }
  return usage.consumptionRate >= warnRatio;
}
