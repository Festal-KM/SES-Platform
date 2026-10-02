// apps/web/lib/home/summary.test.ts
// 🔴 **KPI カード 4 枚**の件数の読み取り（`docs/04` §4.1 / §7.2 改訂 23 / docs/05 §6.11.1）。
//    T-22-09 → ✅ 2026-10-02。
//
// 固定するもの:
//   ① 🔴 **`where` に分離キー（`tenant_id` / `partner_company_id` / `owner_partner_company_id`）を書かない**
//      —— 母集団は RLS が決める。ここで `if` を書くと、境界の担保が条件式に移る
//   ② 🔴 **0 件でも `count: 0` を返す**（`items` を空配列にする分岐が無い）。4 件を**間引かない**
//   ③ 🔴 **`今日やること` は要対応キューの行数そのもの**（クエリを 1 本も撃たない）
//   ④ 🔴 差分は **`今週…` の 1 指標だけ**が持ち、在庫の 3 指標は `null`（嘘の昨日比を作らない）
//   ⑤ 🔴 差分の窓は **当週の月曜 0:00（JST）起点 / 前週は同時刻まで**（§7.2 ② の基準）
//   ⑥ 🔴 取引先の応答に他社を示唆する `kind` が 1 つも無い（自社スコープの 4 つだけ）
//   ⑦ 🔴 `initialEmpty` は**台帳の有無**で決まる（件数が 0 かどうかではない）
import { describe, expect, it } from 'vitest';
import {
  AWAITING_REPLY_PROPOSAL_STATE,
  buildSummaryBlock,
  HOST_SUMMARY_METRIC_ORDER,
  INTERVIEW_PROPOSAL_STATE,
  PARTNER_SUMMARY_METRIC_ORDER,
  readSummaryCounts,
  type SummaryCountDb,
} from './summary';

type Recorded = { readonly model: string; readonly where: unknown };

/** 2026-10-02（金）12:00 JST = 03:00Z。当週の月曜は 2026-09-28 00:00 JST。 */
const NOW = new Date('2026-10-02T03:00:00.000Z');

function fakeDb(counts: Readonly<Record<string, number>>, recorded: Recorded[]): SummaryCountDb {
  const delegate = (model: string) => ({
    count: async (args?: { readonly where?: unknown }) => {
      recorded.push({ model, where: args?.where ?? null });
      return counts[model] ?? 0;
    },
  });
  return {
    project: delegate('project'),
    engineer: delegate('engineer'),
    proposal: delegate('proposal'),
    proposalRequest: delegate('proposalRequest'),
    projectVisibility: delegate('projectVisibility'),
  } as unknown as SummaryCountDb;
}

describe('🔴 ① where に分離キーを書かない（母集団は RLS が決める）', () => {
  it('ホスト: どの `count` の `where` にも分離キーが現れない', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'HOST', { now: NOW });
    const serialized = JSON.stringify(recorded);
    for (const key of ['tenantId', 'tenant_id', 'partnerCompanyId', 'ownerPartnerCompanyId']) {
      expect(serialized, key).not.toContain(key);
    }
  });

  it('取引先: 同じ（`proposal_requests` / `project_visibilities` も分離キーを書かない）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'PARTNER', { now: NOW });
    const serialized = JSON.stringify(recorded);
    for (const key of ['tenantId', 'tenant_id', 'partnerCompanyId', 'ownerPartnerCompanyId']) {
      expect(serialized, key).not.toContain(key);
    }
  });
});

describe('🔴 ② 0 件でも 0 を返し、項目を間引かない', () => {
  it('ホストは 4 指標（すべて 0 でも 4 件）', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'HOST', { now: NOW });
    const block = buildSummaryBlock(counts, 'HOST', 0);
    expect(block.items).toHaveLength(4);
    expect(block.items.map((item) => item.kind)).toEqual([...HOST_SUMMARY_METRIC_ORDER]);
    expect(block.items.every((item) => item.count === 0)).toBe(true);
  });

  it('取引先は 4 指標（同じ）', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'PARTNER', { now: NOW });
    const block = buildSummaryBlock(counts, 'PARTNER', 0);
    expect(block.items).toHaveLength(4);
    expect(block.items.map((item) => item.kind)).toEqual([...PARTNER_SUMMARY_METRIC_ORDER]);
  });

  it('🔴 1 指標のキーは 4 つだけ（ラベル・色・率・金額を返さない）', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'HOST', { now: NOW });
    for (const item of buildSummaryBlock(counts, 'HOST', 0).items) {
      expect(Object.keys(item).sort()).toEqual(['count', 'delta', 'href', 'kind']);
    }
  });
});

describe('🔴 ③ `今日やること` は要対応キューの行数そのもの（クエリを撃たない）', () => {
  it('渡された行数がそのまま件数になる', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'HOST', { now: NOW });
    const block = buildSummaryBlock(counts, 'HOST', 7);
    expect(block.items.find((item) => item.kind === 'ACTION_QUEUE')?.count).toBe(7);
  });

  it('🔴 要対応キューのための `count` が 1 本も撃たれていない（読むのは 4 表だけ）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'HOST', { now: NOW });
    // ホストが読むのは `proposal` × 4（返信待ち / 面談 / 今週 / 先週）+ `project` + `engineer`。
    expect(recorded.map((entry) => entry.model).sort()).toEqual([
      'engineer',
      'project',
      'proposal',
      'proposal',
      'proposal',
      'proposal',
    ]);
  });

  it('🔴 取引先は `proposal_requests` と `project_visibilities` を読む（`engineer_shares` は読まない）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'PARTNER', { now: NOW });
    const models = recorded.map((entry) => entry.model);
    expect(models).toContain('proposalRequest');
    expect(models.filter((model) => model === 'projectVisibility')).toHaveLength(2);
    expect(models).not.toContain('engineerShare');
  });
});

describe('🔴 ④⑤ 差分は「今週…」の 1 指標だけで、窓は月曜 0:00（JST）起点', () => {
  it('在庫の 3 指標は `delta: null`（嘘の昨日比を作らない）', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'HOST', { now: NOW });
    const block = buildSummaryBlock(counts, 'HOST', 3);
    const deltas = new Map(block.items.map((item) => [item.kind, item.delta]));
    expect(deltas.get('ACTION_QUEUE')).toBeNull();
    expect(deltas.get('AWAITING_REPLY')).toBeNull();
    expect(deltas.get('INTERVIEWS')).toBeNull();
    expect(deltas.get('PROPOSALS_THIS_WEEK')).toEqual({ basis: 'PREVIOUS_WEEK', count: 0 });
  });

  it('差分は今週 − 先週の件数差である（符号つき）', () => {
    const block = buildSummaryBlock(
      {
        awaitingReply: 0,
        interviews: 0,
        thisWeek: 4,
        lastWeek: 9,
        requestsToAnswer: 0,
        ledgerEmpty: false,
      },
      'HOST',
      0,
    );
    expect(block.items.find((item) => item.kind === 'PROPOSALS_THIS_WEEK')?.delta).toEqual({
      basis: 'PREVIOUS_WEEK',
      count: -5,
    });
  });

  it('🔴 今週の窓は月曜 0:00（JST）起点、先週の窓は同曜日・同時刻まで（§7.2 ②）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'HOST', { now: NOW });
    const windows = recorded
      .filter((entry) => JSON.stringify(entry.where).includes('submittedAt'))
      .map((entry) => entry.where as { submittedAt: { gte: Date; lt?: Date } });
    expect(windows).toHaveLength(2);
    // 2026-09-28（月）00:00 JST = 2026-09-27T15:00:00Z。
    expect(windows[0]?.submittedAt.gte.toISOString()).toBe('2026-09-27T15:00:00.000Z');
    // 前週の月曜 = 2026-09-21（月）00:00 JST、終わりは同じ経過時間後（金 12:00 相当）。
    expect(windows[1]?.submittedAt.gte.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    expect(windows[1]?.submittedAt.lt?.toISOString()).toBe('2026-09-25T03:00:00.000Z');
  });

  it('🔴 取引先の新着は「解除されていない公開」だけを数える（`revoked_at IS NULL`）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'PARTNER', { now: NOW });
    const visibility = recorded.filter((entry) => entry.model === 'projectVisibility');
    for (const entry of visibility) {
      expect(JSON.stringify(entry.where)).toContain('revokedAt');
      expect((entry.where as { revokedAt: unknown }).revokedAt).toBeNull();
    }
  });
});

describe('🔴 ⑥ 取引先の `kind` に他社を示唆するものが無い', () => {
  it('`TOTAL_` / `RANK` / `COMPARISON` / `OTHER_COMPANIES` / `SAME_PROJECT` を含まない', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'PARTNER', { now: NOW });
    const serialized = JSON.stringify(buildSummaryBlock(counts, 'PARTNER', 0));
    for (const forbidden of ['TOTAL_', 'RANK', 'COMPARISON', 'OTHER_COMPANIES', 'SAME_PROJECT']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe('🔴 ⑦ `initialEmpty` は台帳の有無で決まる', () => {
  it('案件も人材も 0 件なら `true`', async () => {
    const counts = await readSummaryCounts(fakeDb({}, []), 'HOST', { now: NOW });
    expect(counts.ledgerEmpty).toBe(true);
    expect(buildSummaryBlock(counts, 'HOST', 0).initialEmpty).toBe(true);
  });

  it('🔴 案件が 1 件でもあれば `false`（KPI が全部 0 でも「初回空」にしない）', async () => {
    const counts = await readSummaryCounts(fakeDb({ project: 1 }, []), 'HOST', { now: NOW });
    expect(counts.ledgerEmpty).toBe(false);
    expect(buildSummaryBlock(counts, 'HOST', 0).initialEmpty).toBe(false);
  });

  it('人材だけでも `false`', async () => {
    const counts = await readSummaryCounts(fakeDb({ engineer: 2 }, []), 'HOST', { now: NOW });
    expect(counts.ledgerEmpty).toBe(false);
  });
});

describe('🔴 状態の定数は `@ses/domain` の状態名に縛られている（勝手な状態を作らない）', () => {
  it('返信待ち = `SUBMITTED` / 面談 = `INTERVIEW_SCHEDULED`', () => {
    expect(AWAITING_REPLY_PROPOSAL_STATE).toBe('SUBMITTED');
    expect(INTERVIEW_PROPOSAL_STATE).toBe('INTERVIEW_SCHEDULED');
  });

  it('🔴 読む状態が `where` に現れる（別の状態を数えていない）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryCounts(fakeDb({}, recorded), 'HOST', { now: NOW });
    const states = recorded
      .map((entry) => (entry.where as { state?: string } | null)?.state)
      .filter((state): state is string => state !== undefined);
    expect(states.sort()).toEqual(['INTERVIEW_SCHEDULED', 'SUBMITTED']);
  });
});
