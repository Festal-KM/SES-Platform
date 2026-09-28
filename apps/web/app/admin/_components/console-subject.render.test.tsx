// apps/web/app/admin/_components/console-subject.render.test.tsx
// 管理平面の主体表示の描画（docs/04 §3.3-2 の区別手段 #3 / `BR-44`）。
//
// 🔴 固定するのは 4 つ:
//    ① 氏名とロール名が**両方**出る（どちらかが欠けると「できない理由」の説明にならない）
//    ② 🔴 `PLATFORM_OWNER` と `PLATFORM_SUPPORT` で**ロール名が違う**（同じ語なら区別の用を成さない）
//    ③ 🔴 出すのは氏名とロールだけ（`CLAUDE.md` §10.5。文言キーは `shell.admin.subject.*` に閉じる）
//    ④ アイコンを使わない（docs/04 §7.5）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`console-nav.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformRole } from '@ses/db';
import { t } from '@ses/i18n';
import { AdminConsoleSubject, PLATFORM_ROLE_MESSAGE_KEYS } from './console-subject';

const NAME = '運営コンソール管理者（合成）';

function render(platformRole: PlatformRole, userName = NAME): string {
  return renderToStaticMarkup(createElement(AdminConsoleSubject, { userName, platformRole }));
}

describe('🔴 ① 氏名とロール名が両方出る', () => {
  it.each(['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const)('%s: 見出し語 + 氏名 + ロール名', (platformRole) => {
    const html = render(platformRole);
    expect(html).toContain('data-testid="admin-console-subject"');
    expect(html).toContain(t('shell.admin.subject.label'));
    expect(html).toContain(NAME);
    expect(html).toContain(t(PLATFORM_ROLE_MESSAGE_KEYS[platformRole]));
    expect(html).toContain(`data-platform-role="${platformRole}"`);
  });
});

describe('🔴 ② PLATFORM_OWNER と PLATFORM_SUPPORT でロール名が違う', () => {
  it('2 つのロール名は別の語である（写像もカタログも別の値を持つ）', () => {
    const owner = t(PLATFORM_ROLE_MESSAGE_KEYS.PLATFORM_OWNER);
    const support = t(PLATFORM_ROLE_MESSAGE_KEYS.PLATFORM_SUPPORT);
    expect(PLATFORM_ROLE_MESSAGE_KEYS.PLATFORM_OWNER).not.toBe(
      PLATFORM_ROLE_MESSAGE_KEYS.PLATFORM_SUPPORT,
    );
    expect(owner).not.toBe(support);
    // 描画でも入れ替わらない（片方のロール名がもう片方の画面に出ない）。
    expect(render('PLATFORM_OWNER')).not.toContain(support);
    expect(render('PLATFORM_SUPPORT')).not.toContain(owner);
  });

  it('🔴 テナント側のロール名（members.role.*）を流用していない（別テーブル・別認証。CLAUDE.md §10.5）', () => {
    for (const platformRole of ['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const) {
      expect(PLATFORM_ROLE_MESSAGE_KEYS[platformRole].startsWith('shell.admin.subject.role.')).toBe(
        true,
      );
    }
  });
});

describe('🔴 ③ 出すのは氏名とロールだけ（運営者に見せるものを増やさない）', () => {
  it('メールアドレス・ID・テナント名を出す口を持たない（props が 2 つだけ）', () => {
    const html = render('PLATFORM_SUPPORT');
    expect(html).not.toContain('@');
    // リンクを持たない（主体表示は導線ではない）。
    expect(html).not.toContain('<a');
  });
});

describe('🔴 ④ アイコンを使わない（docs/04 §7.5）', () => {
  it('svg / img を 1 つも含まない', () => {
    const html = render('PLATFORM_OWNER');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});
