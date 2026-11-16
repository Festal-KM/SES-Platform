import { expect, test } from '@playwright/test';
import { hostOwner, openTenantSession } from './support/sessions';

for (const item of [
  { kind: 'PROJECT', path: '/projects/new', field: 'project-name', label: '案件名' },
  { kind: 'ENGINEER', path: '/engineers/new', field: 'engineer-display-name', label: '氏名' },
] as const) {
  test(`${item.kind} の登録文は個人情報を送らずに入力欄へ反映する`, async ({ browser }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    const page = session.page;
    try {
      let payload: unknown;
      await page.route('**/api/ai-intake**', (route) => {
        if (route.request().method() === 'POST') {
          payload = route.request().postDataJSON();
          return route.fulfill({ status: 202, json: { runId: '11111111-1111-4111-8111-111111111111' } });
        }
        return route.fulfill({ json: { status: 'COMPLETED', skills: ['Java'] } });
      });
      await page.goto(item.path);
      await page.getByTestId('intake-text').fill(`${item.label}：検証用の名前\n単価：80万円\nJava`);
      await page.getByTestId('intake-analyze').click();
      await expect(page.getByTestId(item.field)).toHaveValue('検証用の名前');
      expect(payload).toEqual({ kind: item.kind, skills: ['Java'] });
      expect(JSON.stringify(payload)).not.toMatch(/検証用の名前|80万円/);
    } finally { await session.close(); }
  });
}


test('登録AIの実行中に手で入力した値を上書きしない', async ({ browser }) => {
  const session = await openTenantSession(browser, hostOwner(1));
  const page = session.page;
  try {
    await page.route('**/api/ai-intake**', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 202, json: { runId: '11111111-1111-4111-8111-111111111111' } })
      : route.fulfill({ json: { status: 'COMPLETED', skills: ['Java'] } }));
    await page.goto('/projects/new');
    await page.getByTestId('intake-text').fill('案件名：解析結果\nJava');
    await page.getByTestId('intake-analyze').click();
    await page.getByTestId('project-name').fill('手入力の名前');
    await expect(page.getByTestId('intake-start').getByRole('status')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveValue('手入力の名前');
  } finally { await session.close(); }
});
