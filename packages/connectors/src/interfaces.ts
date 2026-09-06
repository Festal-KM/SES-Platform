// packages/connectors/src/interfaces.ts
// docs/05 §8.1 の共通インタフェース。実装（実サービス / モック）はこの契約だけを満たす。
//
// 🔴 モックと実装が**同じシグネチャ**を持つ（docs/05 §13.2）。`callCount()` のような
//    検証用のメソッドもインタフェース側に置く —— テストのためだけにモックへ生やすと、
//    「E2E はモック、本番は実装」で経路が分岐してしまう。

import { SendingDomainRequiredError } from './errors.js';
import type {
  DispatchToken,
  EsignConnectionSecret,
  EsignProviderKey,
  EsignSendInput,
  EsignSigner,
  MeterEventInput,
  MeterSubmissionToken,
  NormalizedEsignStatus,
  DecimalString,
  Period,
  PresignedUrl,
  ProviderQuota,
  RecipientClass,
  ScanResultReading,
  SendAttemptToken,
  VerifiedSendingDomain,
} from './types.js';
import { isExternalRecipientClass } from './types.js';

/** `EmailSender.send` の入力（docs/05 §8.1）。 */
export type EmailSendInput = {
  /** 🔴 必須。既定値を持たない = 省略するとコンパイルエラー（docs/05 §8.2）。 */
  readonly recipientClass: RecipientClass;
  readonly to: string;
  readonly templateKey: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly tenantId: string | null;
  /** 🔴 未検証のときは `null`。分類 2 / 3 / 4 で `null` を渡すと実装が throw する（§8.3）。 */
  readonly fromDomain: VerifiedSendingDomain | null;
  /** 🔴 予約を経ない送信をコンパイル不能にする（docs/05 §10.2）。 */
  readonly token: SendAttemptToken | DispatchToken;
};

export interface EmailSender {
  send(input: EmailSendInput): Promise<{ externalId: string }>;
  /** 🔴 モックと実装の共通シグネチャ（docs/05 §13.3）。環境分離の検証がこれを読む。 */
  callCount(): number;
  /**
   * 送信基盤（アカウント）全体の 24h 枠（docs/05 §8.3-Q ③）。
   * 🔴 取得に失敗したら throw する（0 を返さない）。呼び出し側が `null` に落として判定を続ける。
   */
  getQuota(): Promise<ProviderQuota>;
}

/**
 * 🔴 「共通ドメインへフォールバックしない」（`BR-51` / docs/05 §8.3）を、
 *    **モックと実装の両方が同じコードで**守るための判定。
 *
 * 実装ごとに書くと片方で忘れ、`development` では通るのに `production` で落ちる（あるいはその逆で
 * 未検証のまま取引先へ届く）差分が生まれる。ここ 1 箇所に置き、全 `EmailSender` 実装が呼ぶ。
 */
export function assertSendingDomainForRecipientClass(input: {
  readonly recipientClass: RecipientClass;
  readonly fromDomain: VerifiedSendingDomain | null;
}): void {
  if (!isExternalRecipientClass(input.recipientClass)) return;
  if (input.fromDomain === null) throw new SendingDomainRequiredError(input.recipientClass);
}

/**
 * `ObjectStore.head()` が返す**保管されている実体**の属性（T-05-06 で `contentType` を追加）。
 *
 * 🔴 アップロード確定（#19）は、クライアントの申告ではなく**この値**を正として
 *    `SkillSheet` の行を作る（docs/05 §14.2）。`byteSize` は `UsageCounter(STORAGE_BYTES)` の
 *    加算値であり、`versionId` はスキャン結果の重複排除キーの一部である。
 */
export type ObjectHead = {
  readonly byteSize: number;
  readonly versionId: string;
  readonly contentType: string;
};

export interface ObjectStore {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUrl>;
  presignGet(key: string, ttlSec: number): Promise<PresignedUrl>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
  callCount(): number;
}

export interface MalwareScanner {
  /** GuardDuty は S3 の Put が契機なので実装によっては no-op。 */
  enqueue(key: string): Promise<void>;
  /**
   * 保険のポーリング用（docs/05 §8.5「Webhook が届かない場合の保険」）。**未着なら `null`**。
   *
   * 🔴 `versionId` に `null` を渡すと**最新版**を照会する（T-05-05）。`skill_sheets` は版 ID を
   *    列として持たない（キーの `{uuid}` が版を跨がない前提。docs/05 §14.1）ため、
   *    `scan.poll` は `null` で呼ぶ。戻り値の `objectVersionId` が実際に判定の付いた版であり、
   *    それを `FileScanResult` の重複排除キーに使う。
   * 🔴 **`SCANNING`（未確定）を返さない。** 「まだ判定が無い」は `null` で表す ——
   *    未確定を状態として返すと、呼び出し側が「確定した SCANNING」を適用しようとしてしまう。
   */
  getResult(key: string, versionId: string | null): Promise<ScanResultReading | null>;
  callCount(): number;
}

/**
 * 🔴 認可フローの差異はここに閉じる（`docs/03` §9.1）。ドメイン層は `kind` を知らない。
 */
export type EsignConnectFlow =
  | {
      readonly kind: 'OAUTH_AUTH_CODE';
      /** 🔴 `scope` に `extended` を必ず含める（忘れると 30 日で接続が黙って切れる）。 */
      buildAuthorizeUrl(state: string): string;
      exchangeCode(code: string): Promise<EsignConnectionSecret & { accountName: string }>;
      /** 新しいリフレッシュトークンを返す → 呼び出し側が再暗号化して保存する。 */
      refresh(conn: EsignConnectionSecret): Promise<EsignConnectionSecret>;
    }
  | {
      readonly kind: 'CLIENT_ID';
      validate(conn: EsignConnectionSecret): Promise<{ ok: boolean; reason?: string }>;
    };

export interface EsignProvider {
  readonly key: EsignProviderKey;
  readonly connect: EsignConnectFlow;
  ensureWebhook(conn: EsignConnectionSecret, url: string): Promise<{ configId: string; hmacKeys: string[] }>;
  /** 🔴 生ボディに対する HMAC。いずれか 1 キーが一致すれば true。 */
  verifyWebhook(rawBody: Uint8Array, headers: Headers, keys: readonly string[]): boolean;
  createAndSend(
    input: EsignSendInput & { readonly signers: readonly EsignSigner[] },
    token: SendAttemptToken,
  ): Promise<{ externalDocumentId: string }>;
  fetchStatus(conn: EsignConnectionSecret, externalDocumentId: string): Promise<NormalizedEsignStatus>;
  withdraw(conn: EsignConnectionSecret, externalDocumentId: string): Promise<void>;
  downloadExecuted(conn: EsignConnectionSecret, externalDocumentId: string): Promise<Uint8Array>;
  callCount(): number;
}

/**
 * 🔴 **全プロバイダの実装のマップ**（docs/05 §8.1 / §8.4）。テナントごとに provider が違うため、
 *    `TenantEsignConnection.provider` でキーを引く。**リクエストごとの `if` にしない。**
 *
 * 🔴 キーが無い（= そのプロバイダの実装が登録されていない）場合は `undefined` になり、
 *    呼び出し側は「未接続」として扱うほかない（`requireEsignConnection` が 422）。
 *    **フォールバックで別プロバイダを選ばない。**
 */
export type EsignProviderMap = Readonly<Partial<Record<EsignProviderKey, EsignProvider>>>;

export interface BillingProvider {
  submitMeterEvent(input: MeterEventInput, token: MeterSubmissionToken): Promise<void>;
  fetchInvoiceTotals(customerId: string, period: Period): Promise<{ amountJpy: DecimalString }>;
  callCount(): number;
}
