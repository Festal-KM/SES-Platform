// apps/web/app/admin/demo/admin-demo-screen.tsx
// `A-012` デモ環境の合成データ管理 — 純粋な描画部品（docs/04 §A-012 / `F-053`）。T-10-06。
//
// 🔴 `available`（`APP_ENV ∈ {demo, development}`）が偽なら**「この環境では利用できません」の 1 文だけ**を描く
//    （docs/04 §A-012「非対象環境で URL を直打ち」。フォームもボタンも導線も無い。`F-053 AC-6`）。
//    判定は呼び出し側（`page.tsx`）が `packages/config` の `isSeedableAppEnv` で行い、ここは真偽を受けるだけ。
// 🔴 「対象環境を選ぶ」ドロップダウンを置かない（環境は接続先で決まる。`A-014` セクション 1 と同じ考え方）。
// 🔴 「本番からコピー」に相当する操作を 1 つも置かない（`BR-47`）。
// 🔴 書き込みが許される画面なので `閲覧のみ` バッジは付けない（docs/04 §4.9 の共通前提 4）。
// 🔴 T3（デスクトップ主体）。モバイルでは劣化を許容するが、実演チェックリストと確認ステップは折りたたまない（`CLAUDE.md` §13.3）。
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
  /** API-A16 の URL。 */
  readonly endpoint: string;
  /** 実演チェックリストの開始地点（`seed:demo` の ID から組み立てた値）。 */
  readonly scenarios: DemoScenarioStartPoints;
};

const SECTION_HEADING_CLASSES = 'mt-8 mb-2 text-base font-bold text-slate-900';
const STEP_LIST_CLASSES = 'mb-2 list-none space-y-1 pl-0 text-sm text-slate-700';
const START_LINK_CLASSES = 'font-medium text-slate-900 underline-offset-2 hover:underline';

export function AdminDemoScreen({ messages, appEnv, available, endpoint, scenarios }: AdminDemoScreenProps) {
  if (!available) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-slate-900">{messages.title}</h1>
        <p className="text-sm text-slate-700" data-testid="admin-demo-unavailable">
          {messages.unavailable}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8" data-testid="admin-demo-screen">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{messages.title}</h1>

      <section aria-labelledby="admin-demo-env-heading">
        <h2 id="admin-demo-env-heading" className="mb-2 text-base font-bold text-slate-900">
          {messages.environment.section}
        </h2>
        <dl className="mb-1 flex items-baseline gap-3 text-sm">
          <dt className="text-slate-600">{messages.environment.label}</dt>
          <dd className="font-mono font-medium text-slate-900" data-testid="admin-demo-app-env">
            {appEnv}
          </dd>
        </dl>
        <p className="text-sm text-slate-600">{messages.environment.note}</p>
      </section>

      <AdminDemoView messages={messages} endpoint={endpoint} appEnv={appEnv} />

      <section aria-labelledby="admin-demo-scenarios-heading" data-testid="admin-demo-scenarios">
        <h2 id="admin-demo-scenarios-heading" className={SECTION_HEADING_CLASSES}>
          {messages.scenarios.section}
        </h2>
        <p className="mb-4 text-sm text-slate-600">{messages.scenarios.lead}</p>

        <h3 className="mb-1 text-sm font-bold text-slate-900">{messages.scenarios.a.title}</h3>
        <ol className={STEP_LIST_CLASSES}>
          {messages.scenarios.a.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mb-6 text-sm">
          <span className="mr-2 text-slate-600">{messages.scenarios.start}</span>
          <a className={START_LINK_CLASSES} href={scenarios.scenarioA.startUrl} target="_blank" rel="noreferrer" data-testid="admin-demo-scenario-a-start">
            {scenarios.scenarioA.startUrl}
          </a>
        </p>

        <h3 className="mb-1 text-sm font-bold text-slate-900">{messages.scenarios.b.title}</h3>
        <ol className={STEP_LIST_CLASSES}>
          {messages.scenarios.b.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mb-6 text-sm">
          <span className="mr-2 text-slate-600">{messages.scenarios.start}</span>
          <a className={START_LINK_CLASSES} href={scenarios.scenarioB.startUrl} target="_blank" rel="noreferrer" data-testid="admin-demo-scenario-b-start">
            {scenarios.scenarioB.startUrl}
          </a>
        </p>

        <h3 className="mb-1 text-sm font-bold text-slate-900">{messages.scenarios.accounts.title}</h3>
        <p className="mb-2 text-sm text-slate-600">{messages.scenarios.accounts.lead}</p>
        <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4" data-testid="admin-demo-accounts">
          <dt className="text-slate-600">{messages.scenarios.accounts.hostSales}</dt>
          <dd className="font-mono text-slate-900">{scenarios.accounts.hostSalesEmail}</dd>
          <dt className="text-slate-600">{messages.scenarios.accounts.partnerSales}</dt>
          <dd className="font-mono text-slate-900">{scenarios.accounts.partnerSalesEmail}</dd>
          <dt className="text-slate-600">{messages.scenarios.accounts.password}</dt>
          <dd className="font-mono text-slate-900">{scenarios.accounts.password}</dd>
        </dl>
      </section>
    </main>
  );
}
