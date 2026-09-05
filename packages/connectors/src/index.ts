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
import type { BillingProvider, EmailSender, EsignProviderMap, MalwareScanner, ObjectStore } from './interfaces.js';
import type { ConnectorCategory, ConnectorImplementationKind, ConnectorSelectionInput } from './types.js';

export * from './types.js';
export * from './errors.js';
export * from './interfaces.js';
export * from './queues.js';
// 🔴 T-04-02: メール送信の単一経路が受け取る payload の型（docs/05 §9.4）。
//    分類 2 / 3 / 4 を `email.dispatch` に渡せないことを型で固定する。
export * from './email/dispatch.js';
// 🔴 T-04-02: `sandbox` の宛先分類による差し替え（docs/05 §8.2）。**モック実装ではない**
//    （分類 1 / 分類外は実送信側へ委譲する）ため、モックと違って re-export してよい。
//    ⚠️ `createConnectors` への登録は T-04-03 が行う（`real` に渡す SES 実装が要るため）。
//    それまで `sandbox` の起動は `ConnectorImplementationNotAvailableError` で失敗する
//    —— これは意図した挙動である（モックで埋めない。CLAUDE.md §11.1）。
export * from './email/sandbox-recipient-scoped.js';
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
 * 起動時に 1 回だけ呼ぶ（`apps/web` は `instrumentation.ts`、`apps/worker` は `src/main.ts`）。
 * 🔴 リクエストごとに呼ばない。
 *
 * 現時点で登録されている実装はモックだけであり、`real` / `sandboxRecipientScoped` を選ぶ環境
 * （`staging` / `production` / `sandbox`、および `development` の objectStore / malwareScanner）では
 * `ConnectorImplementationNotAvailableError` が起動時に throw される。
 * 🔴 これは意図した挙動である —— 実装が無いことを黙ってモックで埋めると
 * 「成功したように見えて実際には送信されていない」（CLAUDE.md §11.1）に直結する。
 * 各実装を足すタスク（SES = T-04-03、MinIO / ClamAV / DocuSign / Stripe = 後続）が
 * このファクトリ表に登録を追加していく。
 */
export function createConnectors(selection: ConnectorSelectionInput): Connectors {
  return {
    email: pickByKind<EmailSender>('email', selection.email, {
      mock: () => new MockEmailSender(),
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
