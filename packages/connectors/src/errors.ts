// packages/connectors/src/errors.ts
// コネクタ層が投げる例外。🔴 いずれも**握り潰さない**（CLAUDE.md §3.2 / §3.4）。

import type { ConnectorCategory, ConnectorImplementationKind, RecipientClass } from './types.js';

/**
 * 起動時 DI で選ばれた実装がまだ登録されていない（docs/05 §13.1）。
 *
 * 🔴 **モックへフォールバックしない。** 「未設定ならモック」は
 *    「成功したように見えて実際には送信されていない」という最悪の壊れ方を生む（CLAUDE.md §11.1）。
 *    起動時に throw して**プロセスを落とす**のが正しい振る舞いである。
 */
export class ConnectorImplementationNotAvailableError extends Error {
  constructor(
    readonly category: ConnectorCategory,
    readonly kind: ConnectorImplementationKind,
  ) {
    super(
      `コネクタ区分 '${category}' の実装種別 '${kind}' はまだ登録されていません。` +
        'モックへのフォールバックは行いません（CLAUDE.md §11.1 / docs/05 §13.1）。',
    );
    this.name = 'ConnectorImplementationNotAvailableError';
  }
}

/**
 * 🔴 業務上の外部送信（分類 2 / 3 / 4）に検証済みの送信元ドメインが渡されなかった
 *    （docs/05 §8.3「フォールバックしない」/ `BR-51`）。
 *
 * 共通ドメインへ切り替える分岐を**実装のどこにも書かない**ため、経路の末端で必ず落とす。
 * モックと実装で同じ判定を使う（`assertSendingDomainForRecipientClass`）ので、
 * `development` で通って `production` で落ちる差が生まれない。
 */
export class SendingDomainRequiredError extends Error {
  constructor(readonly recipientClass: RecipientClass) {
    super(
      `宛先分類 '${recipientClass}' への送信には検証済みの独自ドメインが必要です。` +
        '共通ドメインへのフォールバックは行いません（docs/05 §8.3 / BR-51）。',
    );
    this.name = 'SendingDomainRequiredError';
  }
}

/**
 * 🔴 送信基盤（アカウント）全体の 24 時間枠を、外部 API が同期的に拒否した（docs/05 §8.3-Q ⑤）。
 *
 * これは**障害ではなく保留**である。`email.dispatch` / `account.mail` のハンドラは
 * `EmailDispatch.status='HELD_PROVIDER_QUOTA'` に置いて**正常終了**する
 * （`FAILED` にしない / `failureReason` を書かない / 再 throw しない）。
 * 🔴 秒間レート超過（`Maximum sending rate exceeded`）は別物であり、この型に正規化しない。
 * 🔴 `send.*` には適用しない（外部呼び出しを 1 回行った以上 `SUBMIT_FAILED` / `SEND_FAILED`。`BR-22`）。
 */
export class ProviderQuotaExceededError extends Error {
  constructor(message = '送信基盤の 24 時間あたりの送信数上限に到達しています。') {
    super(message);
    this.name = 'ProviderQuotaExceededError';
  }
}
