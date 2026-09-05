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
import { InMemoryProviderSendCounter, SesEmailSender, type SesApi, type ProviderSendCounter } from './email/ses/index.js';
import type { BillingProvider, EmailSender, EsignProviderMap, MalwareScanner, ObjectStore } from './interfaces.js';
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
// 🔴 T-04-02: `sandbox` の宛先分類による差し替え（docs/05 §8.2）。**モック実装ではない**
//    （分類 1 / 分類外は実送信側へ委譲する）ため、モックと違って re-export してよい。
//    ✅ T-04-03 で `createConnectors` に登録した（`real` = SES 実装が揃ったため）。
export * from './email/sandbox-recipient-scoped.js';
// 🔴 T-04-03: SES コネクタ（docs/05 §8.3 / docs/03 §3.2）。`SesApi` は AWS SDK の
//    アダプタが実装するポートであり、業務コードは触らない（`createConnectors` にだけ渡す）。
export * from './email/ses/index.js';
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
   * 🔴 省略時はプロセス内カウンタ。`production` では Redis 版を渡す（T-04-04）。
   */
  readonly sentCounter?: ProviderSendCounter;
};

export type ConnectorRuntimeOptions = {
  readonly ses?: SesRuntimeOptions;
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
  });
}

/**
 * 起動時に 1 回だけ呼ぶ（`apps/web` は `instrumentation.ts`、`apps/worker` は `src/main.ts`）。
 * 🔴 リクエストごとに呼ばない。
 *
 * 🔴 実装が無い区分は**モックで代替せず throw する**（`CLAUDE.md` §11.1）。現時点で未登録なのは
 *    `objectStore` / `malwareScanner`（MinIO / ClamAV。後続タスク）と `esign` / `billing` の
 *    `real`（Phase 3）である。email は 3 種別すべて解決できる（T-04-03）。
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
    objectStore: pickByKind<ObjectStore>('objectStore', selection.objectStore, {
      mock: () => new MockObjectStore(),
    }),
    malwareScanner: pickByKind<MalwareScanner>('malwareScanner', selection.malwareScanner, {
      mock: () => new MockMalwareScanner(),
    }),
    esign: createEsignProviderMap(selection.esign),
    billing: pickByKind<BillingProvider>('billing', selection.billing, {
      mock: () => new MockBillingProvider(),
    }),
  };
}
