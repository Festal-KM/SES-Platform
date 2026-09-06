// packages/connectors/src/aws.ts — `@ses/connectors/aws` サブパスの入口。
//
// 🔴 **AWS SDK に到達できる唯一の公開経路**である（実体は
//    `src/email/ses/aws-sdk-api.ts`（SESv2）と `src/storage/aws-sdk-s3.ts`（S3 / presigner）の
//    2 ファイルだけが `@aws-sdk/*` を import する）。
//
// 🔴 なぜ主バレル（`src/index.ts`）に載せないか:
//    `apps/web` は宛先分類・payload の型のために `@ses/connectors` を import している。
//    主バレルに載せると Next.js のサーババンドルに AWS SDK 一式が入り、
//    「SDK を触るのは 1 ファイル」という構造がビルド成果物の上では成り立たなくなる。
//    この入口を import してよいのは**起動時 DI の配線**（`apps/worker` の `main.ts` /
//    `apps/web` の `instrumentation.ts`）だけである。
export { createSesApi, sesIdentityArn, toSendEmailCommand } from './email/ses/aws-sdk-api.js';
export type { SesApiOptions, SesCommandSender } from './email/ses/aws-sdk-api.js';
// 🔴 T-05-04: S3（オブジェクトストレージ）のアダプタ。`createObjectStore` / `createConnectors` の
//    `runtime.s3.api` に渡す（docs/05 §13.1 / §14.2）。
export { createS3Api } from './storage/aws-sdk-s3.js';
export type { S3ApiOptions } from './storage/aws-sdk-s3.js';
