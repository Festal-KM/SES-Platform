// 一覧と同じカーソル経路を使い、検索条件と行の位置がページ送りで失われないことを確かめる。
import { expect, test } from '@playwright/test';
import { hostOwner, openTenantSession } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';
import { apiRequest, parseJson } from './support/api';

test('案件一覧の上下でページを送り、検索条件を保って先頭へ戻れる', async ({browser}) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.goto('/projects?limit=1&status=OPEN', {waitUntil:'domcontentloaded'});
    const first = await page.locator('tbody tr[data-testid^="project-list-row-"]').first().getAttribute('data-testid');
    await expect(page.getByTestId('project-list-page-summary')).toContainText('1–1件を表示');
    await expect(page.getByTestId('project-list-paging')).toBeAttached();
    await page.getByTestId('project-list-next').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    expect(new URL(page.url()).searchParams.get('status')).toBe('OPEN');
    expect(new URL(page.url()).searchParams.get('limit')).toBe('1');
    await expect(page.locator('tbody tr[data-testid^="project-list-row-"]').first()).not.toHaveAttribute('data-testid',first!);
    await expect(page.getByTestId('project-list-first')).toBeAttached();
    await page.getByTestId('project-list-first').click();
    await expect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false);
    await expect(page.locator('tbody tr[data-testid^="project-list-row-"]').first()).toHaveAttribute('data-testid',first!);
    await page.setViewportSize({width:375,height:812});
    await expectNoHorizontalOverflow('案件一覧のページ送り',page);
    await page.getByTestId('project-list-next').click();
    await expect(page.getByTestId('project-list-pagination-previous')).toBeVisible();
    await expectNoHorizontalOverflow('案件一覧の先頭に戻る操作',page);
    await page.getByTestId('project-list-pagination-last').click();
    await expect(page.getByTestId('project-list-next')).toHaveAttribute('aria-disabled','true');
    await page.getByTestId('project-list-page-size').selectOption('25');
    await expect.poll(()=>new URL(page.url()).searchParams.get('limit')).toBe('25');
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await expect(page.getByTestId('project-list-page-1')).toHaveAttribute('aria-current','page');
    session.outbound.assertNone();
  } finally {await session.close();}
});

test('一覧はステータスを表示し、サマリでだけ変更できる', async ({browser}) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    // 公開済みの既存案件を閉じると公開停止処理も動くため、専用の未公開案件を使う。
    const name = '一覧ステータス操作の検証専用案件';
    const created = await apiRequest(page,'/api/projects',{method:'POST',body:{name}});
    expect(created.status).toBe(201);
    const {id} = parseJson(created) as {id:string};
    await page.goto(`/projects?q=${encodeURIComponent(name)}&limit=1`,{waitUntil:'domcontentloaded'});
    const url = page.url();
    await expect(page.locator('[data-testid^="project-list-status-toggle-"]')).toHaveCount(0);
    const toggle = page.getByTestId('project-list-panel-status-toggle');
    await expect(toggle).toContainText('募集中');
    await toggle.click();
    await expect(toggle).toContainText('終了');
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('project-list-panel-status-toggle')).toContainText('終了');
    await toggle.click();
    await expect(toggle).toContainText('募集中');
    await page.route(`**/api/projects/${id}`,async route => {
      if(route.request().method()==='PATCH') await route.fulfill({status:500,json:{error:'検証用の失敗'}});
      else await route.continue();
    });
    await toggle.click();
    await expect(page.getByTestId('project-list-panel').getByRole('alert')).toContainText('変更');
    await expect(toggle).toContainText('募集中');
    session.outbound.assertNone();
  } finally {await session.close();}
});
