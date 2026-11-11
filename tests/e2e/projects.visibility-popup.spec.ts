import { expect, test } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { hostOwner, openTenantSession } from './support/sessions';
import { partnerIds, tenantIds } from './support/population';
import { expectNoHorizontalOverflow } from './support/assertions';

test('公開先を行で選び、全選択も既存の公開要求に渡す', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  const projectId = tenantIds(1).publishedProjectId;
  const partner1 = partnerIds(1, 1).partnerCompanyId;
  const partner2 = partnerIds(1, 2).partnerCompanyId;
  const submissions: string[][] = [];
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route(`**/api/projects/${projectId}/visibility`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const body = route.request().postDataJSON() as { partnerCompanyIds: string[] };
      submissions.push(body.partnerCompanyIds);
      return route.fulfill({ json: { verdict: 'PENDING_GATE', reviewGateId: null } });
    });
    await page.goto(`/projects/${projectId}`);
    await page.getByTestId('project-detail-visibility-settings').click();
    const list = page.getByTestId('project-visibility-partner-list');
    await expect(list).toBeVisible();
    await list.getByTestId(`project-visibility-partner-${partner2}`).check();
    await expectNoHorizontalOverflow('公開先の選択', page);
    await page.getByRole('dialog').getByRole('button', { name: t('projects.visibilitySettings.submit') }).click();
    await expect.poll(() => submissions.length).toBe(1);
    expect([...submissions[0]!].sort()).toEqual([partner1, partner2].sort());
    await expect(page.getByTestId('project-visibility-popup-notice')).toContainText(t('projects.visibilitySettings.result.pendingGate'));
    await page.getByTestId('project-visibility-publish-all').click();
    await expect.poll(() => submissions.length).toBe(2);
    expect([...submissions[1]!].sort()).toEqual([partner1, partner2].sort());
    await page.unroute(`**/api/projects/${projectId}/visibility`);
    await page.route(`**/api/projects/${projectId}/visibility`, (route) => route.fulfill({ status: 500 }));
    await page.getByTestId('project-visibility-publish-all').click();
    await expect(page.getByTestId('project-visibility-popup-notice')).toHaveText(t('projects.visibilitySettings.error.save'));
  } finally {
    await session.close();
  }
});
