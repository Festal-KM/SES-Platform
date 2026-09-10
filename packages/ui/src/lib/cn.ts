// packages/ui/src/lib/cn.ts
// 🔴 shadcn/ui の取り込みコンポーネントが使う最小のクラス名結合ユーティリティ。
//    `class-variance-authority` / `tailwind-merge` は導入せず、必要になった時点で追加する
//    （CLAUDE.md「新規依存の追加は宣言のみ」/ docs/sprints/SP-03 T-03-06「必要な最小
//    コンポーネントのみ」）。
//
// ============================================================================
// 🔴 `className` で「上書き」はできない（T-21-01 レビュー指摘の是正。2026-09-10）
// ============================================================================
// 以前ここには「競合するクラス名の後勝ちは呼び出し側の順序に委ねる」と書いてあった。
// **これは CSS の挙動として誤りである。**
//
//   - この `cn()` は単純結合であり、`tailwind-merge` のような競合解決を一切しない。
//   - `class` 属性の並び順は勝敗を決めない。同じプロパティに効くユーティリティが 2 つ
//     載ったとき、勝つのは **Tailwind が生成したスタイルシート上で後ろにある方**であり、
//     呼び出し側からは制御できない（詳細度も同じなので、宣言順だけで決まる）。
//   - つまり `<TableCell className="whitespace-normal">` と書いても、基底の
//     `whitespace-nowrap` に勝てるとは限らない。**勝つ日と負ける日がある**のではなく、
//     Tailwind の内部順序という「読めない場所」が決めている。
//
// 🔴 したがって次の規律で使う。
//   1. `className` で渡してよいのは、**基底クラスと競合しないユーティリティ**だけである
//      （余白 `mb-4` / 幅 `max-w-sm` / 表示 `hidden sm:table-cell` など）。
//   2. **競合する上書きが要るときは `className` ではなく prop にする** —— `variant` /
//      `size` / `whitespace` のように `packages/ui` 側の選択肢として足す
//      （実例: `components/table.tsx` の `whitespace` prop、`components/badge.tsx` の
//      `variant`。バリアント側で色を持つ語は**基底に置かない**）。
//   3. `tailwind-merge` を入れれば (1) の制限を外して「呼び出し側の後勝ち」にできるが、
//      **新規依存の追加は承認事項**であり、本タスク（T-21-02）では採らない。
//      必要になった時点で、この規律ごと見直して提起する。
export function cn(...classes: ReadonlyArray<string | false | null | undefined>): string {
  return classes
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}
