// apps/web/lib/engineer-shares/schemas.test.ts
// `#29` の境界検証（`lib/engineer-shares/schemas.ts`）。T-08-02。
//
// 🔴 ここで固定するのは「**受け取らないこと**」が中心である:
//   ① 分離キー（`tenantId` / `partnerCompanyId` ほか）が body / params に無い（`BR-03`）
//   ② 🔴 **配列（複数件）を受け取る形が無い**（`F-016 AC-1` / `BR-53`。一括オンを作れない）
//   ③ `shared` の省略を「オン」と解釈しない
import { describe, expect, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import { engineerShareBodySchema, engineerShareParamsSchema } from './schemas';

describe('PUT /api/engineers/{id}/share の body', () => {
  it('`{ shared: boolean }` だけを受け取る', () => {
    expect(engineerShareBodySchema.parse({ shared: true })).toEqual({ shared: true });
    expect(engineerShareBodySchema.parse({ shared: false })).toEqual({ shared: false });
  });

  it('🔴 `shared` は必須（省略を「オン」と解釈しない）', () => {
    expect(engineerShareBodySchema.safeParse({}).success).toBe(false);
  });

  it('🔴 分離キーは 1 つも受け取らない（strip され、ハンドラへ届かない）', () => {
    const withKeys = Object.fromEntries(ISOLATION_KEYS.map((key) => [key, 'x']));
    expect(engineerShareBodySchema.parse({ shared: true, ...withKeys })).toEqual({ shared: true });
    for (const key of ISOLATION_KEYS) {
      expect(Object.keys(engineerShareBodySchema.shape)).not.toContain(key);
    }
  });

  it('🔴 一括で全件をオンにする形（配列）を受け取るキーが存在しない（`F-016 AC-1` / `BR-53`）', () => {
    // 🔴 キーの集合そのものを固定する。`engineerIds` / `ids` / `all` のような
    //    「複数件を一度に」動かせるキーが増えた瞬間にここが落ちる。
    expect(Object.keys(engineerShareBodySchema.shape)).toEqual(['shared']);
    // 送っても届かない（strip）ことも併せて確かめる。
    expect(
      engineerShareBodySchema.parse({ shared: true, engineerIds: ['a', 'b'], all: true }),
    ).toEqual({ shared: true });
  });
});

describe('PUT /api/engineers/{id}/share の params', () => {
  it('UUID 以外は拒否する', () => {
    expect(engineerShareParamsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('対象は常に 1 件である（キーは `id` だけ）', () => {
    expect(Object.keys(engineerShareParamsSchema.shape)).toEqual(['id']);
  });
});
