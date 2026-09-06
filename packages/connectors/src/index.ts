// packages/connectors/src/index.ts — @ses/connectors の公開 API。
//
// 🔴 **選択結果を instantiate するだけ**（docs/05 §8.1 / §13.1）。`APP_ENV` の分岐は
//    `packages/config` の `resolveConnectorSelection` 1 箇所にあり、ここでは `APP_ENV` を見ない。
//    見ないことを保証するため、このパッケージは `AppEnv` を引数に取らない。
//
// 🔴 `production` でモックが選ばれない担保は 2 段（docs/05 §13.4 規則 1 / §13.1）:
//    ①`packages/config` の `envSchema`（`production` の枝に `mock` が無い）
//    ②`resolveConnectorSelection` 内の `assertNoMockInProduction`（実行時の二重防御）
//    本ファイルはその結果を受け取るだけであり、**未登録の実装をモックで代替しない**。
//
// 🔴 `ai` を返さない理由: AI クライアントは `packages/ai` が `selection.ai` から組み立てる。
//    `packages/connectors` は `@anthropic-ai/sdk` を import できず（CLAUDE.md §3.2）、
//    `@ses/ai` にも依存できない（§2.1）ため、ここでは作れない。束ねるのは `apps/*` の層である。

import {
  MockBillingProvider,
  MockEmailSender,
  MockEsignProvider,
  MockMalwareScanner,
  MockObjectStore,
} from './mock/index.js';
import { ConnectorImplementationNotAvailableError } from './errors.js';
import { SandboxRecipientScopedEmailSender } from './email/sandbox-recipient-scoped.js';
import {
  InMemoryProviderSendCounter,
  SesEmailSender,
  type ProviderQuotaCache,
  type ProviderSendCounter,
  type SesApi,
} from './email/ses/index.js';
import type { BillingProvider, EmailSender, EsignProviderMap, MalwareScanner, ObjectStore } from './interfaces.js';
import { S3ObjectStore, type S3Api } from './storage/index.js';
import type { ConnectorCategory, ConnectorImplementationKind, ConnectorSelectionInput } from './types.js';

export * from './types.js';
export * from './errors.js';
export * from './interfaces.js';
export * from './queues.js';
// 🔴 T-04-02: メール送信の単一経路が受け取る payload の型（docs/05 §9.4）。
//    分類 2 / 3 / 4 を `email.dispatch` に渡せないことを型で固定する。
export * from './email/dispatch.js';
// 🔴 T-04-03: `SENT` / `MOCKED` の記録を取り違えないための判定（docs/05 §13.2 / §9.7）。
export * from './email/delivery-mode.js';
// 🔴 T-04-03: `account.mail` の payload と送達状態（docs/05 §9.4 / §6.4）。
//    `apps/web`（enqueue）と `apps/worker`（実行）の契約であり、どちらかのアプリに置かない。
export * from './email/account-mail.js';
// 🔴 T-04-04: `domain.provision` / `domain.verify` の payload とキューの契約（docs/05 §8.3 / §9.9）。
export * from './email/domain-jobs.js';
// 🔴 T-04-02: `sandbox` の宛先分類による差し替え（docs/05 §8.2）。**モック実装ではない**
//    （分類 1 / 分類外は実送信側へ委譲する）ため、モックと違って re-export してよい。
//    ✅ T-04-03 で `createConnectors` に登録した（`real` = SES 実装が揃ったため）。
export * from './email/sandbox-recipient-scoped.js';
// 🔴 T-04-03: SES コネクタ（docs/05 §8.3 / docs/03 §3.2）。`SesApi` は AWS SDK の
//    アダプタが実装するポートであり、業務コードは触らない（`createConnectors` にだけ渡す）。
export * from './email/ses/index.js';
// 🔴 T-05-04: オブジェクトストレージ（docs/05 §14）。`S3Api` は AWS SDK のアダプタが実装する
//    ポートであり、業務コードは触らない（`createConnectors` にだけ渡す）。
export * from './storage/index.js';
// 🔴 T-04-03: 分次のレート窓（docs/05 §8.7）。日次は `packages/db` の `UsageCounter` が正。
export * from './rate/minute-window.js';
// 🔴 T-04-03: Webhook 受信後の処理ジョブの payload（docs/05 §8.5 / §9.4）。
export * from './webhooks/process.js';
// 🔴 モック実装のクラスは **re-export しない**（docs/05 §13.1 / §2.2）。外に出すと
//    「この環境ならモック」というリクエストごとの分岐を業務コードに書けてしまう。
//    モックの呼び出し回数は `EmailSender.callCount()` 等、**インタフェース側**から読む
//    （docs/05 §13.2「モックと実装の共通シグネチャ」）。

export type Connectors = {
  readonly email: EmailSender;
  readonly objectStore: ObjectStore;
  readonly malwareScanner: MalwareScanner;
  /** 🔴 テナントごとに provider が違う（docs/05 §8.4）。全プロバイダの実装のマップを持つ。 */
  readonly esign: EsignProviderMap;
  readonly billing: BillingProvider;
};

/**
 * 実装種別 → ファクトリの対応表から 1 つ選ぶ内部ヘルパ。
 * 🔴 `APP_ENV` を参照しない。登録が無ければ**例外**（モックへ倒さない。CLAUDE.md §11.1）。
 */
function pickByKind<T>(
  category: ConnectorCategory,
  kind: ConnectorImplementationKind,
  factories: Partial<Record<ConnectorImplementationKind, () => T>>,
): T {
  const factory = factories[kind];
  if (factory === undefined) throw new ConnectorImplementationNotAvailableError(category, kind);
  return factory();
}

/**
 * 🔴 電子署名は「1 実装を選ぶ」のではなく**マップを組み立てる**（docs/05 §8.1 / §8.4）。
 *
 * - `mock`（非本番）: `{ mock }` の 1 実装。
 * - `real`: 第一コネクタ DocuSign は Phase 3 で実装する。未登録の間は
 *   `ConnectorImplementationNotAvailableError` で**起動を止める**（空のマップを返して
 *   「接続済みなのに送れない」を実行時まで持ち越さない）。
 */
function createEsignProviderMap(kind: ConnectorImplementationKind): EsignProviderMap {
  return pickByKind<EsignProviderMap>('esign', kind, {
    mock: () => ({ mock: new MockEsignProvider() }),
  });
}

/**
 * SES 実装（`email: 'real'` / `'sandboxRecipientScoped'`）の組み立てに要る値（T-04-03）。
 *
 * 🔴 `api` は AWS SDK のアダプタ（`packages/connectors` は SDK を持たず、ポートだけを知る。
 *    `email/ses/api.ts` 冒頭）。**起動時に 1 回だけ渡す。**
 * 🔴 環境変数を `packages/connectors` から読まない（`CLAUDE.md` §3.5。設定の出所は
 *    `packages/config` の 1 箇所であり、ここは受け取るだけ）。
 */
export type SesRuntimeOptions = {
  readonly api: SesApi;
  /** `SES_DEFAULT_FROM_ADDRESS`（共通ドメイン）。 */
  readonly defaultFromAddress: string;
  /** `SES_CONFIGURATION_SET`。 */
  readonly configurationSet: string;
  /**
   * 送信基盤の 24h ローリング件数（docs/05 §8.3-Q ③）。
   * 🔴 省略時はプロセス内カウンタ。**複数プロセスで走る環境では `RedisProviderSendCounter` を渡す**
   *    （プロセスごとに数えると枠を過小評価し、実際には枠を超えて送ってしまう）。
   */
  readonly sentCounter?: ProviderSendCounter;
  /**
   * `GetAccount` の 60 秒キャッシュ（docs/05 §8.3-Q ③）。
   * 🔴 省略時はプロセス内キャッシュ。複数プロセスでは `RedisProviderQuotaCache` を渡す
   *    （`GetAccount` は 1 req/s の上限がある）。
   */
  readonly quotaCache?: ProviderQuotaCache;
  /**
   * 現在時刻の注入（既定は `new Date()`）。
   * 🔴 24h カウンタへの加算時刻と `GetAccount` キャッシュの期限に使う。**判定側（ジョブ）と
   *    同じ時計を渡すこと** —— ずれると「送った事実」と「枠の判定」が別の時間軸で動く。
   */
  readonly now?: () => Date;
};

/**
 * S3 実装（`objectStore: 'real'`）の組み立てに要る値（T-05-04）。
 *
 * 🔴 `api` は AWS SDK のアダプタ（`packages/connectors` は SDK を持たず、ポートだけを知る。
 *    `storage/api.ts` 冒頭）。**起動時に 1 回だけ渡す。**
 * 🔴 環境変数を `packages/connectors` から読まない（`CLAUDE.md` §3.5）。バケット名も KMS 鍵も
 *    `packages/config` が検証した値を受け取るだけである。
 */
export type S3RuntimeOptions = {
  readonly api: S3Api;
  /** `S3_BUCKET`。🔴 全テナントで 1 つ（docs/05 §14.1）。 */
  readonly bucket: string;
  /** `S3_KMS_KEY_ID`（`sandbox` / `production` では必須。MinIO では未設定）。 */
  readonly kmsKeyId?: string;
  /** `S3_PRESIGNED_URL_TTL_SECONDS`（既定 300）。 */
  readonly presignedUrlTtlSeconds: number;
  readonly now?: () => Date;
};

export type ConnectorRuntimeOptions = {
  readonly ses?: SesRuntimeOptions;
  readonly s3?: S3RuntimeOptions;
};

/**
 * 🔴 SES を要求する実装種別（`real` / `sandboxRecipientScoped`）のファクトリ。
 *
 * `runtime.ses` が無いときは **`ConnectorImplementationNotAvailableError` で起動を止める**。
 * モックへ倒さない（`CLAUDE.md` §11.1。「未設定ならモック」は
 * 「成功したように見えて実際には送信されていない」を生む）。
 */
function createSesEmailSender(
  kind: ConnectorImplementationKind,
  ses: SesRuntimeOptions | undefined,
): SesEmailSender {
  if (ses === undefined) throw new ConnectorImplementationNotAvailableError('email', kind);
  return new SesEmailSender({
    api: ses.api,
    defaultFromAddress: ses.defaultFromAddress,
    configurationSet: ses.configurationSet,
    sentCounter: ses.sentCounter ?? new InMemoryProviderSendCounter(),
    ...(ses.quotaCache === undefined ? {} : { quotaCache: ses.quotaCache }),
    ...(ses.now === undefined ? {} : { now: ses.now }),
  });
}

/**
 * 🔴 S3 を要求する実装種別（`real`）のファクトリ（T-05-04）。
 *
 * `runtime.s3` が無いときは **`ConnectorImplementationNotAvailableError` で起動を止める**。
 * モックへ倒さない（`CLAUDE.md` §11.1）—— オブジェクトストレージのモックへ勝手に落ちると、
 * 「アップロードできたのにファイルがどこにも無い」状態が本番同等の環境で成立してしまう。
 */
function createS3ObjectStore(
  kind: ConnectorImplementationKind,
  s3: S3RuntimeOptions | undefined,
): S3ObjectStore {
  if (s3 === undefined) throw new ConnectorImplementationNotAvailableError('objectStore', kind);
  return new S3ObjectStore({
    api: s3.api,
    bucket: s3.bucket,
    ...(s3.kmsKeyId === undefined ? {} : { kmsKeyId: s3.kmsKeyId }),
    presignedUrlTtlSeconds: s3.presignedUrlTtlSeconds,
    ...(s3.now === undefined ? {} : { now: s3.now }),
  });
}

/**
 * 🔴 オブジェクトストレージ**だけ**を組み立てる（T-05-04）。
 *
 * 🔴 なぜ `createConnectors` と別の入口があるか: `createConnectors` は 5 区分を**一度に**作るため、
 *    1 区分でも未登録（現時点では `malwareScanner` の `real`。T-05-05）だと起動そのものが落ちる。
 *    `apps/web` は先にストレージだけを必要とする（#18）ため、**同じファクトリ**を区分単位でも
 *    呼べるようにした。実装は 1 つであり（`createConnectors` も本関数を呼ぶ）、
 *    「web と worker で別の実装が選ばれる」ことは起こらない。
 * 🔴 `APP_ENV` を見ない（引数の `kind` は `resolveConnectorSelection` の結果である）。
 */
export function createObjectStore(
  kind: ConnectorImplementationKind,
  runtime: ConnectorRuntimeOptions = {},
): ObjectStore {
  return pickByKind<ObjectStore>('objectStore', kind, {
    mock: () => new MockObjectStore(),
    // 🔴 `development`（MinIO）/ `sandbox` 以上（S3）。バケットは 1 つで、テナントは
    //    キーのプレフィックスで分かれる（docs/05 §14.1）。ここに環境分岐は無い。
    real: () => createS3ObjectStore('real', runtime.s3),
  });
}

/**
 * 起動時に 1 回だけ呼ぶ（`apps/web` は `instrumentation.ts`、`apps/worker` は `src/main.ts`）。
 * 🔴 リクエストごとに呼ばない。
 *
 * 🔴 実装が無い区分は**モックで代替せず throw する**（`CLAUDE.md` §11.1）。現時点で未登録なのは
 *    `malwareScanner`（ClamAV / GuardDuty。T-05-05）と `esign` / `billing` の `real`（Phase 3）である。
 *    email は 3 種別すべて（T-04-03）、`objectStore` は `runtime.s3`（AWS SDK のアダプタ）が
 *    渡されていれば `real` も解決できる（T-05-04）。
 */
export function createConnectors(
  selection: ConnectorSelectionInput,
  runtime: ConnectorRuntimeOptions = {},
): Connectors {
  return {
    email: pickByKind<EmailSender>('email', selection.email, {
      mock: () => new MockEmailSender(),
      // 🔴 `staging` / `production`。共通ドメイン / 独自ドメインの判定は `EmailSendInput.fromDomain`
      //    が持ち、ここに環境分岐は無い。
      real: () => createSesEmailSender('real', runtime.ses),
      // 🔴 `sandbox`。分類 1 / 分類外だけが SES へ、分類 2 / 3 / 4 は
      //    `development` / `demo` / E2E と**同一のモック実装**へ流れる（docs/05 §13.2 / §17.5）。
      sandboxRecipientScoped: () =>
        new SandboxRecipientScopedEmailSender({
          real: createSesEmailSender('sandboxRecipientScoped', runtime.ses),
          mock: new MockEmailSender(),
        }),
    }),
    // 🔴 区分単位の入口（`createObjectStore`）と**同じ実装**を通る（2 経路に書き分けない）。
    objectStore: createObjectStore(selection.objectStore, runtime),
    malwareScanner: pickByKind<MalwareScanner>('malwareScanner', selection.malwareScanner, {
      mock: () => new MockMalwareScanner(),
    }),
    esign: createEsignProviderMap(selection.esign),
    billing: pickByKind<BillingProvider>('billing', selection.billing, {
      mock: () => new MockBillingProvider(),
    }),
  };
}
