// apps/web/app/_components/environment-banner.render.test.tsx
// `AppEnvironmentBanner`（`F-028` 非本番環境バナー。T-10-05）の環境別描画テスト。
//
// 🔴 なぜこの粒度で要るか: E2E ハーネスは `APP_ENV=development` 固定（`tests/e2e/harness/
//    web-server.ts`）であり、`demo` / `sandbox` / `staging` の文言と **`production` で出ない
//    こと（`F-028 AC-3`）** はブラウザ E2E からは 1 つも観測できない。`APP_ENV` を props で
//    注入できるのはこの層だけである（`sending-domain-screen.render.test.tsx` と同じ理由）。
// 🔴 既存の `*.render.test.tsx` と同じ流儀（`react-dom/server` の `renderToStaticMarkup` +
//    `createElement`。新規依存を足さない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APP_ENV_KINDS, type AppEnvKind } from '@ses/config';
import { t } from '@ses/i18n';
import { AppEnvironmentBanner } from './environment-banner';

function render(env: AppEnvKind): string {
  return renderToStaticMarkup(createElement(AppEnvironmentBanner, { env }));
}

const VISIBLE_ENVS = ['development', 'demo', 'sandbox', 'staging'] as const satisfies readonly AppEnvKind[];

describe('AppEnvironmentBanner — 環境別の描画（F-028 AC-1 / AC-3）', () => {
  it('🔴 production では何も描かない（DOM に痕跡が 1 つも残らない）', () => {
    expect(render('production')).toBe('');
  });

  it.each([...VISIBLE_ENVS])('%s では data-testid 付きの帯を描き、文言は packages/i18n の値と一致する', (env) => {
    const markup = render(env);
    expect(markup).toContain('data-testid="environment-banner"');
    expect(markup).toContain(`data-environment="${env}"`);
    expect(markup).toContain(t(`env.${env}`));
  });

  it('🔴 APP_ENV の 5 値すべてに対して「production だけ出ない・それ以外は必ず出る」（環境が増えたときの漏れ検知）', () => {
    // 型（`switch` の網羅性）に加えて実行時の対照も持つ。`packages/config` の集合を正とする。
    for (const env of APP_ENV_KINDS) {
      const markup = render(env);
      if (env === 'production') {
        expect(markup, env).toBe('');
      } else {
        expect(markup, env).toContain('data-testid="environment-banner"');
      }
    }
  });

  it('最上部に固定される（sticky top-0）。折りたたみ・1 行切り詰めの語（truncate / line-clamp / nowrap）を持たない', () => {
    for (const env of VISIBLE_ENVS) {
      const markup = render(env);
      expect(markup, env).toMatch(/class="[^"]*\bsticky\b[^"]*"/);
      expect(markup, env).toMatch(/class="[^"]*\btop-0\b[^"]*"/);
      expect(markup, env).not.toMatch(/truncate|line-clamp|whitespace-nowrap|hidden/);
    }
  });

  it('4 環境の文言はすべて異なる（demo と sandbox を取り違えない。F-028 AC-2）', () => {
    const messages = VISIBLE_ENVS.map((env) => t(`env.${env}`));
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('AppEnvironmentBanner — demo / sandbox の文言（F-028 AC-2 / U-07）', () => {
  it('demo: 「デモ環境 — 送信は行われません」が読める', () => {
    expect(render('demo')).toContain('デモ環境 — 送信は行われません');
  });

  const sandbox = render('sandbox');

  it('sandbox ①: 提案先・エンド企業宛の業務上の外部送信（提案 / 面談調整 / 契約書 / 署名依頼）は疑似である', () => {
    for (const word of ['提案', '面談調整', '契約書', '署名依頼']) {
      expect(sandbox).toContain(word);
    }
    expect(sandbox).toContain('送信されません');
  });

  it('sandbox ②: 取引先の担当者宛のメール（招待を含む）も疑似で、招待は画面に表示されるリンクで行う', () => {
    expect(sandbox).toContain('取引先の担当者宛のメール（招待を含む）は送信されません');
    expect(sandbox).toContain('画面に表示されるリンク');
  });

  it('sandbox ③: 自社メンバー宛のメール（招待・期限のお知らせ）は実際に届く', () => {
    expect(sandbox).toContain('自社メンバー宛の招待・期限のお知らせ');
    expect(sandbox).toContain('実際に届きます');
  });

  it('🔴 sandbox: 「メールは一切送信されない」とも「すべてのメールが届く」とも読めない', () => {
    expect(sandbox).not.toContain('一切');
    expect(sandbox).not.toMatch(/すべてのメール|全てのメール|メールは送信されません/);
  });

  it('sandbox: 3 点が「送信されないもの → 代替手段があるもの → 実際に届くもの」の順に並ぶ（docs/04 §3.5）', () => {
    const notSent = sandbox.indexOf('送信されません');
    const link = sandbox.indexOf('画面に表示されるリンク');
    const delivered = sandbox.indexOf('実際に届きます');
    expect(notSent).toBeGreaterThanOrEqual(0);
    expect(link).toBeGreaterThan(notSent);
    expect(delivered).toBeGreaterThan(link);
  });
});
