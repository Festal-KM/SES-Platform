// tests/static/platform-user-no-flag.test.ts
// T-02-01（docs/sprints/SP-02-schema-isolation.md）/ docs/05 §17.2 #13:
// `users` に `platform` / `is_admin` / `is_operator` を含む列名が存在しないことを検証する
// （`BR-36`。CLAUDE.md §10.5「運営者は別テーブル・別認証。テナントの User に運営者フラグを
// 持たせる設計を採らない」の実装担保。運営者アカウントは `PlatformUser` 表で完全に分離する）。
//
// 🔴 これは「静的テスト（コードの構造そのものを検査する）」であり DB を必要としない
// （docs/05 §17.2 の分類。§17.1「ユニット（Vitest）: … platform-user-no-flag の列名走査」）。
// `@prisma/client` の import は packages/db 内部のみ許可されるため
// （tests/static/db-raw-access.test.ts ①）、生成物ではなく schema.prisma をテキストとして読み、
// `model User { ... }` ブロックのフィールド名 / `@map` 列名だけを抽出して判定する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const schemaPath = path.join(repoRoot, 'packages', 'db', 'prisma', 'schema.prisma');
const fixturesDir = path.join(here, '__fixtures__', 'platform-user-no-flag');

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

/**
 * `schemaText` から `model <modelName> { ... }` ブロックの列名（`@map` 指定があればそちら、
 * 無ければフィールド名そのもの）を列挙する。Prisma のモデル本体に波括弧のネストは無い
 * （`@relation(...)` / `@@index([...])` は丸括弧・角括弧であり `{` `}` を含まない）ため、
 * 開き `{` に対応する最初の `}` までを本体として素直に切り出せる。
 */
function extractModelColumnNames(schemaText: string, modelName: string): string[] {
  const openMarker = `model ${modelName} {`;
  const start = schemaText.indexOf(openMarker);
  if (start === -1) {
    throw new Error(`model ${modelName} が見つかりません`);
  }
  const bodyStart = start + openMarker.length;
  const end = schemaText.indexOf('\n}', bodyStart);
  if (end === -1) {
    throw new Error(`model ${modelName} の閉じ括弧が見つかりません`);
  }
  const body = schemaText.slice(bodyStart, end);

  const columnNames = new Set<string>();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;

    // フィールド宣言の先頭トークン（例: `passwordHash String @map("password_hash")` の `passwordHash`）。
    const fieldMatch = /^(\w+)\s+\S/.exec(line);
    if (fieldMatch?.[1]) columnNames.add(fieldMatch[1]);

    // @map("...") が明示されていれば実列名はそちらが正（フィールド名と乖離しうるため両方見る）。
    const mapMatch = /@map\("([^"]+)"\)/.exec(line);
    if (mapMatch?.[1]) columnNames.add(mapMatch[1]);
  }
  return [...columnNames];
}

/** BR-36: 運営者フラグに相当する語を含む列名（大小文字・camelCase / snake_case を問わない）。 */
const FORBIDDEN_SUBSTRINGS = ['platform', 'is_admin', 'is_operator', 'isadmin', 'isoperator'];

function forbiddenViolations(columnNames: readonly string[]): string[] {
  const lowerForbidden = FORBIDDEN_SUBSTRINGS.map((s) => s.toLowerCase());
  return columnNames.filter((name) => {
    const lower = name.toLowerCase().replace(/_/g, '');
    return lowerForbidden.some((forbidden) => lower.includes(forbidden.replace(/_/g, '')));
  });
}

describe('users に platform / is_admin / is_operator を含む列名が存在しない（BR-36 / docs/05 §17.2 #13）', () => {
  it('対照: このテスト自体が空振りしていない（packages/db/prisma/schema.prisma に model User が実在する）', () => {
    const schemaText = readFileSync(schemaPath, 'utf8');
    const columnNames = extractModelColumnNames(schemaText, 'User');
    expect(columnNames.length).toBeGreaterThan(0);
  });

  it('実スキーマ: users の列名に禁止語が 0 件', () => {
    const schemaText = readFileSync(schemaPath, 'utf8');
    const columnNames = extractModelColumnNames(schemaText, 'User');
    expect(forbiddenViolations(columnNames)).toEqual([]);
  });

  it('違反 fixture: is_admin_flag / platform_notes を含む列名を検出する', () => {
    const schemaText = readFixture('violation.schema.prisma');
    const columnNames = extractModelColumnNames(schemaText, 'User');
    const violations = forbiddenViolations(columnNames);
    expect(violations).toContain('is_admin_flag');
    expect(violations).toContain('platform_notes');
  });

  it('対照: 違反 fixture でも検査対象は users モデルのみ（他モデルの is_operator_id は対象外）', () => {
    const schemaText = readFixture('violation.schema.prisma');
    const userColumns = extractModelColumnNames(schemaText, 'User');
    expect(userColumns).not.toContain('is_operator_id');
    const unrelatedColumns = extractModelColumnNames(schemaText, 'Unrelated');
    expect(unrelatedColumns).toContain('is_operator_id'); // 抽出関数自体は正しく拾えている
  });
});
