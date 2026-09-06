// apps/web/lib/db/bootstrap.ts
// 🔴 DB クライアント・暗号鍵・キューの初期化（プロセスにつき 1 回）。
//    **環境変数の検証と外部連携の選択そのものは `@ses/config` の `initializeRuntimeConfig`
//    が唯一の経路であり、その最初の呼び出しは `apps/web/instrumentation.ts`（T-03-12）である。**
//    ここはその解決済みの結果（`RuntimeConfig`）を読むだけで、`loadAppEnv` を直接呼ばない
//    （docs/05 §13.1 / CLAUDE.md §11.1）。
//
// 🔴 `initializeRuntimeConfig` はプロセス内でキャッシュされるため、instrumentation が
//    先に走っていれば**ここで再検証も再ログも起きない**（多重初期化を作らない）。
//    逆に instrumentation を通らない実行経路（結合テストが `apps/web/lib/**` を直接呼ぶ場合）
//    でも、同じ 1 箇所を通って初期化される。
//
// 🔴 例外を握りつぶさない。検証に失敗したらそのまま throw する
//    （「未設定ならモックにフォールバック」を作らない。CLAUDE.md §11.1）。
// 🔴 リクエストごとに `APP_ENV` を分岐しない。差し替えの判断は `resolveConnectorSelection`
//    （`initializeRuntimeConfig` の内部）で既に終わっており、ここは結果を読むだけである。
import process from 'node:process';
import { initializeRuntimeConfig, type AppEnvKind } from '@ses/config';
import { createObjectStore, type ConnectorImplementationKind, type ObjectStore } from '@ses/connectors';
// 🔴 T-05-04: AWS SDK に到達する唯一の公開経路（`@ses/connectors/aws`）。**このファイルが
//    `apps/web` の起動時 DI の実体**であり、ここ以外から import しない（`packages/connectors/src/aws.ts`）。
//    🔴 `instrumentation.ts` に置かない —— あちらは Next.js が **Edge ランタイム向けにも
//    コンパイルする**ため、Node 組み込みモジュールに依存する AWS SDK を持ち込むとビルドが落ちる
//    （同ファイル冒頭の注記と同じ理由）。Edge で動く `proxy.ts` は本ファイルを import しない。
import { createS3Api } from '@ses/connectors/aws';
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  configureTenantDb,
  configureTokenEncryption,
} from '@ses/db';
import { configureAccountMailQueue, PendingAccountMailQueue } from '../jobs/account-mail';
import { configureDomainJobQueue, PendingDomainJobQueue } from '../jobs/domain-jobs';
import { resolveInviteUrlRuntime, type InviteUrlRuntime } from '../invitations/invite-link';
import {
  configureWebhookProcessQueue,
  confirmSnsSubscription,
  fetchSigningCertificate,
  PendingWebhookProcessQueue,
} from '../webhooks/runtime';
import type { SigningCertificateLoader } from '../webhooks/sns';

let initialized = false;
/** 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8）が読む値。`ensureDbConfigured()` が 1 度だけ埋める。 */
let cachedAppEnv: AppEnvKind | null = null;
/**
 * 🔴 T-03-07: 管理平面の Auth.js インスタンスの署名鍵（docs/03 §4.9「主平面と管理平面で
 *    別の署名鍵」）。Auth.js は `AUTH_SECRET` しか自動で読まないため、管理平面のインスタンスには
 *    ここから明示的に渡す。**`process.env` を直接読まない**（CLAUDE.md §3.5）。
 */
let cachedPlatformAuthSecret: string | null = null;
/**
 * 🔴 T-03-10: `SANDBOX` で開設したテナントの試用期限（日数。docs/05 §6.9 API-A4 /
 *    `CLAUDE.md` §9-12「有効期間は 30 日」）。`packages/config` の `SANDBOX_TRIAL_DAYS` が唯一の出所。
 */
let cachedSandboxTrialDays: number | null = null;
/**
 * 🔴 T-04-03: `POST /api/webhooks/ses` が受け入れる SNS トピック（`SES_EVENT_TOPIC_ARN`）。
 *    署名検証は「Amazon が署名したこと」しか証明しないため、**受け入れるトピックを固定する**。
 */
let cachedSesEventTopicArn: string | null = null;
/**
 * 🔴 T-04-04: 送信ドメイン設定（#71 / #72）が要る起動時解決済みの値（docs/05 §8.3 / docs/03 §3.2.7）。
 *    ルートが `process.env` を読まない（`CLAUDE.md` §3.5）ための唯一の経路。
 */
let cachedSendingDomainRuntime: { readonly region: string; readonly verificationRequired: boolean } | null =
  null;
/**
 * 🔴 T-04-08: `#14` が招待リンク（平文トークン）を応答に載せてよいか（`F-007 AC-4`）。
 *    `sandbox` では取引先招待メールがモックになる（Issue #9 / #10）ため、画面で手渡すしかない。
 *    **判定はここ 1 箇所**であり、ルートにも画面にも `APP_ENV` の分岐を置かない（`CLAUDE.md` §11.1）。
 */
let cachedInviteUrlRuntime: InviteUrlRuntime | null = null;
/**
 * 🔴 T-05-04: ストレージの上限・署名の設定と、**選ばれた実装種別**（docs/05 §13.1 / §14.2）。
 *    `APP_ENV` の分岐は `resolveConnectorSelection` が起動時に済ませており、ここは結果を持つだけ。
 */
let cachedStorageRuntime: StorageRuntime | null = null;
/** 🔴 起動時に選ばれた実装から 1 度だけ組み立てる（リクエストごとに作らない）。 */
let cachedObjectStore: ObjectStore | null = null;
/**
 * 🔴 S3 クライアントの接続設定（資格情報を含む）。**export しない / `storageRuntime()` に載せない**
 *    —— 鍵の到達経路を `objectStore()` の内側 1 か所に閉じる（`CLAUDE.md` §3.5）。
 */
let cachedS3ClientEnv: Parameters<typeof createS3Api>[0] | null = null;

/**
 * DB クライアントを 1 度だけ初期化する。
 *
 * 🔴 `initialized` はモジュールスコープに置く（`initializeRuntimeConfig` のように
 *    `globalThis` へ逃がさない）。ここが守るのは「この Prisma クライアントを 1 度だけ作る」
 *    ことであり、バンドラがモジュールを複製した場合は**複製ごとに専用のクライアントが要る**
 *    （別インスタンスの `getBaseClient()` は未初期化のままになるため）。
 */
export function ensureDbConfigured(): void {
  if (initialized) return;
  // 🔴 起動時 DI の唯一の入口。instrumentation が先に呼んでいればキャッシュが返り、
  //    環境変数の再検証も起動ログの再出力も起きない（T-03-12）。
  const { env, connectors } = initializeRuntimeConfig(process.env, (line) => {
    process.stdout.write(`${line}\n`);
  });
  cachedAppEnv = env.APP_ENV;
  cachedPlatformAuthSecret = env.AUTH_PLATFORM_SECRET;
  cachedSandboxTrialDays = env.SANDBOX_TRIAL_DAYS;
  configureTenantDb({ datasourceUrl: env.DATABASE_URL });
  // 🔴 T-03-07: 管理平面は**別の接続プール・別の DB ロール**（docs/03 §4.3.3 / docs/05 §4.2）。
  //    主平面の DATABASE_URL を流用しない（流用すると運営者の資格情報へ主平面のロールから
  //    到達できてしまう。CLAUDE.md §10.5「権限昇格の事故経路を作らない」）。
  configurePlatformWriteDb({ datasourceUrl: env.PLATFORM_WRITE_DATABASE_URL });
  // 🔴 T-03-08: 管理平面の**読み取り専用**プール（`app_platform`。docs/05 §4.2 / §5.2）。
  //    `withPlatformRead` はこちらで接続する。読みと書きを 1 本のプールに混ぜない ——
  //    「read-only は DB 権限で担保する」（§5.2）が、同じ接続を使い回すと成立しない。
  configurePlatformReadDb({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  // 🔴 T-03-02: 秘匿値の暗号鍵も同じ初期化経路で注入する（docs/05 §8.6 / docs/03 §4.4）。
  //    packages/db 側で `process.env` を読ませない（鍵の出所を packages/config に一本化する）。
  configureTokenEncryption({
    key: env.TOKEN_ENCRYPTION_KEY,
    keyId: env.TOKEN_ENCRYPTION_KEY_ID,
    previous: env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
  });
  // 🔴 T-03-03: `account.mail`（docs/05 §9.4）の enqueue 先を**起動時の 1 箇所**で決める。
  //    判断材料は `resolveConnectorSelection`（APP_ENV 分岐の唯一の場所。CLAUDE.md §11.1）が
  //    起動時に解決した `connectors` であり、ここで `APP_ENV` を自分で分岐しない。
  //    - email が `mock`（development / demo）→ 保留キュー（SP-04 のハンドラが処理するまで積むだけ）
  //    - それ以外（sandbox / staging / production）→ **登録しない**。BullMQ のキュー実装は SP-04 の
  //      範囲であり、未実装のまま「送ったつもり」にさせない（enqueue 時に例外 = 操作が成立しない）。
  if (connectors.email === 'mock') {
    configureAccountMailQueue(new PendingAccountMailQueue());
  }
  // 🔴 T-04-03: Webhook 受信の enqueue 先。判断材料は `account.mail` と同じ（`connectors.email`）。
  //    - email が `mock`（development / demo）→ 保留キュー（SP-07 のハンドラが処理するまで積むだけ）
  //    - それ以外（sandbox / staging / production）→ **登録しない**。BullMQ の配線は SP-07 であり、
  //      未実装のまま「受け取ったことにして捨てる」状態を作らない。受信時に例外 = 500 になり、
  //      SNS が再送を続けるので通知は失われない（`CLAUDE.md` §11.1）。
  if (connectors.email === 'mock') {
    configureWebhookProcessQueue(new PendingWebhookProcessQueue());
  }
  // 🔴 T-04-04: `domain.provision` / `domain.verify` の enqueue 先。判断材料は同じ（`connectors.email`）。
  //    BullMQ の配線は SP-07 であり、それまで `sandbox` / `staging` / `production` では
  //    **登録しない** = enqueue 時に例外になり、「登録したのに DNS レコードが出てこない」
  //    状態を成立させない（`CLAUDE.md` §11.1）。
  if (connectors.email === 'mock') {
    configureDomainJobQueue(new PendingDomainJobQueue());
  }
  cachedSesEventTopicArn = env.SES_EVENT_TOPIC_ARN;
  // 🔴 `sandbox` / `demo` / `development` は共通ドメインで動く（`docs/03` §3.2.7-4 / -5）。
  //    **分岐はここ 1 箇所**であり、リクエストごとに `APP_ENV` を見ない（`CLAUDE.md` §11.1）。
  cachedSendingDomainRuntime = {
    region: env.AWS_REGION,
    verificationRequired: env.APP_ENV === 'staging' || env.APP_ENV === 'production',
  };
  // 🔴 T-04-08: 招待リンクの開示（`F-007 AC-4`）も**同じ 1 箇所**で決める。
  //    判定式そのものは `resolveInviteUrlRuntime`（`invite-link.ts`）が持つ ——
  //    結合テストが `buildValidEnv('sandbox')` から**同じ関数**で runtime を作れるようにするため
  //    （テスト専用のフックも、テスト側での判定の書き写しも作らない）。
  cachedInviteUrlRuntime = resolveInviteUrlRuntime(env);
  // 🔴 T-05-04: ストレージ（docs/05 §14.1 / §14.2 / docs/03 §4.5）。値の出所は `packages/config`
  //    だけであり、ルートも画面も `process.env` を読まない（`CLAUDE.md` §3.5）。
  //    🔴 実装種別（`connectors.objectStore`）もここで確定させる。**リクエストごとに
  //    `APP_ENV` を見ない**（`CLAUDE.md` §11.1 / docs/05 §13.1）。
  cachedStorageRuntime = {
    implementation: connectors.objectStore,
    bucket: env.S3_BUCKET,
    ...(env.S3_KMS_KEY_ID === undefined ? {} : { kmsKeyId: env.S3_KMS_KEY_ID }),
    presignedUrlTtlSeconds: env.S3_PRESIGNED_URL_TTL_SECONDS,
    uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    // 🔴 プラン別の上書き（`Plan.storageLimitBytes`）が入るまでの既定値（`packages/config`）。
    //    判定関数は `limitBytes` を引数で受け取るため、上書きが入っても呼び出し側は変わらない。
    storageLimitBytes: BigInt(env.STORAGE_LIMIT_BYTES_PER_TENANT),
  };
  // 🔴 T-05-04: S3 クライアントの接続設定。**`storageRuntime()` には載せない** ——
  //    あちらはルート・画面が読む値であり、資格情報を混ぜると「設定を読むついでに鍵が読める」
  //    経路になる（`CLAUDE.md` §3.5）。ここだけが持ち、`objectStore()` 以外は参照しない。
  //    🔴 静的キーは `development` の MinIO でしか設定されない（`staging` / `production` で
  //    設定されていたら `packages/config` が起動を止める。docs/03 §6.5 / NFR-ENV-4）。
  cachedS3ClientEnv = {
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT === undefined ? {} : { endpoint: env.S3_ENDPOINT }),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    ...(env.S3_ACCESS_KEY_ID === undefined || env.S3_SECRET_ACCESS_KEY === undefined
      ? {}
      : {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
  };
  initialized = true;
}

/**
 * 🔴 T-05-04: ストレージの実行時設定（docs/05 §14.2）。
 *
 * `#18`（アップロード用署名の発行）と、後続の版管理・ダウンロード（T-05-06 / T-05-07）が読む。
 */
export type StorageRuntime = {
  readonly implementation: ConnectorImplementationKind;
  readonly bucket: string;
  readonly kmsKeyId?: string;
  readonly presignedUrlTtlSeconds: number;
  readonly uploadMaxBytes: number;
  readonly storageLimitBytes: bigint;
};

export function storageRuntime(): StorageRuntime {
  ensureDbConfigured();
  if (cachedStorageRuntime === null) {
    throw new Error('ストレージの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedStorageRuntime;
}

/**
 * 🔴 オブジェクトストレージの実装（docs/05 §8.1 / §13.1）。プロセスにつき 1 つ。
 *
 * 🔴 **`APP_ENV` を見ない。** 実装種別は起動時に `resolveConnectorSelection` が決めた値
 *    （`storageRuntime().implementation`）であり、ここは `createObjectStore` に渡すだけである。
 * 🔴 **未実装の区分をモックで代替しない**（`CLAUDE.md` §11.1）。`real`（MinIO / S3）は
 *    AWS SDK のアダプタ（`@ses/connectors/aws` の `createS3Api`）を必要とし、渡さなければ
 *    `ConnectorImplementationNotAvailableError` で失敗する。「未設定ならモック」に倒すと、
 *    **アップロードできたように見えてファイルがどこにも無い**という最悪の壊れ方になる。
 * 🔴 遅延生成にしているのは、**この区分だけ**を先に組み立てるためである（`createConnectors` は
 *    全 5 区分を一度に作るため、未登録の `malwareScanner`〔T-05-05〕で起動そのものが落ちる）。
 *    実装種別の決定は起動時のまま動かしていない。
 * 🔴 `S3Client` の生成はネットワークに出ない（資格情報の解決は最初の呼び出しまで遅延する）。
 *    したがって実装種別で分岐せずに常に組み立ててよく、`mock`（`demo`）でも副作用は無い ——
 *    **「この環境なら S3 を作る」という分岐をここに書かない**ことのほうが重要である。
 */
export function objectStore(): ObjectStore {
  const runtime = storageRuntime();
  if (cachedObjectStore === null) {
    if (cachedS3ClientEnv === null) {
      throw new Error('S3 の接続設定が解決されていません（bootstrap の不変条件違反）。');
    }
    cachedObjectStore = createObjectStore(runtime.implementation, {
      s3: {
        api: createS3Api(cachedS3ClientEnv),
        bucket: runtime.bucket,
        ...(runtime.kmsKeyId === undefined ? {} : { kmsKeyId: runtime.kmsKeyId }),
        presignedUrlTtlSeconds: runtime.presignedUrlTtlSeconds,
      },
    });
  }
  return cachedObjectStore;
}

/**
 * 🔴 `#14`（`POST /api/invitations`）と `S-014` が読む、起動時解決済みの開示設定（`F-007 AC-4`）。
 *    `NOT_DISCLOSED` の枝には `appUrl` が無いため、**呼び出し側は URL を組み立てられない**。
 */
export function inviteUrlRuntime(): InviteUrlRuntime {
  ensureDbConfigured();
  if (cachedInviteUrlRuntime === null) {
    throw new Error('招待リンクの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedInviteUrlRuntime;
}

/**
 * 🔴 `#71` / `#72` が使う起動時解決済みの値（docs/05 §8.3）。
 *    `verificationRequired === false` の環境では #72 が `{ state: 'NOT_REQUIRED' }` を返す。
 */
export function sendingDomainRuntime(): {
  readonly region: string;
  readonly verificationRequired: boolean;
} {
  ensureDbConfigured();
  if (cachedSendingDomainRuntime === null) {
    throw new Error('送信ドメインの実行時設定が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedSendingDomainRuntime;
}

/**
 * 🔴 `POST /api/webhooks/ses` が使う起動時解決済みの値（docs/05 §8.5）。
 *    ルートが `process.env` を読まない（`CLAUDE.md` §3.5）ための唯一の経路。
 */
export function sesWebhookRuntime(): {
  readonly topicArn: string;
  readonly loadCertificate: SigningCertificateLoader;
  readonly confirmSubscription: (subscribeUrl: string) => Promise<void>;
} {
  ensureDbConfigured();
  if (cachedSesEventTopicArn === null) {
    throw new Error('SES_EVENT_TOPIC_ARN が解決されていません（bootstrap の不変条件違反）。');
  }
  return {
    topicArn: cachedSesEventTopicArn,
    loadCertificate: fetchSigningCertificate,
    confirmSubscription: confirmSnsSubscription,
  };
}

/**
 * 🔴 `GET /api/me` の `env`（docs/05 §6.3 #8。T-03-06）が読む唯一の経路。
 *    `ensureDbConfigured()` と同じキャッシュを返す（`loadAppEnv` を二重に呼ばない）。
 */
export function currentAppEnv(): AppEnvKind {
  ensureDbConfigured();
  if (cachedAppEnv === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('APP_ENV が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedAppEnv;
}

/**
 * 🔴 T-03-10: `A-014`（テナント開設）が `SANDBOX` の `sandboxExpiresAt` を計算するために読む。
 *    値の出所は `packages/config`（`SANDBOX_TRIAL_DAYS`。既定 30 日）だけであり、
 *    API ハンドラに日数をベタ書きしない。
 */
export function sandboxTrialDays(): number {
  ensureDbConfigured();
  if (cachedSandboxTrialDays === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない。
    throw new Error('SANDBOX_TRIAL_DAYS が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedSandboxTrialDays;
}

/**
 * 🔴 管理平面の Auth.js インスタンス（`lib/auth/platform.ts`）だけが読む署名鍵。
 *    主平面の `AUTH_SECRET`（Auth.js が自動で読む）とは**別の値**であることを
 *    `packages/config` の起動時検証が保証している（同値なら起動に失敗する）。
 */
export function platformAuthSecret(): string {
  ensureDbConfigured();
  if (cachedPlatformAuthSecret === null) {
    // `ensureDbConfigured()` が例外を投げずに戻った以上、この分岐には到達しない
    // （不変条件違反。フォールバックせず、そのまま失敗させる。CLAUDE.md §11.1）。
    throw new Error('AUTH_PLATFORM_SECRET が解決されていません（bootstrap の不変条件違反）。');
  }
  return cachedPlatformAuthSecret;
}
