// tests/static/ui-overlay-contract.test.ts
// 🔴 `SP-22` `T-22-03` の受け入れ基準を**構造で**固定する（`docs/sprints/SP-22-ui-overhaul.md`
//    §6 の「新部品の render テスト … `Drawer` の型に `action` が無い」/ 受け入れ基準 2・3・4・5）。
//
// ============================================================================
// なぜ「型の形」をテストするのか（コメントで守れないものだけを見る）
// ============================================================================
// `docs/04` §5-13 が overlay に課している規約のうち、**実装のコメントでは守れないもの**が 3 つある。
//
//   ① 🔴 **`Drawer` に実行系のアクション（承認 / 送信 / 再送 / 応諾 / 公開 / 解除）を置かない。**
//      `children: ReactNode` を持つ部品は「何でも入れられる器」であり、規約は**コメントだけ**に
//      なる（`CLAUDE.md` §3.3 のゲートは「判断材料を全部見たうえで承認する」ことが前提で、
//      要約だけで押せる承認導線は**ゲートの実質的な形骸化**である）。**props のキーの集合を
//      凍結し、`action` / `children` / `footer` が生えた瞬間に落とす。**
//   ② 🔴 **`Dialog` にスクロールが必要な量を入れない**（§5-13。入るなら Drawer かページ）。
//      本文が `ReactNode` になった瞬間に一覧・ゲート結果・差分が入る。**`body: string` を凍結する。**
//   ③ 🔴 **`'use client'` を主バレルにも `apps/web/app/(main)/layout.tsx` にも置かない**
//      （`docs/05` §2.3.1）。置くと**主平面の全画面**がクライアントバンドルへ移り、
//      `tests/static/client-db-boundary.test.ts` の前提（`'use client'` の閉包に `@ses/db` が
//      現れない）が「全画面が閉包に入る」形で崩れる。**宣言のあるファイルの集合を凍結する。**
//
// 🔴 **既存の検査と重複させない**（`docs/05` §17.4「同じ検証を 2 箇所に書かない」）:
//   - `role="dialog"` の単一実装 / `@radix-ui/*` の import 位置 → `ui-primitive-single-impl.test.ts` (b)
//   - `exports` の**キー**が 2 つだけ / `@ses/ui/client` の**利用側**が `'use client'` を宣言
//     → `ui-dependency-single-path.test.ts` (i)⑤⑥
//   - `packages/ui` のトークン（色 / spacing / 文字サイズ / radius / shadow） → `design-tokens.test.ts`
//   **本ファイルが見るのは「型の形」「バレルの割れ方」「`'use client'` の置き場所」だけ**である。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';

const UI_SRC = path.join(repoRoot, 'packages', 'ui', 'src');
const COMPONENTS = path.join(UI_SRC, 'components');

/** 🔴 `T-22-03` が置く overlay 6 部品（`docs/05` §2.3.1 の表の 9〜13 と 16）。 */
const OVERLAY_FILES = [
  'dialog.tsx',
  'drawer.tsx',
  'dropdown-menu.tsx',
  'tabs.tsx',
  'toast.tsx',
  'tooltip.tsx',
] as const;

function parse(absolute: string): ts.SourceFile {
  return ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function component(name: string): ts.SourceFile {
  return parse(path.join(COMPONENTS, name));
}

// ============================================================================
// 検出器（対照テストを末尾に持つ）
// ============================================================================

/** ファイル先頭の `'use client'` ディレクティブ。 */
export function declaresUseClient(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  if (first === undefined || !ts.isExpressionStatement(first)) return false;
  return ts.isStringLiteralLike(first.expression) && first.expression.text === 'use client';
}

/** 型エイリアスの宣言（同一ファイル内）。 */
function typeAlias(source: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  const found = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  if (found === undefined) throw new Error(`型 ${name} が ${source.fileName} に無い`);
  return found;
}

export type TypeMember = {
  readonly name: string;
  readonly optional: boolean;
  /** その member の**型**のソーステキスト（member の JSDoc は含まない）。 */
  readonly typeText: string;
};

/**
 * 型リテラル（交差型なら各項、同一ファイル内の型参照なら参照先）の member を集める。
 *
 * 🔴 **`Omit<ComponentProps<…>, …>` のような外部型は展開しない**（TypeScript の型チェッカを
 *    使わないため）。代わりに `topLevelTypeReferences()` が「土台に何を使っているか」を返し、
 *    テスト側が「外部型を土台にしていないこと」を別に検査する。
 */
export function typeMembers(source: ts.SourceFile, name: string): TypeMember[] {
  const members: TypeMember[] = [];
  const visitType = (node: ts.TypeNode, depth: number): void => {
    if (depth > 4) return;
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name === undefined) continue;
        const memberName = ts.isStringLiteralLike(member.name)
          ? member.name.text
          : member.name.getText(source);
        members.push({
          name: memberName,
          optional: member.questionToken !== undefined,
          typeText: member.type === undefined ? '' : member.type.getText(source).replace(/\s+/g, ' '),
        });
      }
      return;
    }
    if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
      for (const part of node.types) visitType(part, depth + 1);
      return;
    }
    if (ts.isParenthesizedTypeNode(node)) {
      visitType(node.type, depth + 1);
      return;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      // 同一ファイル内の型エイリアスなら辿る（`DrawerPassThrough` のような素通し用の型）。
      const local = source.statements.find(
        (statement): statement is ts.TypeAliasDeclaration =>
          ts.isTypeAliasDeclaration(statement) && statement.name.text === (node.typeName as ts.Identifier).text,
      );
      if (local !== undefined) visitType(local.type, depth + 1);
    }
  };
  visitType(typeAlias(source, name).type, 0);
  return members;
}

/** 交差型の各項に現れる**型参照の名前**（土台に何を使っているかを見る）。 */
export function topLevelTypeReferences(source: ts.SourceFile, name: string): string[] {
  const names: string[] = [];
  const visitType = (node: ts.TypeNode): void => {
    if (ts.isIntersectionTypeNode(node)) {
      for (const part of node.types) visitType(part);
      return;
    }
    if (ts.isParenthesizedTypeNode(node)) {
      visitType(node.type);
      return;
    }
    if (ts.isTypeReferenceNode(node)) names.push(node.typeName.getText(source));
  };
  visitType(typeAlias(source, name).type);
  return names;
}

/** 文字列リテラルの合併型（`ToastKind` / `align`）の値。 */
export function stringUnionMembers(source: ts.SourceFile, name: string): string[] {
  const node = typeAlias(source, name).type;
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)) return [node.literal.text];
  if (!ts.isUnionTypeNode(node)) return [];
  return node.types.flatMap((part) =>
    ts.isLiteralTypeNode(part) && ts.isStringLiteralLike(part.literal) ? [part.literal.text] : [],
  );
}

/** タプルの合併型（`TabsItems` / `DropdownMenuItems`）の各項の要素数。 */
export function tupleUnionArities(source: ts.SourceFile, name: string): number[] {
  const node = typeAlias(source, name).type;
  const arityOf = (part: ts.TypeNode): number[] => {
    const inner = ts.isTypeOperatorNode(part) ? part.type : part;
    return ts.isTupleTypeNode(inner) ? [inner.elements.length] : [];
  };
  return ts.isUnionTypeNode(node) ? node.types.flatMap(arityOf) : arityOf(node);
}

/** 数値の定数宣言（`export const TABS_MAX_ITEMS = 4`）。 */
export function numericConstant(source: ts.SourceFile, name: string): number | null {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer !== undefined && ts.isNumericLiteral(initializer)) return Number(initializer.text);
    }
  }
  return null;
}

/** `throw new Error(...)` の件数（上限を超えた入力を「黙って捨てない」ことの担保）。 */
export function throwCount(source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/** `export … from '<module>'` の module 指定子（バレルが何を載せているか）。 */
export function reExportedModules(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

/**
 * `import … from '<module>'` の module 指定子。
 * 🔴 **正規表現でファイル全体を割らない** —— 本リポジトリのプリミティブは「取り込まなかった
 *    依存」をコメントに書き残しており（`components/toast.tsx` の「`@radix-ui/react-toast` は
 *    承認の列挙に無い」）、テキスト照合にすると**規律を書き残した瞬間に落ちる検査**になる
 *    （`support/ui-classes.ts` 冒頭と同じ理由。誤検知する検査はいずれ緩められる）。
 */
export function importedModules(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

/** 指定した名前のグローバル関数の**呼び出し**（コメント中の言及は拾わない）。 */
export function globalCalls(source: ts.SourceFile, names: readonly string[]): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.includes(node.expression.text)) {
      found.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// ============================================================================
// ① `'use client'` の置き場所（受け入れ基準 2 / `docs/05` §2.3.1）
// ============================================================================
const uiFiles = collectSourceFiles(UI_SRC, ['.ts', '.tsx']);

describe("🔴 `'use client'` は overlay 6 部品のファイルだけに在る（docs/05 §2.3.1）", () => {
  it('走査が空振りしていない（対照）', () => {
    expect(uiFiles.length).toBeGreaterThanOrEqual(21);
  });

  it('🔴 宣言しているファイルが overlay 6 部品と完全に一致する（主バレルにも 15 部品にも無い）', () => {
    const declaring = uiFiles
      .filter((absolute) => declaresUseClient(parse(absolute)))
      .map((absolute) => toRepoRelative(absolute))
      .sort();
    expect(
      declaring,
      "🔴 `'use client'` は `@ses/ui/client` 側の各ファイル先頭にだけ置きます（docs/05 §2.3.1）。" +
        '主バレル（`packages/ui/src/index.ts`）とそこから export される 15 部品に付けると、' +
        'それらを描いていたサーバコンポーネントの画面が丸ごとクライアントバンドルへ移ります。',
    ).toEqual(OVERLAY_FILES.map((file) => `packages/ui/src/components/${file}`).sort());
  });

  it('🔴 主バレル（`index.ts`）と `./client` バレル（`index.client.ts`）自身は宣言しない', () => {
    // バレルは再 export だけであり、境界を宣言するのは実体のあるファイルである
    //（Next.js は再 export 経由でも各部品ファイルの `'use client'` を境界として扱う）。
    for (const barrel of ['index.ts', 'index.client.ts']) {
      expect(declaresUseClient(parse(path.join(UI_SRC, barrel))), barrel).toBe(false);
    }
  });

  it("🔴 `apps/web/app/(main)/layout.tsx` が `'use client'` を宣言していない（主平面の全画面がクライアント化しない）", () => {
    const layout = path.join(repoRoot, 'apps', 'web', 'app', '(main)', 'layout.tsx');
    expect(
      declaresUseClient(parse(layout)),
      '🔴 docs/05 §2.3.1: ここに付けると主平面の全画面がクライアントバンドルへ移り、' +
        '`tests/static/client-db-boundary.test.ts` の前提（`use client` の閉包に `@ses/db` が' +
        '現れない）が「全画面が閉包に入る」形で崩れます。',
    ).toBe(false);
  });
});

// ============================================================================
// ② バレルの割れ方（受け入れ基準 2 / `docs/05` §2.3.1）
// ============================================================================
describe('🔴 バレルは `"."`（サーバ）と `"./client"`（Radix 系）の 2 つに割れている', () => {
  const mainBarrel = parse(path.join(UI_SRC, 'index.ts'));
  const clientBarrel = parse(path.join(UI_SRC, 'index.client.ts'));

  it('🔴 主バレルが overlay 6 部品を 1 つも載せていない', () => {
    const loaded = reExportedModules(mainBarrel).filter((module) =>
      OVERLAY_FILES.some((file) => module.endsWith(`/${file.replace(/\.tsx$/, '.js')}`)),
    );
    expect(
      loaded,
      '🔴 docs/05 §2.3.1: 主バレルに載せると、`Button` を 1 つ使うだけの' +
        'サーバコンポーネントが Radix と `use client` の塊を**参照していないのに**引き込みます。',
    ).toEqual([]);
  });

  it('`./client` バレルが overlay 6 部品を載せている', () => {
    const loaded = new Set(reExportedModules(clientBarrel));
    for (const file of OVERLAY_FILES) {
      expect(loaded, file).toContain(`./components/${file.replace(/\.tsx$/, '.js')}`);
    }
  });

  it('🔴 `exports` の 2 つのサブパスが、それぞれのバレルの成果物を指している', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', 'ui', 'package.json'), 'utf8'),
    ) as { readonly exports?: Record<string, { readonly types?: string; readonly default?: string }> };
    // 🔴 キーが 2 つだけであることは `ui-dependency-single-path.test.ts` (i)⑥ が見る。
    //    ここで見るのは**指し先**である（片方が同じファイルを指していたら分割が効かない）。
    expect(manifest.exports?.['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
    expect(manifest.exports?.['./client']).toEqual({
      types: './dist/index.client.d.ts',
      default: './dist/index.client.js',
    });
  });
});

// ============================================================================
// ③ 🔴 `Drawer` — 実行系のアクションを置けない形であること（本ファイルの主眼）
// ============================================================================
/**
 * 🔴 **実行系を持ち込む口の名前**（`docs/04` §5-13 の「承認 / 送信 / 再送 / 応諾 / 公開 / 解除」を
 *    置くために要る prop の名前）。1 つでも生えたら落ちる。
 */
const EXECUTION_PROP_NAMES = [
  'children',
  'action',
  'actions',
  'footer',
  'confirm',
  'submit',
  'onClick',
  'onSelect',
  'onSubmit',
  'formAction',
  'primaryAction',
  'secondaryAction',
] as const;

/** 🔴 任意の要素を差し込める型の名前（`Drawer` の props に現れてはならない）。 */
const ARBITRARY_NODE_TYPES = ['ReactNode', 'ReactElement', 'JSX.Element'] as const;

describe('🔴 `Drawer` は「読み取りのみ」を型で守っている（docs/04 §5-13 / §7.2 / §4.1）', () => {
  const source = component('drawer.tsx');
  const members = typeMembers(source, 'DrawerProps');

  it('🔴 props のキーの集合が凍結されている（`action` / `children` / `footer` が無い）', () => {
    expect(
      members.map((member) => member.name).sort(),
      '🔴 docs/04 §5-13: Drawer に実行系のアクション（承認 / 送信 / 再送 / 応諾 / 公開 / 解除）を' +
        '置かない。`CLAUDE.md` §3.3 のゲートは「判断材料を全部見たうえで承認する」ことが前提であり、' +
        '要約だけで押せる承認導線はゲートの実質的な形骸化にあたります。' +
        '出口は `detailLink`（遷移）1 本だけです。',
    ).toEqual(
      [
        'closeLabel',
        'data-testid',
        'detailLink',
        'history',
        'historyLabel',
        'items',
        'linkComponent',
        'onOpenChange',
        'open',
        'panelClassName',
        'title',
      ].sort(),
    );
  });

  it('🔴 実行系を持ち込む名前の prop が 1 つも無い', () => {
    const names = new Set(members.map((member) => member.name));
    const offenders = EXECUTION_PROP_NAMES.filter((name) => names.has(name));
    expect(offenders, '🔴 上の 🔴 と同じ理由。名前を変えて同じ穴を開けることも認めません。').toEqual([]);
  });

  it('🔴 任意の要素を受け取る member が 1 つも無い（`ReactNode` を直接持たない）', () => {
    const offenders = members
      .filter((member) => ARBITRARY_NODE_TYPES.some((type) => member.typeText.includes(type)))
      .map((member) => `${member.name}: ${member.typeText}`);
    expect(
      offenders,
      '🔴 `ReactNode` を受け取る prop は「何でも入れられる器」であり、`<Button>` / `<form>` を' +
        '渡せてしまいます（規約がコメントだけになる）。`linkComponent` は `href` を必須に持つ' +
        '**遷移専用**の部品型（`OverlayLinkProps`）であり、要素そのものではありません。',
    ).toEqual([]);
  });

  it('🔴 `ComponentProps` を土台にしていない（`children` と DOM の `onClick` が入ってこない）', () => {
    expect(
      topLevelTypeReferences(source, 'DrawerProps'),
      '🔴 `ComponentProps<typeof DialogPrimitive.Content>` を土台にすると `children` と' +
        '`onClick` が一緒に入ってきて、上の 3 つの保証が同時に消えます。' +
        '素通しするのは `data-testid` だけを持つ閉じた型（`DrawerPassThrough`）です。',
    ).toEqual(['DrawerPassThrough']);
  });

  it('`detailLink` が `href` と `label` だけを持つ（`onClick` を持たない = 遷移である）', () => {
    expect(typeMembers(source, 'DrawerDetailLink').map((member) => member.name).sort()).toEqual([
      'href',
      'label',
    ]);
  });

  it('読み取り項目の値が文字列である（要素を並べられない）', () => {
    const item = typeMembers(source, 'DrawerItem');
    expect(item.map((member) => `${member.name}: ${member.typeText}`).sort()).toEqual([
      'label: string',
      'value: string',
    ]);
  });
});

// ============================================================================
// ④ 🔴 `Dialog` — スクロールが必要な量を入れられない形であること
// ============================================================================
describe('🔴 `Dialog` は「判断材料を押し込まない / スクロールが必要な量を入れない」を型で守っている', () => {
  const source = component('dialog.tsx');
  const members = typeMembers(source, 'DialogProps');
  const byName = new Map(members.map((member) => [member.name, member]));

  it('🔴 本文（`body`）が `string` である（`ReactNode` ではない）', () => {
    expect(
      byName.get('body')?.typeText,
      '🔴 docs/04 §5-13: Dialog に**スクロールが必要な量を入れない**（入るなら Drawer かページ）/ ' +
        '**判断材料を押し込まない**（§7.2）。本文が `ReactNode` になった瞬間に一覧・ゲート結果・' +
        '差分が入ります。パネル側も `max-h-[85vh] overflow-hidden` で、`overflow-y-auto` を' +
        '付けていません（付けた瞬間に「入れてよい」になります）。',
    ).toBe('string');
  });

  it('🔴 `children` を受け取らない（土台の `Omit` で外している）', () => {
    expect(byName.has('children')).toBe(false);
    const omit = topLevelTypeReferences(source, 'DialogProps').find((name) => name === 'Omit');
    expect(omit, '土台が `Omit<…>` でなくなっている（`children` が入る）').toBe('Omit');
    const aliasText = typeAlias(source, 'DialogProps').type.getText(source);
    expect(
      /'children'/.test(aliasText),
      "🔴 `Omit<ComponentProps<…>, 'children' | …>` の `'children'` が消えています。",
    ).toBe(true);
  });

  it('確定操作は 1 つで、取消の語は必須である（§7.6 の摩擦 / §7.8 の `キャンセル`）', () => {
    expect(byName.get('confirm')?.optional, '確定操作は必須（摩擦のためだけの Dialog は作らない）').toBe(false);
    expect(byName.get('cancelLabel')?.optional, '🔴 取消は必ず在る（何も起きずに閉じる道を消さない）').toBe(false);
  });

  it('1 項目の入力のスロットが**単数**である（`fields` ではなく `field`）', () => {
    expect(byName.has('field')).toBe(true);
    expect(byName.has('fields'), '🔴 複数項目のフォームはウィザード（ページ）です（§7.2）').toBe(false);
  });
});

// ============================================================================
// ⑤ 🔴 `Tabs` / `DropdownMenu` — 件数の上限（§10.3 / §5-13）
// ============================================================================
describe('🔴 `Tabs` は 5 つ以上に増やせない（docs/04 §10.3）', () => {
  const source = component('tabs.tsx');

  it('上限が 4 である（「5 つ以上に増やさない」= 5 も含む）', () => {
    expect(numericConstant(source, 'TABS_MAX_ITEMS')).toBe(4);
  });

  it('🔴 型が 1〜4 要素のタプルの合併である（5 個目はコンパイルが通らない）', () => {
    expect(
      tupleUnionArities(source, 'TabsItems'),
      '🔴 配列型（`readonly TabsItem[]`）にすると上限が型で表せません。',
    ).toEqual([1, 2, 3, 4]);
  });

  it('🔴 実行時にも上限を守る（キャストで型の壁を越えた入力を黙って描かない）', () => {
    expect(
      throwCount(source),
      '🔴 `CLAUDE.md` §4.2 と同じ立て方: サイレントに無視しない。5 件目を黙って捨てると' +
        '規約は「気をつける」に戻ります。',
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('🔴 `DropdownMenu` は項目 7 つ以上にできない（docs/04 §5-13）', () => {
  const source = component('dropdown-menu.tsx');

  it('上限が 6 である（「7 つ以上にしない」= 7 も含む）', () => {
    expect(numericConstant(source, 'DROPDOWN_MENU_MAX_ITEMS')).toBe(6);
  });

  it('🔴 型が 1〜6 要素のタプルの合併である', () => {
    expect(tupleUnionArities(source, 'DropdownMenuItems')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('🔴 実行時にも上限を守る', () => {
    expect(throwCount(source)).toBeGreaterThanOrEqual(1);
  });

  it('🔴 破壊的操作を赤くしてメニューに隠す口が無い（`variant` を持たない）', () => {
    const names = new Set([
      ...typeMembers(source, 'DropdownMenuActionItem').map((member) => member.name),
      ...typeMembers(source, 'DropdownMenuLinkItem').map((member) => member.name),
    ]);
    expect(
      [...names].sort(),
      '🔴 docs/04 §5-13: primary / 破壊的操作をメニューに隠さない（`S-013` の公開解除・' +
        '`A-010` の停止は画面上の secondary + 確認。§7.6）。shadcn/ui の ' +
        '`DropdownMenuItem` は `variant="destructive"` を持ちますが、**取り込みません** ——' +
        '赤い項目を作れる口があると必ずそこに入ります。',
    ).toEqual(['disabled', 'href', 'kind', 'label', 'onSelect'].sort());
  });
});

// ============================================================================
// ⑥ 🔴 `Toast` / `Tooltip` — 種別と中身の形（§5-13）
// ============================================================================
describe('🔴 `Toast` は「受付」を促し、エラーの経路にならない（docs/04 §5-13 / §4.4）', () => {
  const source = component('toast.tsx');
  const byName = new Map(typeMembers(source, 'ToastProps').map((member) => [member.name, member]));

  it('🔴 種別に `error` が無い（エラーを Toast だけで出す口を作らない）', () => {
    expect(
      stringUnionMembers(source, 'ToastKind'),
      '🔴 docs/04 §5-13: **エラーを Toast だけで出さない**（消えると原因が読めない）。' +
        '§7.10 の error は画面内に残します。`danger` 色を持たないのも同じ理由です' +
        '（`--color-danger` は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` だけの色。§7.4）。',
    ).toEqual(['accepted', 'completed']);
  });

  it('🔴 対象への遷移（`subject`）が必須である（Toast だけで完了を伝えない）', () => {
    expect(
      byName.get('subject')?.optional,
      '🔴 docs/04 §5-13: 一次の伝達経路は**対象の状態バッジ**（§5-1）と `S-032` の通知であり、' +
        'Toast は補助です（`CLAUDE.md` §13.1 の「移動中に操作する」前提では画面を閉じる）。' +
        '必須にすることで「Toast を出して終わり」という呼び出し方が型で書けなくなります。',
    ).toBe(false);
  });

  it('🔴 自動で消えない（`setTimeout` / `setInterval` を呼ばない）', () => {
    expect(
      globalCalls(source, ['setTimeout', 'setInterval']),
      '🔴 消えるまでの時間は「読めたか」の保証になりません。表示の寿命は呼び出し側（画面の状態）が' +
        '持ち、閉じるのは利用者の操作（`onDismiss`）だけです。',
    ).toEqual([]);
  });

  it('🔴 Radix を使わない（`@radix-ui/react-toast` は承認の列挙に無い）', () => {
    expect(
      importedModules(source).filter((module) => module.startsWith('@radix-ui/')),
      '🔴 docs/05 §2.3.3 が承認しているのは `@radix-ui/react-{dialog,dropdown-menu,tooltip,tabs}` の' +
        '4 つだけです（依存の追加は人間の承認事項。`CLAUDE.md` §8.6）。',
    ).toEqual([]);
  });
});

describe('🔴 `Tooltip` に判断材料を入れられない（docs/04 §5-13 / `U-16`）', () => {
  const source = component('tooltip.tsx');
  const byName = new Map(typeMembers(source, 'TooltipProps').map((member) => [member.name, member]));

  it('🔴 中身（`content`）が `string` である（要素を渡せない）', () => {
    expect(
      byName.get('content')?.typeText,
      '🔴 docs/04 §5-13: **ツールチップだけにしか無い情報を作らない / 判断材料を入れない**' +
        '（触端末で開けない。`CLAUDE.md` §13.3）。`ReactNode` にすると表・リンク・ボタンが入ります。',
    ).toBe('string');
  });
});

// ============================================================================
// ⑦ Radix の割り当て（`Drawer` は `Dialog` 派生であり、別依存を足していない）
// ============================================================================
describe('🔴 Radix の依存が 4 つで、`Drawer` は `Dialog` 派生である（docs/05 §2.3.1 / §2.3.3）', () => {
  it('🔴 `packages/ui` の `@radix-ui/*` の依存が承認された 4 つと完全に一致する', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', 'ui', 'package.json'), 'utf8'),
    ) as { readonly dependencies?: Record<string, string> };
    const radix = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith('@radix-ui/'))
      .sort();
    expect(
      radix,
      '🔴 docs/04 §5-13 / docs/05 §2.3.3 で人間が承認したのはこの 4 つだけです' +
        '（`Drawer` 用に別依存を足さない / `Toast` は Radix を使わない）。',
    ).toEqual([
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ]);
  });

  it('🔴 `drawer.tsx` が使う Radix は `react-dialog` だけである（Dialog 派生）', () => {
    expect(
      importedModules(component('drawer.tsx')).filter((module) => module.startsWith('@radix-ui/')),
      '🔴 docs/05 §2.3.1: `Drawer` は `Dialog` 派生として実装し、別依存を足さない。' +
        '`vaul` 等のドロワー専用ライブラリを入れないこと。',
    ).toEqual(['@radix-ui/react-dialog']);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: 型の検出器', () => {
  const parseText = (text: string): ts.SourceFile =>
    ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('交差型と同一ファイル内の型参照をたどって member を集める', () => {
    const source = parseText(
      [
        'type Pass = { readonly "data-testid"?: string };',
        'export type P = Pass & {',
        '  /** doc に children と書いても member ではない */',
        '  readonly title: string;',
        '  readonly items?: readonly { label: string }[];',
        '};',
      ].join('\n'),
    );
    expect(typeMembers(source, 'P').map((member) => `${member.name}${member.optional ? '?' : ''}`).sort()).toEqual(
      ['data-testid?', 'items?', 'title'].sort(),
    );
  });

  it('🔴 `children` / `action` / `ReactNode` を仕込むと検出される（走査が空振りしていない）', () => {
    const source = parseText(
      ['export type P = {', '  readonly children: ReactNode;', '  readonly action: () => void;', '};'].join('\n'),
    );
    const members = typeMembers(source, 'P');
    expect(members.map((member) => member.name).sort()).toEqual(['action', 'children']);
    expect(EXECUTION_PROP_NAMES.filter((name) => members.some((member) => member.name === name)).sort()).toEqual([
      'action',
      'children',
    ]);
    expect(
      members.filter((member) => ARBITRARY_NODE_TYPES.some((type) => member.typeText.includes(type))).map((m) => m.name),
    ).toEqual(['children']);
  });

  it('土台に使った型参照を返す（`Omit<…>` を土台にしたら分かる）', () => {
    const source = parseText("export type P = Omit<ComponentProps<'div'>, 'children'> & { readonly a: string };");
    expect(topLevelTypeReferences(source, 'P')).toEqual(['Omit']);
  });

  it('タプルの合併の要素数と、文字列の合併の値を返す', () => {
    const source = parseText(
      [
        'export type T = readonly [A] | readonly [A, A] | readonly [A, A, A];',
        "export type K = 'a' | 'b';",
        'export const MAX = 3;',
      ].join('\n'),
    );
    expect(tupleUnionArities(source, 'T')).toEqual([1, 2, 3]);
    expect(stringUnionMembers(source, 'K')).toEqual(['a', 'b']);
    expect(numericConstant(source, 'MAX')).toBe(3);
    expect(numericConstant(source, 'MISSING')).toBeNull();
  });

  it("🔴 `'use client'` の検出が先頭のディレクティブだけを見る", () => {
    expect(declaresUseClient(parseText("'use client';\nexport const A = 1;"))).toBe(true);
    expect(declaresUseClient(parseText("export const A = 1;\n'use client';"))).toBe(false);
    expect(declaresUseClient(parseText("// 'use client'\nexport const A = 1;"))).toBe(false);
  });

  it('`export … from` の module 指定子だけを拾う（値の export は拾わない）', () => {
    const source = parseText(
      ["export { A } from './a.js';", "export type { B } from './b.js';", 'export const C = 1;'].join('\n'),
    );
    expect(reExportedModules(source)).toEqual(['./a.js', './b.js']);
  });

  it('`throw` の件数を数える', () => {
    expect(throwCount(parseText('export function f() { if (true) throw new Error("x"); }'))).toBe(1);
    expect(throwCount(parseText('export function f() { return 1; }'))).toBe(0);
  });

  it('🔴 import と `setTimeout` の検出が**コメント中の言及**を拾わない（誤検知する検査は緩められる）', () => {
    const source = parseText(
      [
        "// 🔴 `@radix-ui/react-toast` は承認の列挙に無いので import しない。setTimeout も使わない。",
        "import * as D from '@radix-ui/react-dialog';",
        'export function f() { return D; }',
      ].join('\n'),
    );
    expect(importedModules(source)).toEqual(['@radix-ui/react-dialog']);
    expect(globalCalls(source, ['setTimeout', 'setInterval'])).toEqual([]);
    // 実物の呼び出しは拾う（空振りしていないことの対照）。
    expect(
      globalCalls(parseText('export function f() { setTimeout(() => 1, 0); }'), ['setTimeout', 'setInterval']),
    ).toEqual(['setTimeout']);
  });
});
