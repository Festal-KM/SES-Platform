// packages/ui/src/components/name-cell.tsx
// 一覧テーブルの名称セル（企業名・案件名・エンジニア名）。T-11-12。
// docs/04 §10.3「長い名称」の共通規約（改訂 12 / §11-14 / `U-16`）を 1 か所で実装する:
//
//   | ブレークポイント | 描き方 | 理由 |
//   |---|---|---|
//   | `lg` 以上 | 1 行で切り詰め（`truncate`）+ `title` 属性で全文 + 🔴 同じ行に全文へ到達する導線（`href`） | 1 万件を縦に走査する場では行の高さが揃うことが比較の前提（§11-12） |
//   | `lg` 未満 | 折り返し（`whitespace-normal`） | 触端末では hover が無くツールチップを開けない。切り詰めると名称の末尾が読めず `CLAUDE.md` §13.3 に反する |
//
// 🔴 **導線（`href`）が無い名称は、どのブレークポイントでも切り詰めない。** 規約の `lg` 以上の形は
//    「切り詰め + 全文への導線」の**組**であり、導線を欠いたまま切り詰めると「隠していないが読めない」に
//    なる（§11-14）。詳細画面を持たない表（`S-011` の公開先テーブル）はこの枝で描く。
// 🔴 **名称列の下限幅 10rem（`min-w-40`）はどのブレークポイントでも維持する**（`1a1e7f8`。`T-08-11` の
//    折り返し検出器が CI で捕捉した「名称列だけが 62px に潰れる」の再発防止）。
// 🔴 **`lg` 以上の上限幅（`max-w-64`）は切り詰めを成立させるためにある。** `table-layout: auto` の表では、
//    `white-space: nowrap` の内容がそのまま列の最小幅になり、上限が無いと列が名称の全長まで伸びて
//    切り詰めが起きない（表が器の中で横にスクロールするだけになる）。`table-layout: fixed` の表
//    （`S-016`）では列幅は `<th>` の指定で決まり、この上限は効かない（害も無い）。
// 🔴 **切り詰めは `<td>` の内側の `<span>` に掛ける**（`<a>` 自身に掛けない）。`T-08-11` の検出器は `<a>` の
//    `scrollWidth > clientWidth` を `clipped-x`（読めない・押せない）とみなす。切り詰めるのは**列**であって
//    リンクではないので、器の側で溢れを閉じ込める。`<a>` はインラインのまま全文を持ち、`title` と導線で
//    全文へ到達できる（判定は緩めていない。`tests/e2e/support/assertions.ts`）。
// 🔴 **文言を持たない**（名称・導線の部品は呼び出し側が渡す）。**`next/link` に依存しない** —— Next.js の
//    画面は `linkComponent={Link}` で `next/link` を渡す（既定は素の `<a>`）。
// 🔴 **導線が無い名称に行内の操作を載せる場合（`S-015` のプレビュー選択ボタン。T-12-17 ④）は `nameComponent`
//    で渡す。** `href={null}` の枝でだけ使われ、**切り詰めの規約は変わらない**（導線が無い = どのブレークポイント
//    でも切り詰めない）。ボタンは全文へ「到達する」導線ではなく行内の操作なので、`href` の枝（切り詰め + 導線の
//    組）に寄せてはならない（§11-14）。
// 🔴 `'use client'` を付けない（状態もイベントハンドラも持たない。`../index.ts` 規約 4）。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { TableCell, type TableCellProps } from './table.js';

/** 名称列の下限幅（10rem。`1a1e7f8`）。どのブレークポイントでも維持する。 */
export const NAME_CELL_MIN_WIDTH_CLASS = 'min-w-40';
/** `lg` 以上の上限幅（切り詰めを成立させる。導線がある名称にだけ掛ける）。 */
export const NAME_CELL_MAX_WIDTH_CLASS = 'lg:max-w-64';
/** 導線がある名称の本文の器: `lg` 未満は折り返し（親 `<td>` の `whitespace-normal` を継承）、`lg` 以上は 1 行切り詰め。 */
export const NAME_CELL_TEXT_CLASSES = 'block lg:truncate';
/** 導線が無い名称の本文の器: どのブレークポイントでも折り返す。 */
export const NAME_CELL_TEXT_WRAP_CLASSES = 'block';
/** 導線（詳細画面へのリンク）の見た目。既存の一覧（`S-005` / `S-010`）と同じ語。 */
export const NAME_CELL_LINK_CLASSES = 'font-medium text-slate-900 underline';

/** 導線の部品が受け取る props（`next/link` の `Link` がそのまま満たす）。 */
export type NameCellLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
};

/** 導線が無い名称に載せる行内操作の部品が受け取る props（`href={null}` の枝でだけ使われる）。 */
export type NameCellNameProps = {
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
};

/** 行内操作（`nameComponent`）の見た目。折り返す名称の器なので `inline`（`inline-block` だと語の途中で折り返せない）。 */
export const NAME_CELL_ACTION_CLASSES = 'text-left font-medium text-slate-900 underline';

function DefaultLink({ href, className, children, ...rest }: NameCellLinkProps) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

export type NameCellProps = Omit<TableCellProps, 'whitespace' | 'children' | 'title'> & {
  /** 名称の全文。本文と `title`（ツールチップ）の両方に使う。 */
  readonly name: string;
  /**
   * 全文へ到達する導線（詳細画面の URL）。🔴 `null` ならリンクを描かず、どのブレークポイントでも切り詰めない
   * （ファイル冒頭）。
   */
  readonly href: string | null;
  /** 導線を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` の `Link` を渡す。 */
  readonly linkComponent?: ComponentType<NameCellLinkProps>;
  /**
   * 導線が無い名称に載せる行内操作の部品（`S-015` のプレビュー選択ボタン）。🔴 `href` が `null` のときだけ描かれ、
   * `href` があるときは無視される（導線と行内操作を同じ名称に重ねない）。
   */
  readonly nameComponent?: ComponentType<NameCellNameProps>;
  /** 導線（`<a>`）または行内操作（`nameComponent`）に付ける `data-testid`。セル自身の testid は `data-testid` で渡す。 */
  readonly linkTestId?: string;
};

export function NameCell({
  name,
  href,
  linkComponent: LinkComponent = DefaultLink,
  nameComponent: NameComponent,
  linkTestId,
  className,
  ...props
}: NameCellProps) {
  return (
    <TableCell
      whitespace="normal"
      className={cn(NAME_CELL_MIN_WIDTH_CLASS, href === null ? null : NAME_CELL_MAX_WIDTH_CLASS, className)}
      {...props}
    >
      <span className={href === null ? NAME_CELL_TEXT_WRAP_CLASSES : NAME_CELL_TEXT_CLASSES} title={name}>
        {href === null ? (
          NameComponent === undefined ? (
            name
          ) : (
            <NameComponent className={NAME_CELL_ACTION_CLASSES} data-testid={linkTestId}>
              {name}
            </NameComponent>
          )
        ) : (
          <LinkComponent href={href} className={NAME_CELL_LINK_CLASSES} data-testid={linkTestId}>
            {name}
          </LinkComponent>
        )}
      </span>
    </TableCell>
  );
}
