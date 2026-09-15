// apps/web/lib/candidates/schemas.test.ts
// T-08-05: `#30` / `#15?projectId=` の境界検証（カーソルの形と検索条件の共有）。
import { describe, expect, it } from 'vitest';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import { engineerListQuerySchema } from '../engineers/schemas';
import {
  candidateCursorSchema,
  decodeCandidateCursor,
  encodeCandidateCursor,
  engineerListApiQuerySchema,
  isUuidCursor,
  projectCandidateListQuerySchema,
} from './schemas';

const REF = 'yM2RkvynFUQclwUcbLMLXw'; // base64url 22 文字（T-08-04 の回帰値と同じ形）
const UUID = '01930000-0000-7000-8000-0000000000e1';

describe('candidateCursorSchema（並びのキー）', () => {
  it('`{bucket}:{YYYY-MM-DD}:{sortRef}` だけを受ける', () => {
    expect(candidateCursorSchema.safeParse(`0:2026-09-08:${REF}`).success).toBe(true);
    expect(candidateCursorSchema.safeParse(`1:2026-12-31:${REF}`).success).toBe(true);
    // 🔴 行の UUID（`S-005` のカーソル）は受けない —— 混同した要求は 400 になる。
    expect(candidateCursorSchema.safeParse(UUID).success).toBe(false);
    expect(candidateCursorSchema.safeParse(`2:2026-09-08:${REF}`).success).toBe(false);
    expect(candidateCursorSchema.safeParse(`0:2026-09-08T00:00:${REF}`).success).toBe(false);
    expect(candidateCursorSchema.safeParse(`0:2026-09-08:${REF}x`).success).toBe(false);
    expect(candidateCursorSchema.safeParse(`0:2026-09-08:${UUID}`).success).toBe(false);
  });

  it('encode / decode は往復し、形が不正なら RangeError（値を message に載せない）', () => {
    const key = { bucket: 1 as const, updatedOn: '2026-09-08', sortRef: REF };
    expect(decodeCandidateCursor(encodeCandidateCursor(key))).toEqual(key);
    expect(() => decodeCandidateCursor(UUID)).toThrow(RangeError);
    try {
      decodeCandidateCursor(`9:2026-09-08:${REF}`);
    } catch (error) {
      expect((error as Error).message).not.toContain(REF);
    }
  });
});

describe('projectCandidateListQuerySchema（#30）', () => {
  it('検索条件は `S-005`（#15）と同じ項目である（キー集合が一致する）', () => {
    const own = Object.keys(engineerListQuerySchema.shape).sort();
    const candidates = Object.keys(projectCandidateListQuerySchema.shape).sort();
    expect(candidates).toEqual(own);
  });

  it('カーソルは並びのキーだけを受け、UUID は 400 相当（失敗）になる', () => {
    expect(projectCandidateListQuerySchema.safeParse({ cursor: `0:2026-09-08:${REF}` }).success).toBe(true);
    expect(projectCandidateListQuerySchema.safeParse({ cursor: UUID }).success).toBe(false);
    // 空文字は「指定なし」に畳む（`optionalFilter`。素の `<form method="get">` が空欄を送るため）。
    const parsed = projectCandidateListQuerySchema.parse({ cursor: '', q: '' });
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.q).toBeUndefined();
    expect(parsed.limit).toBe(50);
    expect(parsed.onlyInTime).toBe(false);
    expect(parsed.onlyCommutable).toBe(false);
  });

  it('🔴 分離キーを 1 つも持たない', () => {
    for (const key of ISOLATION_KEYS) {
      expect(Object.keys(projectCandidateListQuerySchema.shape)).not.toContain(key);
      expect(Object.keys(engineerListApiQuerySchema.shape)).not.toContain(key);
    }
  });
});

describe('engineerListApiQuerySchema（#15。`projectId` は任意）', () => {
  it('`projectId` は UUID のみ。カーソルは UUID と並びのキーの両方を受ける（組み合わせは Route Handler が見る）', () => {
    expect(engineerListApiQuerySchema.safeParse({ projectId: UUID }).success).toBe(true);
    expect(engineerListApiQuerySchema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false);
    expect(engineerListApiQuerySchema.safeParse({ cursor: UUID }).success).toBe(true);
    expect(engineerListApiQuerySchema.safeParse({ cursor: `0:2026-09-08:${REF}` }).success).toBe(true);
    expect(engineerListApiQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(false);
    expect(engineerListApiQuerySchema.parse({ projectId: '' }).projectId).toBeUndefined();
  });

  it('isUuidCursor は行の UUID だけを真にする', () => {
    expect(isUuidCursor(UUID)).toBe(true);
    expect(isUuidCursor(`0:2026-09-08:${REF}`)).toBe(false);
  });
});
