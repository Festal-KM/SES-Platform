// apps/web/app/_components/auth-shell.render.test.tsx
// `AuthShell`（`S-001` / `S-002` / `S-046` / `A-001` の共通外枠）の描画テスト。SP-22 段④。
//
// 🔴 **何を担保するか（この 1 点が本テストの存在理由である）**
//    段④ で `AuthShell` が `PageBody`（幅 3 クラス）を描くようになった。`docs/04` §7.1 は
//    クラス C（`prose`）を **「720px・左寄せ。🔴 中央寄せにしない」** と定めているが、
//    **認証画面は `AppShell` の外側（サイドバーが無い）であり、カードはビューポートの中央に在る**。
//    したがってここでは **①中央寄せを維持し ②`PageBody` の gutter（`px-6`）を打ち消して
//    カードの内容幅を変えない** 形にした。🔴 **この 2 つは「見た目を 1px も変えない」ための
//    条件であり、どちらかが崩れると認証画面だけ左寄せ・内容幅 336px になる**（= 刷新の事故）。
//    中央寄せの実装が `PageBody` の `prose`（左寄せ）に差し替わったら、ここで落ちる。
//
// 🔴 既存の `*.render.test.tsx` と同じ流儀で書く（新規依存を足さない。`react-dom/server` の
//    `renderToStaticMarkup` + `createElement`）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthShell } from './auth-shell';

function render(widthClass?: 'full' | 'split' | 'prose'): string {
  return renderToStaticMarkup(
    createElement(AuthShell, {
      wordmark: 'SES Platform',
      ...(widthClass === undefined ? {} : { widthClass }),
      children: createElement('h1', null, 'サインイン'),
    }),
  );
}

/** `class="…"` の集合（属性の並び順に依存しないで語の有無を見るため）。 */
function classesOf(markup: string): readonly string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/));
}

describe('AuthShell', () => {
  it('🔴 中央寄せを維持する（`AppShell` の外側で柱が無いため、§7.1 の「左寄せ」を持ち込まない）', () => {
    const classes = classesOf(render('prose'));
    expect(classes).toContain('justify-center');
    expect(classes).toContain('flex');
    expect(classes).toContain('min-h-dvh');
    // カードの幅（24rem）。🔴 これが消えると入力欄が 720px まで伸びる。
    expect(classes).toContain('max-w-sm');
  });

  it('🔴 `PageBody` に幅クラスを素通しする（検査 (k)「1 画面に 1 つ」を `page.tsx` 側で満たすため）', () => {
    expect(render('prose')).toContain('data-width-class="prose"');
    expect(render('prose')).toContain('data-testid="page-body"');
  });

  it('🔴 `PageBody` の gutter（`px-6`）を打ち消す（`<main>` の `px-4` と二重に入れない）', () => {
    const classes = classesOf(render('prose'));
    // 左右の余白はビューポートの端との間隔であり、`<main>` が 1 箇所で持つ。
    expect(classes).toContain('px-4');
    expect(classes).toContain('px-0');
    // 🔴 二重の gutter（内容幅 384 → 336px）になっていない。
    expect(classes).not.toContain('px-6');
  });

  it('`widthClass` を渡さない呼び出し（段⑤ 待ちの `A-001`）でも同じ幅クラスで描く', () => {
    expect(render()).toContain('data-width-class="prose"');
    expect(classesOf(render())).toContain('max-w-sm');
  });

  it('ワードマークと本体を props から受け取る（この部品は文言を持たない）', () => {
    const markup = render('prose');
    expect(markup).toContain('SES Platform');
    expect(markup).toContain('<h1>サインイン</h1>');
  });
});
