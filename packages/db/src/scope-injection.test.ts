// packages/db/src/scope-injection.test.ts
// 第 2 防御（Prisma 拡張の where / data 注入）の単体検証。
// 🔴 RLS が無効化されてもアプリは正常に動くため、機能テストではこの防御の欠落に気づけない
//    （docs/05 §4.1 第 5 防御）。ここと tests/isolation/double-defense.test.ts が唯一の検知手段。
import { describe, expect, it } from 'vitest';
import {
  CrossTenantWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TenantRelationWriteError,
  UnscopedOperationError,
  injectTenantScope,
  tenantKeyMovingRelationsOf,
  tenantKeyOf,
  tenantRelationOf,
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
    it('宣言から逆リレーション名を解決できる（T-02-01: docs/05 §3.3 の 5 表 / T-02-02: §3.4・§3.5 の 10 表を追加）', () => {
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
      ]);
      // 子側は順方向の宣言（tenantRelationOf）が担当する。二重に持たない。
      expect(tenantKeyMovingRelationsOf('Engineer')).toEqual([]);
      expect(tenantKeyMovingRelationsOf('User')).toEqual([]);
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
