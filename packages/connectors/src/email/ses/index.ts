// packages/connectors/src/email/ses/index.ts
// SES コネクタの公開面（T-04-03）。
// 🔴 `SesEmailSender` は `createConnectors` が `email: 'real'` のときに instantiate する。
//    業務コードが直接 new する経路は無い（実装種別の分岐を業務コードに書かせない。docs/05 §13.1）。
export type { SesApi, SesGetAccountResponse, SesSendEmailRequest, SesSendEmailResponse } from './api.js';
export { InMemoryProviderSendCounter, type ProviderSendCounter } from './counter.js';
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
export {
  buildSesSendEmailRequest,
  resolveFromAddress,
  SES_QUOTA_CACHE_TTL_MS,
  SesEmailSender,
  sesTenantName,
  type SesEmailSenderParts,
} from './ses.js';
