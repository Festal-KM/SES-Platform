// packages/connectors/src/email/ses/nearing-marker.ts
// 🔴 送信基盤（SES アカウント）全体の 24h 枠が**接近**（`MAIL_PROVIDER_QUOTA_WARN_RATIO`。既定 0.8）に
//    入った**最初の時刻**の目印（docs/05 §16.5 項目 13 ③「`mail:provider:nearingSince` に置く。下回ったら削除。
//    表示専用なので揮発してよい」）。T-11-04。
//
// ============================================================================
// 🔴 これは表示のための目印であり、判定には使わない
// ============================================================================
// 送れるかどうか（`decideProviderQuota`）と接近しているか（`isProviderQuotaWarning`）は毎回その場で計算する。
// この目印が持つのは「接近を最初に観測した時刻」だけであり、無くなっても失うのは `A-005` の「接近時刻」の
// 表示だけである（次に観測した時刻から数え直す）。Redis の障害でこの目印が読めなくても項目 13 は成立する
// （`nearingSince: null` で返す）。
//
// 🔴 `SET ... NX` で**最初の観測時刻を守る**（後から観測した時刻で上書きしない）。下回ったら `DEL`。
//    24 時間ローリングの枠なので目印にも 24 時間の TTL を付け、観測が途絶えても永久に残らないようにする。
// 🔴 `packages/connectors` は Redis クライアントを持たない（`counter.ts` / `quota-cache.ts` と同じ整理）。
//    ioredis と構造的に一致する最小集合を宣言し、実体は `bullmq.ts`（Redis クライアントを作る唯一のファイル）が渡す。

/** 🔴 Redis のキー。環境（SES アカウント）全体で 1 本（`PROVIDER_SENT_24H_KEY` と同じ理由でテナントごとに分けない）。 */
export const PROVIDER_NEARING_SINCE_KEY = 'mail:provider:nearingSince';

/** 24h ローリングの枠に合わせた TTL。観測が途絶えたら消える（永久に残さない）。 */
export const PROVIDER_NEARING_SINCE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 接近の目印。
 *
 * `observe(nearing, now)` … いま接近していれば「最初に接近を観測した時刻」を返す（目印が無ければ `now` を
 * 記録してそれを返す）。接近していなければ目印を消して `null` を返す。
 */
export interface ProviderQuotaNearingMarker {
  observe(nearing: boolean, now: Date): Promise<Date | null>;
}

/** 単一プロセス用（`development` / ユニットテスト）。 */
export class InMemoryProviderQuotaNearingMarker implements ProviderQuotaNearingMarker {
  private since: Date | null = null;

  async observe(nearing: boolean, now: Date): Promise<Date | null> {
    if (!nearing) {
      this.since = null;
      return null;
    }
    if (this.since === null || now.getTime() - this.since.getTime() > PROVIDER_NEARING_SINCE_TTL_MS) {
      this.since = now;
    }
    return this.since;
  }
}

/**
 * `RedisProviderQuotaNearingMarker` が使う Redis コマンドの最小集合（ioredis と構造的に一致）。
 * 🔴 `set(key, value, 'PX', ttl, 'NX')` = 無いときだけ書く。最初の観測時刻を後から動かさない。
 */
export interface ProviderNearingRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

function parseSince(raw: string | null): Date | null {
  if (raw === null) return null;
  const parsed = new Date(raw);
  // 🔴 壊れた値は「無かったこと」にする（例外にして監視画面を止めない）。次の観測が正しい値で書き直す。
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 🔴 プロセス横断の目印（`sandbox` / `staging` / `production`）。 */
export class RedisProviderQuotaNearingMarker implements ProviderQuotaNearingMarker {
  constructor(
    private readonly redis: ProviderNearingRedis,
    private readonly key: string = PROVIDER_NEARING_SINCE_KEY,
    private readonly ttlMs: number = PROVIDER_NEARING_SINCE_TTL_MS,
  ) {}

  async observe(nearing: boolean, now: Date): Promise<Date | null> {
    if (!nearing) {
      await this.redis.del(this.key);
      return null;
    }
    await this.redis.set(this.key, now.toISOString(), 'PX', this.ttlMs, 'NX');
    const stored = parseSince(await this.redis.get(this.key));
    // 🔴 `NX` が負けて別プロセスの値が入っていればそれを採る。読めなければ（TTL 切れの競合）今回の観測時刻。
    return stored ?? now;
  }
}
