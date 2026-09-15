// tests/static/career-year-month-mirror.test.ts
// T-09-12（docs/05 §3.4.1）: `YYYY-MM` の妥当性判定は **1 本**であり、API 境界の Zod（`@ses/domain` の
// `YEAR_MONTH_PATTERN`）と DB の CHECK（migration 20260917000000）が**同じ正規表現**を指すことを突合する。
//
// 🔴 なぜ要るか: 片方だけ緩むと「API は通ったのに DB で落ちて 500 になる」か、逆に「DB は通すのに
//    API が弾いて登録できない」のどちらかになる。どちらも利用者からは不具合と区別できない。
//    `tests/static/schema-enum-drift.test.ts`（CHECK IN の値集合）と同じ位置づけで、正規表現の CHECK を見る。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  YEAR_MONTH_PATTERN,
  YEAR_MONTH_SQL_PATTERN,
} from '../../packages/domain/src/ledger/year-month.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const migrationsDir = path.join(repoRoot, 'packages', 'db', 'prisma', 'migrations');

function readAllMigrationSql(): string {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(path.join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

/** `CONSTRAINT "<name>" CHECK (... ~ '<regex>')` から正規表現の文字列を取り出す。 */
function extractRegexCheck(sql: string, constraintName: string): string {
  const pattern = new RegExp(
    String.raw`CONSTRAINT\s+"${constraintName}"\s+CHECK\s*\([^~]*~\s*'([^']+)'\s*\)`,
    'g',
  );
  const matches = [...sql.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`CHECK "${constraintName}" が migration.sql 群に ${matches.length} 件（1 件ちょうどを期待）`);
  }
  return matches[0]![1]!;
}

const migrationSql = readAllMigrationSql();

describe('🔴 YYYY-MM の正規表現は TS（@ses/domain）と DB（CHECK）で同一である（docs/05 §3.4.1）', () => {
  it('TS 側の RegExp のソースは SQL 側の文字列と一致する（単一出所の写し）', () => {
    expect(YEAR_MONTH_PATTERN.source).toBe(YEAR_MONTH_SQL_PATTERN);
    expect(YEAR_MONTH_PATTERN.flags).toBe('');
  });

  it.each(['engineer_careers_period_from_format_check', 'engineer_careers_period_to_format_check'])(
    '%s の正規表現が YEAR_MONTH_SQL_PATTERN と一致する',
    (constraintName) => {
      expect(extractRegexCheck(migrationSql, constraintName)).toBe(YEAR_MONTH_SQL_PATTERN);
    },
  );

  it('期間の前後関係と出所の CHECK が存在する（docs/05 §3.4 の 4 本）', () => {
    expect(migrationSql).toMatch(
      /CONSTRAINT\s+"engineer_careers_period_order_check"\s+CHECK\s*\("period_to" IS NULL OR "period_to" >= "period_from"\)/,
    );
    expect(migrationSql).toMatch(
      /CONSTRAINT\s+"engineer_careers_extraction_source_check"\s+CHECK\s*\("source" = 'EXTRACTED' OR "skill_sheet_extraction_id" IS NULL\)/,
    );
  });

  it('🔴 複合 FK (tenant_id, engineer_id) → engineers(tenant_id, id) が張られている（単一列 FK ではない。Issue #33）', () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("tenant_id", "engineer_id"\) REFERENCES "engineers"\("tenant_id", "id"\)/,
    );
    expect(migrationSql).not.toMatch(
      /"engineer_careers"[^;]*FOREIGN KEY \("engineer_id"\) REFERENCES "engineers"\("id"\)/,
    );
  });

  it('対照: 存在しない制約名は例外になる（空振り防止）', () => {
    expect(() => extractRegexCheck(migrationSql, 'no_such_regex_check')).toThrow();
  });
});
