// packages/db/src/scope-injection.test.ts
// 第 2 防御（Prisma 拡張の where / data 注入）の単体検証。
// 🔴 RLS が無効化されてもアプリは正常に動くため、機能テストではこの防御の欠落に気づけない
//    （docs/05 §4.1 第 5 防御）。ここと tests/isolation/double-defense.test.ts が唯一の検知手段。
import { describe, expect, it } from 'vitest';
import {
  CrossTenantWriteError,
  PARTNER_BASE_TABLE_MODELS,
  PARTNER_VIEW_MODELS,
  PartnerBaseTableAccessError,
  PartnerViewWriteError,
  ReadOnlyModelWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TENANT_SCOPE_STRATEGY_DECLARATIONS,
  TENANT_SCOPE_SYSTEM_ONLY_MODELS,
  SystemOnlyModelAccessError,
  TenantRelationWriteError,
  UnscopedOperationError,
  assertPartnerBaseTableNotAccessed,
  injectPartnerViewScope,
  injectTenantScope,
  tenantKeyBackingRelationsOf,
  tenantKeyMovingRelationsOf,
  tenantKeyOf,
  tenantRelationOf,
  tenantScopeStrategyOf,
} from './scope-injection.js';

const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

function inject(model: string, operation: string, args: unknown): unknown {
  return injectTenantScope({ model, operation, args, tenantId: TENANT_A });
}

describe('射程（CLAUDE.md §3.1）', () => {
  it('注入対象外は Skill / Plan / Subscription / PlatformUser の 4 モデルだけである', () => {
    // 🔴 この配列を増やすことは情報境界の前提を変えること（人間の承認事項。CLAUDE.md §8.6）。
    expect([...TENANT_SCOPE_EXCLUDED_MODELS]).toEqual([
      'Skill',
      'Plan',
      'Subscription',
      'PlatformUser',
    ]);
  });

  it('射程外の 4 モデルはテナントキーを持たない', () => {
    for (const model of TENANT_SCOPE_EXCLUDED_MODELS) {
      expect(tenantKeyOf(model)).toBeNull();
    }
  });

  it('Tenant のテナントキーは自身の id である（docs/05 §3.1 の例外）', () => {
    expect(tenantKeyOf('Tenant')).toBe('id');
  });

  it('その他の業務モデルは既定の tenantId が注入先になる', () => {
    expect(tenantKeyOf('Engineer')).toBe('tenantId');
    expect(tenantKeyOf('Proposal')).toBe('tenantId');
  });

  it('射程外モデルの引数は素通しする', () => {
    const args = { where: { id: 'skill-1' } };
    expect(inject('Skill', 'findMany', args)).toBe(args);
  });
});

describe('where への注入（🔴 条件は狭まる方向にしか動かない）', () => {
  it.each([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'delete',
    'deleteMany',
    'aggregate',
    'count',
    'groupBy',
  ])('%s の where に AND でテナント条件を足す', (operation) => {
    expect(inject('Engineer', operation, { where: { displayName: '山田' } })).toEqual({
      where: { displayName: '山田', AND: [{ tenantId: TENANT_A }] },
    });
  });

  it.each(['update', 'updateMany', 'updateManyAndReturn'])(
    '%s も where に AND でテナント条件を足す（data はそのまま残る）',
    (operation) => {
      expect(
        inject('Engineer', operation, {
          where: { displayName: '山田' },
          data: { displayName: '山田太郎' },
        }),
      ).toEqual({
        where: { displayName: '山田', AND: [{ tenantId: TENANT_A }] },
        data: { displayName: '山田太郎' },
      });
    },
  );

  it('where が未指定でも注入する', () => {
    expect(inject('Engineer', 'findMany', undefined)).toEqual({
      where: { AND: [{ tenantId: TENANT_A }] },
    });
  });

  it('🔴 呼び出し側が他テナントを指定した場合、条件が両立せず 0 件になる形になる', () => {
    // 上書きにすると deleteMany({ where: { tenantId: 他テナント } }) が
    // 「自テナントを全消し」に化ける。AND なら必ず 0 件（docs/05 §4.8）。
    expect(inject('Engineer', 'deleteMany', { where: { tenantId: TENANT_B } })).toEqual({
      where: { tenantId: TENANT_B, AND: [{ tenantId: TENANT_A }] },
    });
  });

  it('🔴 findUnique では一意フィールドが最上位に残る（extendedWhereUnique を壊さない）', () => {
    const result = inject('Engineer', 'findUnique', { where: { id: 'engineer-1' } }) as {
      where: Record<string, unknown>;
    };
    expect(result.where['id']).toBe('engineer-1');
    expect(result.where['AND']).toEqual([{ tenantId: TENANT_A }]);
  });

  it('既存の AND（配列）を保ったまま追加する', () => {
    expect(
      inject('Engineer', 'findMany', { where: { AND: [{ displayName: '山田' }] } }),
    ).toEqual({ where: { AND: [{ displayName: '山田' }, { tenantId: TENANT_A }] } });
  });

  it('既存の AND（単一オブジェクト形）も保ったまま追加する', () => {
    expect(inject('Engineer', 'findMany', { where: { AND: { displayName: '山田' } } })).toEqual({
      where: { AND: [{ displayName: '山田' }, { tenantId: TENANT_A }] },
    });
  });

  it('OR を書いても、テナント条件は OR の外側で AND される（境界を広げられない）', () => {
    expect(
      inject('Engineer', 'findMany', {
        where: { OR: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] },
      }),
    ).toEqual({
      where: {
        OR: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }],
        AND: [{ tenantId: TENANT_A }],
      },
    });
  });

  it('Tenant では id にテナント条件を足す', () => {
    expect(inject('Tenant', 'findMany', { where: { id: TENANT_B } })).toEqual({
      where: { id: TENANT_B, AND: [{ id: TENANT_A }] },
    });
  });

  it('引数を破壊しない', () => {
    const args = { where: { displayName: '山田' } };
    inject('Engineer', 'findMany', args);
    expect(args).toEqual({ where: { displayName: '山田' } });
  });
});

describe('data への注入', () => {
  it('create の data にテナントキーを設定する', () => {
    expect(inject('Engineer', 'create', { data: { displayName: '山田' } })).toEqual({
      data: { displayName: '山田', tenantId: TENANT_A },
    });
  });

  it('createMany の配列の全要素に設定する', () => {
    expect(
      inject('Engineer', 'createMany', {
        data: [{ displayName: '山田' }, { displayName: '鈴木', tenantId: TENANT_A }],
      }),
    ).toEqual({
      data: [
        { displayName: '山田', tenantId: TENANT_A },
        { displayName: '鈴木', tenantId: TENANT_A },
      ],
    });
  });

  it('upsert は where と create の両方を扱う', () => {
    expect(
      inject('Engineer', 'upsert', {
        where: { id: 'engineer-1' },
        create: { displayName: '山田' },
        update: { displayName: '山田' },
      }),
    ).toEqual({
      where: { id: 'engineer-1', AND: [{ tenantId: TENANT_A }] },
      create: { displayName: '山田', tenantId: TENANT_A },
      update: { displayName: '山田' },
    });
  });
});

// 🔴 where の注入だけでは、既存行の所属を data で書き換える攻撃（行の移動）を止められない。
//    T-01-04 のレビューで、RLS を落とした DB に対して update / updateMany /
//    upsert(update 分岐) / tenant.connect の 4 経路で実際に行が移動することが実証された。
//    docs/05 §4.1 第 2 防御「書き込み data のテナントキー検査」。
describe('🔴 update 系 data のテナントキー検査（行の移動を止める）', () => {
  it('テナントキーを裏付けるリレーション名を宣言から解決できる', () => {
    expect(tenantRelationOf('Engineer')).toBe('tenant');
    // Tenant のテナントキーは自身の id であり、裏付けるリレーションを持たない。
    expect(tenantRelationOf('Tenant')).toBeNull();
    // 射程外モデルはそもそも注入対象でない。
    expect(tenantRelationOf('Skill')).toBeNull();
  });

  it('① update の data.tenantId が他テナントなら例外にする', () => {
    expect(() =>
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { tenantId: TENANT_B },
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('② updateMany の data.tenantId が他テナントなら例外にする', () => {
    expect(() =>
      inject('Engineer', 'updateMany', {
        where: { id: 'engineer-1' },
        data: { tenantId: TENANT_B },
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('updateManyAndReturn も同様に例外にする', () => {
    expect(() =>
      inject('Engineer', 'updateManyAndReturn', { data: { tenantId: TENANT_B } }),
    ).toThrow(CrossTenantWriteError);
  });

  it('③ upsert の update 分岐の tenantId が他テナントなら例外にする', () => {
    expect(() =>
      inject('Engineer', 'upsert', {
        where: { id: 'engineer-1' },
        create: { displayName: '山田' },
        update: { tenantId: TENANT_B },
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('④ update の tenant: { connect } は値を問わず例外にする', () => {
    expect(() =>
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { tenant: { connect: { id: TENANT_B } } },
      }),
    ).toThrow(TenantRelationWriteError);
  });

  it.each(['connect', 'set', 'create', 'connectOrCreate', 'disconnect'])(
    '🔴 リレーション経由の書き込みは %s でも例外にする（スカラーだけ塞いでも迂回される）',
    (nestedOperation) => {
      expect(() =>
        inject('Engineer', 'update', {
          where: { id: 'engineer-1' },
          data: { tenant: { [nestedOperation]: { id: TENANT_B } } },
        }),
      ).toThrow(TenantRelationWriteError);
    },
  );

  it('🔴 自テナントへの connect でも例外にする（テナントキーを決めるのは拡張だけ）', () => {
    expect(() =>
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { tenant: { connect: { id: TENANT_A } } },
      }),
    ).toThrow(TenantRelationWriteError);
  });

  it('🔴 create の data でもリレーション経由の書き込みを例外にする', () => {
    expect(() =>
      inject('Engineer', 'create', {
        data: { displayName: '山田', tenant: { connect: { id: TENANT_B } } },
      }),
    ).toThrow(TenantRelationWriteError);
  });

  it('⑤ { set: 他テナント } 形の更新も例外にする', () => {
    // Prisma のスカラー更新は素の値と { set: value } の 2 形をとる。
    expect(() =>
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { tenantId: { set: TENANT_B } },
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('🔴 解釈できない更新演算子は fail-closed で例外にする', () => {
    expect(() =>
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { tenantId: { increment: 1 } },
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('Tenant の update で id を他テナントに変えようとしたら例外にする', () => {
    expect(() =>
      inject('Tenant', 'update', { where: { id: TENANT_A }, data: { id: TENANT_B } }),
    ).toThrow(CrossTenantWriteError);
  });

  // 🔴 経路 ⑥。子 → 親（Engineer.tenant）を塞いでも、親 → 子（Tenant.engineers）から
  //    同じ engineers.tenant_id 列を書ける。RLS を落とした DB で
  //    tenant.update({ where: { id: 自テナント }, data: { engineers: { connect: { id: 他テナントの行 } } } })
  //    が例外なく成功し、実際に行が移動することが実測された。
  describe('🔴 逆リレーション経由のテナントキー書き換え（経路 ⑥）', () => {
    it('宣言から逆リレーション名を解決できる（T-02-01: docs/05 §3.3 の 5 表 / T-02-02: §3.4・§3.5 の 10 表 / T-02-03: §3.6 の 5 表 / T-02-04: §3.7 の 9 表 / T-02-05: §3.8・§3.9・§3.10 の 15 表を追加）', () => {
      expect(tenantKeyMovingRelationsOf('Tenant')).toEqual([
        'engineers',
        'users',
        'memberships',
        'partnerCompanies',
        'invitations',
        'sendingDomains',
        'skillAliases',
        'engineerSkills',
        'skillSheets',
        'skillSheetExtractions',
        'fileScanResults',
        'projects',
        'projectRequirements',
        'projectVisibilities',
        'matchCandidates',
        'engineerShares',
        'proposalRequests',
        'proposals',
        'engineerSnapshots',
        'proposalEvents',
        'reviewGates',
        'chatThreads',
        'threadParticipants',
        'messages',
        'contracts',
        'contractDocuments',
        'contractTemplates',
        'orders',
        'assignments',
        'extensionReviews',
        'tasks',
        'notifications',
        'aiUsages',
        'auditLogs',
        'usageCounters',
        'sendAttempts',
        'emailDispatches',
        'tenantEsignConnection',
        'tenantMonthlyCosts',
        'billingMeterSubmissions',
        'dataExportRequests',
        'tenantPurgeRuns',
        'tenantRoleApprovalModes',
        'tenantRoleModels',
        'tenantMatchWeights',
      ]);
      // 子側は順方向の宣言（tenantRelationOf）が担当する。二重に持たない。
      expect(tenantKeyMovingRelationsOf('Engineer')).toEqual([]);
      expect(tenantKeyMovingRelationsOf('User')).toEqual([]);
      // 🔴 T-02-05: Subscription は射程外モデルのため Tenant.subscription はここに現れない
      //    （tenant-relation.test.ts が DMMF 側の対照を取る）。
      expect(tenantKeyMovingRelationsOf('Tenant')).not.toContain('subscription');
    });

    it('⑥ Tenant.update の data.engineers は値を問わず例外にする', () => {
      expect(() =>
        inject('Tenant', 'update', {
          where: { id: TENANT_A },
          data: { engineers: { connect: { id: 'engineer-b' } } },
        }),
      ).toThrow(TenantRelationWriteError);
    });

    it('🔴 T-02-01: Tenant.update の data.users も値を問わず例外にする（docs/05 §3.3 の新表への横展開）', () => {
      expect(() =>
        inject('Tenant', 'update', {
          where: { id: TENANT_A },
          data: { users: { connect: { id: 'user-b' } } },
        }),
      ).toThrow(TenantRelationWriteError);
    });

    it.each(['connect', 'set', 'create', 'connectOrCreate', 'disconnect', 'update', 'updateMany'])(
      '🔴 Tenant.engineers への書き込みは %s でも例外にする',
      (nestedOperation) => {
        expect(() =>
          inject('Tenant', 'update', {
            where: { id: TENANT_A },
            data: { engineers: { [nestedOperation]: { id: 'engineer-b' } } },
          }),
        ).toThrow(TenantRelationWriteError);
      },
    );

    it.each(['updateMany', 'upsert', 'create'])(
      '%s でも逆リレーションへの書き込みを例外にする（update だけ塞いでも迂回される）',
      (operation) => {
        const args =
          operation === 'upsert'
            ? {
                where: { id: TENANT_A },
                create: { name: 'Tenant A' },
                update: { engineers: { connect: { id: 'engineer-b' } } },
              }
            : operation === 'create'
              ? { data: { name: 'Tenant A', engineers: { connect: { id: 'engineer-b' } } } }
              : {
                  where: { id: TENANT_A },
                  data: { engineers: { connect: { id: 'engineer-b' } } },
                };
        expect(() => inject('Tenant', operation, args)).toThrow(TenantRelationWriteError);
      },
    );

    /**
     * 🔴 Issue #33 / docs/05 §3.3.1: パートナーを指す FK が複合 FK
     * （`fields: [tenantId, <パートナー列>]`）になったことで、**`tenant` 以外にも
     * テナントキー列を書けるリレーションが生まれた**。第 2 防御はこれも塞ぐ。
     *
     * 塞がないと `invitation.create({ data: { partnerCompany: { connect: … } } })` が
     * `invitations.tenant_id` を書く経路になり、`tenant` だけを塞いだ意味が無くなる
     * （`Engineer.tenant` を塞いでも `Tenant.engineers` から書けた経路 ⑥ と同型）。
     */
    describe('🔴 Issue #33: 複合 FK が生んだ 2 本目の裏付けリレーション', () => {
      it('宣言（tenantKeyBackingRelationsOf）が tenant + パートナー側の 2 本を返す', () => {
        expect(tenantKeyBackingRelationsOf('Invitation')).toEqual(['tenant', 'partnerCompany']);
        expect(tenantKeyBackingRelationsOf('Message')).toEqual(['tenant', 'senderPartnerCompany']);
        expect(tenantKeyBackingRelationsOf('Contract')).toEqual([
          'tenant',
          'counterpartyPartnerCompany',
        ]);
        expect(tenantKeyBackingRelationsOf('Task')).toEqual(['tenant', 'ownerPartnerCompany']);
        // 複合 FK を持たない表は 1 本のまま（宣言が広がりすぎていない対照）。
        expect(tenantKeyBackingRelationsOf('Project')).toEqual(['tenant']);
        // 射程外モデルは 0 本。
        expect(tenantKeyBackingRelationsOf('Skill')).toEqual([]);
      });

      it.each([
        ['Invitation', 'partnerCompany'],
        ['Membership', 'partnerCompany'],
        ['User', 'ownerPartnerCompany'],
        ['Engineer', 'ownerPartnerCompany'],
        ['ProjectVisibility', 'partnerCompany'],
        ['EngineerShare', 'partnerCompany'],
        ['ProposalRequest', 'partnerCompany'],
        ['Proposal', 'ownerPartnerCompany'],
        ['ChatThread', 'partnerCompany'],
        ['ThreadParticipant', 'partnerCompany'],
        ['Message', 'senderPartnerCompany'],
        ['Contract', 'counterpartyPartnerCompany'],
        ['Task', 'ownerPartnerCompany'],
      ])('%s.create の data.%s は値を問わず例外にする', (model, relation) => {
        expect(() =>
          inject(model, 'create', { data: { [relation]: { connect: { id: 'partner-b' } } } }),
        ).toThrow(TenantRelationWriteError);
      });

      it('🔴 PartnerCompany 側の逆リレーションも塞ぐ（partnerCompany.update から子の tenant_id を書けない）', () => {
        expect(() =>
          inject('PartnerCompany', 'update', {
            where: { id: 'partner-a' },
            data: { invitations: { connect: { id: 'invitation-b' } } },
          }),
        ).toThrow(TenantRelationWriteError);
        expect(() =>
          inject('PartnerCompany', 'update', {
            where: { id: 'partner-a' },
            data: { tasks: { connect: { id: 'task-b' } } },
          }),
        ).toThrow(TenantRelationWriteError);
      });

      it('🔴 パートナー列そのもの（スカラー）の書き込みは第 2 防御の対象外である（対照）', () => {
        // スカラーの partnerCompanyId は「実行者の所属」ではなく業務入力になりうる
        // （docs/05 §6.4 #14 の targetPartnerCompanyId）。ここを一律拒否すると招待が作れない。
        // 越境は DB の複合 FK（最終防衛線）とアプリ層の RLS 母集団照合（404）が受け持つ。
        expect(
          inject('Invitation', 'create', {
            data: { email: 'x@example.com', partnerCompanyId: 'partner-a' },
          }),
        ).toEqual({
          data: { email: 'x@example.com', partnerCompanyId: 'partner-a', tenantId: TENANT_A },
        });
      });
    });

    it('🔴 「オブジェクト値を一律拒否」にはしない（Json 列・DateTime・{ set: } が壊れる）', () => {
      // 宣言に無いフィールドのオブジェクト値は通ること。SP-02 で Json 列が来るため。
      expect(
        inject('Tenant', 'update', {
          where: { id: TENANT_A },
          data: { createdAt: new Date(0), name: { set: 'Tenant A' } },
        }),
      ).toEqual({
        where: { id: TENANT_A, AND: [{ id: TENANT_A }] },
        data: { createdAt: new Date(0), name: { set: 'Tenant A' } },
      });
    });

    it('逆リレーションに触れない Tenant の update は素通しする（対照）', () => {
      expect(
        inject('Tenant', 'update', { where: { id: TENANT_A }, data: { name: 'Tenant A2' } }),
      ).toEqual({
        where: { id: TENANT_A, AND: [{ id: TENANT_A }] },
        data: { name: 'Tenant A2' },
      });
    });
  });

  it('自テナントを明示した update は素通しする（対照）', () => {
    expect(
      inject('Engineer', 'update', {
        where: { id: 'engineer-1' },
        data: { displayName: '山田', tenantId: TENANT_A },
      }),
    ).toEqual({
      where: { id: 'engineer-1', AND: [{ tenantId: TENANT_A }] },
      data: { displayName: '山田', tenantId: TENANT_A },
    });
  });

  it('🔴 テナントキー未指定の update に tenantId を書き足さない（updateMany の意味を変えない）', () => {
    const result = inject('Engineer', 'updateMany', {
      where: { displayName: '山田' },
      data: { displayName: '山田太郎' },
    }) as { data: Record<string, unknown> };
    expect(result.data).not.toHaveProperty('tenantId');
  });

  it('射程外モデルの update は素通しする', () => {
    const args = { where: { id: 'skill-1' }, data: { name: 'Java' } };
    expect(inject('Skill', 'update', args)).toBe(args);
  });

  it('引数を破壊しない', () => {
    const args = { where: { id: 'engineer-1' }, data: { displayName: '山田' } };
    inject('Engineer', 'update', args);
    expect(args).toEqual({ where: { id: 'engineer-1' }, data: { displayName: '山田' } });
  });
});

describe('fail-closed', () => {
  it('🔴 create で他テナントを指定したら静かに書き換えず例外にする', () => {
    expect(() => inject('Engineer', 'create', { data: { tenantId: TENANT_B } })).toThrow(
      CrossTenantWriteError,
    );
  });

  it('🔴 createMany の 1 要素でも他テナントなら例外にする', () => {
    expect(() =>
      inject('Engineer', 'createMany', {
        data: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }],
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('🔴 upsert の create が他テナントでも例外にする', () => {
    expect(() =>
      inject('Engineer', 'upsert', {
        where: { id: 'engineer-1' },
        create: { tenantId: TENANT_B },
        update: {},
      }),
    ).toThrow(CrossTenantWriteError);
  });

  it('🔴 分類の無い操作は素通しせず例外にする', () => {
    expect(() => inject('Engineer', 'findRaw', {})).toThrow(UnscopedOperationError);
  });
});

// ---------------------------------------------------------------------------
// 🔴 T-02-06: モデル別のスコープ注入方式（docs/05 §4.4 C1 の 2 つの読み替え）
// ---------------------------------------------------------------------------
describe('🔴 スコープ注入方式の宣言（T-02-02 からの申し送り: SkillAlias の known-gap）', () => {
  it('既定以外の方式を宣言したモデルは SkillAlias / Announcement の 2 つだけである', () => {
    // 🔴 この宣言を増やすことは第 2 防御の述語を緩めることであり、情報境界の前提を変える。
    //    増やすときは docs/05 §4.4 のポリシークラスと必ず対で確認する（CLAUDE.md §8.6）。
    expect([...TENANT_SCOPE_STRATEGY_DECLARATIONS]).toEqual([
      { model: 'SkillAlias', kind: 'COLUMN_WITH_GLOBAL_ROWS' },
      { model: 'Announcement', kind: 'ARRAY_MEMBERSHIP' },
    ]);
  });

  it('宣言の無い業務モデルは既定の COLUMN である', () => {
    expect(tenantScopeStrategyOf('Engineer')).toBe('COLUMN');
    expect(tenantScopeStrategyOf('Tenant')).toBe('COLUMN');
  });

  it('射程外モデルには方式が無い（注入自体を行わない）', () => {
    for (const model of TENANT_SCOPE_EXCLUDED_MODELS) {
      expect(tenantScopeStrategyOf(model)).toBeNull();
    }
  });
});

describe('🔴 SkillAlias: グローバル行（tenant_id IS NULL）は読みだけ緩める（F-010 AC-2）', () => {
  it.each(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'])(
    '%s の where は「自テナント OR グローバル行」で AND される',
    (operation) => {
      expect(inject('SkillAlias', operation, { where: { alias: 'React.js' } })).toEqual({
        where: {
          alias: 'React.js',
          AND: [{ OR: [{ tenantId: TENANT_A }, { tenantId: null }] }],
        },
      });
    },
  );

  it('🔴 他テナントを明示しても、緩和された述語と両立せず 0 件になる形になる', () => {
    // OR は AND の内側に閉じており、呼び出し側の where と OR 結合されない。
    expect(inject('SkillAlias', 'findMany', { where: { tenantId: TENANT_B } })).toEqual({
      where: {
        tenantId: TENANT_B,
        AND: [{ OR: [{ tenantId: TENANT_A }, { tenantId: null }] }],
      },
    });
  });

  it('🔴 delete / deleteMany は緩めない（テナントからグローバル行を消せない）', () => {
    for (const operation of ['delete', 'deleteMany']) {
      expect(inject('SkillAlias', operation, { where: { id: 'alias-1' } })).toEqual({
        where: { id: 'alias-1', AND: [{ tenantId: TENANT_A }] },
      });
    }
  });

  it('🔴 update も緩めない（グローバル行を書き換えられない）', () => {
    expect(inject('SkillAlias', 'update', { where: { id: 'alias-1' }, data: { status: 'ACCEPTED' } })).toEqual({
      where: { id: 'alias-1', AND: [{ tenantId: TENANT_A }] },
      data: { status: 'ACCEPTED' },
    });
  });

  it('🔴 create はテナントキーを ctx で確定させる（グローバル行を作らせない）', () => {
    expect(inject('SkillAlias', 'create', { data: { alias: 'React.js' } })).toEqual({
      data: { alias: 'React.js', tenantId: TENANT_A },
    });
  });

  it('🔴 update で tenantId を null にしようとしたら例外にする（グローバル行への昇格を防ぐ）', () => {
    expect(() =>
      inject('SkillAlias', 'update', { where: { id: 'alias-1' }, data: { tenantId: null } }),
    ).toThrow(CrossTenantWriteError);
  });
});

describe('🔴 Announcement: テナントキーが配列（docs/05 §4.4 C1 の読み替え）', () => {
  it('テナントキーは targetTenantIds である（既定の tenantId 列は存在しない）', () => {
    expect(tenantKeyOf('Announcement')).toBe('targetTenantIds');
  });

  it('読み取りは「全テナント宛（空配列）または自テナントを含む」で AND される', () => {
    expect(inject('Announcement', 'findMany', {})).toEqual({
      where: {
        AND: [
          {
            OR: [
              { targetTenantIds: { isEmpty: true } },
              { targetTenantIds: { has: TENANT_A } },
            ],
          },
        ],
      },
    });
  });

  it('🔴 テナント文脈からの書き込みは例外にする（DB でも SELECT しか GRANT していない）', () => {
    for (const operation of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      expect(() => inject('Announcement', operation, { data: {} })).toThrow(ReadOnlyModelWriteError);
    }
  });

  it('分類の無い操作は ReadOnlyModelWriteError ではなく UnscopedOperationError にする', () => {
    expect(() => inject('Announcement', 'findRaw', {})).toThrow(UnscopedOperationError);
  });
});

describe('🔴 C0 SYSTEM_ONLY はテナント文脈から触れない（docs/05 §4.4 / §4.4.2）', () => {
  it.each([...TENANT_SCOPE_SYSTEM_ONLY_MODELS])(
    '%s: 読み書きのいずれも例外にする（素通ししない）',
    (model) => {
      for (const operation of ['findMany', 'findUnique', 'count', 'create', 'update', 'deleteMany']) {
        expect(() => inject(model, operation, { where: {} })).toThrow(SystemOnlyModelAccessError);
      }
    },
  );

  it('🔴 射程外モデル（素通し）と混同しない: 射程外は例外にならない', () => {
    expect(() => inject('Skill', 'findMany', {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-02-07: 越境経路 5（当事者レコードの参照）— docs/05 §4.3-6 / §4.4 C9 / §4.9
// ---------------------------------------------------------------------------

const PARTNER_A1 = '01930000-0000-7000-8000-0000000000c1';

describe('🔴 パートナー文脈から経路 5 の基底表に触れると例外（docs/05 §4.3-6 ②）', () => {
  it('宣言は assignments / contracts / contract_documents / orders / extension_reviews の 5 モデル', () => {
    expect([...PARTNER_BASE_TABLE_MODELS]).toEqual([
      'Assignment',
      'Contract',
      'ContractDocument',
      'Order',
      'ExtensionReview',
    ]);
  });

  it.each([...PARTNER_BASE_TABLE_MODELS])(
    '%s: パートナー文脈では読み書きのいずれも PartnerBaseTableAccessError になる（0 件ではなく例外）',
    (model) => {
      for (const operation of ['findMany', 'findUnique', 'count', 'create', 'update', 'deleteMany']) {
        expect(() =>
          assertPartnerBaseTableNotAccessed({ model, operation, partnerCompanyId: PARTNER_A1 }),
        ).toThrow(PartnerBaseTableAccessError);
      }
    },
  );

  it('🔴 ホスト文脈（partnerCompanyId = null）では例外にならない（C2 の正常系）', () => {
    for (const model of PARTNER_BASE_TABLE_MODELS) {
      expect(() =>
        assertPartnerBaseTableNotAccessed({ model, operation: 'findMany', partnerCompanyId: null }),
      ).not.toThrow();
    }
  });

  it('経路 5 と無関係のモデルは、パートナー文脈でも例外にならない（空振り防止の対照）', () => {
    for (const model of ['Engineer', 'Proposal', 'Message', 'PartnerAssignmentsV']) {
      expect(() =>
        assertPartnerBaseTableNotAccessed({
          model,
          operation: 'findMany',
          partnerCompanyId: PARTNER_A1,
        }),
      ).not.toThrow();
    }
  });
});

describe('🔴 経路 5 の射影ビューへの当事者スコープ注入（docs/05 §4.9）', () => {
  it('宣言は射影ビュー 4 本である', () => {
    expect([...PARTNER_VIEW_MODELS]).toEqual([
      'PartnerAssignmentsV',
      'PartnerContractsV',
      'PartnerContractDocumentsV',
      'PartnerOrdersV',
    ]);
  });

  it.each([...PARTNER_VIEW_MODELS])('%s: findMany の where に当事者の述語が AND される', (model) => {
    // 🔴 契約書のビューだけは「署名済み最終版のみ」（F-066 AC-2）も鏡写しにする。
    const expected =
      model === 'PartnerContractDocumentsV'
        ? { counterpartyPartnerCompanyId: PARTNER_A1, signedAt: { not: null } }
        : { counterpartyPartnerCompanyId: PARTNER_A1 };
    expect(
      injectPartnerViewScope({
        model,
        operation: 'findMany',
        args: { where: { state: 'ACTIVE' } },
        counterpartyPartnerCompanyId: PARTNER_A1,
      }),
    ).toEqual({
      where: {
        state: 'ACTIVE',
        AND: [expected],
      },
    });
  });

  it('🔴 契約書のビューは「署名済み最終版のみ」も AND する（C9 の述語の鏡写し。F-066 AC-2）', () => {
    expect(
      injectPartnerViewScope({
        model: 'PartnerContractDocumentsV',
        operation: 'count',
        args: {},
        counterpartyPartnerCompanyId: PARTNER_A1,
      }),
    ).toEqual({
      where: { AND: [{ counterpartyPartnerCompanyId: PARTNER_A1, signedAt: { not: null } }] },
    });
  });

  it('🔴 count にも同じ述語が入る（total が境界適用後の母集団だけを数える。F-065 AC-3 / F-066 AC-4）', () => {
    expect(
      injectPartnerViewScope({
        model: 'PartnerContractsV',
        operation: 'count',
        args: {},
        counterpartyPartnerCompanyId: PARTNER_A1,
      }),
    ).toEqual({ where: { AND: [{ counterpartyPartnerCompanyId: PARTNER_A1 }] } });
  });

  it('🔴 呼び出し側が他社を明示指定しても、条件は狭まる方向にしか動かない（0 件になる）', () => {
    const other = '01930000-0000-7000-8000-0000000000c2';
    expect(
      injectPartnerViewScope({
        model: 'PartnerOrdersV',
        operation: 'findMany',
        args: { where: { counterpartyPartnerCompanyId: other } },
        counterpartyPartnerCompanyId: PARTNER_A1,
      }),
    ).toEqual({
      where: {
        counterpartyPartnerCompanyId: other,
        AND: [{ counterpartyPartnerCompanyId: PARTNER_A1 }],
      },
    });
  });

  it('🔴 書き込みは例外にする（経路 5 に書き込みは無い。BR-68）', () => {
    for (const operation of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      expect(() =>
        injectPartnerViewScope({
          model: 'PartnerAssignmentsV',
          operation,
          args: { data: {} },
          counterpartyPartnerCompanyId: PARTNER_A1,
        }),
      ).toThrow(PartnerViewWriteError);
    }
  });

  it('射影ビュー以外のモデルは素通しする（テナントスコープの注入は injectTenantScope の責務）', () => {
    const args = { where: { id: 'x' } };
    expect(
      injectPartnerViewScope({
        model: 'Engineer',
        operation: 'findMany',
        args,
        counterpartyPartnerCompanyId: PARTNER_A1,
      }),
    ).toBe(args);
  });
});
