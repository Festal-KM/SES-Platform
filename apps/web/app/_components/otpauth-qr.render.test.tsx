// apps/web/app/_components/otpauth-qr.render.test.tsx
// `OtpauthQr`（`S-001` / `A-001` の 2 要素認証 登録ウィザードの QR）の描画テスト。
//
// 🔴 何を担保するか:
//    ①**シークレットが markup のどこにも文字列として現れない** —— 外部の QR 生成サービスの
//      URL を組み立てて `<img>` に載せる実装（= シークレットの外部送信。CLAUDE.md §3.5 / §7）に
//      すり替わったら、`otpauth://` URL が属性値として markup に現れるため、ここで落ちる
//    ②インライン `<svg>` として描かれる（`<img>` / 外部参照ではない）
//    ③符号化できない入力では**何も描かない**（併記された手入力用の表示だけで設定を続けられる）
//
// 🔴 既存の `*.render.test.tsx` と同じ流儀で書く（新規依存を足さない。`react-dom/server` の
//    `renderToStaticMarkup` + `createElement`。理由は sending-domain-screen.render.test.tsx 冒頭）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OtpauthQr } from './otpauth-qr';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OTPAUTH_URL = `otpauth://totp/SES%20Platform:owner%40example.test?secret=${SECRET}&issuer=SES+Platform&algorithm=SHA1&digits=6&period=30`;

function render(otpauthUrl: string): string {
  return renderToStaticMarkup(
    createElement(OtpauthQr, {
      otpauthUrl,
      caption: 'QR コード（認証アプリのカメラで読み取り）',
      alt: '2 要素認証の設定用 QR コード',
      testId: 'signin-otpauth-qr',
    }),
  );
}

describe('OtpauthQr', () => {
  it('インライン svg として描かれる（外部画像を参照しない）', () => {
    const markup = render(OTPAUTH_URL);
    expect(markup).toContain('data-testid="signin-otpauth-qr"');
    expect(markup).toContain('<svg');
    expect(markup).toContain('<path d="M');
    expect(markup).not.toContain('<img');
    expect(markup).not.toMatch(/https?:\/\//);
  });

  it('🔴 シークレットも otpauth:// URL も markup に文字列として現れない', () => {
    const markup = render(OTPAUTH_URL);
    expect(markup).not.toContain(SECRET);
    // `otpauth://`（URL そのもの）で見る。`ses-otpauth-qr` などの class 名は別物。
    expect(markup).not.toContain('otpauth:');
  });

  it('見出しと代替テキストを props から受け取る（コンポーネント内にベタ書きしない）', () => {
    const markup = render(OTPAUTH_URL);
    expect(markup).toContain('aria-label="2 要素認証の設定用 QR コード"');
    expect(markup).toContain('QR コード（認証アプリのカメラで読み取り）');
  });

  it('クワイエットゾーン（周囲 4 モジュール）を含む viewBox になる', () => {
    // 上記の URL は 144 バイト → 型番 8（49 モジュール）。49 + 4 * 2 = 57。
    expect(render(OTPAUTH_URL)).toContain('viewBox="0 0 57 57"');
  });

  it('符号化できない長さの入力では見出しごと何も描かない（手入力用の表示だけで続行できる）', () => {
    // 🔴 見出しだけが残ると「QR コード」の下が空という壊れ方になる。空文字であることを見る。
    expect(render('a'.repeat(667))).toBe('');
  });
});
