'use client';
// packages/ui/src/components/drawer.tsx
// 🔴 `docs/04` §5-13 の `Drawer`（Side Panel）: **一覧から離れずに中身を確かめる（読み取り中心）。**
//    適用画面は **`S-003` / `S-004` の要対応キューの行だけ**（改訂 17 で 3 画面を外した）。
//
// 🔴 **`Dialog` 派生として実装し、別依存を足さない**（`docs/05` §2.3.1 / §2.3.3）——
//    `@radix-ui/react-dialog` の `Content` に側面からの表示を与えるだけである。
//    `vaul` 等のドロワー専用ライブラリを入れない（依存の追加は人間の承認事項であり、
//    §5-13 が承認したのは `@radix-ui/*` の 4 つだけ）。
//    ⚠️ **`role="dialog"` は Radix が出す。** `Drawer` と `Dialog` で 2 系統のフォーカストラップを
//    持たないため、`tests/static/ui-primitive-single-impl.test.ts` (b)① が「`role="dialog"` を
//    出すソースは多くとも 1 ファイル」を検査している（自前で書けば即座に落ちる）。
//
// ============================================================================
// 🔴 「実行系のアクションを置かない」を**型**でどう守ったか（本ファイルの主眼）
// ============================================================================
// 条文（§5-13 / §7.2 / §4.1）: 🔴 **承認 / 送信 / 再送 / 応諾 / 公開 / 解除を `Drawer` に置かない。**
// 理由は `CLAUDE.md` §3.3 —— ゲートは「判断材料を全部見たうえで承認する」ことが前提であり、
// **要約だけで押せる承認導線はゲートの実質的な形骸化**である。
//
// 🔴 **`children` を受け取らない。** これが要である —— `children: ReactNode` を持つ部品は
//    「何でも入れられる器」であり、規約は**コメントだけ**になる。本部品が受け取るのは次だけ:
//
//   | prop | 型 | 置けるもの |
//   |---|---|---|
//   | `title` | `string` | 表題 |
//   | `items` | `readonly { label: string; value: string }[]` | 読み取り項目（対象の名称 / 相手 / 状態 / 経過時間 / 期限） |
//   | `history` / `historyLabel` | `readonly string[]` / `string` | 直近の履歴（§4.1 は 3 行） |
//   | `detailLink` | `{ href: string; label: string }` | **遷移 1 本**（`S-021` 等の専用画面へ） |
//   | `closeLabel` | `string` | 閉じる |
//   | `linkComponent` | `ComponentType<{ href; className; children }>` | 遷移を描く部品（`next/link`） |
//   | `panelClassName` / `data-testid` | `string` | 余白の調整と testid |
//
// 🔴 **`ReactNode` を受け取る prop が 1 つも無い**（`linkComponent` は `href` を必須に持つ
//    **遷移専用**の部品型であり、要素そのものではない）。したがって `<Button>` / `<form>` /
//    `formAction` を持つ要素を**構文として渡せない**。
// 🔴 **`children` / `footer` / `actions` / `confirm` / `action` / `onClick` のいずれの名前の
//    prop も存在しない。** 素通しするのは `data-testid` だけを持つ閉じた型（`DrawerPassThrough`）で
//    あり、`ComponentProps<typeof DialogPrimitive.Content>` を土台に**しない** ——
//    土台にすると `children` と DOM の `onClick` が一緒に入ってきて、上の保証が消える。
//    検査は `tests/static/ui-overlay-contract.test.ts`（props のキーの集合を固定し、実行系を
//    示す名前が増えた瞬間に落ちる。`SP-22` §6 の「`Drawer` の型に `action` が無い」）。
// 🔴 **出口は `detailLink` の 1 本だけで、それは遷移である**（`href`）—— 押しても状態は
//    変わらない。`onClick` / `onSelect` を受ける口が無いので、遷移を実行系にすり替えられない。
// 🔴 **`Drawer` の中で `Drawer` を開かない**（§5-13）。入れ子にする口（`children`）が無いので
//    構造として起こらない。
//
// ============================================================================
// 🔴 その他の条文の実装
// ============================================================================
// - **閉じたら一覧の位置とスクロールが保たれる**（§5-13）: 遷移を伴わないオーバーレイであり、
//   Radix の `modal`（既定 `true`）が背後のスクロールを固定する。フォーカスは Radix の
//   `FocusScope` が**開く前にフォーカスしていた要素**（= 行の `内容を見る`）へ戻す
//   （だから `Trigger` を持たなくても一覧の位置を失わない）。
// - **モバイルは全画面オーバーレイ**（§3.4 の 🔴。下からのシートにしない）:
//   `DRAWER_PANEL_CLASSES` が `w-full`（= 全画面）→ `sm:w-100`（側面パネル）。
// - 🔴 **出す項目は §4.1 `S-003` の定めに従う**（対象の名称 / 相手 / 状態 / 経過時間 / 期限 /
//   直近の履歴 3 行）。**台帳のエンジニア詳細・スキルシートを出さない**（出すと
//   `CLAUDE.md` §3.5 の `engineer.view` が行を開くたびに積まれ、「誰の経歴を誰がいつ見たか」が
//   読めなくなる）。🔴 **経路 4 の匿名化規則を継承する**（`提案依頼の返答待ち` の行は
//   対象 = 案件名 + `共有候補（匿名）` / 相手 = `—`）。
//   ⚠️ **どちらも値を作る側（`apps/web`）の責務である** —— 本部品は `label` / `value` の組を
//   並べるだけで**中身を判断しない**。呼び出し側は
//   `tests/static/home-drawer-no-ledger.test.ts` が検査する。
// - 🔴 **文言を持たない**（`../index.ts` 規約 5）。`label` も `value` も `packages/i18n` と
//   API の応答から呼び出し側が組む。
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentType } from 'react';
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import {
  DRAWER_PANEL_CLASSES,
  OVERLAY_BACKDROP_CLASSES,
  OVERLAY_BODY_CLASSES,
  OVERLAY_DEFINITION_LIST_CLASSES,
  OVERLAY_LABEL_CLASSES,
  OVERLAY_LINK_CLASSES,
  OVERLAY_TITLE_CLASSES,
  type OverlayLinkProps,
} from '../lib/overlay-classes.js';

/** 読み取り項目 1 件（定義リストの 1 組）。🔴 **値は文字列**（要素を渡せない）。 */
export type DrawerItem = {
  readonly label: string;
  readonly value: string;
};

/**
 * 詳細画面への遷移（**1 本だけ**）。
 * 🔴 **`onClick` を持たない。** 持たせると実行系を差し込む口になる（ファイル冒頭）。
 */
export type DrawerDetailLink = {
  readonly href: string;
  readonly label: string;
};

/**
 * 遷移を描く部品が受け取る props（`next/link` の `Link` がそのまま満たす）。
 * 🔴 **`href` を必須に持つ**ことが、この型を「遷移専用」にしている（`<button>` は満たさない）。
 *    定義は `../lib/overlay-classes.ts` に 1 つだけ置き、`DropdownMenu` と共有する
 *    （同じ形の型を部品ごとに起こさない）。
 */
export type DrawerLinkProps = OverlayLinkProps;

function DefaultLink({ href, className, children }: DrawerLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * 🔴 **素通しできる属性はこれだけ**（閉じた型）。`ComponentProps` を土台にしないので、
 *    `children` も DOM の `onClick` も入ってこない（ファイル冒頭の 🔴）。
 */
export type DrawerPassThrough = {
  readonly 'data-testid'?: string;
};

export type DrawerProps = DrawerPassThrough & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 表題（`packages/i18n` の値 + 対象の名称）。 */
  readonly title: string;
  /** 読み取り項目（対象の名称 / 相手 / 状態 / 経過時間 / 期限。§4.1 `S-003`）。 */
  readonly items: readonly DrawerItem[];
  /** 直近の履歴（§4.1 は 3 行）。見出しの語は `historyLabel` で受ける。 */
  readonly history?: readonly string[];
  /** 履歴の見出し（`packages/i18n`）。`history` が空なら節ごと描かない。 */
  readonly historyLabel?: string;
  /** 🔴 **遷移 1 本**（`S-021` 等の専用画面へ。§5-13「Drawer の末尾は遷移 1 本で閉じる」）。 */
  readonly detailLink: DrawerDetailLink;
  /** 遷移を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` の `Link` を渡す。 */
  readonly linkComponent?: ComponentType<DrawerLinkProps>;
  /** 閉じる操作の語（`packages/i18n`）。🔴 **`戻る` ではない**（§7.8。画面遷移ではない）。 */
  readonly closeLabel: string;
  /** パネルに足すクラス（余白・幅の調整のみ。`../lib/cn.ts` 規律 1）。 */
  readonly panelClassName?: string;
};

export function Drawer({
  open,
  onOpenChange,
  title,
  items,
  history,
  historyLabel,
  detailLink,
  linkComponent: Link = DefaultLink,
  closeLabel,
  panelClassName,
  ...passThrough
}: DrawerProps) {
  const historyRows = history ?? [];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY_BACKDROP_CLASSES} />
        <DialogPrimitive.Content
          className={cn(DRAWER_PANEL_CLASSES, panelClassName)}
          /*
            🔴 `Description` を持たない。Radix は説明が無いと開発時に警告を出すが、
               `aria-describedby={undefined}` が上流の公式な打ち消しである。
               **警告を黙らせるためではなく、要約に説明文を足す欄を作らないため**に
               こうする —— 欄があれば、そこに判断材料が書かれる（§7.2）。
          */
          aria-describedby={undefined}
          {...passThrough}
        >
          <DialogPrimitive.Title className={OVERLAY_TITLE_CLASSES}>{title}</DialogPrimitive.Title>
          <dl className={OVERLAY_DEFINITION_LIST_CLASSES}>
            {items.map((item) => (
              <div key={item.label}>
                <dt className={OVERLAY_LABEL_CLASSES}>{item.label}</dt>
                <dd className={OVERLAY_BODY_CLASSES}>{item.value}</dd>
              </div>
            ))}
          </dl>
          {historyRows.length > 0 && historyLabel !== undefined ? (
            <div className={OVERLAY_DEFINITION_LIST_CLASSES}>
              <p className={OVERLAY_LABEL_CLASSES}>{historyLabel}</p>
              <ol className={OVERLAY_DEFINITION_LIST_CLASSES}>
                {/* 履歴 1 行は分精度の日時 + 出来事の語 + 遷移で本文を含めない設計のため、同じ分の同種の出来事は文字列が一致する。値だけでは key が一意にならない。 */}
                {historyRows.map((row, index) => (
                  <li key={`${index}-${row}`} className={OVERLAY_BODY_CLASSES}>
                    {row}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {/* 🔴 出口は遷移 1 本だけ（§5-13）。実行系はここに来ない。 */}
          <Link href={detailLink.href} className={OVERLAY_LINK_CLASSES}>
            {detailLink.label}
          </Link>
          {/*
            閉じる。⚠️ **語を文字で描く** —— `lucide-react` は `T-22-05` で入る
            （`docs/05` §2.3.3）ので、アイコンだけの当たり判定にすると**今の時点では
            何も見えないボタン**になる。`T-22-05` で `IconButton` + `X` に載せ替える。
            🔴 `Esc` と背景クリックでも閉じられる（Radix）。閉じる手段を 1 つに絞らない。
          */}
          <DialogPrimitive.Close className={cn('self-end', SECONDARY_LINK_CLASSES)}>
            {closeLabel}
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
