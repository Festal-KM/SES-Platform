// apps/web/app/admin/monitoring/admin-monitoring-items.render.test.tsx
// `AdminMonitoringItems`（`A-005` の監視項目）の描画テスト。T-11-04。
//
// 🔴 `docs/04` §A-005 の状態表と色分けを固定する:
//   ① 全項目 0 件 → 「異常は検知されていません」+ 各項目の「本日の照合」を 0 件として明示（空画面にしない）
//   ② 🔴 空の表現 3 種 — 項目 13 は 0 件ではなく消費率（「本日の送信: N / 上限 M 通（X%）— 保留 0 件」）、
//      項目 14 は「保留中の送信はありません」、項目 15 は「削除待ちのテナントはありません」
//   ③ 🔴 色分け — 保留（項目 12 の AI_COST_LIMIT_HELD / 13 / 14 / 15 / 16）は `warning`、障害（1 / 2 / 3 / 4 / 7 / 12 の JOB_FAILED /
//      RUNNING_OVERDUE / スケジューラ停止 / 17 の REACHED）は `danger`。**保留を障害の色にしない**
//   ④ `{ ok: false }` は「取得できませんでした」を項目単位で出し、他の項目は出る（0 件と表示しない）
//   ⑤ 導線 — テナント行は `A-003`、`RATE_LIMIT` / `AI_COST_LIMIT_HELD` はクォータの導線、項目 13 / 14 の PROVIDER_QUOTA / 16 / 17 は無し。
//      🔴 再送 / retry / 再実行のボタンが 1 つも無い。`targetId` はリンクにならない
//   ⑥ 項目 12 で失敗記録を照合できないときは「失敗記録を照合できていません」を出し、応答不明に畳まない
//   ⑦ 項目 17 の REACHED は専用の帯（単一テナントの上限到達と混ぜない）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（他の `*.render.test.tsx` と同じ）。
// 🔴 文言は `packages/i18n` の実物を `_lib/messages.ts` 経由で使う（表示文言の変更で落ちるのは意図どおり: 空の表現が仕様だから）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MonitoringItemView, MonitoringPayloadByKind, MonitoringSnapshotView } from '../../../lib/admin-monitoring/view';
import { MONITORING_KINDS, type MonitoringKind } from '../../../lib/admin-monitoring/view';
import { adminMonitoringMessages } from './_lib/messages';
import { AdminMonitoringItems } from './admin-monitoring-items';

const NOW = '2026-09-16T09:00:00.000Z';
const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';
const PROPOSAL_ID = '01930000-0000-7000-8000-000000000111';

const EMPTY_RATE = { done: 0, failed: 0, rate: null } as const;

const OK_PAYLOADS: MonitoringPayloadByKind = {
  SUBMIT_FAILED_UNATTENDED: { rows: [], total: 0 },
  SUBMITTING_STALL: { rows: [], total: 0, stallThresholdMinutes: 30 },
  FAILED_JOBS: { byQueue: [{ queueName: 'email.dispatch', count: 0, lastFailedAt: null }], total: 0 },
  SCAN_FAILED: { rows: [], total: 0, scanningStalled: { count: 0, oldestUploadedAt: null }, scanStallThresholdMinutes: 10 },
  GATE_FAIL_RATE: { rows: [], recent: EMPTY_RATE, baseline: EMPTY_RATE, windowHours: 24, baselineDays: 7 },
  USAGE_MEASUREMENT: { countsByKind: { GAP_MISSING: 0, GAP_MISMATCH: 0, STORAGE_DIVERGENCE: 0 }, items: [] },
  PURGE_JOB_FAILED: { rows: [], total: 0, runningOverdue: { kind: 'RUNNING_OVERDUE', rows: [], total: 0, stallThresholdMinutes: 30 } },
  SENDING_DOMAIN_UNVERIFIED: { items: [], countsByStatus: { NOT_REGISTERED: 0, REGISTERED: 0, PENDING: 0, FAILED: 0, REVOKED: 0 }, total: 0 },
  GATE_STALL: {
    stallThresholdMinutes: 30,
    countsByReason: { AI_COST_LIMIT_HELD: 0, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
    rows: [],
    total: 0,
    failedJobsAvailable: true,
    unclassifiedOverdue: 0,
  },
  MAIL_PROVIDER_QUOTA: {
    scope: 'ENVIRONMENT',
    providerReading: { available: true, max24h: 50_000, sentLast24h: 37, consumptionRate: 0.185, observedAt: NOW },
    envLimit: 200,
    warnRatio: 0.8,
    reachedAt: null,
    nearingSince: null,
    heldCount: 0,
  },
  SEND_HOLD: {
    byReason: {
      RATE_LIMIT: { scope: 'TENANT', rows: [] },
      DOMAIN_UNVERIFIED: { scope: 'TENANT', rows: [] },
      ESIGN_DISCONNECTED: { scope: 'TENANT', rows: [] },
      TENANT_SUSPENDED: { scope: 'TENANT', rows: [] },
      GATE_STALE: { scope: 'TENANT', rows: [] },
      AI_COST_LIMIT: { scope: 'TENANT', rows: [] },
      PROVIDER_QUOTA: { scope: 'ENVIRONMENT', proposals: 0, contracts: 0, oldestSince: null },
    },
    total: 0,
  },
  PURGE_NOTICE_PENDING: { rows: [], total: 0, graceDays: 30 },
  MAIL_DISPATCH_STUCK: { count: 0, oldestSince: null, stallThresholdMinutes: 15, countIsLowerBound: false },
  PROVIDER_SPEND: { scope: 'ENVIRONMENT', periodKey: '2026-09', spentUsd: '12.500000', capUsd: '500.000000', consumptionRate: 0.025, level: 'BELOW', tenantCount: 3 },
  SCHEDULER_HEARTBEAT: { lastRunAt: NOW, staleHours: 24, stalled: false },
};

function snapshot(overrides: Partial<{ [K in MonitoringKind]: MonitoringItemView<K> }> = {}): MonitoringSnapshotView {
  const items = MONITORING_KINDS.map((kind) => {
    const override = overrides[kind];
    if (override !== undefined) return override as MonitoringItemView;
    return { kind, ok: true, ...OK_PAYLOADS[kind] } as MonitoringItemView;
  });
  return { observedAt: NOW, items };
}

function render(view: MonitoringSnapshotView): string {
  return renderToStaticMarkup(createElement(AdminMonitoringItems, { snapshot: view, messages: adminMonitoringMessages() }));
}

/** `data-testid="…"` の要素の開始タグから `data-severity` の値を取る。 */
function severityOf(html: string, kind: MonitoringKind): string | null {
  const match = new RegExp(`data-testid="admin-monitoring-item-${kind}"[^>]*data-severity="([a-z]+)"`).exec(html);
  return match?.[1] ?? null;
}

function badgeVariantOf(html: string, kind: MonitoringKind): 'danger' | 'warning' | 'success' | 'outline' | null {
  const match = new RegExp(`<span class="([^"]*)"[^>]*data-testid="admin-monitoring-item-${kind}-severity"`).exec(html);
  const classes = match?.[1] ?? '';
  if (classes.includes('bg-red-100')) return 'danger';
  if (classes.includes('bg-amber-100')) return 'warning';
  if (classes.includes('bg-emerald-100')) return 'success';
  if (classes.includes('border-slate-300')) return 'outline';
  return null;
}

describe('① 全項目 0 件（docs/04 §A-005 空状態）', () => {
  const html = render(snapshot());

  it('「異常は検知されていません」が出て、全項目のセクションが項目表の順に存在する', () => {
    expect(html).toContain('data-testid="admin-monitoring-all-clear"');
    expect(html).toContain('異常は検知されていません');
    const positions = MONITORING_KINDS.map((kind) => html.indexOf(`data-testid="admin-monitoring-item-${kind}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('各項目の「本日の照合」が 0 件として明示される（空画面にしない）', () => {
    for (const kind of ['SUBMIT_FAILED_UNATTENDED', 'SUBMITTING_STALL', 'FAILED_JOBS', 'SCAN_FAILED', 'PURGE_JOB_FAILED', 'GATE_STALL'] as const) {
      expect(html, kind).toContain(`data-testid="admin-monitoring-item-${kind}-empty"`);
    }
    expect(html).toContain('本日の照合: 未対応の送信失敗 0 件');
    expect(html).toContain('本日の照合: 失敗ジョブ 0 件（全キューを照合）');
    expect(html).toContain('最終更新');
  });

  it('全項目が成立（success）の色', () => {
    for (const kind of MONITORING_KINDS) {
      expect(severityOf(html, kind), kind).toBe('ok');
      expect(badgeVariantOf(html, kind), kind).toBe('success');
    }
  });
});

describe('🔴 T-12-17 ⑱ 項目 7: RUNNING の滞留は FAILED とは別区分で出る（完了の事実は出さない）', () => {
  it('RUNNING_OVERDUE の行だけ（FAILED 0 件）→ 失敗の表は「0 件」のまま、別区分の表に件数・原因・開始・経過が出て、重さは hold', () => {
    const html = render(
      snapshot({
        PURGE_JOB_FAILED: {
          kind: 'PURGE_JOB_FAILED',
          ok: true,
          rows: [],
          total: 0,
          runningOverdue: {
            kind: 'RUNNING_OVERDUE',
            rows: [{ tenantId: TENANT_A, cause: 'RETENTION', runningCount: 1, oldestStartedAt: NOW, longestRunningMinutes: 95 }],
            total: 1,
            stallThresholdMinutes: 30,
          },
        },
      }),
    );
    expect(html).toContain('data-testid="admin-monitoring-item-PURGE_JOB_FAILED-empty"');
    expect(html).toContain('data-testid="admin-monitoring-purge-running-overdue-table"');
    expect(html).toContain(`data-testid="admin-monitoring-purge-running-overdue-row-${TENANT_A}"`);
    expect(html).toContain('実行中のまま閾値を超えた削除ジョブ');
    expect(html).toContain('閾値: 30 分');
    expect(html).toContain('95 分');
    expect(html).toContain('失敗ではありません');
    expect(html).not.toContain('data-testid="admin-monitoring-purge-running-overdue-empty"');
    expect(severityOf(html, 'PURGE_JOB_FAILED')).toBe('hold');
    expect(html).not.toContain('data-testid="admin-monitoring-all-clear"');
    // 🔴 完了の事実・件数の内訳・失敗理由に相当する語が無い。
    expect(html).not.toContain('削除完了（');
    expect(html).not.toContain('engineerContacts');
  });

  it('FAILED と RUNNING_OVERDUE が両方あるとき、失敗の表と別区分の表が別々に出て、失敗の重さ（failure）が勝つ', () => {
    const html = render(
      snapshot({
        PURGE_JOB_FAILED: {
          kind: 'PURGE_JOB_FAILED',
          ok: true,
          rows: [{ tenantId: TENANT_B, cause: 'RETENTION', failedCount: 2, lastFailedAt: NOW }],
          total: 2,
          runningOverdue: {
            kind: 'RUNNING_OVERDUE',
            rows: [{ tenantId: TENANT_A, cause: 'TENANT_PURGED', runningCount: 1, oldestStartedAt: NOW, longestRunningMinutes: 40 }],
            total: 1,
            stallThresholdMinutes: 30,
          },
        },
      }),
    );
    expect(html).not.toContain('data-testid="admin-monitoring-item-PURGE_JOB_FAILED-empty"');
    expect(html).toContain('data-testid="admin-monitoring-purge-running-overdue-table"');
    expect(severityOf(html, 'PURGE_JOB_FAILED')).toBe('failure');
  });

  it('0 件のときは別区分も「0 件」と明示する', () => {
    const html = render(snapshot());
    expect(html).toContain('data-testid="admin-monitoring-purge-running-overdue-empty"');
    expect(html).toContain('実行中のまま閾値を超えた削除ジョブ 0 件');
  });
});

describe('② 🔴 空の表現 3 種（項目 13 / 14 / 15）', () => {
  const html = render(snapshot());

  it('項目 13 は 0 件ではなく消費率で成立を示す', () => {
    expect(html).toContain('data-testid="admin-monitoring-mail-provider-summary"');
    expect(html).toContain('本日の送信: 37 / 上限 200 通（19%）— 保留 0 件');
    expect(html).not.toContain('data-testid="admin-monitoring-item-MAIL_PROVIDER_QUOTA-empty"');
    // 環境全体の値であり、テナントの導線を持たない。
    const section = html.slice(html.indexOf('admin-monitoring-item-MAIL_PROVIDER_QUOTA"'), html.indexOf('admin-monitoring-item-SEND_HOLD"'));
    expect(section).toContain('−（環境全体）');
    expect(section).not.toContain('/admin/tenants/');
  });

  it('項目 14 の 0 件は「保留中の送信はありません」', () => {
    expect(html).toContain('保留中の送信はありません');
  });

  it('項目 15 の 0 件は「削除待ちのテナントはありません」', () => {
    expect(html).toContain('削除待ちのテナントはありません');
  });

  it('項目 17 は BELOW でも行を出し、消費率で成立を示す', () => {
    expect(html).toContain('data-testid="admin-monitoring-provider-spend-summary"');
    expect(html).toContain('当月 $12.500000 / 上限 $500.000000（3%）— 3 テナント');
    expect(html).not.toContain('data-testid="admin-monitoring-provider-spend-reached"');
  });
});

describe('③ 🔴 色分け — 保留は障害の色にしない（CLAUDE.md §4.2 / F-059 AC-6 / AC-7）', () => {
  const html = render(
    snapshot({
      SUBMIT_FAILED_UNATTENDED: { kind: 'SUBMIT_FAILED_UNATTENDED', ok: true, rows: [{ tenantId: TENANT_A, count: 2, oldestSince: NOW }], total: 2 },
      SUBMITTING_STALL: {
        kind: 'SUBMITTING_STALL',
        ok: true,
        rows: [{ tenantId: TENANT_A, count: 1, oldestSince: NOW, longestStalledMinutes: 45 }],
        total: 1,
        stallThresholdMinutes: 30,
      },
      FAILED_JOBS: { kind: 'FAILED_JOBS', ok: true, byQueue: [{ queueName: 'usage.gap-check', count: 3, lastFailedAt: NOW }], total: 3 },
      GATE_STALL: {
        kind: 'GATE_STALL',
        ok: true,
        stallThresholdMinutes: 30,
        countsByReason: { AI_COST_LIMIT_HELD: 1, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
        rows: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_ID, reason: 'AI_COST_LIMIT_HELD', since: NOW, stalledMinutes: 80 }],
        total: 1,
        failedJobsAvailable: true,
        unclassifiedOverdue: 0,
      },
      MAIL_PROVIDER_QUOTA: {
        kind: 'MAIL_PROVIDER_QUOTA',
        ok: true,
        scope: 'ENVIRONMENT',
        providerReading: { available: true, max24h: 50_000, sentLast24h: 200, consumptionRate: 1, observedAt: NOW },
        envLimit: 200,
        warnRatio: 0.8,
        reachedAt: NOW,
        nearingSince: NOW,
        heldCount: 4,
      },
      SEND_HOLD: {
        kind: 'SEND_HOLD',
        ok: true,
        byReason: {
          ...OK_PAYLOADS.SEND_HOLD.byReason,
          RATE_LIMIT: { scope: 'TENANT', rows: [{ tenantId: TENANT_B, proposals: 2, contracts: 0, oldestSince: NOW }] },
          PROVIDER_QUOTA: { scope: 'ENVIRONMENT', proposals: 3, contracts: 1, oldestSince: NOW },
        },
        total: 6,
      },
      PURGE_NOTICE_PENDING: { kind: 'PURGE_NOTICE_PENDING', ok: true, rows: [{ tenantId: TENANT_B, cause: 'NOTICE_PENDING', overdueDays: 2 }], total: 1, graceDays: 30 },
      MAIL_DISPATCH_STUCK: { kind: 'MAIL_DISPATCH_STUCK', ok: true, count: 2, oldestSince: NOW, stallThresholdMinutes: 15, countIsLowerBound: false },
      SCHEDULER_HEARTBEAT: { kind: 'SCHEDULER_HEARTBEAT', ok: true, lastRunAt: '2026-09-14T09:00:00.000Z', staleHours: 24, stalled: true },
    }),
  );

  it('障害（1 / 2 / 3 / スケジューラ停止）は danger', () => {
    for (const kind of ['SUBMIT_FAILED_UNATTENDED', 'SUBMITTING_STALL', 'FAILED_JOBS', 'SCHEDULER_HEARTBEAT'] as const) {
      expect(severityOf(html, kind), kind).toBe('failure');
      expect(badgeVariantOf(html, kind), kind).toBe('danger');
    }
  });

  it('🔴 保留（12 の AI_COST_LIMIT_HELD / 13 / 14 / 15 / 16）は warning であり danger ではない', () => {
    for (const kind of ['GATE_STALL', 'MAIL_PROVIDER_QUOTA', 'SEND_HOLD', 'PURGE_NOTICE_PENDING', 'MAIL_DISPATCH_STUCK'] as const) {
      expect(severityOf(html, kind), kind).toBe('hold');
      expect(badgeVariantOf(html, kind), kind).toBe('warning');
    }
  });

  it('「異常は検知されていません」は出ない', () => {
    expect(html).not.toContain('data-testid="admin-monitoring-all-clear"');
  });

  it('⑤ 導線: テナント行は A-003、RATE_LIMIT / AI_COST_LIMIT_HELD はクォータの導線。PROVIDER_QUOTA 行は「−（環境全体）」で導線なし', () => {
    expect(html).toContain(`href="/admin/tenants/${TENANT_A}"`);
    const rateLimitRow = html.slice(html.indexOf('data-testid="admin-monitoring-send-hold-RATE_LIMIT"'), html.indexOf('data-testid="admin-monitoring-send-hold-PROVIDER_QUOTA"'));
    expect(rateLimitRow).toContain('クォータ');
    const providerRow = html.slice(html.indexOf('data-testid="admin-monitoring-send-hold-PROVIDER_QUOTA"'));
    const providerRowEnd = providerRow.indexOf('</tr>');
    expect(providerRow.slice(0, providerRowEnd)).toContain('−（環境全体）');
    expect(providerRow.slice(0, providerRowEnd)).not.toContain('href=');
    // 項目 12 の保留行はクォータの導線。
    const heldRow = html.slice(html.indexOf('data-testid="admin-monitoring-gate-stall-AI_COST_LIMIT_HELD"'));
    expect(heldRow.slice(0, heldRow.indexOf('</tr>'))).toContain('クォータ');
  });

  it('🔴 ⑤ 再送 / retry / 再実行のボタンが 1 つも無く、targetId はリンクにならない', () => {
    expect(html).not.toMatch(/<button/);
    // 注記の文（「再送の操作はありません」）は出てよい。導線（リンク・ボタン）の文言としては 1 つも無い。
    expect(html).not.toMatch(/<(?:button|a)(?:\s[^>]*)?>[^<]*(?:再送|再実行|retry|リトライ)/);
    expect(html).toContain(`PROPOSAL:${PROPOSAL_ID}`);
    expect(html).not.toMatch(new RegExp(`href="[^"]*${PROPOSAL_ID}`));
  });

  it('項目 13 の到達は消費率 100% と保留件数・到達時刻で示す（0 件と表示しない）', () => {
    expect(html).toContain('本日の送信: 200 / 上限 200 通（100%）— 保留 4 件');
  });
});

describe('④ { ok: false } は項目単位で「取得できませんでした」', () => {
  const html = render(
    snapshot({
      FAILED_JOBS: { kind: 'FAILED_JOBS', ok: false, errorKind: 'QUEUE_READ_FAILED' },
      MAIL_PROVIDER_QUOTA: { kind: 'MAIL_PROVIDER_QUOTA', ok: false, errorKind: 'PROVIDER_READ_FAILED' },
    }),
  );

  it('失敗した項目に「取得できませんでした」と理由の種別が出る', () => {
    expect(html).toContain('data-testid="admin-monitoring-item-FAILED_JOBS-unavailable"');
    expect(html).toContain('ジョブキュー（Redis）の失敗記録を読めませんでした。');
    expect(html).toContain('data-testid="admin-monitoring-item-MAIL_PROVIDER_QUOTA-unavailable"');
    expect(severityOf(html, 'FAILED_JOBS')).toBe('unavailable');
    expect(badgeVariantOf(html, 'FAILED_JOBS')).toBe('outline');
  });

  it('失敗した項目は 0 件として表示されず、他の項目は出る。「異常は検知されていません」も出ない', () => {
    expect(html).not.toContain('data-testid="admin-monitoring-item-FAILED_JOBS-empty"');
    expect(html).toContain('data-testid="admin-monitoring-item-SEND_HOLD-empty"');
    expect(html).toContain('data-testid="admin-monitoring-provider-spend-summary"');
    expect(html).not.toContain('data-testid="admin-monitoring-all-clear"');
  });

  it('🔴 T-12-17 ⑦: 項目 13 の DB_READ_FAILED と PROVIDER_READ_FAILED は別の語で出る（「上限を確認できていません」とも別）', () => {
    const dbFailed = render(
      snapshot({ MAIL_PROVIDER_QUOTA: { kind: 'MAIL_PROVIDER_QUOTA', ok: false, errorKind: 'DB_READ_FAILED' } }),
    );
    const section = (page: string) => {
      const start = page.indexOf('data-testid="admin-monitoring-item-MAIL_PROVIDER_QUOTA"');
      return page.slice(start, page.indexOf('</section>', start));
    };
    expect(section(dbFailed)).toContain('データベースの読み取りに失敗しました。');
    expect(section(dbFailed)).not.toContain('送信基盤のカウンタ（Redis）を読めませんでした。');
    expect(section(dbFailed)).not.toContain('上限を確認できていません');
    expect(section(html)).toContain('送信基盤のカウンタ（Redis）を読めませんでした。');
    expect(section(html)).not.toContain('データベースの読み取りに失敗しました。');
  });
});

describe('⑥ 項目 12: 失敗記録を照合できないときは応答不明に畳まない', () => {
  it('「失敗記録を照合できていません」+ 判定できない件数を出し、保留行だけが表に残る', () => {
    const html = render(
      snapshot({
        GATE_STALL: {
          kind: 'GATE_STALL',
          ok: true,
          stallThresholdMinutes: 30,
          countsByReason: { AI_COST_LIMIT_HELD: 1, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
          rows: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_ID, reason: 'AI_COST_LIMIT_HELD', since: NOW, stalledMinutes: 80 }],
          total: 1,
          failedJobsAvailable: false,
          unclassifiedOverdue: 2,
        },
      }),
    );
    expect(html).toContain('data-testid="admin-monitoring-gate-stall-failed-jobs-unavailable"');
    expect(html).toContain('失敗記録を照合できていません');
    expect(html).toContain('2 件');
    expect(html).not.toContain('data-testid="admin-monitoring-gate-stall-RUNNING_OVERDUE"');
    expect(severityOf(html, 'GATE_STALL')).toBe('failure');
  });

  it('JOB_FAILED / RUNNING_OVERDUE は障害の色で、応答不明にはワーカー確認の注記', () => {
    const html = render(
      snapshot({
        GATE_STALL: {
          kind: 'GATE_STALL',
          ok: true,
          stallThresholdMinutes: 30,
          countsByReason: { AI_COST_LIMIT_HELD: 0, JOB_FAILED: 1, RUNNING_OVERDUE: 1 },
          rows: [
            { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_ID, reason: 'JOB_FAILED', since: NOW, stalledMinutes: 59 },
            { tenantId: TENANT_B, targetType: 'PROPOSAL', targetId: '01930000-0000-7000-8000-000000000113', reason: 'RUNNING_OVERDUE', since: NOW, stalledMinutes: 45 },
          ],
          total: 2,
          failedJobsAvailable: true,
          unclassifiedOverdue: 0,
        },
      }),
    );
    expect(severityOf(html, 'GATE_STALL')).toBe('failure');
    expect(badgeVariantOf(html, 'GATE_STALL')).toBe('danger');
    expect(html).toContain('data-testid="admin-monitoring-gate-stall-JOB_FAILED"');
    expect(html).toContain('data-testid="admin-monitoring-gate-stall-RUNNING_OVERDUE"');
    expect(html).toContain('ワーカー / Redis の稼働を確認してください');
  });
});

describe('⑦ 項目 17 / 13 の特別な状態', () => {
  it('REACHED は専用の帯（danger）で出し、単一テナントの行に混ぜない', () => {
    const html = render(
      snapshot({
        PROVIDER_SPEND: {
          kind: 'PROVIDER_SPEND',
          ok: true,
          scope: 'ENVIRONMENT',
          periodKey: '2026-09',
          spentUsd: '520.000000',
          capUsd: '500.000000',
          consumptionRate: 1.04,
          level: 'REACHED',
          tenantCount: 12,
        },
      }),
    );
    expect(html).toContain('data-testid="admin-monitoring-provider-spend-reached"');
    expect(html).toContain('全テナントの AI 機能が同時に停止します');
    expect(html).toContain('上限超過 104%');
    expect(severityOf(html, 'PROVIDER_SPEND')).toBe('failure');
    const section = html.slice(html.indexOf('admin-monitoring-item-PROVIDER_SPEND"'), html.indexOf('admin-monitoring-item-SCHEDULER_HEARTBEAT"'));
    expect(section).not.toContain('/admin/tenants/');
  });

  it('項目 13 の available: false は「上限を確認できていません」を出し、0 件・0% と表示しない', () => {
    const html = render(
      snapshot({
        MAIL_PROVIDER_QUOTA: {
          kind: 'MAIL_PROVIDER_QUOTA',
          ok: true,
          scope: 'ENVIRONMENT',
          providerReading: { available: false, localSentLast24h: 12, lastObservedAt: null },
          envLimit: 200,
          warnRatio: 0.8,
          reachedAt: null,
          nearingSince: null,
          heldCount: 0,
        },
      }),
    );
    expect(html).toContain('data-testid="admin-monitoring-mail-provider-unavailable"');
    expect(html).toContain('上限を確認できていません');
    expect(html).toContain('手元のカウンタ: 12 通');
    expect(html).not.toContain('（0%）');
    expect(severityOf(html, 'MAIL_PROVIDER_QUOTA')).toBe('hold');
  });
});
