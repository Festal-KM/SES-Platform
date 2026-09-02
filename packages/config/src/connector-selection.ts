// packages/config/src/connector-selection.ts
// 🔴 起動時 DI の「選択」段階（docs/05 §13.1 / docs/03 §4.18.2 / CLAUDE.md §11.1）。
//
// `packages/connectors` はまだ骨格（`export {}`）しか無い（コネクタ実体は別タスク）。
// このモジュールは「APP_ENV から、各コネクタ区分がどの実装種別を使うべきか」という
// *決定* だけを、起動時 1 箇所（`resolveConnectorSelection`）に集約する。
// 実際のクラスのインスタンス化は `packages/connectors/src/index.ts::createConnectors(selection)` が
// この選択結果を読んで行う（将来のタスク）。
//
// 🔴 リクエストごとの `if (APP_ENV === ...)` 分岐にしない。`resolveConnectorSelection` は
// 起動時に一度だけ呼び、結果を DI コンテナに保持する。

import { assertNever } from './app-env.js';
import { ProductionMockConnectorError } from './errors.js';
import type { AppEnv } from './schema.js';

/** docs/05 §13.2 が列挙する共通インタフェース（EmailSender / ObjectStore / MalwareScanner / EsignProvider / BillingProvider）+ AI 呼び出し。 */
export type ConnectorCategory = 'email' | 'objectStore' | 'malwareScanner' | 'esign' | 'billing' | 'ai';

/**
 * - `real`: 実サービスに接続する実装
 * - `mock`: `packages/connectors/src/mock/**`（E2E と共用。docs/05 §13.2）
 * - `sandboxRecipientScoped`: 🔴 `sandbox` の email 専用。宛先分類（テナント所属利用者か否か）で
 *   実装内部が分岐する単一のコネクタ（CLAUDE.md §11.1 の原則判定）。トップレベルの if 分岐にはしない
 */
export type ConnectorImplementationKind = 'real' | 'mock' | 'sandboxRecipientScoped';

export type ConnectorSelection = Readonly<Record<ConnectorCategory, ConnectorImplementationKind>>;

const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = [
  'email',
  'objectStore',
  'malwareScanner',
  'esign',
  'billing',
  'ai',
];

// development: ローカル docker-compose。ObjectStore(MinIO) と MalwareScanner(ClamAV) はローカルの
// 実サービスに接続する「real」実装（mock ではない。SP-01 T-01-03 申し送り 1）。送信系のみ mock。
function developmentSelection(): ConnectorSelection {
  return {
    email: 'mock',
    objectStore: 'real',
    malwareScanner: 'real',
    esign: 'mock',
    billing: 'mock',
    ai: 'mock',
  };
}

// demo: 営業デモ専用。合成データのみ。全区分 mock（docs/03 §4.18.1 / CLAUDE.md §11「demo は全モック」）。
function demoSelection(): ConnectorSelection {
  return {
    email: 'mock',
    objectStore: 'mock',
    malwareScanner: 'mock',
    esign: 'mock',
    billing: 'mock',
    ai: 'mock',
  };
}

// sandbox: 見込み客の実データ。email のみ宛先分類で分岐。他の外部送信（esign 等）は宛先が
// 常に第三者であるため mock 固定（docs/02 章 7.6 分類 3/4）。malwareScanner/objectStore/billing は
// 「送信系（メール/電子署名）のみモック、それ以外は本番同等」（CLAUDE.md §11）の原則どおり実サービス。
// 🔴 billing=real でも実害はない: sandbox テナントは Tenant.lifecycleState='SANDBOX' のままであり
// Stripe の Subscription を持たないため、課金フローそのものが発生しない（§4.2 Tenant の規則）。
function sandboxSelection(): ConnectorSelection {
  return {
    email: 'sandboxRecipientScoped',
    objectStore: 'real',
    malwareScanner: 'real',
    esign: 'mock',
    billing: 'real',
    ai: 'real',
  };
}

// staging: 各サービスの sandbox / test モードに実接続する（docs/03 §4.18.1）。
function stagingSelection(): ConnectorSelection {
  return {
    email: 'real',
    objectStore: 'real',
    malwareScanner: 'real',
    esign: 'real',
    billing: 'real',
    ai: 'real',
  };
}

// production: 全区分 real。mock が混ざったら assertNoMockInProduction が throw する。
function productionSelection(): ConnectorSelection {
  return {
    email: 'real',
    objectStore: 'real',
    malwareScanner: 'real',
    esign: 'real',
    billing: 'real',
    ai: 'real',
  };
}

/**
 * 🔴 NFR-ENV-3 の実行時の二重防御（docs/03 §4.18.2）。
 * `production` の分岐でスキーマ上は選べないはずの mock が万一選択されていたら起動を失敗させる。
 * 型（envSchema の production 枝が 'mock' を許容しない）が唯一の防御にならないようにする。
 */
export function assertNoMockInProduction(env: Pick<AppEnv, 'APP_ENV'>, selection: ConnectorSelection): void {
  if (env.APP_ENV !== 'production') return;
  for (const category of CONNECTOR_CATEGORIES) {
    if (selection[category] === 'mock') {
      throw new ProductionMockConnectorError(category);
    }
  }
}

/** 🔴 唯一の分岐点。apps/web の instrumentation.ts / apps/worker の起動処理から 1 回だけ呼ぶ。 */
export function resolveConnectorSelection(env: AppEnv): ConnectorSelection {
  const kind = env.APP_ENV;
  let selection: ConnectorSelection;
  switch (kind) {
    case 'development':
      selection = developmentSelection();
      break;
    case 'demo':
      selection = demoSelection();
      break;
    case 'sandbox':
      selection = sandboxSelection();
      break;
    case 'staging':
      selection = stagingSelection();
      break;
    case 'production':
      selection = productionSelection();
      break;
    default:
      return assertNever(kind, 'resolveConnectorSelection');
  }
  assertNoMockInProduction(env, selection);
  return selection;
}
