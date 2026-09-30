// apps/web/app/(main)/_shell/page-heading.tsx
// 主平面の**帯**の値の組み立て。描画は `@ses/ui` の `PageHeader` が持つ。
// docs/04 §3.1（レイアウト図の 3 行目）/ §3.4 / §7.5 / §7.6。T-12-21 → SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 なぜレイアウト（外枠）ではなく各画面が描くのか（**`T-12-21` の判断。変えていない**）
// ============================================================================
// 帯の中身（タイトル・現在地・次の一手）は**画面ごとの値**である。RSC ではページのデータが
// レイアウトへ流れないため、レイアウト側で帯を描くには ①並列ルート（`@heading`）で 29 画面ぶんの
// ルート木を二重に持つ ②クライアントコンテキストで持ち上げる のどちらかが必要になる。
// ①は同じ読み取りを 2 回行うことになり（外枠の DB 本数の表が壊れる）、②は外枠を
// `'use client'` にする（主平面の全画面がクライアントバンドルへ移る）。
// **したがって帯は 1 つの共通部品として各画面の本文の先頭に置く。** 置き場所の合意は
// `@ses/ui` の `AppShell` が描く `app-page-heading-slot`（帯が入る位置の印）が持つ。
//
// ============================================================================
// 🔴 なぜ描画がここに無いのか（`T-22-05` での移動）
// ============================================================================
// `docs/05` §2.3.1: **19 部品はすべて `packages/ui/src/components/**` に置き、`_shell/**` に残るのは
// 値の組み立てだけである**。ここが受け持つのは次の 3 つだけで、**判断は 1 つも増やしていない**。
//   ① `packages/i18n` での語の解決（`packages/ui` は `@ses/i18n` に依存しない）
//   ② `next/link` の受け渡し（`packages/ui` は `next/*` に依存しない）
//   ③ 🔴 **`kind: 'ACTION'` を `canAct` で落とす判定**（下の 🔴 3）
//
// ============================================================================
// 🔴 この帯が守るもの（部品側の 🔴 と対になる）
// ============================================================================
// 1. **タイトルを二重に描かない** —— 詳細画面（`S-006` / `S-011` / `S-013`）はエンティティ名の
//    `h1` を画面本体が持つ。その 3 画面では `title` を渡さず、帯はパンくずだけを描く。
//    `tests/static/page-heading-single.test.ts` が「1 画面に `h1` は 1 つ」を固定する。
// 2. **パンくずの祖先はリンクである**（`page-trail.ts` の 🔴 1）。現在地はリンクにせず
//    `aria-current="page"` を付ける（判定は部品側）。
// 3. 🔴 **primary アクションは 1 つだけ**（§7.6）。`ACTION` は `VIEWER` / `PARTNER_VIEWER` に
//    出さない（`isPageActionRole`）。`NAVIGATION` はロールで隠さない。
//    🔴 **`kind: 'ACTION'` は本番の 29 画面で 1 度も使われていない**（`primaryAction` を渡すのは
//    `projects/[id]/page.tsx` の `NAVIGATION` 1 箇所だけ）。つまり「`VIEWER` / `PARTNER_VIEWER` に
//    作成系の導線が出ない」ことの実効的な担保は**この帯ではなく各画面本体の既存のロール判定**
//    （各 `page.tsx` の `redirect` / フォームの権限差分）である。帯のテスト（この検査）だけを
//    根拠にすると、後から画面本体側の判定が外れても緑のままで通ってしまう。
// 4. 🔴 **モバイルでは primary を画面下部の固定バーに置く**（§3.4。部品側の `ACTION_CLASSES`）。
// 5. **アイコンを 1 つも使わない**（§7.5「見出し全部」「ボタン全部」）。
// 6. **`'use client'` を宣言しない**（状態もイベントハンドラも持たない）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import { PageHeader, type PageHeaderAction, type PageHeaderCrumb } from '@ses/ui';
import type { PageCrumb, PagePrimaryAction } from '../../../lib/shell/page-trail';

export type PageHeadingProps = {
  /** パンくず（`lib/shell/page-trail.ts` の表から渡す）。 */
  readonly trail: readonly PageCrumb[];
  /**
   * 画面タイトル。🔴 **`null` のときは `h1` を描かない** —— エンティティ名の `h1` を
   * 画面本体が持つ詳細画面のためである（上の 🔴 1）。
   */
  readonly title?: string | null;
  /** primary アクション（1 つ）。無い画面は省略する。 */
  readonly primaryAction?: PagePrimaryAction | null;
  /**
   * `ACTION` の primary を出せるか（`isPageActionRole(ctx.role)` の結果を渡す）。
   * 🔴 既定は `false` —— 渡し忘れたときに閲覧専用ロールへ作成導線が漏れる側に倒さない。
   */
  readonly canAct?: boolean;
  /**
   * primary アクションの `data-testid`。
   * 🔴 **画面側が文字列リテラルで書く**（`tests/static/testid-inventory.test.ts` が `testId` の
   *    属性値を走査して凍結する。データとして持つと値が凍結できず、削除・改名の検知が効かない。
   *    `@ses/ui` の `NameCell` / `OtpauthQr` と同じ作法）。
   */
  readonly testId?: string;
  /**
   * **最後のリンク項目（= 戻り先）**に付ける `data-testid`。
   * 🔴 帯へ移す前から凍結されている値（`engineer-detail-list-link` / `usage-breadcrumb-home`）を
   *    引き継ぐためであり、新しい testid を増やすためではない。
   *    どのパンくずに付くかを「最後のリンク」に固定したのは、**戻り先が 1 つに決まる**からである
   *    （`S-006` は「人材」、`S-038` は 設定 が非リンクなので「ホーム」。`S-042` は 設定 が
   *    `S-035` へのリンクになった〔T-12-21〕ので、最後のリンクは「設定」＝
   *    `retention-breadcrumb-settings`）。
   */
  readonly linkTestId?: string;
};

/**
 * 語の解決と、`linkTestId` を**最後のリンク項目（= 戻り先）**に付ける判定。
 *
 * 🔴 **この判定はここに在る**（部品側に持ち込まない）: 「最後のリンクに付ける」は `T-12-21` が
 *    決めた**本リポジトリの規約**であり、汎用部品の関心ではない。加えて
 *    `data-testid={条件 ? x : undefined}` を `packages/ui` に書くと、
 *    `tests/static/testid-inventory.test.ts` の「部品は testid の値を作らない」に反する
 *    （三項の `undefined` 側が「ローカルで計算した値」と判定される）。
 * 🔴 どのパンくずに付くかを「最後のリンク」に固定したのは、**戻り先が 1 つに決まる**からである。
 */
function resolveTrail(trail: readonly PageCrumb[], linkTestId: string | undefined): readonly PageHeaderCrumb[] {
  const lastLinkIndex = trail.reduce((found, crumb, index) => (crumb.href === null ? found : index), -1);
  return trail.map((crumb, index) => ({
    label: t(crumb.labelKey),
    href: crumb.href,
    ...(index === lastLinkIndex && linkTestId !== undefined ? { testId: linkTestId } : {}),
  }));
}

export function PageHeading({
  trail,
  title = null,
  primaryAction = null,
  canAct = false,
  testId,
  linkTestId,
}: PageHeadingProps) {
  // 🔴 `ACTION` は閲覧専用ロールに出さない（`CLAUDE.md` §10.1）。`NAVIGATION` は隠さない。
  //    🔴 **判定はここ 1 箇所**であり、部品側は「渡されたものを描く」だけである
  //    （部品に権限の概念を持たせると、`packages/ui` がロールを知ることになる）。
  const visible = primaryAction === null || (primaryAction.kind === 'ACTION' && !canAct) ? null : primaryAction;
  const action: PageHeaderAction | null =
    visible === null ? null : { label: t(visible.labelKey), href: visible.href };
  return (
    <PageHeader
      trail={resolveTrail(trail, linkTestId)}
      breadcrumbLabel={t('shell.breadcrumb.label')}
      title={title}
      action={action}
      // 🔴 属性名は `testId` のまま（`tests/static/testid-inventory.test.ts` の `ATTRIBUTE_NAMES` が
      //    見る名前であり、`UNRESOLVED_ALLOWLIST` に載っているこのファイルの「穴」がこれである ——
      //    値は呼び出し側の各 `page.tsx` が文字列リテラルで書いており、凍結は効いたままである）。
      testId={testId}
      // 🔴 `packages/ui` は `next/*` に依存しない（`docs/05` §2.3.1）。ここで渡す。
      linkComponent={Link}
    />
  );
}
