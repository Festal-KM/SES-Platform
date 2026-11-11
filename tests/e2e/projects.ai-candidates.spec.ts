import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { t } from '../../packages/i18n/src/index';
import { apiRequest } from './support/api';
import { hostOwner, openTenantSession } from './support/sessions';
import { expectNoHorizontalOverflow } from './support/assertions';

test('候補パネルで検査済みの候補と理由を確認し、失敗を表示する', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const created = await apiRequest(page, '/api/projects', {
      method: 'POST', body: { name: `候補表示検証-${randomUUID()}` },
    });
    expect(created.status).toBe(201);
    const { id } = JSON.parse(created.text) as { id: string };
    await page.route(`**/api/projects/${id}/ai-candidates**`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ json: { runId: 'test-run' } });
      } else {
        await route.fulfill({ json: { status: 'COMPLETED', candidates: [
          { candidate: { kind: 'ANONYMOUS', key: 'test-candidate', skills: ['Java'] }, reason: 'Java の経験' },
        ] } });
      }
    });
    await page.goto(`/projects/${id}`);
    await page.getByTestId('project-detail-candidates').click();
    const panel = page.getByTestId('project-ai-candidates-panel');
    await expect(panel.getByText('Java の経験')).toBeVisible();
    await expect(panel.getByText(t('projects.aiCandidates.shared'))).toBeVisible();
    await expectNoHorizontalOverflow('案件候補パネル', page);
    await page.unroute(`**/api/projects/${id}/ai-candidates**`);
    await page.route(`**/api/projects/${id}/ai-candidates**`, (route) => route.fulfill({ status: 500 }));
    await panel.getByRole('textbox').fill('Java');
    await panel.getByRole('button', { name: t('projects.aiCandidates.send') }).click();
    await expect(panel.getByRole('alert')).toHaveText(t('projects.aiCandidates.error'));
    await expect(panel.getByText('Java の経験')).toBeVisible();
  } finally {
    await session.close();
  }
});
