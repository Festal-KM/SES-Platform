// apps/web/lib/shell/proposal-request-due.test.ts
// 期限バッジの読み取り（`proposal-request-due.ts`）が守る境界を**ソースの形**で固定する。T-12-21。
//
// 🔴 なぜソースを読むのか: この関数は `withTenant`（RLS + Prisma 拡張）に依存するため、
//    実 DB を伴う検証は `tests/isolation/**` の領域である（そちらは T-12-20 の
//    `shell-header.test.ts` と同じハーネスで、外枠の読み取り本数も数えている）。
//    ここで固定するのは **「件数を取らない」「分離キーを `where` に書かない」** の 2 点で、
//    どちらも**書いてしまったら成立しない**性質なので、静的に見るのが最も確実である
//    （`CLAUDE.md` §3.1 / §7「パートナー間の相互参照 0 件」/ `F-004 AC-4`）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'proposal-request-due.ts'), 'utf8');

describe('🔴 件数を取らない（出すのは期限だけ）', () => {
  it('`count` / `aggregate` / `groupBy` を呼ばない', () => {
    expect(source).not.toMatch(/\.count\(/);
    expect(source).not.toMatch(/\.aggregate\(/);
    expect(source).not.toMatch(/\.groupBy\(/);
  });

  it('`findMany` ではなく `findFirst` で 1 行だけ読む', () => {
    expect(source).toContain('findFirst(');
    expect(source).not.toContain('findMany(');
  });

  it('返す型が件数のフィールドを持たない', () => {
    expect(source).not.toMatch(/readonly\s+count\b/);
    expect(source).not.toMatch(/readonly\s+total\b/);
  });
});

describe('🔴 分離キーを `where` に書かない（母集団は RLS が決める。CLAUDE.md §3.1）', () => {
  it('`tenantId` / `partnerCompanyId` / `ownerPartnerCompanyId` を `where` に置いていない', () => {
    // コメント行を落としてから見る（説明としての言及は許す）。
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    expect(code).not.toContain('tenantId:');
    expect(code).not.toContain('partnerCompanyId:');
    expect(code).not.toContain('ownerPartnerCompanyId:');
  });

  it('アクセスは `withTenant` 経由である（生 `PrismaClient` を使わない）', () => {
    expect(source).toContain("from '@ses/db'");
    expect(source).toContain('withTenant(');
    expect(source).not.toContain('new PrismaClient');
  });
});

describe('🔴 業務上の絞り込みは未返答（`REQUESTED`）だけ', () => {
  it('`REQUESTED` を読み、期限の昇順で 1 件を選ぶ', () => {
    expect(source).toContain("state: 'REQUESTED'");
    expect(source).toContain("expiresAt: 'asc'");
  });

  it('🔴 `expiresAt` 以外の列を `select` していない（氏名・案件名・依頼元に触れない）', () => {
    const select = /select:\s*\{([^}]*)\}/.exec(source);
    expect(select).not.toBeNull();
    expect((select?.[1] ?? '').trim().replace(/,$/, '')).toBe('expiresAt: true');
  });
});
