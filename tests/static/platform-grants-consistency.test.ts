// tests/static/platform-grants-consistency.test.ts
// 🔴 T-11-07（docs/05 §5.5 第 1 層 / §17.2 #4 の補助）: `tests/isolation/support/platform-grants.ts` の 2 つのリスト
//    （`PLATFORM_READ_COLUMN_ALLOWLIST` = この列だけ SELECT できる / `PLATFORM_READ_COLUMN_DENYLIST` = 名指しで SELECT できない）
//    が**互いに矛盾せず、`schema.prisma` の実在の列を指している**ことを DB 無しで固定する。
//
// なぜ静的テストか: `roles.test.ts` / `rls-enforced.test.ts` は Testcontainers で GRANT の実態を実測するが、
//   ① 許可リストと非開示リストの**両方に同じ列が書かれている**と、実測は「GRANT が無い」側で落ちるだけで、
//      「許可リストに非開示列が紛れた」という写し間違いの向きが読み取りにくい
//   ② 存在しない列名を非開示リストに書くと `has_column_privilege` がエラーになるか、常に false（= 空振りで green）になる
// のどちらも、DB を起動する前に構造で捕まえられる。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_READ_COLUMN_ALLOWLIST,
  PLATFORM_READ_COLUMN_DENYLIST,
} from '../isolation/support/platform-grants';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const SCHEMA_PATH = path.join(repoRoot, 'packages', 'db', 'prisma', 'schema.prisma');

/** `schema.prisma` の `model` ブロックを表名（`@@map`）→ 列名（`@map` または項目名）に写す。リレーション項目は除く。 */
function readSchemaColumns(): ReadonlyMap<string, ReadonlySet<string>> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  const blocks: Array<{ model: string; body: string }> = [];
  for (const match of text.matchAll(modelPattern)) {
    blocks.push({ model: match[1]!, body: match[2]! });
  }
  const modelNames = new Set(blocks.map((b) => b.model));
  const tables = new Map<string, Set<string>>();
  for (const { model, body } of blocks) {
    const tableMatch = body.match(/@@map\("([^"]+)"\)/);
    const table = tableMatch?.[1] ?? model;
    const columns = new Set<string>();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\[\])?\??/);
      if (fieldMatch === null) continue;
      const [, field, type] = fieldMatch;
      if (modelNames.has(type!)) continue; // リレーション項目（列ではない）
      const mapMatch = line.match(/@map\("([^"]+)"\)/);
      columns.add(mapMatch?.[1] ?? field!);
    }
    tables.set(table, columns);
  }
  return tables;
}

const schema = readSchemaColumns();

describe('🔴 platform-grants.ts の許可リストと非開示リストが矛盾せず、実在の列を指す（docs/05 §5.5 第 1 層。T-11-07）', () => {
  it('対照: schema.prisma の読み取りが空振りしていない', () => {
    expect(schema.size).toBeGreaterThan(40);
    expect(schema.get('engineers')).toContain('display_name');
    expect(schema.get('users')).toContain('password_hash');
    expect(schema.get('audit_logs')).toContain('summary');
  });

  it('🔴 許可リストと非開示リストの交差が空集合（同じ列が両方に書かれていない）', () => {
    const overlaps: string[] = [];
    for (const [table, denied] of Object.entries(PLATFORM_READ_COLUMN_DENYLIST)) {
      const allowed = new Set(PLATFORM_READ_COLUMN_ALLOWLIST[table] ?? []);
      for (const column of denied) if (allowed.has(column)) overlaps.push(`${table}.${column}`);
    }
    expect(overlaps, '許可リストに非開示列が紛れている').toEqual([]);
  });

  it('非開示リストの表と列が schema.prisma に実在する（存在しない名前は実測が空振りする）', () => {
    const missing: string[] = [];
    for (const [table, denied] of Object.entries(PLATFORM_READ_COLUMN_DENYLIST)) {
      const columns = schema.get(table);
      if (columns === undefined) {
        missing.push(`${table}（表が無い）`);
        continue;
      }
      for (const column of denied) if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });

  it('許可リストの表と列が schema.prisma に実在する', () => {
    const missing: string[] = [];
    for (const [table, allowed] of Object.entries(PLATFORM_READ_COLUMN_ALLOWLIST)) {
      const columns = schema.get(table);
      if (columns === undefined) {
        missing.push(`${table}（表が無い）`);
        continue;
      }
      for (const column of allowed) if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });

  it('リストに重複した列名が無い（同じ列を 2 度書くと片方の削除で見落とす）', () => {
    const duplicates: string[] = [];
    for (const [name, list] of [
      ['ALLOWLIST', PLATFORM_READ_COLUMN_ALLOWLIST],
      ['DENYLIST', PLATFORM_READ_COLUMN_DENYLIST],
    ] as const) {
      for (const [table, columns] of Object.entries(list)) {
        const seen = new Set<string>();
        for (const column of columns) {
          if (seen.has(column)) duplicates.push(`${name}: ${table}.${column}`);
          seen.add(column);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('🔴 対照: docs/05 §5.5 が名指しする非開示列の代表が非開示リストに載っている（CLAUDE.md §10.5 の 4 分類 + T-11-07 の追加）', () => {
    const expectDenied = (table: string, column: string): void => {
      expect(PLATFORM_READ_COLUMN_DENYLIST[table] ?? [], `${table}.${column}`).toContain(column);
    };
    // スキルシートの原本と本文 / 氏名・生年月日・連絡先 / チャットの本文 / トークン平文（CLAUDE.md §10.5）
    expectDenied('skill_sheets', 'object_key');
    expectDenied('skill_sheet_extractions', 'payload');
    expectDenied('engineers', 'display_name');
    expectDenied('engineers', 'birth_date');
    expectDenied('engineers', 'contact_email');
    expectDenied('engineers', 'contact_phone');
    expectDenied('messages', 'body');
    expectDenied('tenant_esign_connections', 'credential_encrypted');
    expectDenied('two_factor_credentials', 'secret_encrypted');
    expectDenied('users', 'password_hash');
    // 提案の内容・宛先・単価 / ゲートの指摘 / 依頼の本文と辞退理由
    expectDenied('proposals', 'subject');
    expectDenied('proposals', 'body');
    expectDenied('proposals', 'draft_body');
    expectDenied('proposals', 'offered_unit_price');
    expectDenied('proposals', 'recipient_email');
    expectDenied('proposals', 'recipient_company_name');
    expectDenied('review_gates', 'findings');
    expectDenied('review_gates', 'ai_warnings');
    expectDenied('proposal_requests', 'message');
    expectDenied('proposal_requests', 'decline_reason');
    expectDenied('email_dispatches', 'recipient_email');
    // T-11-07 の追加（migration 20260925000000）
    expectDenied('users', 'email');
    expectDenied('users', 'display_name');
    expectDenied('partner_companies', 'contact_email');
    expectDenied('invitations', 'token_hash');
    expectDenied('tenant_sending_domains', 'mail_from_domain');
    expectDenied('tenant_sending_domains', 'ses_identity_arn');
    expectDenied('tenant_sending_domains', 'last_failure_reason');
    expectDenied('ai_usage', 'target_id');
    expectDenied('ai_usage', 'prompt_version');
    expectDenied('tenant_quota_overrides', 'reason');
    expectDenied('tenant_purge_runs', 'failure_reason');
  });
});
