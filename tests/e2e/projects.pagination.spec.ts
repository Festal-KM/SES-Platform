// 一覧と同じカーソル経路を使い、検索条件と行の位置がページ送りで失われないことを確かめる。
import { expect, test } from '@playwright/test';
import { hostOwner, openTenantSession } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';

test('案件一覧の上下でページを送り、検索条件を保って先頭へ戻れる', async ({browser}) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.goto('/projects?limit=1&status=OPEN', {waitUntil:'domcontentloaded'});
    const first = await page.locator('tbody tr[data-testid^="project-list-row-"]').first().getAttribute('data-testid');
    await expect(page.getByTestId('project-list-page-summary')).toContainText('このページは1件');
    await expect(page.getByTestId('project-list-paging')).toBeAttached();
    await page.getByTestId('project-list-top-pagination-next').click();
    await expect.poll(() => new URL(page.url()).searchParams.has('cursor')).toBe(true);
    expect(new URL(page.url()).searchParams.get('status')).toBe('OPEN');
    expect(new URL(page.url()).searchParams.get('limit')).toBe('1');
    await expect(page.locator('tbody tr[data-testid^="project-list-row-"]').first()).not.toHaveAttribute('data-testid',first!);
    await expect(page.getByTestId('project-list-first')).toBeAttached();
    await page.getByTestId('project-list-first').click();
    await expect.poll(() => new URL(page.url()).searchParams.has('cursor')).toBe(false);
    await expect(page.locator('tbody tr[data-testid^="project-list-row-"]').first()).toHaveAttribute('data-testid',first!);
    await page.setViewportSize({width:375,height:812});
    await expectNoHorizontalOverflow('案件一覧のページ送り',page);
    await page.getByTestId('project-list-top-pagination-next').click();
    await expect(page.getByTestId('project-list-top-pagination-prev')).toBeVisible();
    await expectNoHorizontalOverflow('案件一覧の先頭に戻る操作',page);
    session.outbound.assertNone();
  } finally {await session.close();}
});
