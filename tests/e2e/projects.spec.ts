// tests/e2e/projects.spec.ts
// `S-012` 案件の登録・編集（`docs/04` §S-012 / `F-013` / `F-010` / `docs/05` §6.4 #26）。T-06-01。
//
// 🔴 **本ファイルの唯一の目的**: 「登録 → 遷移」を**実際のブラウザ操作**で確かめる。
//    `apps/web/lib/projects/created-href.ts` 冒頭の実測メモのとおり、登録直後の遷移先パターンを
//    `'use client'` のモジュール（`project-form.tsx`）から**値として** import すると、RSC の
//    サーバグラフでは client reference（プロキシ）に置換され、保存に成功した直後の遷移先が
//    壊れる（実測: `/projects/function(){throw Error(...)}/edit`）。この壊れ方は:
//      - ユニットテスト（`vitest`。RSC 変換を経ない `*.render.test.tsx`）を素通りする
//      - 静的検査（`tests/static/client-db-boundary.test.ts` はモジュール依存の**方向**だけを見る）
//        も素通りする
//      - `next build` 済みの本番相当ビルド（`next start`。`tests/e2e/harness/web-server.ts` が
//        起動する唯一の実行形態）でしか再現しない
//    したがって **この E2E だけが検知できる網**である（Iteration 1 → Iteration 2 の是正はここで
//    初めて固定できる）。
//
// 🔴 実 API を叩かない: 本テストが呼ぶのは自テナントの `POST /api/projects` だけであり、
//    外部送信（メール・電子署名・S3）を経由しない（development は全コネクタがモック。
//    `CLAUDE.md` §11）。
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { hostOwner, openTenantSession } from './support/sessions';

/**
 * 保存に必要な最小入力。`S-012` セクション 1「基本」の `name` だけが必須であり、他は
 * 既定値（`status='OPEN'` / `headcount=1` 等。`createProjectBodySchema` の `.default()`）で足りる
 * （`docs/04` §S-012「新規は空フォーム」）。
 *
 * 🔴 値をベタ書きしない（合成データは `audit-k7.spec.ts` の規約に倣い接頭辞 + 乱数を付す）。
 */
function syntheticProjectName(): string {
  return `T0601合成案件-${randomUUID().slice(0, 8)}`;
}

/** 遷移先パスの正の形（`/projects/{uuid(7)}/edit`）。`packages/db/prisma/schema.prisma` の `Project.id` は `@default(uuid(7))`。 */
const CREATED_HREF_PATTERN =
  /^\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/;

test.describe('S-012 案件の登録・編集（T-06-01）', () => {
  test('ホスト OWNER が最小入力で保存すると、実際に /projects/{採番された id}/edit へ遷移する', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const name = syntheticProjectName();
    try {
      await session.page.goto('/projects/new', { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('project-form')).toBeVisible();
      // 対照: 新規モードで開いていること（フォームの `data-mode` 属性。`project-form.tsx`）。
      await expect(session.page.getByTestId('project-form')).toHaveAttribute('data-mode', 'CREATE');

      await session.page.getByTestId('project-name').fill(name);
      await session.page.getByTestId('project-submit').click();

      // 🔴 保存成功 → `window.location.assign()` によるトップレベルナビゲーション
      //    （`project-form.tsx` の `onSubmit`）。`/projects/new` から離れるまで待つ。
      await session.page.waitForURL((url) => url.pathname !== '/projects/new', {
        timeout: 15_000,
      });

      const { pathname } = new URL(session.page.url());
      // 🔴 壊れた遷移先の実物（Iteration 1）: `/projects/function(){throw Error(...)}/edit`。
      //    形（UUID）の正のアサーションに加え、崩れた文字列を個別に否定する
      //    （形だけを見ると「たまたま UUID っぽい文字列に見える別の壊れ方」を見逃しうるため）。
      expect(pathname, `壊れた遷移先に "function" が含まれていないこと（実際: ${pathname}）`).not.toContain(
        'function',
      );
      expect(pathname, `壊れた遷移先に "Error" が含まれていないこと（実際: ${pathname}）`).not.toContain(
        'Error',
      );
      expect(
        pathname,
        `遷移先が /projects/{id}/edit の形であること（実際: ${pathname}）`,
      ).toMatch(CREATED_HREF_PATTERN);

      // 🔴 形だけでなく実体も見る: 編集フォームが実際に描画され、直前に保存した値を持つ
      //    （壊れた ID で 404 に畳まれていない・別の行を指していないことの対照）。
      await expect(session.page.getByTestId('project-form')).toBeVisible();
      await expect(session.page.getByTestId('project-form')).toHaveAttribute('data-mode', 'EDIT');
      await expect(session.page.getByTestId('project-name')).toHaveValue(name);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
