// packages/connectors/src/email/ses/quota-cache.ts
// 🔴 `EmailSender.getQuota()`（SES の `GetAccount`）の 60 秒キャッシュ（docs/05 §8.3-Q ③）。T-04-04。
//
// 🔴 なぜキャッシュが要るか: `GetAccount` は送信系以外の API であり **1 リクエスト / 秒**の
//    上限がある（docs/03 §3.2.4）。1 通ごとに叩くとそこで詰まり、**枠の判定そのものが
//    送信のボトルネックになる**。
// 🔴 なぜプロセス横断（Redis）にするか: ワーカーは複数プロセスで走る。プロセスごとに
//    キャッシュを持つと `GetAccount` の呼び出しがプロセス数だけ増え、上記の 1 req/s に当たる。
//
// 🔴 このキャッシュは**判定を緩めない**。`decideProviderQuota` は
//    `consumed = max(localSent24h, provider.sentLast24h)` を採るため（§8.3-Q ②）、
//    最大 60 秒古い provider 値が実際より小さくても、手元のカウンタ（Redis ZSET）が
//    その間の送信を数えている。**古いキャッシュが「枠が空いている」に倒れることはない。**

import type { ProviderQuota } from '../../types.js';

/** 🔴 docs/05 §8.3-Q ③「Redis に 60 秒キャッシュ」。 */
export const SES_QUOTA_CACHE_TTL_MS = 60_000;

/** 🔴 環境（SES アカウント）全体で 1 本のキー。テナントごとに分けない。 */
export const PROVIDER_QUOTA_CACHE_KEY = 'mail:provider:quota';

/**
 * 取得済みの枠を保持する場所。
 * 🔴 「無ければ `null`」であって「無ければ枠が無限」ではない。呼び出し側（`SesEmailSender`）は
 *    `null` のとき `GetAccount` を実際に叩き、それも失敗したら例外を投げる（0 を返さない）。
 */
export interface ProviderQuotaCache {
  read(now: Date): Promise<ProviderQuota | null>;
  write(quota: ProviderQuota, now: Date): Promise<void>;
}

/** 単一プロセス用（`development` / ユニットテスト）。 */
export class InMemoryProviderQuotaCache implements ProviderQuotaCache {
  private entry: { readonly quota: ProviderQuota; readonly expiresAt: number } | null = null;

  constructor(private readonly ttlMs: number = SES_QUOTA_CACHE_TTL_MS) {}

  async read(now: Date): Promise<ProviderQuota | null> {
    const entry = this.entry;
    if (entry === null || entry.expiresAt <= now.getTime()) return null;
    return entry.quota;
  }

  async write(quota: ProviderQuota, now: Date): Promise<void> {
    this.entry = { quota, expiresAt: now.getTime() + this.ttlMs };
  }
}

/**
 * `RedisProviderQuotaCache` が使う Redis コマンドの最小集合。
 * 🔴 メソッド名・引数は ioredis と構造的に一致させてある（`ProviderCounterRedis` と同じ方針）。
 */
export interface ProviderQuotaCacheRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

type SerializedQuota = {
  readonly max24h: number;
  readonly sentLast24h: number;
  readonly observedAt: string;
};

function parseQuota(raw: string): ProviderQuota | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 🔴 壊れたキャッシュは「無かったこと」にする（例外にして送信を止めない）。
    //    次の `write` が正しい値で上書きする。
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<SerializedQuota>;
  if (
    typeof candidate.max24h !== 'number' ||
    typeof candidate.sentLast24h !== 'number' ||
    typeof candidate.observedAt !== 'string'
  ) {
    return null;
  }
  const observedAt = new Date(candidate.observedAt);
  if (Number.isNaN(observedAt.getTime())) return null;
  return { max24h: candidate.max24h, sentLast24h: candidate.sentLast24h, observedAt };
}

/** 🔴 プロセス横断のキャッシュ（`production` / `staging` / `sandbox`）。TTL は Redis 側（`PX`）が持つ。 */
export class RedisProviderQuotaCache implements ProviderQuotaCache {
  constructor(
    private readonly redis: ProviderQuotaCacheRedis,
    private readonly ttlMs: number = SES_QUOTA_CACHE_TTL_MS,
    private readonly key: string = PROVIDER_QUOTA_CACHE_KEY,
  ) {}

  /**
   * @param now 期限は Redis の `PX` が持つため参照しない。**引数は落とさない** ——
   *   `ProviderQuotaCache` として差し替えたときに、呼び出し側が渡す形が実装ごとに変わらないようにする。
   */
  async read(now?: Date): Promise<ProviderQuota | null> {
    void now;
    const raw = await this.redis.get(this.key);
    return raw === null ? null : parseQuota(raw);
  }

  async write(quota: ProviderQuota, now?: Date): Promise<void> {
    void now;
    const payload: SerializedQuota = {
      max24h: quota.max24h,
      sentLast24h: quota.sentLast24h,
      observedAt: quota.observedAt.toISOString(),
    };
    await this.redis.set(this.key, JSON.stringify(payload), 'PX', this.ttlMs);
  }
}
