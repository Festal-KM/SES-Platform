// packages/connectors/src/email/ses/counter.ts
// 🔴 送信基盤（SES アカウント）の 24 時間ローリング送信数の**手元のカウンタ**（docs/05 §8.3-Q ③）。
//
// 🔴 加算は**単一経路の内側**（`SesEmailSender.send` の実送信成功直後）で行う。
//    呼び出し側に加算させると、新しい送信経路が増えるたびに忘れられる。
// 🔴 モック sink に流した分（`sandbox` の分類 2 / 3 / 4）は**加算しない**。SES の枠を
//    消費していないものを数えると、空いている枠を保留してしまう。
//    `SandboxRecipientScopedEmailSender` がモック側へ振る経路はこのカウンタに触れない構造になっている。

/**
 * 直近 24 時間の実送信数のカウンタ。
 *
 * 🔴 本番は Redis の ZSET `mail:provider:sent24h`（`ZADD score=now` /
 *    `ZREMRANGEBYSCORE` で 24h より古いものを落とす。docs/05 §8.3-Q ③）で実装する。
 *    **プロセスを跨いで共有できることが要件**であり、`InMemoryProviderSendCounter` は
 *    単一プロセス（`development` / ユニットテスト）専用である。実装は T-04-04。
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
