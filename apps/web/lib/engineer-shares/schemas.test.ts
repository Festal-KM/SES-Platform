// apps/web/lib/engineer-shares/schemas.test.ts
// `#29` の境界検証（`lib/engineer-shares/schemas.ts`）。T-08-02 → T-11-11（`GET` の query とカーソルを末尾に追加）。
//
// 🔴 ここで固定するのは「**受け取らないこと**」が中心である:
//   ① 分離キー（`tenantId` / `partnerCompanyId` ほか）が body / params に無い（`BR-03`）
//   ② 🔴 **配列（複数件）を受け取る形が無い**（`F-016 AC-1` / `BR-53`。一括オンを作れない）
//   ③ `shared` の省略を「オン」と解釈しない
import { describe, expect, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import { CursorModeMismatchError } from './errors';
import {
  decodeEngineerShareCursor,
  encodeEngineerShareCursor,
  engineerShareBodySchema,
  engineerShareCursorMode,
  engineerShareCursorSchema,
  engineerShareListQuerySchema,
  engineerShareParamsSchema,
} from './schemas';

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

// ---------------------------------------------------------------------------
// T-11-11: `GET /api/engineer-shares` の query とカーソル（docs/05 §6.4「#29 の改訂」/ §17.2 #33 ②③）
// ---------------------------------------------------------------------------

const ENGINEER_A = '01930000-0000-7000-8000-0000000000a1';
const ENGINEER_B = '01930000-0000-7000-8000-0000000000a2';
const AT = new Date('2026-09-17T01:02:03.456Z');

describe('GET /api/engineer-shares の query（検索 3 条件 + ページング）', () => {
  it('🔴 キー集合は `availableBy` / `cursor` / `limit` / `q` / `shared` の 5 つ（スキル・単価・勤務地・skillMode を足さない）', () => {
    expect(Object.keys(engineerShareListQuerySchema.shape).sort()).toEqual([
      'availableBy',
      'cursor',
      'limit',
      'q',
      'shared',
    ]);
  });

  it('条件を 1 つも入れない検索は通り、`limit` は既定 50・`shared` は「すべて」（undefined）', () => {
    expect(engineerShareListQuerySchema.parse({})).toEqual({ limit: 50 });
    // `<form method="get">` は未入力の欄も送る（空文字は「指定なし」に畳む）。
    expect(engineerShareListQuerySchema.parse({ q: '', availableBy: '', shared: '', cursor: '' })).toEqual({
      limit: 50,
    });
  });

  it('`shared` は `true` / `false` だけを受け、boolean に coerce しない', () => {
    expect(engineerShareListQuerySchema.parse({ shared: 'true' }).shared).toBe('true');
    expect(engineerShareListQuerySchema.parse({ shared: 'false' }).shared).toBe('false');
    expect(engineerShareListQuerySchema.safeParse({ shared: '1' }).success).toBe(false);
    expect(engineerShareListQuerySchema.safeParse({ shared: 'all' }).success).toBe(false);
  });

  it('`q` / `availableBy` は #15 と同じパーサ（trim・日付の形）', () => {
    expect(engineerShareListQuerySchema.parse({ q: '  合成  ' }).q).toBe('合成');
    expect(engineerShareListQuerySchema.parse({ availableBy: '2026-10-31' }).availableBy).toBe('2026-10-31');
    expect(engineerShareListQuerySchema.safeParse({ availableBy: '2026/10/31' }).success).toBe(false);
  });

  it('`limit` の上限超過は 400（黙って丸めない）', () => {
    expect(engineerShareListQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(engineerShareListQuerySchema.parse({ limit: '200' }).limit).toBe(200);
  });

  it('🔴 分離キーは 1 つも受け取らない（strip され、ハンドラへ届かない）', () => {
    const withKeys = Object.fromEntries(ISOLATION_KEYS.map((key) => [key, 'x']));
    expect(engineerShareListQuerySchema.parse({ shared: 'true', ...withKeys })).toEqual({
      shared: 'true',
      limit: 50,
    });
  });
});

describe('🔴 カーソルの形（`s:{epochMs}:{engineerId}` / `u:{epochMs}:{engineerId}`。形が違えば 400）', () => {
  it('encode → decode が往復する（ミリ秒で可逆）', () => {
    const shared = encodeEngineerShareCursor('s', { at: AT, engineerId: ENGINEER_A });
    expect(shared).toBe(`s:${String(AT.getTime()).padStart(13, '0')}:${ENGINEER_A}`);
    expect(engineerShareCursorSchema.safeParse(shared).success).toBe(true);
    expect(decodeEngineerShareCursor(shared, 'true')).toEqual({ mode: 's', at: AT, engineerId: ENGINEER_A });

    const updated = encodeEngineerShareCursor('u', { at: AT, engineerId: ENGINEER_B });
    expect(decodeEngineerShareCursor(updated, undefined)).toEqual({ mode: 'u', at: AT, engineerId: ENGINEER_B });
    expect(decodeEngineerShareCursor(updated, 'false')).toEqual({ mode: 'u', at: AT, engineerId: ENGINEER_B });
  });

  it.each([
    ['UUID 単体（`S-005` のカーソル）', ENGINEER_A],
    ['並びのキー `{bucket}:{date}:{sortRef}`（`S-016` のカーソル）', '0:2026-09-08:AAAAAAAAAAAAAAAAAAAAAA'],
    ['mode が違う', `x:0001757000000000:${ENGINEER_A}`],
    ['epochMs の桁が違う', `s:1757000000000000:${ENGINEER_A}`],
    ['id が UUID でない', 's:0001757000000000:not-a-uuid'],
    ['SQL 片', "s:0001757000000000:' OR 1=1 --"],
  ])('%s は形が違う → スキーマで拒否（400）', (_label, cursor) => {
    expect(engineerShareCursorSchema.safeParse(cursor).success).toBe(false);
    expect(engineerShareListQuerySchema.safeParse({ cursor }).success).toBe(false);
  });

  it('空文字はカーソル単体では形が違うが、query では「指定なし」に畳まれる（`?cursor=` は 1 ページ目）', () => {
    expect(engineerShareCursorSchema.safeParse('').success).toBe(false);
    expect(engineerShareListQuerySchema.parse({ cursor: '' })).toEqual({ limit: 50 });
  });

  it('🔴 `mode` と `shared` の組み合わせが合わないカーソルは `CursorModeMismatchError`（400 `CURSOR_MODE_MISMATCH`）', () => {
    const shared = encodeEngineerShareCursor('s', { at: AT, engineerId: ENGINEER_A });
    const updated = encodeEngineerShareCursor('u', { at: AT, engineerId: ENGINEER_A });

    expect(() => decodeEngineerShareCursor(updated, 'true')).toThrow(CursorModeMismatchError);
    expect(() => decodeEngineerShareCursor(shared, 'false')).toThrow(CursorModeMismatchError);
    expect(() => decodeEngineerShareCursor(shared, undefined)).toThrow(CursorModeMismatchError);

    const error = new CursorModeMismatchError();
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('CURSOR_MODE_MISMATCH');
    expect(error.details).toEqual(['query.cursor']);
  });

  it('形が違う値を decode に渡すのは実装ミス（RangeError。値を message に載せない）', () => {
    expect(() => decodeEngineerShareCursor('garbage', 'true')).toThrow(RangeError);
    try {
      decodeEngineerShareCursor('garbage-value', 'true');
    } catch (error) {
      expect((error as Error).message).not.toContain('garbage-value');
    }
  });

  it('`shared` → `mode` の判定は 1 か所（`true` = `s`、それ以外 = `u`）', () => {
    expect(engineerShareCursorMode('true')).toBe('s');
    expect(engineerShareCursorMode('false')).toBe('u');
    expect(engineerShareCursorMode(undefined)).toBe('u');
  });
});
