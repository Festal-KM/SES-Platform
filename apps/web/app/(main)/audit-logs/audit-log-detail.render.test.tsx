// apps/web/app/(main)/audit-logs/audit-log-detail.render.test.tsx
// `AuditLogDetail`（`S-041` 行の詳細）の状態別描画テスト。T-11-09。
//
// 🔴 なぜこの粒度で要るか: `U-17`（パートナー由来の台帳系は理由テキストを**常時**置く）と `docs/04` §10.3 の
//    `null` 規約（削除済みの取引先を空欄にしない）は「描かれること」の検証であり、API の結合テストでは
//    応答の形しか示せない。`docs/04` §S-041 の描き方（`before` → 変更前 / `after` → 変更後 / 列挙値のラベル /
//    `auth.*` の「詳細はありません」）を、`react-dom/server` の `renderToStaticMarkup` で確かめる
//    （新規依存を増やさない。`skill-dictionary-screen.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import { auditLogDetailMessages, type AuditLogDetailMessages } from '../../../lib/audit-logs/detail-labels';
import type { AuditDetailEntryView } from '../../../lib/audit-logs/view';
import { AuditLogDetail } from './audit-log-detail';

const messages: AuditLogDetailMessages = {
  toggleOpen: '詳細を開く',
  toggleClose: '詳細を閉じる',
  columnItem: '項目',
  columnValue: '値',
  columnBefore: '変更前',
  columnAfter: '変更後',
  empty: '詳細はありません',
  suppressed: { PARTNER_LEDGER: '取引先の台帳に関する記録のため、詳細は表示されません' },
  deletedPartnerCompany: '削除済みの取引先',
  emptyList: '—',
  booleanTrue: 'はい',
  booleanFalse: 'いいえ',
  booleanUnknown: '不明',
  dateNone: '—',
  pairLabels: { visibility: '公開先', role: 'ロール', state: '状態' },
  pairSideLabels: { 'role.BEFORE': '変更前のロール', 'role.AFTER': '変更後のロール' },
  keyLabels: { verdict: '判定', operation: '操作', projectId: '案件', periodTo: '期間（終了）', changedFields: '変更した項目', periodFrom: '期間（開始）' },
  enumLabels: {
    'verdict.PENDING_GATE': 'ゲート待ち',
    'fromState.APPROVED': '承認済み',
    'toState.SUBMITTING': '送信中',
    'beforeRole.SALES': '営業',
    'afterRole.ADMIN': '管理者',
    'operation.DECLINE': '辞退',
  },
  nullLabels: { projectId: '削除済みの案件', periodTo: '継続中' },
};

function render(entries: readonly AuditDetailEntryView[], suppressed: 'PARTNER_LEDGER' | null = null): string {
  return renderToStaticMarkup(
    createElement(AuditLogDetail, {
      item: { id: '01930000-0000-7000-8000-00000000a001', detail: { entries }, detailSuppressedReason: suppressed },
      messages,
    }),
  );
}

describe('AuditLogDetail — 展開部の描画（docs/04 §S-041「行の詳細」）', () => {
  it('project.visibility_change: before → 変更前、after → 変更後（社名で描き、null 要素は「削除済みの取引先」）', () => {
    const html = render([
      { key: 'before', pair: { id: 'visibility', side: 'BEFORE' }, value: { kind: 'NAME_LIST', value: ['株式会社ダミーチャーリー'] } },
      {
        key: 'after',
        pair: { id: 'visibility', side: 'AFTER' },
        value: { kind: 'NAME_LIST', value: ['株式会社ダミーチャーリー', null, '株式会社ダミーデルタ'] },
      },
      { key: 'verdict', pair: null, value: { kind: 'ENUM', value: 'PENDING_GATE' } },
    ]);
    expect(html).toContain('data-testid="audit-logs-detail-list"');
    expect(html).toContain('data-testid="audit-logs-detail-row-before"');
    expect(html).toContain('公開先');
    expect(html).toContain('変更前');
    expect(html).toContain('変更後');
    expect(html).toContain('株式会社ダミーデルタ');
    // 🔴 null 要素は空欄にしない（docs/04 §10.3）。位置も保つ（3 要素）。
    expect(html).toContain('data-testid="audit-logs-detail-deleted-partner"');
    expect(html).toContain('削除済みの取引先');
    expect(html.match(/<li/g)?.length).toBe(4);
    // 列挙値はラベル化される。
    expect(html).toContain('判定');
    expect(html).toContain('ゲート待ち');
    expect(html).not.toContain('PENDING_GATE');
    // 単値の行は 3 列の器の中で値の列をまたぐ。
    expect(html).toContain('sm:col-span-2');
  });

  it('proposal.*: fromState / toState は §4.2 の状態名ラベルで「状態」の 1 行に畳む', () => {
    const html = render([
      { key: 'operation', pair: null, value: { kind: 'ENUM', value: 'SUBMIT_REQUEST' } },
      { key: 'fromState', pair: { id: 'state', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'APPROVED' } },
      { key: 'toState', pair: { id: 'state', side: 'AFTER' }, value: { kind: 'ENUM', value: 'SUBMITTING' } },
    ]);
    expect(html).toContain('data-testid="audit-logs-detail-row-fromState"');
    expect(html).not.toContain('data-testid="audit-logs-detail-row-toState"');
    expect(html).toContain('状態');
    expect(html).toContain('承認済み');
    expect(html).toContain('送信中');
    // 未知の列挙値（ラベル未登録）はトークンのまま描く。
    expect(html).toContain('SUBMIT_REQUEST');
  });

  it('membership.role_change は対で、membership.revoke の beforeRole は単値（側つきの名前）で描く', () => {
    const pair = render([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'SALES' } },
      { key: 'afterRole', pair: { id: 'role', side: 'AFTER' }, value: { kind: 'ENUM', value: 'ADMIN' } },
    ]);
    expect(pair).toContain('ロール');
    expect(pair).toContain('営業');
    expect(pair).toContain('管理者');
    expect(pair).toContain('変更前');

    const single = render([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'SALES' } },
    ]);
    expect(single).toContain('変更前のロール');
    expect(single).toContain('営業');
    // 対が無いので 2 列（項目 / 値）。
    expect(single).toContain('>値<');
    expect(single).not.toContain('>変更後<');
  });

  it('🔴 SUPPRESSED（パートナー由来の台帳系）は理由テキストを常時置き、項目を 1 つも描かない（U-17）', () => {
    const html = render([], 'PARTNER_LEDGER');
    expect(html).toContain('data-testid="audit-logs-detail-suppressed"');
    expect(html).toContain('取引先の台帳に関する記録のため、詳細は表示されません');
    expect(html).not.toContain('audit-logs-detail-list');
    expect(html).not.toContain('詳細はありません');
  });

  it('auth.* / 0 キー: 「詳細はありません」', () => {
    const html = render([]);
    expect(html).toContain('data-testid="audit-logs-detail-empty"');
    expect(html).toContain('詳細はありません');
    expect(html).not.toContain('audit-logs-detail-list');
  });

  it('proposal_request.create の projectId: 案件名、削除済みは「削除済みの案件」', () => {
    expect(render([{ key: 'projectId', pair: null, value: { kind: 'NAME', value: '公開案件 T1' } }])).toContain('公開案件 T1');
    const deleted = render([{ key: 'projectId', pair: null, value: { kind: 'NAME', value: null } }]);
    expect(deleted).toContain('削除済みの案件');
    expect(deleted).not.toContain('削除済みの取引先');
  });

  it('engineer_career.*（ホスト主体）: periodTo の null は「継続中」、changedFields は項目名の列挙、空は「—」（docs/04 §7.8）', () => {
    const html = render([
      { key: 'changedFields', pair: null, value: { kind: 'FIELD_NAMES', value: ['periodFrom', 'role'] } },
      { key: 'periodFrom', pair: null, value: { kind: 'DATE', value: '2020-04' } },
      { key: 'periodTo', pair: null, value: { kind: 'DATE', value: null } },
    ]);
    expect(html).toContain('継続中');
    expect(html).toContain('2020-04');
    expect(html).toContain('期間（開始）');
    // 項目名はラベルがあればラベル、無ければ識別子のまま。
    expect(html).toContain('>role<');
    expect(html).toContain('期間（開始）</li>');
    expect(render([{ key: 'before', pair: null, value: { kind: 'NAME_LIST', value: [] } }])).toContain('—');
  });

  it('BOOLEAN / NUMBER の描き方', () => {
    const html = render([
      { key: 'externalCallMade', pair: null, value: { kind: 'BOOLEAN', value: null } },
      { key: 'attemptSeq', pair: null, value: { kind: 'NUMBER', value: 2 } },
    ]);
    expect(html).toContain('不明');
    expect(html).toContain('>2<');
    // ラベル未登録のキーはキー名のまま描く（落とさない）。
    expect(html).toContain('externalCallMade');
  });
});

describe('T-12-18 ⑨ / ⑩ / ⑪ — 許可リストに足した行の描画（実物の文言 `auditLogDetailMessages()`）', () => {
  function renderWithCatalog(entries: readonly AuditDetailEntryView[]): string {
    return renderToStaticMarkup(
      createElement(AuditLogDetail, {
        item: { id: '01930000-0000-7000-8000-00000000a002', detail: { entries }, detailSuppressedReason: null },
        messages: auditLogDetailMessages(),
      }),
    );
  }

  it('⑨ GATE_RESULT: 各層 verdict は「合格 / 不合格」、件数は数値。トークンのまま描かない', () => {
    const html = renderWithCatalog([
      { key: 'operation', pair: null, value: { kind: 'ENUM', value: 'GATE_RESULT' } },
      { key: 'overall', pair: null, value: { kind: 'ENUM', value: 'FAIL' } },
      { key: 'piiVerdict', pair: null, value: { kind: 'ENUM', value: 'FAIL' } },
      { key: 'commerceVerdict', pair: null, value: { kind: 'ENUM', value: 'PASS' } },
      { key: 'consistencyVerdict', pair: null, value: { kind: 'ENUM', value: 'PASS' } },
      { key: 'findingCount', pair: null, value: { kind: 'NUMBER', value: 2 } },
      { key: 'warningCount', pair: null, value: { kind: 'NUMBER', value: 0 } },
    ]);
    expect(html).toContain(t('auditLogs.detail.key.overall'));
    expect(html).toContain(t('auditLogs.detail.key.piiVerdict'));
    expect(html).toContain(t('auditLogs.detail.enum.gateVerdict.PASS'));
    expect(html).toContain(t('auditLogs.detail.enum.gateVerdict.FAIL'));
    expect(html).not.toMatch(/>PASS<|>FAIL</);
    expect(html).toContain(`${t('auditLogs.detail.key.findingCount')}</span>`);
    expect(html).toContain('>2<');
  });

  it('⑨ state.invalid_transition: entity は状態機械の名前、from → to は「状態」の対（状態名ラベル）', () => {
    const html = renderWithCatalog([
      { key: 'entity', pair: null, value: { kind: 'ENUM', value: 'Proposal' } },
      { key: 'from', pair: { id: 'state', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'DRAFT' } },
      { key: 'to', pair: { id: 'state', side: 'AFTER' }, value: { kind: 'ENUM', value: 'WON' } },
    ]);
    expect(html).toContain(t('auditLogs.detail.key.entity'));
    expect(html).toContain(t('auditLogs.detail.enum.entity.Proposal'));
    expect(html).toContain('data-testid="audit-logs-detail-row-from"');
    expect(html).toContain(t('auditLogs.detail.pair.state'));
    expect(html).toContain(t('proposals.state.DRAFT'));
    expect(html).toContain(t('proposals.state.WON'));
    // ProposalRequest / Tenant の状態名も引ける。
    const request = renderWithCatalog([
      { key: 'entity', pair: null, value: { kind: 'ENUM', value: 'ProposalRequest' } },
      { key: 'from', pair: { id: 'state', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'REQUESTED' } },
      { key: 'to', pair: { id: 'state', side: 'AFTER' }, value: { kind: 'ENUM', value: 'ACCEPTED' } },
    ]);
    expect(request).toContain(t('proposalRequests.state.REQUESTED'));
    const tenant = renderWithCatalog([
      { key: 'entity', pair: null, value: { kind: 'ENUM', value: 'Tenant' } },
      { key: 'from', pair: { id: 'state', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'PURGED' } },
      { key: 'to', pair: { id: 'state', side: 'AFTER' }, value: { kind: 'ENUM', value: 'ACTIVE' } },
    ]);
    expect(tenant).toContain(t('admin.tenants.lifecycleState.PURGED'));
  });

  it('⑩ tenant.purge: count_{table} は S-042 と同じ種別ラベルの件数行。cause / kind はラベル化。未知の表名はキーのまま', () => {
    const html = renderWithCatalog([
      { key: 'cause', pair: null, value: { kind: 'ENUM', value: 'TENANT_PURGED' } },
      { key: 'tables', pair: null, value: { kind: 'NUMBER', value: 2 } },
      { key: 'count_engineers', pair: null, value: { kind: 'NUMBER', value: 12 } },
      { key: 'count_skill_sheets', pair: null, value: { kind: 'NUMBER', value: 4 } },
      { key: 'count_unknown_table', pair: null, value: { kind: 'NUMBER', value: 1 } },
    ]);
    expect(html).toContain(t('auditLogs.detail.enum.cause.TENANT_PURGED'));
    expect(html).toContain(t('retention.schedule.kind.engineers'));
    expect(html).toContain(t('retention.schedule.kind.skill_sheets'));
    expect(html).toContain('data-testid="audit-logs-detail-row-count_engineers"');
    expect(html).toContain('>12<');
    expect(html).toContain('count_unknown_table');
    const download = renderWithCatalog([{ key: 'kind', pair: null, value: { kind: 'ENUM', value: 'CLOSING_RETURN' } }]);
    expect(download).toContain(t('auditLogs.detail.key.kind'));
    expect(download).toContain(t('auditLogs.detail.enum.kind.CLOSING_RETURN'));
  });

  it('⑪ audit_log.export: rowCount は数値、truncated は はい / いいえ', () => {
    const html = renderWithCatalog([
      { key: 'rowCount', pair: null, value: { kind: 'NUMBER', value: 120 } },
      { key: 'truncated', pair: null, value: { kind: 'BOOLEAN', value: false } },
    ]);
    expect(html).toContain(t('auditLogs.detail.key.rowCount'));
    expect(html).toContain('>120<');
    expect(html).toContain(t('auditLogs.detail.key.truncated'));
    expect(html).toContain(t('auditLogs.detail.boolean.false'));
  });
});
