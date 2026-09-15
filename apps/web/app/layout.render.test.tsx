// apps/web/app/layout.render.test.tsx
// `RootLayout` の配線テスト（`F-028` 非本番環境バナー。T-10-05）。
//
// 🔴 何を担保するか（`environment-banner.render.test.tsx` はラッパ単体、こちらは**実際の
//    レイアウトが**それを描くこと）:
//    ① バナーは `body` 直下・`children` の**前**に在る（docs/04 §3.3-1「平面帯は環境バナーの
//       直下」。管理平面の帯は `admin/layout.tsx` が `children` の先頭に描くので、root → admin の
//       入れ子で「バナー → 平面帯 → 本文」の順になる）
//    ② `production` では**レイアウトのどこにも**バナーが無い（`F-028 AC-3`。ラッパが `null` を
//       返すだけでなく、レイアウトが別の場所に描き直していないこと）
//    ③ `APP_ENV` の出所は `lib/db/bootstrap.ts` の `currentAppEnv()` だけである（ここを
//       差し替えるとバナーの環境が変わる = レイアウトが他の経路で `APP_ENV` を読んでいない）
//
// 🔴 `lib/db/bootstrap.ts` は `@ses/db` / AWS SDK / BullMQ を束ねる起動時 DI の実体であり、
//    render テストから実行させない（環境変数も Redis も無い）。`vi.mock` で `currentAppEnv`
//    だけを差し替える。他の export は使わないので定義しない（使えば undefined で落ちる =
//    レイアウトが bootstrap の別の値を読み始めたことを検出できる）。
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvKind } from '@ses/config';
import { t } from '@ses/i18n';
import AdminLayout from './admin/layout';
import RootLayout from './layout';

const runtime = vi.hoisted(() => ({ env: 'development' as AppEnvKind }));

vi.mock('../lib/db/bootstrap', () => ({
  currentAppEnv: () => runtime.env,
}));

const PROBE = 'data-testid="layout-probe"';

function probeElement(): ReactNode {
  return createElement('main', { 'data-testid': 'layout-probe' });
}

function renderRoot(env: AppEnvKind, children: ReactNode = probeElement()): string {
  runtime.env = env;
  return renderToStaticMarkup(createElement(RootLayout, { children }));
}

describe('RootLayout — 非本番環境バナーの配線（F-028 AC-1 / AC-3）', () => {
  it('development: バナーが body 直下・children の前に描かれる', () => {
    const markup = renderRoot('development');
    const banner = markup.indexOf('data-testid="environment-banner"');
    const probe = markup.indexOf(PROBE);
    expect(banner).toBeGreaterThanOrEqual(0);
    expect(probe).toBeGreaterThan(banner);
    expect(markup).toContain(t('env.development'));
    // `<body ...>` の直後に来る（間に別の要素を挟まない）。
    expect(markup).toMatch(/<body[^>]*><p[^>]*data-testid="environment-banner"/);
  });

  it.each(['demo', 'sandbox', 'staging'] as const)('%s: その環境の文言で描かれる', (env) => {
    const markup = renderRoot(env);
    expect(markup).toContain(`data-environment="${env}"`);
    expect(markup).toContain(t(`env.${env}`));
  });

  it('🔴 production: レイアウトのどこにもバナーが無く、children は描かれる', () => {
    const markup = renderRoot('production');
    expect(markup).not.toContain('environment-banner');
    expect(markup).not.toContain('data-environment=');
    for (const env of ['development', 'demo', 'sandbox', 'staging'] as const) {
      expect(markup, env).not.toContain(t(`env.${env}`));
    }
    expect(markup).toContain(PROBE);
    expect(markup).toMatch(/<body[^>]*><main/);
  });

  it('管理平面: バナー → 平面帯（運営者コンソール）→ 本文の順になる（docs/04 §3.3-1）', () => {
    const markup = renderRoot('demo', createElement(AdminLayout, { children: probeElement() }));
    const banner = markup.indexOf('data-testid="environment-banner"');
    const band = markup.indexOf(t('admin.plane.band'));
    const probe = markup.indexOf(PROBE);
    expect(banner).toBeGreaterThanOrEqual(0);
    expect(band).toBeGreaterThan(banner);
    expect(probe).toBeGreaterThan(band);
  });
});
