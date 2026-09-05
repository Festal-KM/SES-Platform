// packages/connectors/src/email/sandbox-recipient-scoped.ts
// 🔴 `sandbox` の宛先分類による差し替え（docs/05 §8.2 の表 / `docs/02` 章 7.6 NFR-ENV-1 ②③ /
//    CLAUDE.md §11.1 / [Issue #9] / [Issue #10]）。T-04-02。
//
// 🔴 これは「送信箇所ごとの `if`」ではない。**実装の選択は起動時の 1 箇所**
//    （`packages/config` の `resolveConnectorSelection` が `sandbox` のとき
//    `email: 'sandboxRecipientScoped'` を返し、`createConnectors` がこのクラスを instantiate する）
//    であり、ここに来る時点で「`sandbox` である」ことは確定している。
//    このクラスは `APP_ENV` を**受け取らないし読まない** —— 読めるようにすると、
//    リクエストごとの環境分岐がここから漏れ出す（NFR-ENV-2）。
//
// 🔴 分岐の軸は宛先分類だけである（docs/02 章 7.6「この区別は列挙ではなく宛先の分類で判定する」）:
//      - 分類 1（ホスト所属利用者。招待中の本人を含む）と分類外（運営者）→ **実送信**
//        本人に届かないと `sandbox` に入れず、期限予告（`F-054 AC-9`）や
//        削除予告（`F-064 AC-10`）にも気づけない。
//      - 分類 2 / 3 / 4（パートナー所属利用者・提案先・エンド企業・エンジニア本人）→ **モック**
//        実在する取引先・第三者であり、CLAUDE.md §11.1 が防ごうとしている危険そのもの。
//    新しい通知が増えても列挙を増やさない。分類が決まれば扱いが一意に決まる。

import { isHostOrPlatformRecipientClass, type ProviderQuota } from '../types.js';
import type { EmailSendInput, EmailSender } from '../interfaces.js';

export type SandboxRecipientScopedEmailSenderParts = {
  /**
   * 分類 1 / 分類外の宛先に実際に送る実装（`sandbox` 用の SES。T-04-03 が渡す）。
   * 🔴 モックを渡してはならない —— 渡すと本人に届かないまま「送った」ことになる（CLAUDE.md §11.1）。
   */
  readonly real: EmailSender;
  /**
   * 分類 2 / 3 / 4 を流す先。🔴 `development` / `demo` / E2E と**同一のモック実装**を使う
   * （docs/05 §13.2 / §17.5。テスト専用の別モックを作らない）。
   */
  readonly mock: EmailSender;
};

/**
 * 宛先分類で実送信とモックを振り分ける `EmailSender`（`sandbox` 専用）。
 *
 * 🔴 `EmailSender` の実装であるため、呼び出し側（単一経路）は**振り分けの存在を知らない**。
 *    知らせると「この分類だけ別扱い」を業務コードに書けてしまう。
 */
export class SandboxRecipientScopedEmailSender implements EmailSender {
  constructor(private readonly parts: SandboxRecipientScopedEmailSenderParts) {}

  async send(input: EmailSendInput): Promise<{ externalId: string }> {
    // 🔴 判定は宛先分類だけを見る（テンプレート名・機能 ID で分岐しない）。
    //    `recipientClass` は必須引数であり、呼び出し側が省略できない（docs/05 §8.2）。
    return this.senderFor(input).send(input);
  }

  /** 実送信・モックの**合計**（環境分離の検証は分類ごとの内訳をモック側から読む。docs/05 §17.4）。 */
  callCount(): number {
    return this.parts.real.callCount() + this.parts.mock.callCount();
  }

  /**
   * 送信基盤（アカウント）全体の 24h 枠（docs/05 §8.3-Q ③）。
   * 🔴 実送信側の枠だけを返す。モックに流した分は SES の枠を消費していないため、
   *    ここに混ぜると「枠が空いていないのに送れる / 空いているのに保留する」ことになる。
   */
  async getQuota(): Promise<ProviderQuota> {
    return this.parts.real.getQuota();
  }

  private senderFor(input: EmailSendInput): EmailSender {
    return isHostOrPlatformRecipientClass(input.recipientClass) ? this.parts.real : this.parts.mock;
  }
}
