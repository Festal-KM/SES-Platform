// packages/db/src/tenant-purge.test.ts
// T-10-09: `PURGE_SPEC` → SQL の写像（`buildPurgeStatements`。純粋）を固定する。DB を要らない。
//   ① 列の消去は `UPDATE … SET … WHERE tenant_id = $1 AND (<未処理述語>)`。`purgedAtColumn` があれば `purged_at IS NULL` が述語で
//      `purged_at = $now` が SET に入る（再実行は 0 件 = 冪等）
//   ② 消去値: NULL / '' / '[]'::jsonb / '{}'::jsonb / 'purged:' || id（`users.email` の UNIQUE を保つ）
//   ③ 行の削除（`rows: 'ALL'`）は `DELETE FROM … WHERE tenant_id = $1`
//   ④ 識別子は `"…"` で囲まれ、snake_case 以外は例外（spec の定数以外が来ない構造だが、来たら SQL に埋めない）
//   ⑤ `PURGE_SPEC.delete` の全要素が例外なく SQL に写る（表 / 列の綴りが Prisma.raw の検査を通る）
// 実 DB での適用（削除スコープ・件数・CAS）は `tests/isolation/tenant-purge.test.ts`。
import { describe, expect, it } from 'vitest';
import { PURGE_SPEC, type PurgeDeleteSpec } from '@ses/config';
import { buildPurgeStatements, partitionPurgeObjectKeys, tenantPurgeFailureReason } from './tenant-purge.js';

const TENANT = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-10-01T03:00:00.000Z');

function sqlText(spec: PurgeDeleteSpec) {
  const statements = buildPurgeStatements(spec, TENANT, NOW);
  return { apply: statements.apply.text.replace(/\s+/g, ' ').trim(), pending: statements.pendingCount.text.replace(/\s+/g, ' ').trim(), values: statements.apply.values };
}

describe('buildPurgeStatements（docs/05 §9.7。PURGE_SPEC が唯一の出所）', () => {
  it('① purgedAtColumn を持つ表: 述語は purged_at IS NULL、SET に purged_at = $now', () => {
    const { apply, pending, values } = sqlText({
      table: 'skill_sheets',
      columns: ['object_key', 'note'],
      objectKeyColumns: ['object_key'],
      purgedAtColumn: 'purged_at',
    });
    expect(apply).toBe('UPDATE "skill_sheets" SET "object_key" = NULL, "note" = NULL, "purged_at" = $1 WHERE "tenant_id" = $2::uuid AND ("purged_at" IS NULL)');
    expect(values).toEqual([NOW, TENANT]);
    expect(pending).toBe('SELECT count(*)::int AS count FROM "skill_sheets" WHERE "tenant_id" = $1::uuid AND ("purged_at" IS NULL)');
  });

  it('② 消去値の 4 種と、purgedAtColumn が無い表の未処理述語（各列の OR）', () => {
    const { apply, pending } = sqlText({
      table: 'users',
      columns: [
        { name: 'email', erase: 'ROW_ID_TOKEN' },
        { name: 'display_name', erase: 'EMPTY_TEXT' },
        'password_reset_token_hash',
      ],
    });
    expect(apply).toBe(
      'UPDATE "users" SET "email" = \'purged:\' || "id"::text, "display_name" = \'\', "password_reset_token_hash" = NULL ' +
        'WHERE "tenant_id" = $1::uuid AND ("email" <> \'purged:\' || "id"::text OR "display_name" <> \'\' OR "password_reset_token_hash" IS NOT NULL)',
    );
    expect(pending).toContain('"email" <> \'purged:\' || "id"::text');
    const json = sqlText({
      table: 'review_gates',
      columns: [{ name: 'findings', erase: 'EMPTY_JSON_ARRAY' }, { name: 'ai_warnings', erase: 'EMPTY_JSON_ARRAY' }],
    });
    expect(json.apply).toContain('"findings" = \'[]\'::jsonb');
    expect(json.apply).toContain('"findings" <> \'[]\'::jsonb');
    const object = sqlText({ table: 'skill_sheet_extractions', columns: [{ name: 'payload', erase: 'EMPTY_JSON_OBJECT' }] });
    expect(object.apply).toContain('"payload" = \'{}\'::jsonb');
  });

  it('③ rows: ALL は DELETE（tenant_id で絞る）', () => {
    const { apply, pending, values } = sqlText({ table: 'engineer_careers', rows: 'ALL', provisional: 'ISSUE-48' });
    expect(apply).toBe('DELETE FROM "engineer_careers" WHERE "tenant_id" = $1::uuid');
    expect(pending).toBe('SELECT count(*)::int AS count FROM "engineer_careers" WHERE "tenant_id" = $1::uuid');
    expect(values).toEqual([TENANT]);
  });

  it('④ 識別子は snake_case だけ。それ以外は例外（SQL に埋めない）', () => {
    expect(() => buildPurgeStatements({ table: 'users; DROP TABLE x', columns: ['email'] }, TENANT, NOW)).toThrow(/不正な識別子/);
    expect(() => buildPurgeStatements({ table: 'users', columns: ['e"mail'] }, TENANT, NOW)).toThrow(/不正な識別子/);
    expect(() => buildPurgeStatements({ table: 'users', columns: [] }, TENANT, NOW)).toThrow(/消去列が空/);
  });

  it('⑤ PURGE_SPEC.delete の全要素が SQL に写り、tenant_id の述語を必ず持つ', () => {
    for (const spec of PURGE_SPEC.delete as readonly PurgeDeleteSpec[]) {
      const { apply, pending } = sqlText(spec);
      expect(apply, spec.table).toContain(`"${spec.table}"`);
      expect(apply, spec.table).toContain('"tenant_id" = $');
      expect(pending, spec.table).toContain('"tenant_id" = $');
    }
  });

  it('🔴 partitionPurgeObjectKeys: 自テナントの t/{tenantId}/… だけを targets に入れ、それ以外は値を載せずに skipped へ（S3 側の二重防御）', () => {
    const OTHER = '01930000-0000-7000-8000-0000000000b1';
    const mine = `t/${TENANT}/skill-sheets/01930000-0000-7000-8000-0000000000e1/1/01930000-0000-7000-8000-0000000000d1.xlsx`;
    const theirs = `t/${OTHER}/skill-sheets/01930000-0000-7000-8000-0000000000e1/1/01930000-0000-7000-8000-0000000000d2.xlsx`;
    const listing = partitionPurgeObjectKeys(TENANT, [
      { table: 'skill_sheets', column: 'object_key', key: mine },
      { table: 'skill_sheets', column: 'object_key', key: theirs },
      // Phase 1 の `proposal_events.attachment_key` の形（`skill_sheets.id`）。S3 のキーではない。
      { table: 'proposal_events', column: 'attachment_key', key: '01930000-0000-7000-8000-00000000d101' },
      { table: 'messages', column: 'attachment_key', key: 'skill-sheets/../evil.xlsx' },
      { table: 'data_export_requests', column: 'object_key', key: `t/${TENANT}/exports/01930000-0000-7000-8000-0000000000e9/01930000-0000-7000-8000-0000000000ea.zip` },
    ]);
    expect(listing.targets.map((t) => t.key)).toEqual([mine, `t/${TENANT}/exports/01930000-0000-7000-8000-0000000000e9/01930000-0000-7000-8000-0000000000ea.zip`]);
    expect(listing.skipped).toEqual([
      { table: 'skill_sheets', column: 'object_key' },
      { table: 'proposal_events', column: 'attachment_key' },
      { table: 'messages', column: 'attachment_key' },
    ]);
    // 🔴 skipped に値（キー / UUID）が載らない。
    expect(JSON.stringify(listing.skipped)).not.toContain(OTHER);
    expect(JSON.stringify(listing.skipped)).not.toContain('d101');
    expect(partitionPurgeObjectKeys(TENANT, [])).toEqual({ targets: [], skipped: [] });
  });

  it('failureReason は段 + 例外クラス名だけ（自由文を書かない）', () => {
    const error = new Error('bucket t/xxx/skill-sheets/... not found');
    error.name = 'NoSuchBucket';
    expect(tenantPurgeFailureReason('OBJECT_DELETE', error)).toBe('OBJECT_DELETE:NoSuchBucket');
    expect(tenantPurgeFailureReason('UNKNOWN', 'str')).toBe('UNKNOWN:string');
  });
});
