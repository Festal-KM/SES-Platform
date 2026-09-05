// packages/connectors/src/email/ses/ses.ts
// 🔴 Amazon SES による `EmailSender` の実装（docs/05 §8.1 / §8.3 / docs/03 §3.2）。T-04-03。
//
// 🔴 この実装が守ること:
//    ① `assertSendingDomainForRecipientClass` を**モックと同じコードで**通す（`BR-51`。
//       未検証の独自ドメインで取引先へ送る経路を、実装差で作らない）
//    ② `SendEmail` に `TenantName` と `FromEmailAddress` を必ず渡す（docs/05 §8.3。
//       SES Tenants によるテナント別レピュテーション・サプレッションの前提）
//    ③ 実送信が成功した**直後**に手元の 24h カウンタへ加算する（docs/05 §8.3-Q ③。
//       単一経路の内側なので呼び出し側が忘れられない）
//    ④ SES の例外を内部型へ正規化する（`CLAUDE.md` §3.4 / docs/05 §15.4）。
//       日次枠超過だけは `ProviderQuotaExceededError`（保留）として区別する
//
// 🔴 リトライをここに書かない。送信の再試行可否はジョブの `attempts`（`packages/connectors/src/queues.ts`）
//    だけが決める。コネクタが内部で黙って再送すると、`attempts: 1` の意味が消える（`BR-22`）。

import { assertSendingDomainForRecipientClass, type EmailSendInput, type EmailSender } from '../../interfaces.js';
import type { ProviderQuota, VerifiedSendingDomain } from '../../types.js';
import type { SesApi, SesSendEmailRequest } from './api.js';
import type { ProviderSendCounter } from './counter.js';
import { normalizeSesError } from './errors.js';

/** `GetAccount` の結果を保持する時間（docs/05 §8.3-Q ③「Redis に 60 秒キャッシュ」）。 */
export const SES_QUOTA_CACHE_TTL_MS = 60_000;

export type SesEmailSenderParts = {
  readonly api: SesApi;
  /**
   * 共通ドメインの送信元アドレス（`SES_DEFAULT_FROM_ADDRESS`。`packages/config`）。
   * 🔴 分類 1 / 分類外（サービスからの連絡）はこのアドレスで送ってよい（docs/03 §3.2.7 規律 2）。
   */
  readonly defaultFromAddress: string;
  /** `SES_CONFIGURATION_SET`。バウンス・苦情の event destination がここに紐づく（docs/03 §3.2.5）。 */
  readonly configurationSet: string;
  /** 🔴 docs/05 §8.3-Q ③。実送信成功のたびに単一経路の内側で加算する。 */
  readonly sentCounter: ProviderSendCounter;
  /** 🔴 現在時刻の注入（テストの決定性）。既定は `new Date()`。 */
  readonly now?: () => Date;
};

/**
 * 送信元アドレスを決める。
 *
 * 🔴 **フォールバックの分岐ではない。** 分類 2 / 3 / 4 は `fromDomain === null` の時点で
 *    `assertSendingDomainForRecipientClass` が既に throw しており、ここへ到達しない
 *    （docs/05 §8.3「共通ドメインへ切り替える分岐をコードに書かない」）。
 *    したがってここの `null` 側は「共通ドメインで正しい宛先（分類 1 / 分類外）」だけである。
 * 🔴 ローカル部は共通アドレスのものを引き継ぐ。テナントごとに別のローカル部を持つ設計は
 *    まだ無く、独自に組み立てると `SES_DEFAULT_FROM_ADDRESS` と食い違う 2 つ目の出所になる。
 */
export function resolveFromAddress(
  defaultFromAddress: string,
  fromDomain: VerifiedSendingDomain | null,
): string {
  if (fromDomain === null) return defaultFromAddress;
  const at = defaultFromAddress.lastIndexOf('@');
  const localPart = at < 0 ? defaultFromAddress : defaultFromAddress.slice(0, at);
  return `${localPart}@${fromDomain.domain}`;
}

/**
 * `SendEmail`（SESv2）のリクエストを組み立てる。
 *
 * 🔴 `TenantName` は `null` のとき**プロパティごと落とす**（空文字を渡すと SES 側の
 *    バリデーションエラーになり、原因が「テナント未割当」だと読み取れなくなる）。
 */
export function buildSesSendEmailRequest(
  input: EmailSendInput,
  parts: { readonly defaultFromAddress: string; readonly configurationSet: string },
): SesSendEmailRequest {
  const tenantName = input.tenantId === null ? undefined : sesTenantName(input.tenantId);
  return {
    FromEmailAddress: resolveFromAddress(parts.defaultFromAddress, input.fromDomain),
    Destination: { ToAddresses: [input.to] },
    ConfigurationSetName: parts.configurationSet,
    ...(tenantName === undefined ? {} : { TenantName: tenantName }),
    Content: {
      Template: {
        TemplateName: input.templateKey,
        TemplateData: JSON.stringify(input.params),
      },
    },
  };
}

/** SES Tenant の名前（docs/05 §8.3 の `'t-{tenantId}'`）。 */
export function sesTenantName(tenantId: string): string {
  return `t-${tenantId}`;
}

export class SesEmailSender implements EmailSender {
  private calls = 0;
  private quotaCache: { readonly quota: ProviderQuota; readonly expiresAt: number } | null = null;

  constructor(private readonly parts: SesEmailSenderParts) {}

  async send(input: EmailSendInput): Promise<{ externalId: string }> {
    // 🔴 モック（`MockEmailSender`）と**同じ関数**を通す。実装差で `BR-51` が緩まないようにする。
    assertSendingDomainForRecipientClass(input);

    const request = buildSesSendEmailRequest(input, {
      defaultFromAddress: this.parts.defaultFromAddress,
      configurationSet: this.parts.configurationSet,
    });

    let response;
    try {
      response = await this.parts.api.sendEmail(request);
    } catch (error) {
      // 🔴 握り潰さない。分類してから投げ直す（日次枠超過は保留、それ以外は失敗）。
      // 🔴 `'send'` を渡す —— 送信経路では 5xx を「応答不明」に分類させるためである
      //    （`TRANSIENT` にすると `attempts: 3` に乗り、実は送信済みのケースで 2 通目が出る）。
      throw normalizeSesError(error, 'send');
    }

    // 🔴 加算は**成功後**に行う（失敗した送信は SES の枠を消費していない）。
    this.calls += 1;
    await this.parts.sentCounter.record(this.now());

    return { externalId: response.MessageId };
  }

  callCount(): number {
    return this.calls;
  }

  /**
   * 送信基盤（アカウント）全体の 24h 枠（docs/05 §8.1 / §8.3-Q ③）。
   *
   * 🔴 **取得に失敗したら throw する**（0 を返さない）。呼び出し側が `null` に倒して
   *    手元のカウンタだけで判定を続ける（止めない側に倒さない）。
   * 🔴 60 秒キャッシュ。`GetAccount` は送信系以外の API であり **1 リクエスト / 秒**の
   *    上限がある（docs/03 §3.2.4）。送信のたびに呼ぶとそこで詰まる。
   *    ⚠️ プロセス内キャッシュである。プロセス横断で共有する Redis 版は T-04-04。
   */
  async getQuota(): Promise<ProviderQuota> {
    const now = this.now();
    const cached = this.quotaCache;
    if (cached !== null && cached.expiresAt > now.getTime()) return cached.quota;

    let account;
    try {
      account = await this.parts.api.getAccount();
    } catch (error) {
      // 🔴 読み取りなので 5xx は `TRANSIENT` でよい（何度呼んでも副作用が無い）。
      throw normalizeSesError(error, 'read');
    }
    const quota: ProviderQuota = {
      max24h: account.SendQuota.Max24HourSend,
      sentLast24h: account.SendQuota.SentLast24Hours,
      observedAt: now,
    };
    this.quotaCache = { quota, expiresAt: now.getTime() + SES_QUOTA_CACHE_TTL_MS };
    return quota;
  }

  private now(): Date {
    return this.parts.now?.() ?? new Date();
  }
}
