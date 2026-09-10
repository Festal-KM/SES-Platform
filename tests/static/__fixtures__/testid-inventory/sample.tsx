// tests/static/__fixtures__/testid-inventory/sample.tsx
// 🔴 `tests/static/testid-inventory.test.ts` の抽出器の自己検査用。**実装ではない。**
//    `tests/static/__fixtures__/**` は eslint / tsconfig.tests.json の対象外である
//    （型が通ることは要求されない。テキストとして読まれるだけ）。
//
// ここに置くのは「抽出器が拾わなければならない形」と「拾ってはいけない形」の両方である。
// 期待値はテスト側に書いてある。**片方だけ足さない。**
export function Sample({
  row,
  a,
  b,
  kind,
  passthroughTestId,
}: {
  row: { id: string };
  a: string;
  b: string;
  kind: string;
  passthroughTestId: string;
}) {
  return (
    <div>
      {/* 拾う: 文字列リテラル（二重引用符 / 単一引用符の式） */}
      <span data-testid="plain-double-quoted" />
      <span data-testid={'plain-single-quoted'} />

      {/* 拾う: 穴の無いテンプレートリテラルは完全一致として扱う */}
      <span data-testid={`template-without-hole`} />

      {/* 拾う: 穴のあるテンプレートリテラルは `${` の手前までを接頭辞として扱う */}
      <span data-testid={`dynamic-row-${row.id}`} />
      <span data-testid={`nested-cell-${a}-${b}`} />

      {/* 拾う: 三項演算子の各枝。🔴 比較のオペランド（`role-enum-value`）は拾わない */}
      <span data-testid={kind === 'role-enum-value' ? 'ternary-when-true' : 'ternary-when-false'} />

      {/* 拾う: `data-testid={testId}` へ流れるプロパティ */}
      <Child testId="via-test-id-prop" />

      {/* 穴として報告する: 素の識別子は静的に解決できない */}
      <span data-testid={passthroughTestId} />

      {/* 拾わない: `data-testid` に似た別属性 */}
      <span data-testid-note="not-a-testid" />
    </div>
  );
}

function Child({ testId }: { testId: string }) {
  return <span data-testid={testId} />;
}
