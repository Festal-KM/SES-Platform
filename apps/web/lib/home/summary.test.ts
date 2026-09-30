// apps/web/lib/home/summary.test.ts
// 🔴 `SummaryStrip` の件数の読み取り（T-22-09 / docs/05 §6.11.1）。
//
// 固定するもの:
//   ① 🔴 **`where` に分離キー（`tenant_id` / `partner_company_id` / `owner_partner_company_id`）を書かない**
//      —— 母集団は RLS が決める。ここで `if` を書くと、境界の担保が条件式に移る
//   ② 🔴 **0 件でも `count: 0` を返す**（`items` を空配列にする分岐が無い）。件数は 3〜5 件で**間引かない**
//   ③ 「進行中の提案」は終端 3 状態（`WON` / `LOST` / `WITHDRAWN`）を除く
//   ④ 取引先の `共有中` は**解除されていない行**だけ（`revoked_at IS NULL`）
//   ⑤ 🔴 `S-015` に到達できないロールでは `共有中` の `href` が `null`（**指標そのものは消さない**）
//   ⑥ 🔴 取引先の応答に他社を示唆する値が 1 つも無い（`kind` の集合が自社スコープの 4 つだけ）
import { describe, expect, it } from 'vitest';
import {
  HOST_SUMMARY_METRIC_ORDER,
  PARTNER_SUMMARY_METRIC_ORDER,
  PROPOSAL_TERMINAL_STATES,
  readSummaryBlock,
  type SummaryCountDb,
} from './summary';

type Recorded = { readonly model: string; readonly where: unknown };

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
    engineerShare: delegate('engineerShare'),
  } as unknown as SummaryCountDb;
}

describe('🔴 ① where に分離キーを書かない（母集団は RLS が決める）', () => {
  it('ホスト: どの `count` の `where` にも分離キーが現れない', async () => {
    const recorded: Recorded[] = [];
    await readSummaryBlock(fakeDb({}, recorded), 'HOST', { canManageShares: false });
    const serialized = JSON.stringify(recorded);
    for (const key of ['tenantId', 'tenant_id', 'partnerCompanyId', 'ownerPartnerCompanyId']) {
      expect(serialized, key).not.toContain(key);
    }
  });

  it('取引先: 同じ（`engineer_shares` も分離キーを書かない）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryBlock(fakeDb({}, recorded), 'PARTNER', { canManageShares: true });
    const serialized = JSON.stringify(recorded);
    for (const key of ['tenantId', 'tenant_id', 'partnerCompanyId', 'ownerPartnerCompanyId']) {
      expect(serialized, key).not.toContain(key);
    }
  });
});

describe('🔴 ② 0 件でも 0 を返し、項目を間引かない', () => {
  it('ホストは Phase 1 の 3 指標（すべて 0 でも 3 件）', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'HOST', { canManageShares: false });
    expect(block.audience).toBe('HOST');
    expect(block.items.map((item) => item.kind)).toEqual([...HOST_SUMMARY_METRIC_ORDER]);
    expect(block.items.every((item) => item.count === 0)).toBe(true);
  });

  it('取引先は Phase 1 の 4 指標（すべて 0 でも 4 件）', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'PARTNER', { canManageShares: true });
    expect(block.audience).toBe('PARTNER');
    expect(block.items.map((item) => item.kind)).toEqual([...PARTNER_SUMMARY_METRIC_ORDER]);
    expect(block.items.every((item) => item.count === 0)).toBe(true);
  });

  it('🔴 Phase 2 の指標（`INTERVIEWS_SCHEDULED` / `ASSIGNMENTS_ACTIVE`）は Phase 1 の応答に現れない', async () => {
    const host = await readSummaryBlock(fakeDb({}, []), 'HOST', { canManageShares: false });
    const partner = await readSummaryBlock(fakeDb({}, []), 'PARTNER', { canManageShares: true });
    for (const block of [host, partner]) {
      const kinds = block.items.map((item) => item.kind as string);
      expect(kinds).not.toContain('INTERVIEWS_SCHEDULED');
      expect(kinds).not.toContain('ASSIGNMENTS_ACTIVE');
    }
  });
});

describe('🔴 ③④ 集計の条件', () => {
  it('「進行中の提案」は終端 3 状態を除く（`notIn`）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryBlock(fakeDb({ proposal: 7 }, recorded), 'HOST', { canManageShares: false });
    const proposal = recorded.find((entry) => entry.model === 'proposal');
    expect(proposal?.where).toEqual({ state: { notIn: ['WON', 'LOST', 'WITHDRAWN'] } });
    expect(PROPOSAL_TERMINAL_STATES).toEqual(['WON', 'LOST', 'WITHDRAWN']);
  });

  it('案件 / 人材は条件なし（母集団は RLS）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryBlock(fakeDb({ project: 128, engineer: 64 }, recorded), 'HOST', { canManageShares: false });
    expect(recorded.filter((entry) => entry.model === 'project')[0]?.where).toBeNull();
    expect(recorded.filter((entry) => entry.model === 'engineer')[0]?.where).toBeNull();
  });

  it('`共有中` は解除されていない行だけ（`F-016 AC-2`「解除で即時に消える」）', async () => {
    const recorded: Recorded[] = [];
    await readSummaryBlock(fakeDb({ engineerShare: 5 }, recorded), 'PARTNER', { canManageShares: true });
    expect(recorded.find((entry) => entry.model === 'engineerShare')?.where).toEqual({ revokedAt: null });
  });

  it('件数はそのまま載る（丸めない）', async () => {
    const block = await readSummaryBlock(
      fakeDb({ project: 1234, engineer: 64, proposal: 7 }, []),
      'HOST',
      { canManageShares: false },
    );
    expect(block.items.map((item) => item.count)).toEqual([1234, 64, 7]);
  });
});

describe('🔴 ⑤ 到達できない導線を出さない（指標は消さない）', () => {
  it('`S-015` に到達できるロールでは `共有中` が `S-015` へのリンクである', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'PARTNER', { canManageShares: true });
    expect(block.items.find((item) => item.kind === 'SHARED_ENGINEERS')?.href).toBe('/engineer-shares');
  });

  it('🔴 到達できないロールでは `href` が `null`（項目は 4 件のまま残る）', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'PARTNER', { canManageShares: false });
    expect(block.items.find((item) => item.kind === 'SHARED_ENGINEERS')?.href).toBeNull();
    expect(block.items).toHaveLength(4);
  });
});

describe('🔴 ⑥ 取引先の応答に他社由来の値が 1 つも無い', () => {
  it('`kind` はすべて自社スコープの語であり、他社・比較・順位の語が無い', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'PARTNER', { canManageShares: true });
    const serialized = JSON.stringify(block);
    for (const marker of ['TOTAL', 'RANK', 'COMPARISON', 'OTHER', 'SAME_PROJECT']) {
      expect(serialized, marker).not.toContain(marker);
    }
    // 🔴 応答に載るキーは `kind` / `count` / `href` の 3 つだけ（ラベル・色・率を返さない）。
    for (const item of block.items) {
      expect(Object.keys(item).sort()).toEqual(['count', 'href', 'kind']);
    }
  });

  it('ホストの応答に取引先固有の指標（`共有中`）が混ざらない', async () => {
    const block = await readSummaryBlock(fakeDb({}, []), 'HOST', { canManageShares: true });
    expect(block.items.map((item) => item.kind as string)).not.toContain('SHARED_ENGINEERS');
  });
});
