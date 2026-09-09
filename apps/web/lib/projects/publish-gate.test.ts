// apps/web/lib/projects/publish-gate.test.ts
// 🔴 案件の公開のゲート接続が、**どんな入力でも同期的に公開を成立させない**こと、および
//    「これから公開する相手」と「内容のハッシュ」を取りこぼさずゲートまで運ぶことを固定する。
//    T-06-06（スタブ）→ T-07-09（実装）。
//
// なぜこのテストが要るか（`CLAUDE.md` §11.1 と同型の壊れ方）: ここが「PASS だったので公開した」に
// 化けると、**ゲートを 1 度も通していない案件が取引先に見え、しかも画面は「公開しました」と
// 表示する**（`F-014 AC-3` を破ったことに誰も気づけない）。
import { describe, expect, it, vi } from 'vitest';
import type { GateRunJob, GateRunJobQueue } from '@ses/connectors';
import type { AuthenticatedTenantCtx } from '@ses/db';
import { GATE_FINDING_FIELDS, type GateFindingField } from '@ses/domain';
import { PUBLISHED_FIELDS, type PublishedField } from './publish-preview';
import {
  createProjectPublishGate,
  PROJECT_PUBLISH_GATE_TARGET_TYPE,
  type ProjectPublishGateDb,
} from './publish-gate';

const CTX = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  partnerCompanyId: null,
  userId: '22222222-2222-4222-8222-222222222222',
} as unknown as AuthenticatedTenantCtx;

const NOW = new Date('2026-09-09T03:00:00.000Z');

type UpsertCall = {
  where: { tenantId_projectId: { tenantId: string; projectId: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

/** 🔴 Prisma の delegate を最小限だけ模す（DB を立てずに「何を書くか」を固定する）。 */
function fakeDb(overrides: {
  readonly name?: string;
  readonly publicSummary?: string | null;
  readonly requirementTexts?: readonly (string | null)[];
  readonly published?: readonly string[];
  readonly partners?: readonly { id: string; name: string }[];
  readonly projectMissing?: boolean;
}): { db: ProjectPublishGateDb; upserts: UpsertCall[] } {
  const upserts: UpsertCall[] = [];
  const db = {
    project: {
      findUnique: async () =>
        overrides.projectMissing === true
          ? null
          : {
              name: overrides.name ?? '基幹システム刷新',
              publicSummary: overrides.publicSummary ?? '公開用の記載',
              endClientName: 'エンド企業',
              internalUnitPrice: null,
            },
    },
    projectRequirement: {
      findMany: async () =>
        (overrides.requirementTexts ?? ['金融系の経験']).map((freeText) => ({ freeText })),
    },
    projectVisibility: {
      findMany: async () =>
        (overrides.published ?? []).map((partnerCompanyId) => ({ partnerCompanyId })),
    },
    partnerCompany: {
      findMany: async () => overrides.partners ?? [{ id: 'partner-a', name: 'エー社' }],
    },
    projectPublishRequest: {
      upsert: async (call: UpsertCall) => {
        upserts.push(call);
        return {};
      },
    },
  } as unknown as ProjectPublishGateDb;
  return { db, upserts };
}

function fakeQueue(): { queue: GateRunJobQueue; calls: string[]; jobs: GateRunJob[] } {
  const calls: string[] = [];
  const jobs: GateRunJob[] = [];
  return {
    calls,
    jobs,
    queue: {
      enqueue: vi.fn(async (job: GateRunJob) => {
        calls.push('enqueue');
        jobs.push(job);
      }),
      removeFailedJob: vi.fn(async () => {
        calls.push('removeFailedJob');
        return 'NOT_FOUND' as const;
      }),
    },
  };
}

describe('🔴 検査する欄は「公開先が実際に読む欄」と 1 対 1 である（docs/05 §11.11 ⑧）', () => {
  /**
   * 🔴 画面の警告（`S-013` のプレビュー）とゲートの合否は、**同じ母集団**を見なければならない。
   *    片方だけに欄が増えると、①ゲートだけに増える → プレビューで何も出ないのに FAIL する
   *    ②プレビューだけに増える → **警告は出るのに公開できてしまう**（`F-014 AC-3` の穴）。
   *    この写像表がその契約であり、`satisfies` により**どちらの列挙が変わってもコンパイルで落ちる**。
   */
  const PUBLISHED_FIELD_TO_GATE_FIELD = {
    name: 'project_name',
    publicSummary: 'public_summary',
    requirement: 'requirement',
  } as const satisfies Record<PublishedField, GateFindingField>;

  it('`PUBLISHED_FIELDS` の全欄に、対応するゲートの欄がある', () => {
    expect(Object.keys(PUBLISHED_FIELD_TO_GATE_FIELD).sort()).toEqual([...PUBLISHED_FIELDS].sort());
    for (const gateField of Object.values(PUBLISHED_FIELD_TO_GATE_FIELD)) {
      expect(GATE_FINDING_FIELDS).toContain(gateField);
    }
  });
});

describe('createProjectPublishGate（#28 の接続点。docs/05 §11.11）', () => {
  it('🔴 `review_gates` の対象種別は `PROJECT_PUBLISH`（docs/05 §3.6 の 5 種の 1 つ）', () => {
    expect(PROJECT_PUBLISH_GATE_TARGET_TYPE).toBe('PROJECT_PUBLISH');
  });

  it('🔴 応答は常に「保留」である（PASS だったので公開した、という枝が無い）', async () => {
    const { db } = fakeDb({});
    const { queue } = fakeQueue();

    const outcome = await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
      projectId: '33333333-3333-4333-8333-333333333333',
      partnerCompanyIds: ['partner-a'],
    });

    expect(outcome.held).toBe(true);
    expect(outcome.reviewGateId).toBeNull();
  });

  it('🔴 公開要求に「これから公開する相手」と実施者（ctx 由来）を残す', async () => {
    const { db, upserts } = fakeDb({});
    const { queue } = fakeQueue();

    await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
      projectId: '33333333-3333-4333-8333-333333333333',
      partnerCompanyIds: ['partner-a'],
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.where.tenantId_projectId).toEqual({
      tenantId: CTX.tenantId,
      projectId: '33333333-3333-4333-8333-333333333333',
    });
    expect(upserts[0]?.update).toMatchObject({
      partnerCompanyIds: ['partner-a'],
      requestedAt: NOW,
      // 🔴 実施者はリクエスト入力ではなく認証コンテキストから来る（`CLAUDE.md` §3.1）。
      requestedBy: CTX.userId,
    });
    expect(typeof upserts[0]?.update.contentHash).toBe('string');
  });

  it('🔴 `enqueue` を呼ぶまでジョブは 1 本も積まれない（コミット後に積むための形）', async () => {
    const { db } = fakeDb({});
    const { queue, calls } = fakeQueue();

    const outcome = await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
      projectId: '33333333-3333-4333-8333-333333333333',
      partnerCompanyIds: ['partner-a'],
    });
    expect(calls).toEqual([]);

    await outcome.enqueue();
    // 🔴 失敗した同 `jobId` の削除が先（§9.10 ②。残っていると `add` が静かに捨てられる）。
    expect(calls).toEqual(['removeFailedJob', 'enqueue']);
  });

  it('🔴 payload の対象は案件であり、内容のハッシュが載る（`jobId` の材料）', async () => {
    const { db, upserts } = fakeDb({});
    const { queue, jobs } = fakeQueue();

    const outcome = await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
      projectId: '33333333-3333-4333-8333-333333333333',
      partnerCompanyIds: ['partner-a'],
    });
    await outcome.enqueue();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      tenantId: CTX.tenantId,
      targetType: 'PROJECT_PUBLISH',
      targetId: '33333333-3333-4333-8333-333333333333',
      // 🔴 公開要求に残した値と**同じ 1 つのハッシュ**（別実装で作らない）。
      contentHash: upserts[0]?.update.contentHash,
    });
  });

  it('🔴 公開文が違えば別のハッシュになる（＝ 別の `jobId` / キャッシュを引かない）', async () => {
    const hashOf = async (publicSummary: string): Promise<unknown> => {
      const { db, upserts } = fakeDb({ publicSummary });
      const { queue } = fakeQueue();
      await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds: ['partner-a'],
      });
      return upserts[0]?.update.contentHash;
    };
    expect(await hashOf('A')).not.toBe(await hashOf('B'));
  });

  // 🔴 T-07-09 の是正（docs/05 §11.11 ⑧）: 検査する欄は公開文だけではない。案件名と要件の
  //    フリーテキストも公開先が読む欄であり、内容のハッシュの材料でもある ——
  //    入っていないと「案件名だけ直して再要求」が FAIL のキャッシュを引き、
  //    逆に「PASS 後に案件名へ商流情報を書き足す」が検査されないまま公開される。
  it('🔴 案件名が違えば別のハッシュになる', async () => {
    const hashOf = async (name: string): Promise<unknown> => {
      const { db, upserts } = fakeDb({ name });
      const { queue } = fakeQueue();
      await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds: ['partner-a'],
      });
      return upserts[0]?.update.contentHash;
    };
    expect(await hashOf('案件 A')).not.toBe(await hashOf('案件 B'));
  });

  it('🔴 要件のフリーテキストが違えば別のハッシュになる（空文字・null は数えない）', async () => {
    const hashOf = async (requirementTexts: readonly (string | null)[]): Promise<unknown> => {
      const { db, upserts } = fakeDb({ requirementTexts });
      const { queue } = fakeQueue();
      await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds: ['partner-a'],
      });
      return upserts[0]?.update.contentHash;
    };
    expect(await hashOf(['金融系の経験'])).not.toBe(await hashOf(['製造系の経験']));
    // 🔴 フリーテキストを持たない要件（`null`）と空文字は材料に入らない ＝ 同じハッシュ。
    expect(await hashOf(['金融系の経験'])).toBe(await hashOf(['金融系の経験', null, '  ']));
  });

  it('🔴 公開先が違えば別のハッシュになる（同じ本文でもキャッシュを引かない。`F-014 AC-3`）', async () => {
    const partners = [
      { id: 'partner-a', name: 'エー社' },
      { id: 'partner-b', name: 'ビー社' },
    ];
    const hashOf = async (partnerCompanyIds: readonly string[]): Promise<unknown> => {
      const { db, upserts } = fakeDb({ partners });
      const { queue } = fakeQueue();
      await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds,
      });
      return upserts[0]?.update.contentHash;
    };
    expect(await hashOf(['partner-a'])).not.toBe(await hashOf(['partner-a', 'partner-b']));
  });

  it('🔴 すでに公開済みの相手も内容の一部である（公開範囲が変われば再検査になる）', async () => {
    const partners = [
      { id: 'partner-a', name: 'エー社' },
      { id: 'partner-b', name: 'ビー社' },
    ];
    const hashOf = async (published: readonly string[]): Promise<unknown> => {
      const { db, upserts } = fakeDb({ partners, published });
      const { queue } = fakeQueue();
      await createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds: ['partner-a'],
      });
      return upserts[0]?.update.contentHash;
    };
    expect(await hashOf([])).not.toBe(await hashOf(['partner-b']));
  });

  it('🔴 案件が見えないまま呼ばれたら握り潰さず落ちる（0 件を成功にしない）', async () => {
    const { db } = fakeDb({ projectMissing: true });
    const { queue } = fakeQueue();

    await expect(
      createProjectPublishGate({ queue, now: NOW })(db, CTX, {
        projectId: '33333333-3333-4333-8333-333333333333',
        partnerCompanyIds: ['partner-a'],
      }),
    ).rejects.toThrow();
  });
});
