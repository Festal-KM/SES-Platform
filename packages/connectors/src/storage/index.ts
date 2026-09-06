// packages/connectors/src/storage/index.ts
// 🔴 主バレル（`src/index.ts`）が読む面。**AWS SDK のアダプタをここから re-export しない**
//    （`email/ses/index.ts` と同じ規律。`apps/web` のサーババンドルに SDK を載せないため）。
export type {
  S3Api,
  S3HeadObjectResponse,
  S3ObjectRequest,
  S3PresignGetRequest,
  S3PresignPutRequest,
} from './api.js';
export {
  ObjectKeyOutOfTenantScopeError,
  S3ObjectStore,
  type S3ObjectStoreOptions,
} from './s3.js';
