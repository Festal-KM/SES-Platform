// tests/static/home-drawer-no-ledger.test.ts
// 🔴 `docs/05` §17.7.1 **(l)**: **ホームの `Drawer` が台帳に到達しない**（`docs/05` §6.11.3）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §11-25 / §4.1 は、要対応キューの行に **`内容を見る`（`Drawer`）** を足す。これは
// 「一覧から離れずに中身を確かめられる」ための**読み取り専用**の引き出しである。ところが——
//
//   🔴 **`Drawer` は「もう 1 項目だけ」を置く場所として最も誘惑が強い。**
//      要対応キューの行の 1 つは `PROPOSAL_REQUEST_PENDING`（経路 4 の提案依頼）であり、
//      `CLAUDE.md` §3.1 経路 4 は **実名・所属会社名・スキルシートは `Proposal` の作成まで
//      開示されない**と定めている（`CLAUDE.md` §7 の「匿名候補の身元が提案の作成前に
//      ホストへ露出した件数 = 0 件。許容しない」）。`Drawer` が台帳（`engineers` /
//      `engineer_careers` / `skill_sheets`）に 1 本でも触れれば、その 0 件が破れる。
//
// そこで **到達できる経路そのものを静的に塞ぐ**（`admin-no-content-reach.test.ts` と同じ発想 ——
// 「読もうとしたら失敗する」の 1 段外側、「読もうとするコードが存在しない」を固定する）。
//
// 検査（(l) の ①〜④）:
//   ① `apps/web/app/(main)/_home/**` と `apps/web/lib/home/**` に台帳デリゲート
//      （`engineer` / `engineerSkill` / `engineerCareer` / `skillSheet`）の参照が無い。
//      🔴 **例外は `action-queue-read.ts` の取引先の枝 1 箇所**（自社台帳の `display_name`。
//      自社の情報であり越境ではない。`docs/05` §17.7.1 (l)①）
//   ② 同範囲から `/api/engineers` / `/api/skill-sheets` への fetch が無い
//   ③ ホスト向けの `Drawer` / 要対応キューのビュー型に `engineerId` / エンジニア名 /
//      所属会社名 / 凍結情報のキーが無い
//   ④ `api/home/**` の行詳細ルートを作らない
//      🔴 **④ は本ファイルに書かない。** ルートの実在で判定する検査は
//      `tests/static/forbidden-api-routes.test.ts`（`docs/05` §17.2 #30）が 1 箇所で持っており、
//      `T-22-02` はそこの `FORBIDDEN_ROUTES` に `/api/home/{}` を足した（`docs/05` §17.4 の
//      「同じ検証を 2 箇所に書かない」）。**ここで再実装すると、動的セグメントの正規化
//      〔`[id]` → `{}`〕を 2 箇所で持つことになり、片方だけが古くなる。**
//
// ⚠️ ③ の**値**の側（実際に描かれる文字列）は `apps/web/lib/home/types.test.ts`（型）と
//    `service.test.ts`（実行時）が固定している。ここは **型宣言のプロパティ名**を走査して、
//    `T-22-10` が `Drawer` のビュー型を足したときに**自動で射程に入る**形にする。
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';

const HOME_ROOTS = [
  path.join(repoRoot, 'apps', 'web', 'app', '(main)', '_home'),
  path.join(repoRoot, 'apps', 'web', 'lib', 'home'),
];

/** 🔴 台帳（エンジニアの現在値・経歴・スキルシート）のデリゲート。ホームから触らせない。 */
const LEDGER_DELEGATES: ReadonlySet<string> = new Set([
  'engineer',
  'engineerSkill',
  'engineerCareer',
  'skillSheet',
]);

/**
 * 🔴 **例外は 1 ファイル 1 デリゲートだけ**（`docs/05` §17.7.1 (l)① の「取引先の枝 1 箇所」）。
 *    `action-queue-read.ts` の取引先の枝は、**自社所属エンジニアの実名**（`engineers.display_name`）を
 *    `readEngineerRefs` で引く。`engineers` は C3 OWNER_SCOPED であり、取引先には自社の台帳だけが
 *    見える（`T-12-15` 指摘 5）。**自社の情報であり越境ではない。**
 * 🔴 **増やさない。** ホストの枝が同じ経路を使いたくなったら、それは経路 4 の違反である。
 */
const LEDGER_EXCEPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['apps/web/lib/home/action-queue-read.ts', new Set(['engineer'])],
]);

/** デリゲートを持つ側の識別子（`admin-no-content-reach.test.ts` と同じ規約）。 */
const DELEGATE_HOLDER_PATTERN = /^(?:db|tx|prisma|client)$|(?:Db|Tx|Client|Prisma)$/;

type Finding = { readonly file: string; readonly line: number; readonly detail: string };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * ① 台帳デリゲートへの参照。**3 つの形すべて**を見る。
 *   (1) 呼び出し … `db.engineer.findMany(…)`
 *   (2) 別名への束縛 … `const e = db.engineer` / `const { engineer } = db`
 *   (3) 🔴 **型での要求** … `db: Pick<TenantDb, 'proposalRequest' | 'engineer'>`
 *       —— 実際の `findMany` を別モジュール（`readEngineerRefs`）に置いても、**そのモジュールに
 *       台帳デリゲートを渡している**のはホームである。(1)(2) だけでは取りこぼす。
 */
export function ledgerDelegateFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const allowed = LEDGER_EXCEPTIONS.get(file) ?? new Set<string>();
  const record = (node: ts.Node, model: string, shape: string): void => {
    if (allowed.has(model)) return;
    findings.push({ file, line: lineOf(source, node), detail: `${model}（${shape}）` });
  };
  const visit = (node: ts.Node): void => {
    // (1) `X.<model>.<method>(…)`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      if (ts.isPropertyAccessExpression(receiver) && LEDGER_DELEGATES.has(receiver.name.text)) {
        record(node, receiver.name.text, `デリゲートの呼び出し .${node.expression.name.text}()`);
      }
    }
    // (2) 別名への束縛
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyAssignment(node)) {
      const initializer = node.initializer;
      if (
        initializer !== undefined &&
        ts.isPropertyAccessExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        DELEGATE_HOLDER_PATTERN.test(initializer.expression.text) &&
        LEDGER_DELEGATES.has(initializer.name.text)
      ) {
        record(node, initializer.name.text, 'デリゲートの別名への束縛');
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      DELEGATE_HOLDER_PATTERN.test(node.initializer.text)
    ) {
      for (const element of node.name.elements) {
        const bound = element.propertyName ?? element.name;
        if (ts.isIdentifier(bound) && LEDGER_DELEGATES.has(bound.text)) {
          record(node, bound.text, 'デリゲートの分割代入');
        }
      }
    }
    // (3) `Pick<TenantDb, '…' | 'engineer'>` のようなキーの列挙
    if (ts.isTypeReferenceNode(node) && node.typeArguments !== undefined) {
      const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
      if (name === 'Pick' || name === 'Omit' || name === 'Record') {
        for (const argument of node.typeArguments.slice(1)) {
          const literals: string[] = [];
          const collect = (type: ts.TypeNode): void => {
            if (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal)) literals.push(type.literal.text);
            if (ts.isUnionTypeNode(type)) type.types.forEach(collect);
          };
          collect(argument);
          for (const literal of literals) {
            if (LEDGER_DELEGATES.has(literal) && name !== 'Omit') {
              record(node, literal, `型でのデリゲートの要求 ${name}<…, '${literal}'>`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** ② 台帳 API への fetch（文字列リテラルに URL が現れる形）。 */
const LEDGER_API_PATTERN = /\/api\/(?:engineers|skill-sheets)(?:\b|\/)/;

export function ledgerFetchFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (LEDGER_API_PATTERN.test(node.text)) {
        findings.push({ file, line: lineOf(source, node), detail: node.text });
      }
    }
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
      if (LEDGER_API_PATTERN.test(text)) findings.push({ file, line: lineOf(source, node), detail: text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * ③ ホスト向けの `Drawer` / 要対応キューのビュー型が持ってはならないプロパティ名。
 * 🔴 `CLAUDE.md` §3.1 経路 4: 実名・所属会社名・スキルシートは `Proposal` の作成で初めて開示される。
 * 🔴 `docs/04` §11-25: `Drawer` は読み取りのみであり、凍結情報（`EngineerSnapshot`）にも到達しない。
 */
const FORBIDDEN_VIEW_KEYS: ReadonlySet<string> = new Set([
  'engineerId',
  'engineerName',
  'engineerDisplayName',
  'displayName',
  'companyName',
  'partnerCompanyId',
  'partnerCompanyName',
  'snapshotId',
  'engineerSnapshotId',
  'skillSheetId',
  'skillSheetUrl',
  'careers',
  'skills',
]);

/** 走査対象の型（`Drawer` のビュー型と要対応キューの型。`T-22-10` が足す型が自動で入る）。 */
const VIEW_TYPE_NAME_PATTERN = /Drawer|ActionQueue/;

export function forbiddenViewKeyFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const name =
      ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ? node.name.text : null;
    if (name !== null && VIEW_TYPE_NAME_PATTERN.test(name)) {
      const inner = (child: ts.Node): void => {
        if (ts.isPropertySignature(child) && (ts.isIdentifier(child.name) || ts.isStringLiteral(child.name))) {
          if (FORBIDDEN_VIEW_KEYS.has(child.name.text)) {
            findings.push({ file, line: lineOf(source, child), detail: `${name}.${child.name.text}` });
          }
        }
        ts.forEachChild(child, inner);
      };
      ts.forEachChild(node, inner);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

// ============================================================================
// 走査
// ============================================================================
const scanned = HOME_ROOTS.flatMap((root) => collectSourceFiles(root, ['.ts', '.tsx'])).map((absolute) => ({
  file: toRepoRelative(absolute),
  source: ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
}));

const delegateFindings = scanned.flatMap(({ file, source }) => ledgerDelegateFindings(file, source));
const fetchFindings = scanned.flatMap(({ file, source }) => ledgerFetchFindings(file, source));
const viewKeyFindings = scanned.flatMap(({ file, source }) => forbiddenViewKeyFindings(file, source));

describe('🔴 (l) ホームの Drawer が台帳に到達しない（docs/05 §6.11.3 / §17.7.1 (l)）', () => {
  it('走査が空振りしていない（`_home/**` と `lib/home/**` の実装を現に読んでいる）', () => {
    expect(scanned.length).toBeGreaterThanOrEqual(8);
    expect(scanned.some(({ file }) => file.startsWith('apps/web/app/(main)/_home/'))).toBe(true);
    expect(scanned.some(({ file }) => file.startsWith('apps/web/lib/home/'))).toBe(true);
    // 走査対象の型が現に在る（③ が空振りではない）。
    const names = scanned.flatMap(({ source }) => {
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && VIEW_TYPE_NAME_PATTERN.test(node.name.text)) {
          found.push(node.name.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    });
    expect(names, '要対応キューのビュー型が 1 つも見つからない（走査先か名前の規約が変わった）').toContain(
      'ActionQueueRow',
    );
  });

  it('① 台帳デリゲート（engineer / engineerSkill / engineerCareer / skillSheet）の参照が無い', () => {
    expect(
      delegateFindings.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 CLAUDE.md §3.1 経路 4: 匿名候補の実名・所属会社名・スキルシートは `Proposal` の作成で' +
        '初めて開示される。ホームから台帳に触る経路を 1 本も作らない',
    ).toEqual([]);
  });

  it('🔴 ① 例外（`action-queue-read.ts` の取引先の枝）が現に使われている（使われていない例外を残さない）', () => {
    for (const [file, models] of LEDGER_EXCEPTIONS) {
      const entry = scanned.find((candidate) => candidate.file === file);
      expect(entry, `${file} が走査対象に無い`).toBeDefined();
      if (entry === undefined) continue;
      // 例外を外したときに**現に**違反として現れること（= 例外が空振りしていない）。
      const withoutException = ledgerDelegateFindingsWithoutException(file, entry.source);
      expect(
        withoutException.map((finding) => finding.detail.split('（')[0]),
        `${file} は台帳デリゲートを参照しなくなりました。LEDGER_EXCEPTIONS から外してください`,
      ).toEqual(expect.arrayContaining([...models]));
    }
  });

  it('② `/api/engineers` / `/api/skill-sheets` への fetch が無い', () => {
    expect(
      fetchFindings.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 Drawer の中身は `GET /api/home` の応答に同梱する（docs/05 §6.11.1 の `HomeBlock` 追加専用の規約）。' +
        '台帳 API を叩くと、開いた回数だけ `engineer.view` の監査対象が発生し、越境の射程も広がる',
    ).toEqual([]);
  });

  it('③ Drawer / 要対応キューのビュー型に実名・所属会社名・凍結情報・スキルシートのキーが無い', () => {
    expect(
      viewKeyFindings.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 docs/05 §6.3 #9 / docs/04 §S-017: ホストの `PROPOSAL_REQUEST_PENDING` は ' +
        '「共有候補（匿名）」の一語であり、`engineerId` を**型としても値としても**持たない',
    ).toEqual([]);
  });
});

/** ③ の例外検査用（例外を無視して素で走査する）。 */
function ledgerDelegateFindingsWithoutException(file: string, source: ts.SourceFile): Finding[] {
  const saved = LEDGER_EXCEPTIONS.get(file);
  if (saved === undefined) return ledgerDelegateFindings(file, source);
  // 例外の無いファイル名として同じソースを走査する（`LEDGER_EXCEPTIONS` を書き換えない）。
  return ledgerDelegateFindings(`${file}#no-exception`, source);
}

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (l) の検出器', () => {
  const parseText = (text: string, name = 'x.ts'): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('① 呼び出し / 別名 / 分割代入 / 型での要求の 4 形すべてを拾う', () => {
    expect(
      ledgerDelegateFindings('x.ts', parseText('export const a = () => db.engineer.findMany({});')).map((f) => f.detail),
    ).toContain('engineer（デリゲートの呼び出し .findMany()）');
    expect(
      ledgerDelegateFindings('x.ts', parseText('const e = db.skillSheet;')).map((f) => f.detail),
    ).toContain('skillSheet（デリゲートの別名への束縛）');
    expect(
      ledgerDelegateFindings('x.ts', parseText('const { engineerCareer } = db;')).map((f) => f.detail),
    ).toContain('engineerCareer（デリゲートの分割代入）');
    expect(
      ledgerDelegateFindings(
        'x.ts',
        parseText("export function f(db: Pick<TenantDb, 'proposal' | 'engineer'>) { return db; }"),
      ).map((f) => f.detail),
    ).toContain("engineer（型でのデリゲートの要求 Pick<…, 'engineer'>）");
  });

  it('🔴 ① 台帳でないデリゲートと、コメント中の記述を拾わない', () => {
    expect(ledgerDelegateFindings('x.ts', parseText('export const a = () => db.proposal.findMany({});'))).toEqual([]);
    expect(ledgerDelegateFindings('x.ts', parseText('// db.engineer.findMany({})\nexport const a = 1;'))).toEqual([]);
    // DTO の行（`row.engineer`）はデリゲートではない。
    expect(ledgerDelegateFindings('x.ts', parseText('export const a = (row: R) => row.engineer.displayName;'))).toEqual([]);
  });

  it('② 台帳 API の URL を拾い、似た URL を拾わない', () => {
    expect(ledgerFetchFindings('x.ts', parseText("export const u = '/api/engineers';")).map((f) => f.detail)).toEqual([
      '/api/engineers',
    ]);
    expect(
      ledgerFetchFindings('x.ts', parseText('export const u = `/api/skill-sheets/${id}`;')).map((f) => f.detail),
    ).toEqual(['/api/skill-sheets/']);
    expect(ledgerFetchFindings('x.ts', parseText("export const u = '/api/engineer-shares';"))).toEqual([]);
    expect(ledgerFetchFindings('x.ts', parseText("export const u = '/api/home';"))).toEqual([]);
  });

  it('③ 対象の型だけを見て、禁止キーを拾う', () => {
    const source = parseText(
      [
        'export type ActionQueueDrawerView = { readonly engineerId: string; readonly subjectLabel: string };',
        'export type UnrelatedView = { readonly engineerId: string };',
      ].join('\n'),
      'x.ts',
    );
    expect(forbiddenViewKeyFindings('x.ts', source).map((f) => f.detail)).toEqual([
      'ActionQueueDrawerView.engineerId',
    ]);
  });

  it('🔴 ③ 入れ子の型でも拾う / 許されたキーは拾わない', () => {
    const nested = parseText(
      'export type ActionQueueRowDrawer = { readonly detail: { readonly companyName: string } };',
      'x.ts',
    );
    expect(forbiddenViewKeyFindings('x.ts', nested).map((f) => f.detail)).toEqual([
      'ActionQueueRowDrawer.companyName',
    ]);
    const clean = parseText(
      'export type ActionQueueDrawerView = { readonly subjectLabel: string; readonly since: string };',
      'x.ts',
    );
    expect(forbiddenViewKeyFindings('x.ts', clean)).toEqual([]);
  });
});
