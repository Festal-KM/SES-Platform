import { expect, test } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { hostOwner, openTenantSession } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';

test('自社人材の検索条件を保存し、折りたたんでも検索できる', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.goto('/engineers');
    await expect(page.getByRole('heading', { name: t('engineers.searchPanel.title') })).toBeVisible();
    await expect(page.getByTestId('engineer-list-panel')).toBeVisible();
    await expect(page.getByTestId('engineer-list-panel-open')).toHaveAttribute('href', /\/engineers\//);
    await expect(page.getByText(t('projects.search.basic'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('projects.search.advanced'), { exact: true })).toBeVisible();
    await page.getByText(t('projects.search.advanced'), { exact: true }).click();
    const query = page.getByTestId('engineer-list-filter-q');
    await query.fill('検索確認');
    await page.getByRole('button', { name: t('projects.search.save'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('engineers.searchPanel.name')).fill('確認用の条件');
    await dialog.getByRole('button', { name: t('projects.search.save') }).click();
    await page.getByRole('tab', { name: /保存した条件/ }).click();
    await expect(page.getByTestId('engineer-list-saved-apply')).toContainText('確認用の条件');
    await page.getByTestId('engineer-list-saved-apply').click();
    await expect(page).toHaveURL(/q=%E6%A4%9C%E7%B4%A2%E7%A2%BA%E8%AA%8D/);
    await page.getByRole('button', { name: t('engineers.searchPanel.collapse') }).click();
    await expect(page.getByTestId('engineer-list-search')).toBeVisible();
    await page.getByTestId('engineer-list-search').click();
    await expect(page).toHaveURL(/keywordGroups=/);
    await page.getByTestId('engineer-list-clear').click();
    await expect(page).not.toHaveURL(/q=/);
    await page.getByRole('button', { name: t('engineers.searchPanel.expand') }).click();
    await expect(page.getByTestId('engineer-list-filter-q')).toHaveValue('');
    await page.getByText(t('projects.search.advanced'), { exact: true }).click();
    await page.getByTestId('engineer-list-utilization-segment-UNDER_HALF').locator('..').click();
    await page.getByTestId('engineer-list-search').click();
    await expect(page).toHaveURL(/utilizationBand=UNDER_HALF/);
    await page.getByText(t('projects.search.advanced'), { exact: true }).click();
    await page.getByTestId('engineer-list-filter-q').fill('Java');
    await page.getByTestId('engineer-list-filter-q').press('Enter');
    await expect(page.getByTestId('engineer-list-filter-keyword-term-0-0')).toContainText('Java');
    await page.getByTestId('engineer-list-search').click();
    await expect(page).toHaveURL(/keywordGroups=/);
    await expectNoHorizontalOverflow('人材検索', page);
    session.outbound.assertNone();
  } finally { await session.close(); }
});
