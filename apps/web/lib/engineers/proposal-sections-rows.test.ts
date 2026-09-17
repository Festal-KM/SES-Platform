// apps/web/lib/engineers/proposal-sections-rows.test.ts
// `S-006` セクション 4（提案履歴）・5（凍結情報との差分）の表示値（docs/04 §S-006 / §5-6 / `F-019 AC-2` / docs/05 §6.5 #46b）。T-12-16。
//
// 🔴 ここで固定するもの:
//   ① セクション 4 の行は `listProposals` の行（ホスト / 取引先）から**同じ形**に写り、列は 提案先 / 案件 / 状態 / 作成日 / 導線
//   ② 「提案後に変更」は `frozen` と `current` の突き合わせ**だけ**から出る（応答に `changed` は無い）。変更の無い項目は「変更なし」
//   ③ 経歴は凍結側（`frozen`）と現在値（`current`）が**別の配列**に組み立てられ、1 つの配列に混ざらない。凍結側は行 ID を持たず、
//      現在値はセクション 8 と同じ部品（`engineerDetailCareerRows`）
//   ④ 値の写し方は両側で同じ関数（同じ値が別の見え方にならない）
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import type { ProposalSnapshotDiffView } from '../proposals/snapshot-diff-fields';
import type { HostProposalListItem, PartnerProposalListItem } from '../proposals/views';
import { engineerDetailCareerRows } from './detail';
import {
  ENGINEER_DETAIL_DIFF_PARAM,
  engineerProposalHistoryRows,
  engineerSnapshotDiffHref,
  snapshotDiffRows,
} from './proposal-sections-rows';

const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const PROPOSAL_1 = '01930000-0000-7000-8000-000000000a01';
const PROPOSAL_2 = '01930000-0000-7000-8000-000000000a02';
const SKILL_A = '01930000-0000-7000-8000-0000000000a1';
const NONE = t('engineers.detail.valueNone');

function host(overrides: Partial<HostProposalListItem> = {}): HostProposalListItem {
  return {
    audience: 'HOST',
    owner: { kind: 'HOST' },
    sendHold: null,
    lastFailureReason: null,
    sendAttempts: [],
    id: PROPOSAL_1,
    state: 'APPROVAL_PENDING',
    origin: 'OWN',
    project: { id: '01930000-0000-7000-8000-0000000000f1', name: '基幹刷新' },
    recipient: { companyName: '架空エンド株式会社', email: 'to@example.test' },
    engineerDisplayName: '佐藤 花子',
    offeredUnitPrice: 650000,
    createdByName: '担当 太郎',
    // JST では 2026-09-15 の 0:30（UTC の前日 15:30）。暦日は JST で丸める。
    createdAt: '2026-09-14T15:30:00.000Z',
    updatedAt: '2026-09-16T02:00:00.000Z',
    ...overrides,
  };
}

function partner(overrides: Partial<PartnerProposalListItem> = {}): PartnerProposalListItem {
  const base = host();
  return {
    audience: 'PARTNER',
    id: base.id,
    state: base.state,
    origin: base.origin,
    project: base.project,
    recipient: base.recipient,
    engineerDisplayName: base.engineerDisplayName,
    offeredUnitPrice: base.offeredUnitPrice,
    createdByName: base.createdByName,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    ...overrides,
  };
}

function diffView(overrides: Partial<ProposalSnapshotDiffView> = {}): ProposalSnapshotDiffView {
  return {
    frozenAt: '2026-09-15T01:00:00.000Z',
    fields: [
      { key: 'displayName', frozen: '架空 太郎', current: '架空 太郎' },
      { key: 'skills', frozen: [{ skillId: SKILL_A, name: 'Java', years: 6, level: 4 }], current: [{ skillId: SKILL_A, name: 'Java', years: 7, level: 4 }] },
      { key: 'unitPriceMin', frozen: 650000, current: 650000 },
      { key: 'unitPriceMax', frozen: 750000, current: null },
      { key: 'availableFrom', frozen: '2026-10-01', current: '2026-10-01' },
      { key: 'prefecture', frozen: '13', current: '27' },
      { key: 'remoteMode', frozen: 'PARTIAL_REMOTE', current: 'PARTIAL_REMOTE' },
    ],
    careers: {
      frozen: [
        { periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新', technologies: 'Java' },
        { periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: '受託', technologies: '' },
      ],
      current: [
        { id: 'c1', periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新（改）', technologies: 'Java', source: 'MANUAL', skillSheetExtractionId: null },
        { id: 'c3', periodFrom: '2019-01', periodTo: '2020-12', role: 'PG', description: '保守', technologies: 'PHP', source: 'MANUAL', skillSheetExtractionId: null },
      ],
    },
    ...overrides,
  };
}

describe('① セクション 4: listProposals の行から同じ形に写る', () => {
  it('ホストと取引先で同じ列。導線は S-023 と同じ画面の ?diff=。作成日は JST の暦日', () => {
    const [h] = engineerProposalHistoryRows([host()], ENGINEER, null);
    const [p] = engineerProposalHistoryRows([partner()], ENGINEER, null);
    expect(h).toEqual(p);
    expect(h).toEqual({
      id: PROPOSAL_1,
      href: `/proposals/${PROPOSAL_1}`,
      diffHref: `/engineers/${ENGINEER}?${ENGINEER_DETAIL_DIFF_PARAM}=${PROPOSAL_1}#engineer-detail-snapshot-diff`,
      recipient: '架空エンド株式会社',
      project: '基幹刷新',
      state: 'APPROVAL_PENDING',
      stateLabel: t('proposals.state.APPROVAL_PENDING'),
      tone: 'warning',
      createdOn: '2026-09-15',
      selected: false,
    });
    expect(engineerSnapshotDiffHref(ENGINEER, PROPOSAL_2)).toBe(`/engineers/${ENGINEER}?diff=${PROPOSAL_2}#engineer-detail-snapshot-diff`);
  });

  it('提案先未設定 / 案件非公開は語に畳む。selected は選択中の提案だけ true。エンジニア名・単価・作成会社は行に無い', () => {
    const rows = engineerProposalHistoryRows(
      [host({ recipient: null, project: null }), host({ id: PROPOSAL_2, state: 'LOST' })],
      ENGINEER,
      PROPOSAL_2,
    );
    expect(rows[0]?.recipient).toBe(t('proposals.list.recipient.unset'));
    expect(rows[0]?.project).toBe(t('proposals.list.project.notShared'));
    expect(rows.map((row) => row.selected)).toEqual([false, true]);
    expect(rows[1]?.tone).toBe('neutral');
    for (const row of rows) {
      expect(row).not.toHaveProperty('engineerDisplayName');
      expect(row).not.toHaveProperty('offeredUnitPrice');
      expect(row).not.toHaveProperty('owner');
    }
  });

  it('0 件は []', () => {
    expect(engineerProposalHistoryRows([], ENGINEER, null)).toEqual([]);
  });
});

describe('② セクション 5: 「提案後に変更」は frozen と current の突き合わせだけから出る', () => {
  it('変わった項目（skills / unitPriceMax / prefecture）だけ changed。他は「変更なし」', () => {
    const rows = snapshotDiffRows(PROPOSAL_1, diffView());
    expect(rows.proposalId).toBe(PROPOSAL_1);
    expect(rows.title).toBe(`${t('engineers.snapshotDiff.title.prefix')}2026-09-15 10:00 JST${t('engineers.snapshotDiff.title.frozenSuffix')}`);
    expect(rows.fields.map((field) => [field.key, field.changed])).toEqual([
      ['displayName', false],
      ['skills', true],
      ['unitPriceMin', false],
      ['unitPriceMax', true],
      ['availableFrom', false],
      ['prefecture', true],
      ['remoteMode', false],
    ]);
    const changed = rows.fields.filter((field) => field.changed);
    for (const field of changed) expect(field.note).toBe(t('engineers.snapshotDiff.changedNote'));
    for (const field of rows.fields.filter((field) => !field.changed)) expect(field.note).toBe(t('engineers.snapshotDiff.unchangedNote'));
  });

  it('④ 値は両側とも同じ写し方（単価は 3 桁区切り + 単位 / null は — / 都道府県・リモートは語 / スキルは 1 行 1 スキル）', () => {
    const rows = snapshotDiffRows(PROPOSAL_1, diffView());
    const byKey = new Map(rows.fields.map((field) => [field.key, field]));
    expect(byKey.get('unitPriceMin')).toMatchObject({ frozen: [`650,000 ${t('engineers.unitPrice.unit')}`], current: [`650,000 ${t('engineers.unitPrice.unit')}`] });
    expect(byKey.get('unitPriceMax')).toMatchObject({ frozen: [`750,000 ${t('engineers.unitPrice.unit')}`], current: [NONE] });
    expect(byKey.get('prefecture')).toMatchObject({ frozen: [t('prefecture.13')], current: [t('prefecture.27')] });
    expect(byKey.get('remoteMode')).toMatchObject({ frozen: [t('engineers.remoteMode.PARTIAL_REMOTE')], current: [t('engineers.remoteMode.PARTIAL_REMOTE')] });
    expect(byKey.get('skills')).toMatchObject({
      frozen: [`Java 6 ${t('engineers.detail.years.unit')}${t('engineers.snapshotDiff.skills.levelPrefix')}${t('engineers.skills.level.4')}${t('engineers.snapshotDiff.skills.levelSuffix')}`],
      current: [`Java 7 ${t('engineers.detail.years.unit')}${t('engineers.snapshotDiff.skills.levelPrefix')}${t('engineers.skills.level.4')}${t('engineers.snapshotDiff.skills.levelSuffix')}`],
    });
    expect(byKey.get('displayName')?.label).toBe(t('engineers.snapshotDiff.field.displayName'));
  });

  it('スキル 0 件は「スキルなし」の 1 行。値集合の外の都道府県コードは落とさずそのまま出す', () => {
    const rows = snapshotDiffRows(
      PROPOSAL_1,
      diffView({
        fields: [
          { key: 'displayName', frozen: 'a', current: 'a' },
          { key: 'skills', frozen: [], current: [] },
          { key: 'unitPriceMin', frozen: null, current: null },
          { key: 'unitPriceMax', frozen: null, current: null },
          { key: 'availableFrom', frozen: null, current: null },
          { key: 'prefecture', frozen: '99', current: null },
          { key: 'remoteMode', frozen: null, current: null },
        ],
      }),
    );
    const byKey = new Map(rows.fields.map((field) => [field.key, field]));
    expect(byKey.get('skills')).toMatchObject({ frozen: [t('engineers.snapshotDiff.skills.none')], current: [t('engineers.snapshotDiff.skills.none')], changed: false });
    expect(byKey.get('availableFrom')).toMatchObject({ frozen: [NONE], current: [NONE], changed: false });
    expect(byKey.get('prefecture')).toMatchObject({ frozen: ['99'], current: [NONE], changed: true });
  });
});

describe('③ セクション 5: 経歴は凍結側と現在値が別の配列（1 つのリストに混在しない）', () => {
  it('frozen は 4 列 + 位置キー（行 ID 無し）、current はセクション 8 と同じ部品。列としての差で changed', () => {
    const view = diffView();
    const rows = snapshotDiffRows(PROPOSAL_1, view);
    expect(rows.careers.frozen).toEqual([
      { key: 'frozen-0', period: `2024-04〜${t('engineers.careers.ongoing')}`, role: 'PL', description: '基幹刷新', technologies: 'Java' },
      { key: 'frozen-1', period: '2021-01〜2024-03', role: 'SE', description: '受託', technologies: NONE },
    ]);
    for (const row of rows.careers.frozen) {
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('source');
    }
    expect(rows.careers.current).toEqual(engineerDetailCareerRows(view.careers.current));
    expect(rows.careers.current.map((row) => row.id)).toEqual(['c1', 'c3']);
    expect(rows.careers.changed).toBe(true);
    expect(rows.careers.note).toBe(t('engineers.snapshotDiff.changedNote'));
    expect(rows.careers.frozenEmpty).toBeNull();
    expect(rows.careers.currentEmpty).toBeNull();
    // 🔴 凍結側の行と現在値の行が同じ配列に入っていない（要素の形が違う = 混在すると型が合わない）。
    expect(rows.careers.frozen.length + rows.careers.current.length).toBe(4);
  });

  it('凍結 0 行 / 現在 0 行はそれぞれ別の空文言。両方 0 行なら changed = false', () => {
    const rows = snapshotDiffRows(PROPOSAL_1, diffView({ careers: { frozen: [], current: [] } }));
    expect(rows.careers.frozenEmpty).toBe(t('engineers.snapshotDiff.careers.frozenEmpty'));
    expect(rows.careers.currentEmpty).toBe(t('engineers.snapshotDiff.careers.currentEmpty'));
    expect(rows.careers.changed).toBe(false);
    expect(rows.careers.note).toBe(t('engineers.snapshotDiff.unchangedNote'));
  });

  it('同じ内容なら changed = false（現在値の id / source の違いは差にならない）', () => {
    const rows = snapshotDiffRows(
      PROPOSAL_1,
      diffView({
        careers: {
          frozen: [{ periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新', technologies: 'Java' }],
          current: [{ id: 'x', periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新', technologies: 'Java', source: 'EXTRACTED', skillSheetExtractionId: null }],
        },
      }),
    );
    expect(rows.careers.changed).toBe(false);
  });
});
