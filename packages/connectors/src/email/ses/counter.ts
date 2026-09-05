// packages/connectors/src/email/ses/counter.ts
// 🔴 送信基盤（SES アカウント）の 24 時間ローリング送信数の**手元のカウンタ**（docs/05 §8.3-Q ③）。
//
// 🔴 加算は**単一経路の内側**（`SesEmailSender.send` の実送信成功直後）で行う。
//    呼び出し側に加算させると、新しい送信経路が増えるたびに忘れられる。
// 🔴 モック sink に流した分（`sandbox` の分類 2 / 3 / 4）は**加算しない**。SES の枠を
//    消費していないものを数えると、空いている枠を保留してしまう。
//    `SandboxRecipientScopedEmailSender` がモック側へ振る経路はこのカウンタに触れない構造になっている。

import { randomUUID } from 'node:crypto';

/**
 * 直近 24 時間の実送信数のカウンタ。
 *
 * 🔴 本番は Redis の ZSET `mail:provider:sent24h`（`ZADD score=now` /
 *    `ZREMRANGEBYSCORE` で 24h より古いものを落とす。docs/05 §8.3-Q ③）で実装する
 *    （`RedisProviderSendCounter`。T-04-04）。**プロセスを跨いで共有できることが要件**であり、
 *    `InMemoryProviderSendCounter` は単一プロセス（`development` / ユニットテスト）専用である。
 */
export interface ProviderSendCounter {
  /** 実送信が成功した事実を 1 件記録する。 */
  record(at: Date): Promise<void>;
  /** `at` から遡って 24 時間以内の件数。 */
  countLast24h(at: Date): Promise<number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 単一プロセス用のカウンタ。
 * 🔴 `production` では使わない（プロセスが複数あると枠を過小評価する）。選択は起動時 DI が行い、
 *    ここに `APP_ENV` の分岐は無い。
 */
export class InMemoryProviderSendCounter implements ProviderSendCounter {
  private readonly sentAt: number[] = [];

  async record(at: Date): Promise<void> {
    this.prune(at);
    this.sentAt.push(at.getTime());
  }

  async countLast24h(at: Date): Promise<number> {
    this.prune(at);
    return this.sentAt.length;
  }

  private prune(at: Date): void {
    const threshold = at.getTime() - DAY_MS;
    while (this.sentAt.length > 0 && (this.sentAt[0] ?? 0) <= threshold) {
      this.sentAt.shift();
    }
  }
}

/**
 * 🔴 Redis ZSET のキー（docs/05 §8.3-Q ③）。**環境（SES アカウント）全体で 1 本**である。
 *    テナントごとに分けない —— 数えている枠が環境全体のものだからである
 *    （テナント単位の日次上限は `UsageCounter(DAY,'EMAIL_COUNT')` が別に持つ。§8.7）。
 */
export const PROVIDER_SENT_24H_KEY = 'mail:provider:sent24h';

/**
 * `RedisProviderSendCounter` が使う Redis コマンドの最小集合。
 *
 * 🔴 メソッド名・引数は **ioredis と構造的に一致**させてある（SP-07 の配線が
 *    `new Redis(REDIS_URL)` をそのまま渡せる）。`packages/connectors` に Redis クライアントの
 *    依存を持ち込まないのは、①ユニットテストと CI が実 Redis を要求しないため
 *    ②接続の生成は起動時 DI の 1 箇所（`CLAUDE.md` §11.1）に閉じるため、である。
 */
export interface ProviderCounterRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: string | number, max: number): Promise<unknown>;
  zcount(key: string, min: number, max: string | number): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

/**
 * 🔴 プロセス横断の 24h ローリングカウンタ（docs/05 §8.3-Q ③）。
 *
 * 🔴 `record` は**実送信が成功した直後**にだけ呼ばれる（`SesEmailSender.send` の内側）。
 *    モック sink に流した分（`sandbox` の分類 2 / 3 / 4）はここに来ない —— SES の枠を
 *    消費していないものを数えると、空いている枠を保留してしまう。
 * 🔴 メンバーは「時刻 + ランダム」にする。時刻だけだと同一ミリ秒の 2 通が同じメンバーになり
 *    **`ZADD` が上書きになって 1 通ぶん数え落とす**（枠を過大評価し、二重に送る側へ倒れる）。
 */
export class RedisProviderSendCounter implements ProviderSendCounter {
  constructor(
    private readonly redis: ProviderCounterRedis,
    private readonly key: string = PROVIDER_SENT_24H_KEY,
  ) {}

  async record(at: Date): Promise<void> {
    const now = at.getTime();
    await this.redis.zadd(this.key, now, `${now}:${randomUUID()}`);
    await this.prune(now);
    // 🔴 全体が 24h 以上更新されなければ落ちてよい（枠は 24h ローリングであり、
    //    それ以上古い記録は判定に影響しない）。キーが永久に残るのを防ぐ。
    await this.redis.pexpire(this.key, DAY_MS);
  }

  async countLast24h(at: Date): Promise<number> {
    const now = at.getTime();
    await this.prune(now);
    return this.redis.zcount(this.key, now - DAY_MS, now);
  }

  /**
   * 🔴 24h より古い記録を落とす（`ZREMRANGEBYSCORE key -inf (now - 24h)`）。
   *    境界（ちょうど 24h 前）は削除側に入るが、`countLast24h` の下限も同じ値なので
   *    「消したものを数える」ことは起きない。
   */
  private async prune(now: number): Promise<void> {
    await this.redis.zremrangebyscore(this.key, '-inf', now - DAY_MS);
  }
}
