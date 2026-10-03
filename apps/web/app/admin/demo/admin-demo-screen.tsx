// apps/web/app/admin/demo/admin-demo-screen.tsx
// `A-012` デモ環境の合成データ管理 — 純粋な描画部品（docs/04 §A-012 / `F-053`）。T-10-06 / T-10-07（リセット節）。
//
// 🔴 `available`（`APP_ENV ∈ {demo, development}`）が偽なら**「この環境では利用できません」の 1 文だけ**を描く
//    （docs/04 §A-012「非対象環境で URL を直打ち」。フォームもボタンも導線も無い。投入・リセットとも。`F-053 AC-6`）。
//    判定は呼び出し側（`page.tsx`）が `packages/config` の `isSeedableAppEnv` で行い、ここは真偽を受けるだけ。
// 🔴 「対象環境を選ぶ」ドロップダウンを置かない（環境は接続先で決まる。`A-014` セクション 1 と同じ考え方）。
// 🔴 「本番からコピー」に相当する操作を 1 つも置かない（`BR-47`）。
// 🔴 書き込みが許される画面なので `閲覧のみ` バッジは付けない（docs/04 §4.9 の共通前提 4）。
// 🔴 T3（デスクトップ主体）。モバイルでは劣化を許容するが、実演チェックリストと確認ステップは折りたたまない（`CLAUDE.md` §13.3）。
//
// ============================================================================
// 🔴 T-22-14（段⑤）: 幅クラスと semantic トークンへの寄せ
// ============================================================================
// - 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`。検査 (c) / (k)）。本画面は
//   **実演の手順書と 8 列の投入状況の表**を併せ持つので **クラス A = 全幅**である
//   （旧 `max-w-5xl` / 非対象環境の `max-w-3xl`）。
//   🔴 **`widthClass` は 1 ファイルに 1 回**（検査 (k)）。旧実装は `available` の真偽で
//   `<main>` を 2 つ持っていたため、**器を `page.tsx` に返し、ここは中身だけ**にした
//   （`A-002` / `A-010` と同じ形。`admin-demo-screen` / `admin-demo-unavailable` の
//   testid と出す / 出さないの分岐は 1 つも変えていない）。
// - 色・文字サイズを §7.9 のトークンへ（`text-base` → `text-lg` / `text-sm` → `text-body` /
//   `text-xl` → `text-title` / `text-slate-*` → `text-fg` / `text-fg-muted`。**実寸は同じ**）。
// - 開始地点の URL は `SECONDARY_LINK_CLASSES`（画面側に `hover:` を書かない = 検査 (j)）。
import { SECONDARY_LINK_CLASSES } from '@ses/ui';
import type { DemoScenarioStartPoints } from '../../../lib/admin-demo/scenarios';
import { AdminDemoView, type AdminDemoViewMessages } from './admin-demo-view';

export type AdminDemoScreenMessages = AdminDemoViewMessages & {
  readonly title: string;
  readonly unavailable: string;
  readonly environment: { readonly section: string; readonly label: string; readonly note: string };
  readonly scenarios: {
    readonly section: string;
    readonly lead: string;
    readonly start: string;
    readonly a: { readonly title: string; readonly steps: readonly string[] };
    readonly b: { readonly title: string; readonly steps: readonly string[] };
    readonly accounts: {
      readonly title: string;
      readonly lead: string;
      readonly hostSales: string;
      readonly partnerSales: string;
      readonly password: string;
    };
  };
};

export type AdminDemoScreenProps = {
  readonly messages: AdminDemoScreenMessages;
  readonly appEnv: string;
  /** `APP_ENV ∈ {demo, development}`。偽なら画面の中身は存在しない。 */
  readonly available: boolean;
  /** API-A16 の URL（`GET` / `POST …/seed`）。 */
  readonly endpoint: string;
  /** ✅ T-10-07: API-A16 `reset` の URL（`POST …/reset`）。 */
  readonly resetEndpoint: string;
  /** ✅ T-10-07: リセットの対象 = `demo` プリセットのテナント名（確認入力の照合先。`lib/admin-demo/reset-targets.ts`）。 */
  readonly resetTenantNames: readonly string[];
  /** 実演チェックリストの開始地点（`seed:demo` の ID から組み立てた値）。 */
  readonly scenarios: DemoScenarioStartPoints;
};

const SECTION_HEADING_CLASSES = 'mt-8 mb-2 text-lg font-bold text-fg';
const STEP_LIST_CLASSES = 'mb-2 list-none space-y-1 pl-0 text-body text-fg';
const START_LINK_CLASSES = SECONDARY_LINK_CLASSES;
/** 画面タイトル / 節の小見出し / 補助テキスト（§7.3 の段。`A-005` と同じ語に揃えた）。 */
const TITLE_CLASSES = 'mb-6 text-title font-bold text-fg';
const SUBTITLE_CLASSES = 'mb-1 text-body font-bold text-fg';
const NOTE_CLASSES = 'text-body text-fg-muted';
const TERM_CLASSES = 'text-fg-muted';
const VALUE_CLASSES = 'font-mono font-medium text-fg';

export function AdminDemoScreen({ messages, appEnv, available, endpoint, resetEndpoint, resetTenantNames, scenarios }: AdminDemoScreenProps) {
  // 🔴 `available` が偽なら投入・リセットのどちらの導線も描かない（F-053 AC-6）。リセット節に新しい環境判定を足さず、この 1 分岐に乗せる。
  if (!available) {
    return (
      <div>
        <h1 className={TITLE_CLASSES}>{messages.title}</h1>
        <p className="text-body text-fg" data-testid="admin-demo-unavailable">
          {messages.unavailable}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="admin-demo-screen">
      <h1 className={TITLE_CLASSES}>{messages.title}</h1>

      <section aria-labelledby="admin-demo-env-heading">
        <h2 id="admin-demo-env-heading" className="mb-2 text-lg font-bold text-fg">
          {messages.environment.section}
        </h2>
        <dl className="mb-1 flex items-baseline gap-3 text-body">
          <dt className={TERM_CLASSES}>{messages.environment.label}</dt>
          <dd className={VALUE_CLASSES} data-testid="admin-demo-app-env">
            {appEnv}
          </dd>
        </dl>
        <p className={NOTE_CLASSES}>{messages.environment.note}</p>
      </section>

      <AdminDemoView
        messages={messages}
        endpoint={endpoint}
        resetEndpoint={resetEndpoint}
        appEnv={appEnv}
        resetTenantNames={resetTenantNames}
      />

      <section aria-labelledby="admin-demo-scenarios-heading" data-testid="admin-demo-scenarios">
        <h2 id="admin-demo-scenarios-heading" className={SECTION_HEADING_CLASSES}>
          {messages.scenarios.section}
        </h2>
        <p className={`mb-4 ${NOTE_CLASSES}`}>{messages.scenarios.lead}</p>

        <h3 className={SUBTITLE_CLASSES}>{messages.scenarios.a.title}</h3>
        <ol className={STEP_LIST_CLASSES}>
          {messages.scenarios.a.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mb-6 text-body">
          <span className={`mr-2 ${TERM_CLASSES}`}>{messages.scenarios.start}</span>
          <a className={START_LINK_CLASSES} href={scenarios.scenarioA.startUrl} target="_blank" rel="noreferrer" data-testid="admin-demo-scenario-a-start">
            {scenarios.scenarioA.startUrl}
          </a>
        </p>

        <h3 className={SUBTITLE_CLASSES}>{messages.scenarios.b.title}</h3>
        <ol className={STEP_LIST_CLASSES}>
          {messages.scenarios.b.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mb-6 text-body">
          <span className={`mr-2 ${TERM_CLASSES}`}>{messages.scenarios.start}</span>
          <a className={START_LINK_CLASSES} href={scenarios.scenarioB.startUrl} target="_blank" rel="noreferrer" data-testid="admin-demo-scenario-b-start">
            {scenarios.scenarioB.startUrl}
          </a>
        </p>

        <h3 className={SUBTITLE_CLASSES}>{messages.scenarios.accounts.title}</h3>
        <p className={`mb-2 ${NOTE_CLASSES}`}>{messages.scenarios.accounts.lead}</p>
        <dl className="grid grid-cols-1 gap-y-1 text-body sm:grid-cols-[auto_1fr] sm:gap-x-4" data-testid="admin-demo-accounts">
          <dt className={TERM_CLASSES}>{messages.scenarios.accounts.hostSales}</dt>
          <dd className="font-mono text-fg">{scenarios.accounts.hostSalesEmail}</dd>
          <dt className={TERM_CLASSES}>{messages.scenarios.accounts.partnerSales}</dt>
          <dd className="font-mono text-fg">{scenarios.accounts.partnerSalesEmail}</dd>
          <dt className={TERM_CLASSES}>{messages.scenarios.accounts.password}</dt>
          <dd className="font-mono text-fg">{scenarios.accounts.password}</dd>
        </dl>
      </section>
    </div>
  );
}
