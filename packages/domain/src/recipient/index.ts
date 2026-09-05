// packages/domain/src/recipient/index.ts
// 宛先分類（docs/05 §8.2）の公開面。`packages/db`（分類する側）と `packages/connectors`
// （必須引数として受け取る側）の**両方**がここだけを見る。
export { classifyRecipient, RECIPIENT_CLASSES } from './classify.js';
export type { RecipientClass, RecipientFacts } from './classify.js';
export {
  ACCOUNT_MAIL_RECIPIENT_CLASSES,
  EXTERNAL_RECIPIENT_CLASSES,
  HOST_OR_PLATFORM_RECIPIENT_CLASSES,
  isAccountMailRecipientClass,
  isExternalRecipientClass,
  isHostOrPlatformRecipientClass,
  OUTSIDER_RECIPIENT_CLASSES,
} from './scope.js';
export type {
  AccountMailRecipientClass,
  ExternalRecipientClass,
  HostOrPlatformRecipientClass,
  OutsiderRecipientClass,
} from './scope.js';
