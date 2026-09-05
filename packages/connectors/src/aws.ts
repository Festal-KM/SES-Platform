// packages/connectors/src/aws.ts — `@ses/connectors/aws` サブパスの入口。
//
// 🔴 **AWS SDK に到達できる唯一の公開経路**である（実体は
//    `src/email/ses/aws-sdk-api.ts` の 1 ファイルだけが `@aws-sdk/client-sesv2` を import する）。
//
// 🔴 なぜ主バレル（`src/index.ts`）に載せないか:
//    `apps/web` は宛先分類・payload の型のために `@ses/connectors` を import している。
//    主バレルに載せると Next.js のサーババンドルに AWS SDK 一式が入り、
//    「SDK を触るのは 1 ファイル」という構造がビルド成果物の上では成り立たなくなる。
//    この入口を import してよいのは**起動時 DI の配線**（`apps/worker` の `main.ts` /
//    `apps/web` の `instrumentation.ts`）だけである。
export { createSesApi, toSendEmailCommand } from './email/ses/aws-sdk-api.js';
export type { SesApiOptions, SesCommandSender } from './email/ses/aws-sdk-api.js';
