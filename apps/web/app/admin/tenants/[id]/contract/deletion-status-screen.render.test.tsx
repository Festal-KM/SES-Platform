// apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.render.test.tsx
// `DeletionStatusScreen`（`A-010` セクション 4「削除完了の確認」）の描画テスト。T-10-10。
//
// 🔴 `docs/04` §A-010 の状態表を固定する:
//   ① 実行なし → 「削除は実行されていません」（`CLOSING` なら期限到来後に実行される旨の注記。他の状態では注記なし）
//   ② `RUNNING`（最新）→ 「削除処理中」+ 未完了の注記。件数の表は出ない
//   ③ `COMPLETED`（最新）→ 「削除完了（YYYY-MM-DD、対象 N 件）」（日付は JST の暦日。N = 表ごとの件数の合計）+ 対象種別ごとの内訳
//   ④ `FAILED`（最新）→ 「削除処理に失敗しています」+ `A-005` への導線。件数の表は出ない
//   ⑤ 履歴は新しい順に全部（再試行の FAILED → COMPLETED が両方載る）
//   ⑥ 🔴 表示は状態・日時・件数だけ。`failureReason` / 返却データ / 削除された内容に相当する文字列・導線が HTML に無い。
//      セクション 1〜3（停止 / 解約 / プラン / 請求）の語・「閲覧のみ」バッジ・操作ボタンが無い
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（他の `*.render.test.tsx` と同じ）。
// 🔴 文言は `packages/i18n` の実物を `_lib/messages.ts` 経由で使う。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeletionStatusRunView, DeletionStatusView } from '@ses/db/platform';
import { t } from '@ses/i18n';
import { deletionStatusMessages } from './_lib/messages';
import { DeletionStatusScreen } from './deletion-status-screen';

const TENANT = '01930000-0000-7000-8000-0000000010a1';

function run(over: Partial<DeletionStatusRunView> & { readonly status: DeletionStatusRunView['status'] }): DeletionStatusRunView {
  return {
    cause: 'TENANT_PURGED',
    startedAt: '2026-09-29T17:10:00.000Z',
    completedAt: null,
    counts: {},
    ...over,
  };
}

function render(view: Partial<DeletionStatusView> = {}): string {
  const full: DeletionStatusView = { tenantId: TENANT, lifecycleState: 'PURGED', purgeRuns: [], ...view };
  return renderToStaticMarkup(
    createElement(DeletionStatusScreen, { view: full, messages: deletionStatusMessages(full.lifecycleState) }),
  );
}

/** 🔴 画面に現れてはならない語（返却データ / 削除された内容 / 失敗理由 / Phase 3 の操作 / バッジ）。 */
const FORBIDDEN_FRAGMENTS = [
  'failureReason',
  'T1010-failure-reason',
  'downloadUrl',
  'object_key',
  '.csv',
  '.zip',
  t('admin.readOnly.badge'),
  '停止',
  '解約する',
  'プラン変更',
  '請求',
  '準備中',
  '<button',
  '<form',
] as const;

describe('A-010 セクション 4 削除完了の確認（docs/04 §A-010 / F-062 AC-7）', () => {
  it('① 実行なし: 「削除は実行されていません」。CLOSING なら期限到来後の注記、PURGED / ACTIVE では注記なし', () => {
    const closing = render({ lifecycleState: 'CLOSING' });
    expect(closing).toContain('data-testid="admin-deletion-status-none"');
    expect(closing).toContain(t('admin.deletionStatus.none'));
    expect(closing).toContain(t('admin.deletionStatus.none.closing'));
    expect(closing).toContain(t('admin.tenants.lifecycleState.CLOSING'));
    expect(closing).not.toContain('admin-deletion-status-history');

    for (const lifecycleState of ['PURGED', 'ACTIVE'] as const) {
      const html = render({ lifecycleState });
      expect(html).toContain(t('admin.deletionStatus.none'));
      expect(html).not.toContain(t('admin.deletionStatus.none.closing'));
    }
  });

  it('② RUNNING: 「削除処理中」+ 未完了の注記。件数の内訳は出ない（counts は完了時に確定する）', () => {
    const html = render({ purgeRuns: [run({ status: 'RUNNING' })] });
    expect(html).toContain('data-testid="admin-deletion-status-running"');
    expect(html).toContain(t('admin.deletionStatus.running'));
    expect(html).toContain(t('admin.deletionStatus.running.note'));
    expect(html).not.toContain('admin-deletion-status-breakdown');
    expect(html).not.toContain(t('admin.deletionStatus.completed.prefix'));
    // 履歴には「処理中（未完了）」として載る。
    expect(html).toContain('data-testid="admin-deletion-status-run-RUNNING"');
    expect(html).toContain(t('admin.deletionStatus.status.RUNNING'));
  });

  it('③ COMPLETED: 「削除完了（YYYY-MM-DD、対象 N 件）」（JST の暦日・合計件数）+ 対象種別ごとの内訳', () => {
    const html = render({
      purgeRuns: [
        run({
          status: 'COMPLETED',
          startedAt: '2026-09-29T17:10:00.000Z',
          // UTC 29 日 17:30 = JST 30 日 02:30 → 表示は 2026-09-30（docs/04 の例と同じ暦日の扱い）。
          completedAt: '2026-09-29T17:30:00.000Z',
          counts: { engineers: 12, skill_sheets: 7, messages: 3 },
        }),
      ],
    });
    expect(html).toContain('data-testid="admin-deletion-status-completed"');
    expect(html).toContain(
      `${t('admin.deletionStatus.completed.prefix')}2026-09-30${t('admin.deletionStatus.completed.countPrefix')}<span data-testid="admin-deletion-status-total">22</span>${t('admin.deletionStatus.completed.countSuffix')}`,
    );
    expect(html).toContain('data-testid="admin-deletion-status-breakdown"');
    expect(html).toContain('data-testid="admin-deletion-status-count-engineers"');
    expect(html).toContain('data-testid="admin-deletion-status-count-skill_sheets"');
    expect(html).toContain('data-testid="admin-deletion-status-count-messages"');
    expect(html).toContain('data-testid="admin-deletion-status-run-COMPLETED"');
    expect(html).toContain(t('admin.deletionStatus.cause.TENANT_PURGED'));
  });

  it('④ FAILED: 「削除処理に失敗しています」+ A-005 への導線（/admin/monitoring）。件数の内訳は出ない', () => {
    const html = render({ purgeRuns: [run({ status: 'FAILED' })] });
    expect(html).toContain('data-testid="admin-deletion-status-failed"');
    expect(html).toContain(t('admin.deletionStatus.failed'));
    expect(html).toContain(t('admin.deletionStatus.failed.note'));
    expect(html).toContain('data-testid="admin-deletion-status-monitoring-link"');
    expect(html).toContain('href="/admin/monitoring"');
    expect(html).not.toContain('admin-deletion-status-breakdown');
  });

  it('⑤ 履歴は新しい順に全部（FAILED のあと再試行で COMPLETED）。見出しは最新（先頭）で決まる', () => {
    const html = render({
      purgeRuns: [
        run({ status: 'COMPLETED', startedAt: '2026-09-30T00:00:00.000Z', completedAt: '2026-09-30T00:05:00.000Z', counts: { engineers: 1 } }),
        run({ status: 'FAILED', startedAt: '2026-09-29T00:00:00.000Z' }),
      ],
    });
    expect(html).toContain('data-testid="admin-deletion-status-completed"');
    expect(html).not.toContain('data-testid="admin-deletion-status-failed"');
    const completedAt = html.indexOf('data-testid="admin-deletion-status-run-COMPLETED"');
    const failedAt = html.indexOf('data-testid="admin-deletion-status-run-FAILED"');
    expect(completedAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(completedAt);
  });

  it('🔴 ⑥ 表示は状態・日時・件数だけ。失敗理由・返却データ・削除された内容・Phase 3 の操作・「閲覧のみ」バッジ・ボタンが無い', () => {
    const htmls = [
      render({ lifecycleState: 'CLOSING' }),
      render({ purgeRuns: [run({ status: 'RUNNING' })] }),
      render({ purgeRuns: [run({ status: 'COMPLETED', completedAt: '2026-09-30T00:00:00.000Z', counts: { engineers: 5 } })] }),
      render({ purgeRuns: [run({ status: 'FAILED' })] }),
    ];
    for (const html of htmls) {
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        expect(html, `禁止語 ${fragment}`).not.toContain(fragment);
      }
      expect(html).toContain(t('admin.deletionStatus.title'));
      expect(html).toContain(t('admin.deletionStatus.lead'));
      expect(html).toContain(`href="/admin/tenants/${TENANT}"`);
    }
  });
});
