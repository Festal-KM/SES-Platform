// apps/web/app/admin/demo/admin-demo-screen.render.test.tsx
// `AdminDemoScreen`（`A-012` デモ環境の合成データ管理）の描画テスト。T-10-06 / T-10-07。
//
// 🔴 `docs/04` §A-012 の状態表を固定する:
//   ① 🔴 `available: false`（`APP_ENV` が `demo` / `development` 以外）→ 「この環境では利用できません」の 1 文だけ。
//      投入・リセットの導線・確認ステップ・実演チェックリスト・サインイン情報のどれも HTML に存在しない（`F-053 AC-6`）
//   ② `available: true` → 環境の確認（`APP_ENV` の再掲。**環境を選ぶ入力は無い**）/ 投入状況の節 / 投入の節 / リセットの節 / 実演シナリオ
//      （`F-053 AC-3` の 2 本の開始地点 = `seed:demo` の案件 ID を含む URL）/ 合成のサインイン情報
//   ③ 🔴 「本番からコピー」に相当する語・導線が無い（`BR-47`）
//   ④ ✅ T-10-07: リセットの節がある（対象 = `demo` プリセットのテナント名）。予告文（`comingSoon`）は撤去した。
//      確認ステップ（入力欄・実行ボタン）は応答（configured）を待ってから開くので初期描画には無い
//   ⑤ 文言はすべて `packages/i18n` の実物（`_lib/messages.ts` 経由）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（他の `*.render.test.tsx` と同じ）。
//    client 部品（`AdminDemoView`）は初期状態（読み込み中）で静的に描かれる。fetch は走らない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_SEED_IDS, DEMO_SEED_PASSWORD, demoSeedCompanyNames } from '@ses/db/seed';
import { t } from '@ses/i18n';
import { demoResetTargetTenantNames } from '../../../lib/admin-demo/reset-targets';
import { demoScenarioStartPoints } from '../../../lib/admin-demo/scenarios';
import { AdminDemoScreen, type AdminDemoScreenProps } from './admin-demo-screen';
import { adminDemoMessages } from './_lib/messages';

function render(over: Partial<AdminDemoScreenProps> = {}): string {
  const props: AdminDemoScreenProps = {
    messages: adminDemoMessages(),
    appEnv: 'demo',
    available: true,
    endpoint: '/api/admin/demo/seed',
    resetEndpoint: '/api/admin/demo/reset',
    resetTenantNames: demoResetTargetTenantNames(),
    scenarios: demoScenarioStartPoints(1),
    ...over,
  };
  return renderToStaticMarkup(createElement(AdminDemoScreen, props));
}

describe('AdminDemoScreen（A-012）', () => {
  it('🔴 ① 非対象環境（production）では「この環境では利用できません」の 1 文だけで、導線・入力・チェックリストが無い', () => {
    const html = render({ appEnv: 'production', available: false });
    expect(html).toContain('data-testid="admin-demo-unavailable"');
    expect(html).toContain(t('admin.demo.unavailable'));
    expect(html).not.toContain('data-testid="admin-demo-screen"');
    expect(html).not.toContain('admin-demo-seed');
    // ✅ T-10-07: リセットの節も導線も無い（投入と同じ 1 分岐で消える。新しい APP_ENV 分岐を足していない）。
    expect(html).not.toContain('admin-demo-reset');
    expect(html).not.toContain(t('admin.demo.section.reset'));
    expect(html).not.toContain('admin-demo-scenario');
    expect(html).not.toContain('admin-demo-accounts');
    expect(html).not.toContain(DEMO_SEED_PASSWORD);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<input');
  });

  it('② 対象環境では APP_ENV の再掲・投入状況・投入・リセット・実演シナリオ・サインイン情報の各節がある（環境を選ぶ入力は無い）', () => {
    const html = render({ appEnv: 'demo' });
    expect(html).toContain('data-testid="admin-demo-screen"');
    expect(html).toContain('data-testid="admin-demo-app-env"');
    expect(html).toContain('>demo<');
    expect(html).toContain(t('admin.demo.section.environment'));
    expect(html).toContain(t('admin.demo.environment.note'));
    expect(html).toContain(t('admin.demo.section.status'));
    expect(html).toContain(t('admin.demo.section.seed'));
    expect(html).toContain(t('admin.demo.seed.datasetName'));
    expect(html).toContain(t('admin.demo.section.reset'));
    expect(html).toContain(t('admin.demo.section.scenarios'));
    expect(html).toContain(t('admin.demo.scenario.a.title'));
    expect(html).toContain(t('admin.demo.scenario.b.title'));
    expect(html).toContain(t('admin.demo.accounts.title'));
    // 🔴 「対象環境を選ぶ」ドロップダウンを置かない（docs/04 §A-012）。
    expect(html).not.toContain('<select');
  });

  it('② 実演シナリオの開始地点は seed:demo の案件 ID を含む主平面の URL（S-013 / S-016）である', () => {
    const html = render();
    const tenant = DEMO_SEED_IDS.tenants[0];
    expect(html).toContain(`href="/projects/${tenant.projects.unpublishedReady}/visibility"`);
    expect(html).toContain(`href="/projects/${tenant.projects.unpublishedCandidates}/candidates"`);
    expect(html).toContain('data-testid="admin-demo-scenario-a-start"');
    expect(html).toContain('data-testid="admin-demo-scenario-b-start"');
    // サインイン情報は合成ドメイン（.example）と合成データ専用のパスワード。
    expect(html).toContain('@demo-alpha.example');
    expect(html).toContain(DEMO_SEED_PASSWORD);
  });

  it('🔴 ③ 「本番からコピー」に相当する語が 1 つも無い（BR-47）', () => {
    const html = render();
    for (const forbidden of ['本番からコピー', '本番データ', '取り込む', 'インポート', 'import']) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it('✅ ④ T-10-07: リセットの節に対象（demo プリセットの 2 テナント名）が出る。予告文は無い。確認ステップは初期描画に無い', () => {
    const html = render();
    expect(html).toContain('data-testid="admin-demo-reset"');
    expect(html).toContain(t('admin.demo.reset.lead'));
    expect(html).toContain('data-testid="admin-demo-reset-targets"');
    expect(html).toContain(demoSeedCompanyNames(1).host);
    expect(html).toContain(demoSeedCompanyNames(2).host);
    // 予告（T-10-06 の `admin.demo.reset.comingSoon`）は撤去した。
    expect(html).not.toContain('admin-demo-reset-coming-soon');
    expect(html).not.toContain('後続のリリース');
    // 確認ステップ（環境名 + テナント名の入力・実行ボタン）は応答（configured）を待ってから開く。初期描画では入力欄も実行ボタンも無い。
    expect(html).not.toContain('admin-demo-reset-open-confirm');
    expect(html).not.toContain('admin-demo-reset-confirm');
    expect(html).not.toContain('admin-demo-reset-submit');
    expect(html).not.toContain('<input');
    // 🔴 対象は合成の商号だけ。任意のテナントを選ぶ入力（tenantId）は存在しない。
    expect(html).not.toContain('tenantId');
  });

  it('④ リセットの対象は props の唯一の出所（reset-targets.ts）と一致し、demo プリセットの 2 件だけである', () => {
    const names = demoResetTargetTenantNames();
    expect(names).toEqual([demoSeedCompanyNames(1).host, demoSeedCompanyNames(2).host]);
    expect(names).toHaveLength(DEMO_SEED_IDS.tenants.length);
  });

  it('② 初期描画では投入状況は読み込み中で、投入ボタンは応答（configured）を待ってから描かれる', () => {
    const html = render();
    expect(html).toContain('data-testid="admin-demo-status-loading"');
    expect(html).not.toContain('data-testid="admin-demo-seed-open-confirm"');
    expect(html).not.toContain('data-testid="admin-demo-seed-confirm"');
  });
});
