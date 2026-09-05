// packages/connectors/src/email/ses/index.ts
// SES コネクタの公開面（T-04-03 / T-04-04）。
// 🔴 `SesEmailSender` は `createConnectors` が `email: 'real'` のときに instantiate する。
//    業務コードが直接 new する経路は無い（実装種別の分岐を業務コードに書かせない。docs/05 §13.1）。
export type {
  SesApi,
  SesCreateEmailIdentityResponse,
  SesGetAccountResponse,
  SesGetEmailIdentityResponse,
  SesIdentityApi,
  SesSendEmailRequest,
  SesSendEmailResponse,
} from './api.js';
export {
  InMemoryProviderSendCounter,
  PROVIDER_SENT_24H_KEY,
  RedisProviderSendCounter,
  type ProviderCounterRedis,
  type ProviderSendCounter,
} from './counter.js';
export {
  InMemoryProviderQuotaCache,
  PROVIDER_QUOTA_CACHE_KEY,
  RedisProviderQuotaCache,
  SES_QUOTA_CACHE_TTL_MS,
  type ProviderQuotaCache,
  type ProviderQuotaCacheRedis,
} from './quota-cache.js';
export {
  EXTERNAL_SEND_FAILURE_KINDS,
  ExternalSendError,
  normalizeSesError,
  type ExternalSendFailureKind,
} from './errors.js';
export {
  hashRecipient,
  normalizeSesEvent,
  parseNormalizedEmailEvent,
  serializeNormalizedEmailEvent,
  SES_EVENT_TYPES,
  SesEventParseError,
  sesWebhookDedupeKey,
  type NormalizedEmailEvent,
  type SerializedEmailEvent,
  type SesEventType,
} from './events.js';
// 🔴 T-04-04: 送信元ドメインの DNS レコード提示と検証状態の正規化（docs/05 §8.3 / docs/03 §3.2.7）。
export {
  buildDkimCnameRecords,
  buildMailFromRecords,
  decideSendingDomainVerification,
  mailFromDomainFor,
  SENDING_DOMAIN_FAILURE_REASONS,
  type SendingDomainDnsRecord,
  type SendingDomainFailureReason,
  type SendingDomainVerification,
} from './identity.js';
export {
  buildSesSendEmailRequest,
  resolveFromAddress,
  SesEmailSender,
  sesTenantName,
  type SesEmailSenderParts,
} from './ses.js';
