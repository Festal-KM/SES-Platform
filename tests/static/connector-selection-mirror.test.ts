// tests/static/connector-selection-mirror.test.ts
// T-04-01: 🔴 `packages/connectors` が**他パッケージと二重に宣言している値集合**を突合する。
//
// 対象は 4 組:
//   ① `ConnectorSelectionInput` ↔ `packages/config` の `ConnectorSelection`
//      ずれると「起動時に選んだ実装種別」と「実際に組み立てられる実装」が食い違い、
//      `production` でモックが選ばれない保証（CLAUDE.md §11.1 / docs/05 §13.1）が静かに崩れる。
//   ② `packages/domain` の `RECIPIENT_CLASSES` ↔ `packages/db` の `EMAIL_RECIPIENT_CLASSES`
//      ずれると `EmailDispatch.recipientClass` の CHECK に通らない値で送信経路が組み上がる。
//      🔴 T-04-02 で `packages/connectors` 側の二重宣言は解消し（`@ses/domain` からの
//      re-export に置き換えた）、突合の基準を **domain** に移した。本テストは合わせて
//      「connectors が独自の `RECIPIENT_CLASSES` を再び宣言していないこと」も見る
//      （再宣言が入った瞬間に、値集合が 3 箇所に散る）。
//   ③ `SEND_ENTITY_TYPES` ↔ `packages/db` の `SEND_ATTEMPT_ENTITY_TYPES`
//      🔴 ずれると `idempotencyKey()` が `send_attempts` の CHECK を通らない冪等キーを生み、
//      **二重送信の唯一の防御線（docs/05 §10.1 の 2 本の UNIQUE）が機能しない**。
//   ④ 送信トークン型のプロパティ名 ↔ docs/05 §10.2 の宣言（`packages/db/src/send.ts`）
//
// なぜ ①③④ を import で共有しないのか:
//   `packages/connectors` は `packages/config` / `packages/db` に依存できない（CLAUDE.md §2.1）。
//   ③④ は `packages/db` が発行する値の型であり、移設先の判断が SP-09（送信の予約）の設計に
//   依存するため、当面は二重宣言を**機械的に突合**して守る。
//   ⚠️ 申し送り（T-09-01）: 送信トークン型を `packages/domain` へ移すタイミングで、
//      ③④ も②と同じく「宣言が 1 つであること」の確認に置き換える。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const configFile = path.join(repoRoot, 'packages', 'config', 'src', 'connector-selection.ts');
const connectorsFile = path.join(repoRoot, 'packages', 'connectors', 'src', 'types.ts');
const domainRecipientFile = path.join(
  repoRoot,
  'packages',
  'domain',
  'src',
  'recipient',
  'classify.ts',
);
const dbValueSetsFile = path.join(repoRoot, 'packages', 'db', 'src', 'schema-value-sets.ts');
const sesEventsFile = path.join(
  repoRoot,
  'packages',
  'connectors',
  'src',
  'email',
  'ses',
  'events.ts',
);
const programDesignFile = path.join(repoRoot, 'docs', '05-program-design.md');

function parse(file: string): ts.SourceFile {
  return parseText(readFileSync(file, 'utf8'), file);
}

function parseText(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
}

/**
 * docs/05 の ```ts フェンス付きコードブロックのうち、`marker` を含むものを 1 つ返す。
 * 🔴 docs 側の宣言を「読んで比較する」ためだけに使う（設計書が正であることを崩さない）。
 */
function tsCodeBlockContaining(markdown: string, marker: string): string {
  const blocks = markdown.split('```');
  for (let i = 1; i < blocks.length; i += 2) {
    const block = blocks[i] ?? '';
    if (block.startsWith('ts') && block.includes(marker)) return block.slice('ts'.length);
  }
  throw new Error(`docs/05 に "${marker}" を含む ts コードブロックが見つかりません`);
}

/** `export type X = 'a' | 'b';` の文字列リテラルを取り出す。 */
function unionLiteralsOfTypeAlias(sourceFile: ts.SourceFile, typeName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      const collect = (type: ts.TypeNode): void => {
        if (ts.isUnionTypeNode(type)) {
          type.types.forEach(collect);
          return;
        }
        if (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal)) found.push(type.literal.text);
      };
      collect(node.type);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** `export const X = ['a', 'b'] as const;` の文字列リテラルを取り出す。 */
function arrayLiteralsOfConst(sourceFile: ts.SourceFile, variableName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer !== undefined
    ) {
      const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isArrayLiteralExpression(initializer)) {
        for (const element of initializer.elements) {
          if (ts.isStringLiteralLike(element)) found.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** `export type X = { a: T; b: T };` のプロパティ名を取り出す。 */
function propertyNamesOfTypeAlias(sourceFile: ts.SourceFile, typeName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (ts.isPropertySignature(member) && member.name !== undefined && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** `export type X = { a: T; b: U };` のプロパティ名 → 型テキストを返す。 */
function propertyTypeTextsOfTypeAlias(sourceFile: ts.SourceFile, typeName: string): Record<string, string> {
  const found: Record<string, string> = {};
  function visit(node: ts.Node): void {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name !== undefined &&
          ts.isIdentifier(member.name) &&
          member.type !== undefined
        ) {
          found[member.name.text] = member.type.getText(sourceFile);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

const config = parse(configFile);
const connectors = parse(connectorsFile);
const domainRecipient = parse(domainRecipientFile);
const dbValueSets = parse(dbValueSetsFile);
const sesEvents = parse(sesEventsFile);
const docsSendTokens = parseText(
  tsCodeBlockContaining(readFileSync(programDesignFile, 'utf8'), 'packages/db/src/send.ts'),
  'docs-05-send.ts',
);

describe('🔴 コネクタ選択の二重宣言が一致していること（docs/05 §13.1）', () => {
  it('対照: 双方から値を取り出せている（テストが空振りしていない）', () => {
    expect(unionLiteralsOfTypeAlias(config, 'ConnectorImplementationKind').length).toBeGreaterThan(0);
    expect(arrayLiteralsOfConst(connectors, 'CONNECTOR_IMPLEMENTATION_KINDS').length).toBeGreaterThan(0);
  });

  it('実装種別（real / mock / sandboxRecipientScoped）が完全に一致する', () => {
    const fromConfig = [...unionLiteralsOfTypeAlias(config, 'ConnectorImplementationKind')].sort();
    const fromConnectors = [...arrayLiteralsOfConst(connectors, 'CONNECTOR_IMPLEMENTATION_KINDS')].sort();
    expect(fromConnectors).toEqual(fromConfig);
  });

  it('🔴 connectors が組み立てる区分は config の区分の部分集合であり、差は ai だけ', () => {
    const fromConfig = unionLiteralsOfTypeAlias(config, 'ConnectorCategory');
    const fromConnectors = arrayLiteralsOfConst(connectors, 'CONNECTOR_CATEGORIES');
    for (const category of fromConnectors) expect(fromConfig).toContain(category);
    // 🔴 `ai` は `packages/ai` が組み立てる（`packages/connectors` は SDK も @ses/ai も
    //    import できない。CLAUDE.md §2.1 / §3.2）。差がこれ以外に増えたら設計判断が要る。
    expect(fromConfig.filter((category) => !fromConnectors.includes(category))).toEqual(['ai']);
  });

  it('ConnectorSelectionInput のプロパティが CONNECTOR_CATEGORIES と一致する', () => {
    const properties = [...propertyNamesOfTypeAlias(connectors, 'ConnectorSelectionInput')].sort();
    const categories = [...arrayLiteralsOfConst(connectors, 'CONNECTOR_CATEGORIES')].sort();
    expect(properties).toEqual(categories);
  });
});

describe('🔴 packages/db の CHECK 値集合との二重宣言が一致していること（docs/05 §3.9）', () => {
  it('対照: packages/db 側から値を取り出せている（テストが空振りしていない）', () => {
    expect(arrayLiteralsOfConst(dbValueSets, 'EMAIL_RECIPIENT_CLASSES').length).toBeGreaterThan(0);
    expect(arrayLiteralsOfConst(dbValueSets, 'SEND_ATTEMPT_ENTITY_TYPES').length).toBeGreaterThan(0);
  });

  it('対照: packages/domain 側から宛先分類を取り出せている（テストが空振りしていない）', () => {
    expect(arrayLiteralsOfConst(domainRecipient, 'RECIPIENT_CLASSES').length).toBeGreaterThan(0);
  });

  it('宛先分類（@ses/domain の RECIPIENT_CLASSES ↔ EMAIL_RECIPIENT_CLASSES）が一致する', () => {
    const fromDomain = [...arrayLiteralsOfConst(domainRecipient, 'RECIPIENT_CLASSES')].sort();
    const fromDb = [...arrayLiteralsOfConst(dbValueSets, 'EMAIL_RECIPIENT_CLASSES')].sort();
    expect(fromDomain).toEqual(fromDb);
  });

  it('🔴 packages/connectors が宛先分類を再宣言していない（T-04-02 で domain に一本化した）', () => {
    // 🔴 再宣言が入ると値集合が 3 箇所に散り、「connectors だけ古い」状態が起こりうる。
    //    ここは re-export（`export { RECIPIENT_CLASSES } from '@ses/domain'`）でなければならない。
    expect(arrayLiteralsOfConst(connectors, 'RECIPIENT_CLASSES')).toEqual([]);
    expect(readFileSync(connectorsFile, 'utf8')).toContain("from '@ses/domain'");
  });

  it('🔴 送信エンティティ種別（SEND_ENTITY_TYPES ↔ SEND_ATTEMPT_ENTITY_TYPES）が一致する', () => {
    // ずれると idempotencyKey() が send_attempts の CHECK を通らない値を生み、
    // 二重送信の唯一の防御線（docs/05 §10.1 の 2 本の UNIQUE）が機能しない。
    const fromConnectors = [...arrayLiteralsOfConst(connectors, 'SEND_ENTITY_TYPES')].sort();
    const fromDb = [...arrayLiteralsOfConst(dbValueSets, 'SEND_ATTEMPT_ENTITY_TYPES')].sort();
    expect(fromConnectors).toEqual(fromDb);
  });

  it('🔴 SES のイベント種別（SES_EVENT_TYPES ↔ EMAIL_EVENT_TYPES）が一致する（T-04-03）', () => {
    // ずれると `normalizeSesEvent` が導いた種別で `email_events` の CHECK に落ちる
    // ＝ バウンス・苦情が記録されないまま実行時に壊れる（docs/03 §3.2.5 / docs/05 §3.9）。
    const fromConnectors = [...arrayLiteralsOfConst(sesEvents, 'SES_EVENT_TYPES')].sort();
    const fromDb = [...arrayLiteralsOfConst(dbValueSets, 'EMAIL_EVENT_TYPES')].sort();
    expect(fromConnectors.length).toBeGreaterThan(0);
    expect(fromConnectors).toEqual(fromDb);
  });

  it('🔴 ジョブ名の接尾辞（send.interview-invite）とエンティティ種別（INTERVIEW）を混同していない', () => {
    // 名前が似ているため取り違えやすい。ここで明示的に固定する。
    expect(arrayLiteralsOfConst(connectors, 'SEND_ENTITY_TYPES')).toContain('INTERVIEW');
    expect(arrayLiteralsOfConst(connectors, 'SEND_ENTITY_TYPES')).not.toContain('INTERVIEW_INVITE');
  });
});

describe('🔴 送信トークン型が docs/05 §10.2 の宣言と一致していること', () => {
  it('対照: docs から SendAttemptToken の宣言を読めている', () => {
    expect(propertyNamesOfTypeAlias(docsSendTokens, 'SendAttemptToken').length).toBeGreaterThan(0);
  });

  it('SendAttemptToken のプロパティ名が docs/05 §10.2（packages/db/src/send.ts）と一致する', () => {
    // ブランド（computed property）は両側とも対象外。名前付きプロパティだけを突合する。
    const fromDocs = [...propertyNamesOfTypeAlias(docsSendTokens, 'SendAttemptToken')].sort();
    const fromConnectors = [...propertyNamesOfTypeAlias(connectors, 'SendAttemptToken')].sort();
    expect(fromConnectors).toEqual(fromDocs);
  });

  it('SendAttemptToken の entityType が SendEntityType である（型名の取り違えを固定する）', () => {
    const types = propertyTypeTextsOfTypeAlias(connectors, 'SendAttemptToken');
    expect(types.entityType).toBe('SendEntityType');
  });
});
