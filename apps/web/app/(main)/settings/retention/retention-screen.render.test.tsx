// apps/web/app/(main)/settings/retention/retention-screen.render.test.tsx
// `RetentionScreen`（`S-042`）の状態別描画テスト（T-10-09）。
//
// 🔴 何を固定するか（docs/04 §S-042 / docs/02 `F-064 AC-5`）:
//   ① `CLOSING` では最上部に固定バナー（「解約手続き中です … あと N 日で削除されます」）が出て、`N` は view の残り日数
//   ② `ACTIVE` では「削除予定のデータはありません」、バナー無し、返却の生成ボタン無し（`CLOSING` 以外では依頼できない）
//   ③ 生成中（最新の依頼が `QUEUED` / `RUNNING`）は「生成しています」で、生成ボタンが無い
//   ④ 完了（`READY`）は「生成が完了しました」+ 履歴の行にダウンロードの導線。`FAILED` は「もう一度試す」（docs/04 §7.8）
//   ⑤ 🔴 削除を実行する導線（ボタン・リンク）が無い。セクション 1（保持期間の設定）を描かない
//   ⑥ 削除予定の一覧は `PURGE_SPEC.delete` の表ごとに 1 行（種別 / 件数 / 削除予定日）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` + `createElement`（`usage-screen.render.test.tsx` と同じ理由）。
//    `useRouter` は `next/navigation` のモックで差し替える（`router.refresh()` は再読の合図であり、描画には関係しない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PURGE_SPEC } from '@ses/config';
import type { RetentionView } from '../../../../lib/retention/view';
import { RetentionScreen, type RetentionScreenMessages } from './retention-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const kindLabels = Object.fromEntries(PURGE_SPEC.delete.map((spec) => [spec.table, `種別:${spec.table}`])) as RetentionScreenMessages['scheduleKindLabels'];

const messages: RetentionScreenMessages = {
  lead: 'リード',
  readOnlyNote: '削除は期限到来時にシステムが実行します。',
  bannerClosingPrefix: '解約手続き中です。新しいデータの作成はできません。返却と閲覧のみ実行できます。あと ',
  bannerClosingSuffix: ' 日で削除されます',
  bannerSuspended: '利用停止中です。',
  sectionSchedule: '削除予定のデータ',
  scheduleEmpty: '削除予定のデータはありません',
  scheduleLead: '削除予定日に次のデータが削除されます。',
  scheduleColumnKind: '対象種別',
  scheduleColumnCount: '件数',
  scheduleColumnScheduledOn: '削除予定日',
  scheduleUnit: '件',
  scheduleKindLabels: kindLabels,
  sectionExport: 'データの返却（CSV）',
  exportLead: '返却のリード',
  exportNotClosing: '返却データの生成は、解約手続き中のテナントで実行できます。',
  exportGenerate: '返却データを生成する',
  exportGenerating: '生成しています（数分かかります）',
  exportGenerated: '生成が完了しました',
  exportDownload: 'ダウンロード',
  exportDownloading: 'ダウンロードの準備をしています',
  exportFailed: '生成できませんでした',
  exportRetry: 'もう一度試す',
  exportRequestFailed: '受け付けられませんでした',
  exportDownloadFailed: 'ダウンロードの準備ができませんでした',
  exportExpired: '有効期限が切れています',
  sectionHistory: '実行履歴',
  historyEmpty: '返却データはまだ生成されていません',
  historyColumnRequestedAt: '依頼日時',
  historyColumnStatus: '状態',
  historyColumnExpiresAt: 'ダウンロード期限',
  historyColumnAction: '操作',
  statusLabels: { QUEUED: '生成待ち', RUNNING: '生成中', READY: '生成済み', FAILED: '失敗', EXPIRED: '期限切れ' },
};

const targets = PURGE_SPEC.delete.map((spec, index) => ({ table: spec.table, count: index }));

function closingView(exports: RetentionView['exports'] = []): RetentionView {
  return { lifecycleState: 'CLOSING', purge: { scheduledOn: '2026-10-01', daysUntil: 12 }, targets, exports };
}

function render(view: RetentionView): string {
  return renderToStaticMarkup(createElement(RetentionScreen, { view, messages }));
}

describe('RetentionScreen（S-042）', () => {
  it('① CLOSING: 固定バナーに残り日数が出て、削除予定の一覧が PURGE_SPEC.delete の表ごとに 1 行', () => {
    const html = render(closingView());
    expect(html).toContain('data-testid="retention-banner-closing"');
    expect(html).toContain('あと <span data-testid="retention-banner-days">12</span> 日で削除されます');
    expect(html).toContain('data-testid="retention-schedule-table"');
    for (const spec of PURGE_SPEC.delete) {
      expect(html).toContain(`data-testid="retention-schedule-row-${spec.table}"`);
      expect(html).toContain(`種別:${spec.table}`);
    }
    expect(html).toContain('2026-10-01');
    expect(html).not.toContain('data-testid="retention-schedule-empty"');
    expect(html).not.toContain('data-testid="retention-banner-suspended"');
  });

  it('② ACTIVE: 空状態。バナー無し・生成ボタン無し（CLOSING 以外では依頼できない）', () => {
    const html = render({ lifecycleState: 'ACTIVE', purge: null, targets: targets.map((t) => ({ ...t, count: 0 })), exports: [] });
    expect(html).toContain('削除予定のデータはありません');
    expect(html).not.toContain('data-testid="retention-banner-closing"');
    expect(html).not.toContain('data-testid="retention-export-generate"');
    expect(html).toContain('data-testid="retention-export-not-closing"');
    expect(html).toContain('data-testid="retention-history-empty"');
  });

  it('SUSPENDED: 停止中の帯（データは消えていない旨）。削除予定は空', () => {
    const html = render({ lifecycleState: 'SUSPENDED', purge: null, targets: [], exports: [] });
    expect(html).toContain('data-testid="retention-banner-suspended"');
    expect(html).toContain('利用停止中です。');
    expect(html).toContain('削除予定のデータはありません');
  });

  it('③ 生成中: 「生成しています」で、生成ボタンが無い', () => {
    const html = render(
      closingView([{ id: 'r-1', status: 'RUNNING', requestedAt: '2026-09-20T00:00:00.000Z', readyAt: null, expiresAt: null }]),
    );
    expect(html).toContain('data-testid="retention-export-generating"');
    expect(html).toContain('生成しています');
    expect(html).not.toContain('data-testid="retention-export-generate"');
    expect(html).toContain('data-testid="retention-history-status-r-1"');
    expect(html).toContain('生成中');
  });

  it('④ 完了: 「生成が完了しました」+ 履歴の行にダウンロードの導線。FAILED は「もう一度試す」', () => {
    const ready = render(
      closingView([
        { id: 'r-2', status: 'READY', requestedAt: '2026-09-20T00:00:00.000Z', readyAt: '2026-09-20T00:01:00.000Z', expiresAt: '2026-09-27T00:01:00.000Z' },
      ]),
    );
    expect(ready).toContain('data-testid="retention-export-generated"');
    expect(ready).toContain('data-testid="retention-history-download-r-2"');
    expect(ready).toContain('data-testid="retention-export-generate"');
    expect(ready).toContain('返却データを生成する');

    const failed = render(
      closingView([{ id: 'r-3', status: 'FAILED', requestedAt: '2026-09-20T00:00:00.000Z', readyAt: null, expiresAt: null }]),
    );
    expect(failed).toContain('data-testid="retention-export-failed"');
    expect(failed).toContain('もう一度試す');
    expect(failed).not.toContain('data-testid="retention-history-download-r-3"');
  });

  it('🔴 ⑤ 削除を実行する導線が無く、保持期間の設定（セクション 1）を描かない', () => {
    const html = render(closingView());
    expect(html).not.toMatch(/data-testid="retention-(purge|delete)/);
    expect(html).not.toContain('保持期間の設定');
    expect(html).not.toContain('retention-years');
    expect(html).toContain('削除は期限到来時にシステムが実行します。');
  });
});
