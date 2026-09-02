// packages/db/src/context.test.ts
// T-01-06（docs/sprints/SP-01-bootstrap.md）: AuthenticatedTenantCtx / HostTenantCtx が
// ブランド型であり、resolveTenantCtx / requireHost 以外が生成できないことを型レベルで固定する
// （docs/05 §1.4 / §4.3。「違反時の挙動」＝コンパイルエラー）。
//
// 🔴 これは実行時アサーションではなく型テストである。expectTypeOf<T>() 系の呼び出しは
//    型検査のみを行い、実行時には何もしない（no-op）。`@ts-expect-error` は、直後の行が
//    「型エラーにならない」場合にそれ自体が型エラーになる（"Unused '@ts-expect-error'
//    directive"）ため、ブランドを回避する経路ができた瞬間に tsc（`pnpm --filter @ses/db
//    typecheck` / ルートの `pnpm typecheck`）が本ファイルで失敗する。
//    vitest は esbuild で型情報なしにトランスパイルするため、実行時には単なる代入文として
//    通過するだけである（完了判定①の検知は typecheck 経由）。
//
// 🔴 `withTenant` / `withHostTenant` を実際に呼び出さない（`configureTenantDb` を要求し、
//    このファイルの目的〔型のみの検証〕に対して DB 依存が不要に生じるため）。
//    「渡せないこと」の検証は `Parameters<typeof withTenant<unknown>>[0]` のような型抽出と
//    代入文の可否で行う（呼び出しではなく型チェックのみ）。
import { describe, expectTypeOf, it } from 'vitest';
import {
  requireHost,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
  type HostTenantCtx,
} from './context.js';
import { withHostTenant, withTenant } from './with-tenant.js';

type WithTenantCtxParam = Parameters<typeof withTenant<unknown>>[0];
type WithHostTenantCtxParam = Parameters<typeof withHostTenant<unknown>>[0];

const VALID_SESSION = {
  tenantId: 't1',
  partnerCompanyId: null,
  userId: 'u1',
  role: 'SALES',
  lifecycleState: 'ACTIVE',
} as const;

describe('AuthenticatedTenantCtx はブランド型であり、resolveTenantCtx 以外が生成できない', () => {
  it('手で組み立てたオブジェクトリテラルは AuthenticatedTenantCtx へ代入できない', () => {
    // @ts-expect-error ブランドプロパティ（unique symbol）を外部から書けないため、
    // 構造的に一致するオブジェクトリテラルでも AuthenticatedTenantCtx への代入は型エラーになる。
    const handCrafted: AuthenticatedTenantCtx = {
      tenantId: 't1',
      partnerCompanyId: null,
      userId: 'u1',
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      deviceKind: 'api',
    };
    void handCrafted;
  });

  it('resolveTenantCtx の戻り値の型は AuthenticatedTenantCtx である', () => {
    expectTypeOf(resolveTenantCtx).returns.resolves.toEqualTypeOf<AuthenticatedTenantCtx>();
  });

  it('withTenant の第 1 引数は AuthenticatedTenantCtx 型である（resolveTenantCtx の戻り値のみ渡せる）', () => {
    expectTypeOf<WithTenantCtxParam>().toEqualTypeOf<AuthenticatedTenantCtx>();
  });

  it('手組みオブジェクトは withTenant の第 1 引数の型として代入できない（構造は一致するがブランドが無い）', () => {
    const plain = {
      tenantId: 't1',
      partnerCompanyId: null as string | null,
      userId: 'u1',
      role: 'SALES' as const,
      lifecycleState: 'ACTIVE' as const,
      deviceKind: 'api' as const,
    };
    // @ts-expect-error ブランドプロパティを持たないため WithTenantCtxParam（=AuthenticatedTenantCtx）
    // に代入できない。withTenant 自体は呼び出さず、型の代入可否だけを検査する。
    const asCtx: WithTenantCtxParam = plain;
    void asCtx;
  });

  it('対照: resolveTenantCtx の戻り値は withTenant の第 1 引数の型に代入できる（ブランド無し判定が空振りでない）', async () => {
    const ctx = await resolveTenantCtx(VALID_SESSION, { deviceKind: 'api' });
    const asCtx: WithTenantCtxParam = ctx;
    void asCtx;
  });
});

describe('HostTenantCtx は requireHost 以外が生成できない（docs/05 §4.3 実装の規約 6）', () => {
  it('手で組み立てたオブジェクトリテラルは HostTenantCtx へ代入できない', () => {
    // @ts-expect-error ブランドプロパティ（HostBrand）を外部から書けない。
    const handCrafted: HostTenantCtx = {
      tenantId: 't1',
      partnerCompanyId: null,
      userId: 'u1',
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      deviceKind: 'api',
    };
    void handCrafted;
  });

  it('resolveTenantCtx の戻り値（AuthenticatedTenantCtx）は、そのままでは withHostTenant の第 1 引数の型に代入できない', async () => {
    const ctx = await resolveTenantCtx(VALID_SESSION, { deviceKind: 'api' });
    // @ts-expect-error AuthenticatedTenantCtx は HostTenantCtx ではない（requireHost を経ていない）。
    // withHostTenant 自体は呼び出さず、型の代入可否だけを検査する。
    const asHostCtx: WithHostTenantCtxParam = ctx;
    void asHostCtx;
  });

  it('requireHost を通した後だけ HostTenantCtx として扱える（型の絞り込み）', async () => {
    const ctx = await resolveTenantCtx(VALID_SESSION, { deviceKind: 'api' });
    requireHost(ctx); // 副作用は無い（partnerCompanyId が null なので投げない）。型だけを絞り込む。
    expectTypeOf(ctx).toExtend<HostTenantCtx>();
    const asHostCtx: WithHostTenantCtxParam = ctx;
    void asHostCtx;
  });

  it('withHostTenant の第 1 引数は HostTenantCtx 型である', () => {
    expectTypeOf<WithHostTenantCtxParam>().toEqualTypeOf<HostTenantCtx>();
  });

  it('partnerCompanyId を null に絞り込んだだけの型は HostTenantCtx と等しくない（HostBrand 自体が寄与していることの確認）', () => {
    // 🔴 「partnerCompanyId: null であること」と「requireHost を経たこと」は別物である。
    //    ここは値ではなく型だけを比較する: HostBrand が無ければこの 2 つの型は一致してしまい、
    //    「null チェックさえすれば HostTenantCtx として扱える」という抜け道が生まれる。
    type NarrowedButNotHost = AuthenticatedTenantCtx & { readonly partnerCompanyId: null };
    expectTypeOf<NarrowedButNotHost>().not.toEqualTypeOf<HostTenantCtx>();
  });
});
