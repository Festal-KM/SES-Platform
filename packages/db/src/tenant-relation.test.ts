// packages/db/src/tenant-relation.test.ts
// 🔴 `scope-injection.ts` の `TENANT_RELATION_OVERRIDES`（宣言）と、Prisma スキーマの実体が
//    一致していることを DMMF で検証する。
//
//    なぜ要るか: 書き込み側の防御は「テナントキーを裏付けるリレーションへの書き込みを拒否する」
//    という宣言に依存している。宣言と実体が食い違ったモデルでは、その拒否が静かに効かなくなり、
//    `data: { <実際のリレーション名>: { connect: { id: 他テナント } } }` で行を他テナントへ
//    移せる状態に戻る（T-01-04 で実測により突破された経路そのもの）。
//    scope-injection.ts 自身は Prisma の生成物を import しない方針のため、照合はここで行う。
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  TENANT_SCOPE_EXCLUDED_MODELS,
  tenantKeyMovingRelationsOf,
  tenantKeyOf,
  tenantRelationOf,
} from './scope-injection.js';

const MODELS = Prisma.dmmf.datamodel.models;

type DmmfModel = (typeof MODELS)[number];
type DmmfField = DmmfModel['fields'][number];

/**
 * リレーションフィールドの「相手側」のフィールドを `relationName` で引く。
 * 自己リレーションでは同名フィールドが両側になりうるため、自分自身は除く。
 */
function oppositeRelationField(model: DmmfModel, field: DmmfField): DmmfField | undefined {
  const opposite = MODELS.find((candidate) => candidate.name === field.type);
  if (opposite === undefined) return undefined;
  return opposite.fields.find(
    (candidate) =>
      candidate.kind === 'object' &&
      candidate.relationName === field.relationName &&
      !(opposite.name === model.name && candidate.name === field.name),
  );
}

/**
 * 🔴 そのモデルの object フィールドのうち、**ネスト write が相手モデルのテナントキー列を
 * 書き換えうる**ものを列挙する（逆リレーション）。
 *
 * 判定: 相手側のリレーションフィールドが持つ外部キー（`relationFromFields`）に、
 * 相手モデルのテナントキーが含まれるか。含まれるなら、こちら側からのネスト write
 * （`connect` / `set` / `create` / …）でその列に値が書かれる。
 */
function inverseTenantKeyRelations(model: DmmfModel): string[] {
  return model.fields
    .filter((field) => field.kind === 'object')
    .filter((field) => {
      const oppositeTenantKey = tenantKeyOf(field.type);
      if (oppositeTenantKey === null) return false;
      const opposite = oppositeRelationField(model, field);
      return (opposite?.relationFromFields ?? []).includes(oppositeTenantKey);
    })
    .map((field) => field.name);
}

describe('テナントキーを裏付けるリレーションの宣言（scope-injection.ts）', () => {
  it('検証対象のモデルが 1 つ以上ある（DMMF の読み取りが空振りしていない）', () => {
    expect(MODELS.length).toBeGreaterThan(0);
  });

  it.each(MODELS.map((model) => model.name))(
    '🔴 %s: テナントキー列を裏付けるリレーションは、宣言された名前のものしか存在しない',
    (modelName) => {
      const model = MODELS.find((candidate) => candidate.name === modelName);
      expect(model).toBeDefined();
      const tenantKey = tenantKeyOf(modelName);
      if (tenantKey === null) return; // 射程外の 4 モデル（CLAUDE.md §3.1）

      const backingRelations = (model?.fields ?? [])
        .filter((field) => field.kind === 'object')
        .filter((field) => (field.relationFromFields ?? []).includes(tenantKey))
        .map((field) => field.name);

      const declared = tenantRelationOf(modelName);
      // 宣言が無い（null）なら裏付けリレーションは 1 つも無いこと。
      // 宣言があるなら、実体は宣言どおりの 1 本か、まだ存在しないかのどちらかであること。
      // 🔴 「宣言に無い名前のリレーションが同じ列を書ける」状態だけを落とす。
      const allowed = declared === null ? [] : [declared];
      expect(
        backingRelations.filter((name) => !allowed.includes(name)),
        `${modelName}: ${tenantKey} を書けるリレーション ${backingRelations.join(' / ')} が ` +
          'scope-injection.ts の TENANT_RELATION_OVERRIDES に宣言されていません',
      ).toEqual([]);
    },
  );

  it('Engineer の裏付けリレーションは実体として tenant である（宣言が空振りしていない対照）', () => {
    const engineer = MODELS.find((model) => model.name === 'Engineer');
    const backing = (engineer?.fields ?? [])
      .filter((field) => field.kind === 'object')
      .filter((field) => (field.relationFromFields ?? []).includes('tenantId'))
      .map((field) => field.name);
    expect(backing).toEqual(['tenant']);
    expect(tenantRelationOf('Engineer')).toBe('tenant');
  });

  it('Tenant はテナントキー（id）を裏付けるリレーションを持たない', () => {
    expect(tenantRelationOf('Tenant')).toBeNull();
  });
});

// 🔴 順方向（自モデルの FK を裏付けるリレーション）だけを走査しても、逆方向は素通しになる。
//    `Tenant.engineers` は `Tenant` 自身の列を 1 つも書かないため上の走査には現れないが、
//    `tenant.update({ data: { engineers: { connect: { id: 他テナントの行 } } } })` で
//    `engineers.tenant_id` を書き換えられる（T-01-04 のレビューで実測により突破された経路 ⑥）。
//    SP-02 で 56 表へ広げるとき、新しい逆リレーションが未宣言のまま増えるのを CI で止める。
describe('🔴 逆リレーション（他モデルのテナントキー列を書き換えうるネスト write）の宣言', () => {
  it.each(MODELS.map((model) => model.name))(
    '🔴 %s: 逆リレーションはすべて TENANT_KEY_MOVING_RELATION_OVERRIDES に宣言されている',
    (modelName) => {
      const model = MODELS.find((candidate) => candidate.name === modelName);
      expect(model).toBeDefined();

      const found = inverseTenantKeyRelations(model as DmmfModel);
      const declared = tenantKeyMovingRelationsOf(modelName);

      expect(
        found.filter((name) => !declared.includes(name)),
        `${modelName}: 他モデルのテナントキー列を書けるリレーション ${found.join(' / ')} が ` +
          'scope-injection.ts の TENANT_KEY_MOVING_RELATION_OVERRIDES に宣言されていません',
      ).toEqual([]);
    },
  );

  it('Tenant の逆リレーションは実体として宣言と一致する（宣言が空振りしていない対照。T-02-01 で docs/05 §3.3 の 5 表を追加）', () => {
    const tenant = MODELS.find((model) => model.name === 'Tenant');
    expect(tenant).toBeDefined();
    const expected = [
      'engineers',
      'users',
      'memberships',
      'partnerCompanies',
      'invitations',
      'sendingDomains',
    ];
    expect(inverseTenantKeyRelations(tenant as DmmfModel)).toEqual(expected);
    expect(tenantKeyMovingRelationsOf('Tenant')).toEqual(expected);
  });

  it('Engineer.tenant は逆リレーションではない（順方向の宣言が担当する二重計上を避ける）', () => {
    const engineer = MODELS.find((model) => model.name === 'Engineer');
    expect(engineer).toBeDefined();
    expect(inverseTenantKeyRelations(engineer as DmmfModel)).toEqual([]);
    expect(tenantKeyMovingRelationsOf('Engineer')).toEqual([]);
  });

  it('🔴 射程外 4 モデルには宣言を置かない（置いても注入自体が行われず効かない）', () => {
    // 射程外モデルに逆リレーションが生えたら、それは新たな越境経路であり
    // 宣言の追加ではなく人間の判断で解決する（CLAUDE.md §3.1 / §8.6）。
    for (const model of TENANT_SCOPE_EXCLUDED_MODELS) {
      expect(tenantKeyMovingRelationsOf(model)).toEqual([]);
    }
  });
});
