// キーワード入力のイベント値は状態更新前に読み、検索までは条件だけを編集する。
import { expect, test } from '@playwright/test';
import { hostOwner, openTenantSession } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';

test('案件検索のチップ入力・明示的な適用・保存条件の再読込', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.goto('/projects', {waitUntil:'domcontentloaded'});
    const initial = page.url();
    const phases = page.getByTestId('project-list-filter-phases-skills');
    // 初回描画の直後はイベント接続前の場合があるため、開いた状態を確認して進む。
    await expect(async () => {
      await phases.focus(); await phases.press('ArrowDown');
      await expect(page.getByTestId('project-list-filter-phases-skills-panel')).toBeVisible({timeout:1000});
    }).toPass({timeout:15000});
    await page.getByTestId('project-list-filter-phases-skills-search').press('ArrowDown');
    await expect(page.getByTestId('project-list-filter-phases-skills-option-PLANNING')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('project-list-filter-phases-skills-option-PLANNING')).toHaveAttribute('aria-selected','true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('project-list-filter-phases-skills-panel')).toHaveCount(0);
    await page.getByTestId('project-list-filter-advanced').locator('summary').click();
    const input = page.getByTestId('project-list-filter-q');
    await expect(page.getByTestId('project-list-filter-keyword-add-0')).toBeDisabled();
    await page.getByTestId('project-list-filter-keyword-empty-0').click();
    await expect(input).toBeFocused();
    await input.fill('   ');
    await expect(page.getByTestId('project-list-filter-keyword-add-0')).toBeDisabled();
    await input.fill('Java'); await input.press('Enter');
    await input.fill(' Springboot '); await page.getByTestId('project-list-filter-keyword-add-0').click();
    await expect(input).toBeFocused(); await expect(input).toHaveValue('');
    await expect(page.getByTestId('project-list-filter-keyword-term-0-1')).toContainText('Springboot');
    await input.fill('Java'); await input.press('Enter');
    await expect(page.getByTestId('project-list-filter-keyword-term-0-2')).toHaveCount(0);
    await page.getByTestId('project-list-filter-keyword-mode-0-AND').check();
    await expect(page.getByTestId('project-list-filter-expression')).toContainText('AND');
    await page.getByTestId('project-list-filter-keyword-mode-0-OR').check();
    await page.getByTestId('project-list-filter-add-group').click();
    await expect(page.getByTestId('project-list-filter-keyword-group-1')).toBeFocused();
    await expect(page.getByTestId('project-list-filter-keyword-connector-1')).toHaveText('AND');
    await expect(page.getByTestId('project-list-filter-expression')).not.toContainText('キーワード未設定');
    await page.getByTestId('project-list-filter-keyword-group-1').fill('設計');
    await page.getByTestId('project-list-filter-keyword-add-1').click();
    await expect(page.getByTestId('project-list-filter-expression')).toContainText('設計');
    await page.getByTestId('project-list-filter-remove-group-1').click();
    await expect(page.getByTestId('project-list-filter-keyword-connector-1')).toHaveCount(0);
    await page.getByTestId('project-list-filter-keyword-term-0-1').click();
    await page.getByTestId('project-list-filter-development-method-segment-AGILE').locator('..').click();
    await page.waitForTimeout(600);
    expect(page.url()).toBe(initial);
    await page.getByTestId('project-list-search').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('developmentMethod')).toBe('AGILE');
    await expect(page.getByTestId('project-list-filter-keyword-term-0-0')).toContainText('Java');
    await page.getByTestId('project-list-search-save').click();
    await page.getByTestId('project-list-search-save-name').fill('検索UIの回帰検証');
    await page.getByTestId('project-list-search-save-confirm').click();
    const selected = page.getByTestId('project-list-search-saved-select');
    const option = selected.getByRole('option', {name:'検索UIの回帰検証',exact:true});
    await expect(option).toHaveCount(1);
    const savedId = await option.getAttribute('value'); expect(savedId).toBeTruthy();
    await selected.selectOption(savedId!);
    await page.getByTestId('project-list-filter-development-method-segment-WATERFALL').locator('..').click();
    await expect(page.getByTestId('project-list-search-selected-modified')).toBeVisible();
    await selected.selectOption(savedId);
    await expect(page.getByTestId('project-list-filter-development-method-segment-AGILE')).toBeChecked();
    await expect(page.getByTestId('project-list-filter-keyword-term-0-0')).toContainText('Java');
    await page.getByTestId('project-list-search-toggle').click();
    await expect(page.getByTestId('project-list-search')).toHaveCount(0);
    await expect(page.getByTestId('project-list-details-summary')).toBeVisible();
    await page.getByTestId('project-list-details-summary').click();
    await expect(page.getByTestId('project-list-filter-advanced')).toHaveAttribute('open','');
    await expect(page.getByTestId('project-list-search')).toBeVisible();
    await page.setViewportSize({width:375,height:812});
    await expectNoHorizontalOverflow('案件検索の入力済み条件',page);
    session.outbound.assertNone();
  } finally { await session.close(); }
});

