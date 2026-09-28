// apps/web/app/(main)/_shell/page-heading.tsx
// 主平面の**帯** —— パンくず / 画面タイトル / primary アクション（1 つ）。
// docs/04 §3.1（レイアウト図の 3 行目）/ §3.4（モバイルの primary は画面下部の固定バー）/ §7.5（アイコンを付けない）/ §7.6。T-12-21。
//
// ============================================================================
// 🔴 なぜレイアウト（`_shell/app-shell.tsx`）ではなく各画面が描くのか
// ============================================================================
// 帯の中身（タイトル・現在地・次の一手）は**画面ごとの値**である。RSC ではページのデータが
// レイアウトへ流れないため、レイアウト側で帯を描くには ①並列ルート（`@heading`）で 29 画面ぶんの
// ルート木を二重に持つ ②クライアントコンテキストで持ち上げる のどちらかが必要になる。
// ①は同じ読み取りを 2 回行うことになり（外枠の DB 本数の表が壊れる）、②は外枠を
// `'use client'` にする（主平面の全画面がクライアントバンドルへ移る。`app-shell.tsx` の 🔴 4）。
// **したがって帯は 1 つの共通部品として各画面の本文の先頭に置く。** 置き場所の合意は
// `app-shell.tsx` の `app-page-heading-slot`（帯が入る位置の印）が持つ。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. **タイトルを二重に描かない** —— 詳細画面（`S-006` / `S-011` / `S-013`）はエンティティ名の
//    `h1` を画面本体が持つ（`engineer-detail-name` / `project-detail-name` /
//    `project-visibility-name`）。その 3 画面では `title` を渡さず、帯はパンくずだけを描く。
//    `tests/static/page-heading-single.test.ts` が「1 画面に `h1` は 1 つ」を固定する。
// 2. **パンくずの祖先はリンクである**（`page-trail.ts` の 🔴 1）。現在地はリンクにせず
//    `aria-current="page"` を付ける。
// 3. 🔴 **primary アクションは 1 つだけ**（§7.6）。`ACTION` は `VIEWER` / `PARTNER_VIEWER` に
//    出さない（`isPageActionRole`）。`NAVIGATION` はロールで隠さない。
//    🔴 **`kind: 'ACTION'` は本番の 29 画面で 1 度も使われていない**（`primaryAction` を渡すのは
//    `projects/[id]/page.tsx` の `NAVIGATION` 1 箇所だけ）。つまり「`VIEWER` / `PARTNER_VIEWER` に
//    作成系の導線が出ない」ことの実効的な担保は**この帯ではなく各画面本体の既存のロール判定**
//    （各 `page.tsx` の `redirect` / フォームの権限差分）である。帯のテスト（この検査）だけを
//    根拠にすると、後から画面本体側の判定が外れても緑のままで通ってしまう。
// 4. 🔴 **モバイルでは primary を画面下部の固定バーに置く**（§3.4）。**同じ 1 要素**で両方を満たし、
//    2 つ描いて片方を隠さない（`app-shell.tsx` の上限インジケータと同じ判断）。
//    🔴 `bottom-12`（48px）はボトムタブ（`fixed bottom-0` / 高さ 33px）の**上**であり重ならない。
//    本文が隠れないのは外枠の `pb-24` が逃がしているためである。
// 5. **アイコンを 1 つも使わない**（§7.5「見出し全部」「ボタン全部」）。
// 6. **`'use client'` を宣言しない**（状態もイベントハンドラも持たない）。
import Link from 'next/link';
import { t } from '@ses/i18n';
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
 * primary の見た目。
 *
 * 🔴 `packages/ui` の `Button`（`variant='primary'`）と**同じトークン**を使う（`bg-slate-900` /
 *    `text-white` / `h-10 px-4` / `rounded-md`）。`Button` は `<button>` 専用で `asChild` を持たず、
 *    `packages/ui/src/lib/link-classes.ts` が公開しているのは secondary の 2 つだけであるため、
 *    **primary のリンクはリポジトリ内でここ 1 箇所である**（同じ見た目のローカル実装が 2 つに
 *    ならない。SP-21 `T-21-02` ①）。2 箇所目が要るようになったら `link-classes.ts` へ移す。
 *
 * 🔴 モバイル = 画面下部の固定バー（§3.4）/ `md:` 以上 = 帯の中（§3.1）。**1 要素で両方**を満たし、
 *    2 つ描いて片方を隠さない（`app-shell.tsx` の上限インジケータと同じ判断）。
 *    `bottom-12`（48px）はボトムタブ（`app-bottom-tabs`。`fixed bottom-0 z-10` / 高さ 33px）の
 *    **上**であり重ならない。`z-20` はタブより手前（互いに覆わない）。
 */
const PRIMARY_ACTION_CLASSES = [
  'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium',
  'shrink-0 whitespace-nowrap bg-slate-900 text-white transition-colors hover:bg-slate-700',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
  'fixed inset-x-4 bottom-12 z-20 md:static md:z-auto md:ml-auto md:inset-x-auto',
].join(' ');

function Crumb({
  crumb,
  last,
  linkTestId,
}: {
  readonly crumb: PageCrumb;
  readonly last: boolean;
  readonly linkTestId: string | undefined;
}) {
  return (
    <li className="flex items-center gap-1">
      {crumb.href === null ? (
        <span aria-current={last ? 'page' : undefined}>{t(crumb.labelKey)}</span>
      ) : (
        <Link className="underline" href={crumb.href} data-testid={linkTestId}>
          {t(crumb.labelKey)}
        </Link>
      )}
      {/* 区切りは装飾ではなく階層の表現。🔴 アイコンを使わない（§7.5）。 */}
      {last ? null : <span aria-hidden="true">/</span>}
    </li>
  );
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
  const action = primaryAction === null || (primaryAction.kind === 'ACTION' && !canAct) ? null : primaryAction;
  // 🔴 `linkTestId` が付くのは**最後のリンク項目（= 戻り先）**である（props の 🔴）。
  const lastLinkIndex = trail.reduce((found, crumb, index) => (crumb.href === null ? found : index), -1);
  return (
    <div className="mb-4" data-testid="app-page-heading">
      <nav aria-label={t('shell.breadcrumb.label')} data-testid="app-page-breadcrumb">
        <ol className="m-0 flex flex-wrap items-center gap-x-1 p-0 text-sm text-slate-500">
          {trail.map((crumb, index) => (
            <Crumb
              key={`${crumb.labelKey}-${String(index)}`}
              crumb={crumb}
              last={index === trail.length - 1}
              linkTestId={index === lastLinkIndex ? linkTestId : undefined}
            />
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {title === null ? null : <h1 className="mt-1 text-xl font-bold text-slate-900">{title}</h1>}
        {action === null ? null : (
          <Link className={PRIMARY_ACTION_CLASSES} href={action.href} data-testid={testId}>
            {t(action.labelKey)}
          </Link>
        )}
      </div>
    </div>
  );
}
