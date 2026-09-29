// packages/ui/src/components/button.tsx
// shadcn/ui の Button を取り込み。ソースを一元管理する（docs/03 §2「UI」/ CLAUDE.md §2.1）。
// 🔴 バリアントは `class-variance-authority`、クラスの合成は `tailwind-merge`（`docs/04` §5-13。
//    2026-09-29 に人間が依存の追加を承認した。経緯は `../lib/cn.ts`）。
//
// ============================================================================
// 🔴 `docs/04` §7.10 の 8 状態（T-22-01）
// ============================================================================
// | 状態 | ここでの実装 |
// |---|---|
// | default | `variant`（primary = `--color-brand` / secondary = 枠 + `--color-bg` / ghost = 透明） |
// | hover | primary = `--color-brand-hover`、secondary / ghost = `--color-bg-subtle`。**文字色は変えない** |
// | active | primary = `--color-brand-active`、secondary / ghost = `--color-bg-inset`（もう 1 段暗く） |
// | selected | **持たない**。ボタンは maintained な選択状態を持たない（現在地・タブ・行選択は `Sidebar` / `Tabs` / `DataTable` の仕事。§7.10 の selected は `../lib/state-classes.ts`） |
// | focus-visible | `FOCUS_RING_CLASSES`（全プリミティブ共通） |
// | disabled | `DISABLED_CLASSES`。🔴 **「権限が無い」「代理閲覧中」を disabled で表さない**（`U-10`。描画せず理由テキストを置く） |
// | loading | `loading` prop（ラベルを `loadingLabel` に置換し、押下を封じる） |
// | error | **持たない**。§7.10 の error は入力欄と領域の状態であり、ボタン自身は持たない |
//
// 🔴 primary の active は `--color-brand-active`（`indigo-900`。`docs/04` §7.9 改訂 19）。
//    ⚠️ 押し込むアニメーション・影・1px の移動で代替してはならない（§7.10 の 🔴）。
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED_CLASSES, FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center rounded-sm font-medium',
    // 🔴 `whitespace-nowrap shrink-0` は shadcn/ui の Button の基底クラスにあるものであり、
    //    見た目の好みではなく**当たり判定の前提**である（T-21-01 の回帰調査で実測）。
    //    これを落とすと、狭い flex コンテナ（例: `S-008` の操作列。表のセルの中）で
    //    ①`min-width: auto` ＝ min-content が **「CJK 1 文字 + 左右パディング」= 38px** まで
    //    縮み ②ラベルが 1 文字ずつ折り返して 63〜64px 分の高さになる。
    //    `h-8` / `h-10` が高さを 32 / 40px に固定しているため、**ラベルがボタンの箱から
    //    はみ出し、隣のボタンと重なって見える**（実測: 幅 38px / 箱 32px / 内容 64px）。
    //    その状態でモバイルの `S-008` を叩くと「この版を開く」を押したつもりで
    //    「ダウンロード」が発火した（`audit-k7.mobile` が実際に落ちた）。
    // 🔴 **押せない・読めないボタンは「劣化」ではなく「遮断」である**（CLAUDE.md §13.3）。
    //    幅が伸びたぶんは、置き場所（`S-008` は `overflow-x-auto`）が横スクロールで受ける。
    'shrink-0 whitespace-nowrap',
    TRANSITION_CLASSES,
    DISABLED_CLASSES,
    FOCUS_RING_CLASSES,
  ),
  {
    variants: {
      /**
       * 🔴 色は**すべてここが持つ**（基底に置かない）。1 箇所でしか色が決まらないことが、
       *    `docs/04` §7.4 の意味の割り当てを守る唯一の方法である（§5-13 / `../lib/cn.ts`）。
       */
      variant: {
        // 🔴 primary = ブランド藍（§7.4「いま進行中・次はあなたの番」）。T-22-01 で
        //    `bg-slate-900`（無彩色）から変えた —— §7.4 は 2026-09-01 から primary をブランド色と
        //    定めているが、実装には `indigo` が 1 箇所も入っていなかった（§7.4 の実装漏れの記録）。
        primary: 'bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-active',
        secondary:
          'border border-border-strong bg-bg text-fg hover:bg-bg-subtle active:bg-bg-inset',
        ghost: 'bg-transparent text-fg hover:bg-bg-subtle active:bg-bg-inset',
      },
      /** 🔴 **すべてのボタンを同じサイズ・同じ形状にしない**（§7.6）。primary は大きく、閲覧系はテキストリンクに落とす。 */
      size: {
        default: 'h-10 px-4 text-body',
        sm: 'h-8 px-3 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /**
   * 進行中（§7.10 の loading）。**押下を封じる**（`disabled` を立てる）。
   * 🔴 スピナーで画面全体を覆わない（§7.10）。領域の loading は `Skeleton`（Phase 3b）である。
   */
  readonly loading?: boolean;
  /**
   * `loading` のあいだ表示するラベル（§7.10「ラベルを進行表示に置換して押下を封じる」）。
   * 🔴 **文言を持たない**（`../index.ts` の規約 5）ので、語は呼び出し側が `packages/i18n` から渡す。
   *    渡されなかった場合は元のラベルを保つ（勝手な既定文言を作らない）。
   */
  readonly loadingLabel?: ReactNode;
};

/**
 * 🔴 loading のときだけ足す属性。**`disabled` を props から取り出さない**のは属性の並び順を
 *    変えないためである —— `{...props}` に既にある `disabled` をここで上書きすると、値だけが
 *    変わって**位置は props のまま**になる（オブジェクトのキーは最初に現れた位置を保つ）。
 *    取り出して JSX の後ろに書くと `disabled` が末尾へ移動し、**属性の並びを固定している
 *    既存テスト**（`visibility-screen.render.test.tsx` の
 *    `disabled="" data-testid="project-visibility-submit"`）が落ちる。
 *    ⚠️ **落ちること自体が正しい警告である**（DOM が変わった）。ここでは DOM を変えないことを
 *    選んだ —— 本タスクはクラス名の置き換えであって、描画される属性を変える作業ではない。
 * 🔴 loading は「一時的で自明な不能」（§7.10 が disabled を許す唯一の型）であり、
 *    **二重送信の防止**そのものである（`CLAUDE.md` §3.4）。
 */
type ButtonLoadingAttributes = {
  readonly disabled?: true;
  readonly 'aria-busy'?: true;
  readonly 'data-loading'?: 'true';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'default',
    type = 'button',
    loading = false,
    loadingLabel,
    children,
    ...props
  },
  ref,
) {
  const loadingAttributes: ButtonLoadingAttributes = loading
    ? { disabled: true, 'aria-busy': true, 'data-loading': 'true' }
    : {};
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      {...loadingAttributes}
    >
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </button>
  );
});

// ============================================================================
// 🔴 `IconButton` — テキスト無しで意味が通る操作（SP-22 `T-22-04`。`docs/04` §5-13 / §7.5 の許可①）
// ============================================================================
// 🔴 **`Button` のバリアントとして実装し、別部品（`icon-button.tsx`）を起こさない**（§5-13 の 🔴。
//    機械検査は `tests/static/ui-primitive-single-impl.test.ts` (b)④ がファイルの不在を見る）。
//    したがって 8 状態・radius・focus リング・`loading` は**上の `Button` のものがそのまま効く**
//    （アイコンのボタンだけ hover の出方が違う、という状態が生まれない）。
//
// 🔴 **使ってよいのは §7.5 の許可① だけ**: 閉じる / 展開・折りたたみ / 並び替え / コピー /
//    外部リンク / 検索 / 行の `内容を見る`（`Drawer`）。**primary / secondary の通常ボタンに
//    アイコンを付けない**（§7.5 の「引き続き使わない場所」）。
//
// 🔴 **`aria-label` は必須である**（§5-13）。型で必須にしてあるので、語を渡さずには描けない
//    （`ButtonHTMLAttributes` の `'aria-label'?: string` を**必須に絞っている**）。
//    ⚠️ 語は呼び出し側が `packages/i18n` から解決して渡す（`../index.ts` の共通規約 5）。
//
// ============================================================================
// 🔴 アイコンは「呼び出し側から `ReactNode` で受ける」（`T-22-04` の判断。**完了記録に出す**）
// ============================================================================
// `lucide-react` は **`T-22-05` で入る**依存であり（`docs/04` §5-13 の依存追加 / `docs/05` §2.3.3）、
// 本タスクでは **`packages/ui` に依存を足さない**。したがって次の 2 案のうち後者を採った。
//
//   ① `T-22-05` まで `IconButton` を作らない → `DropdownMenu` / `Drawer` / `Dialog` の
//      トリガに使う部品が無いまま段② に入ることになり、画面側が `<button>` を自作する余地が残る
//      （§5-13 の「同じ部品を二重実装しない」が破れる入口になる）。
//   ② 🔴 **`icon: ReactNode` を呼び出し側から受ける** → 依存を 1 つも足さずに部品が完成し、
//      `T-22-05` で `packages/ui/src/icons.ts` の閉じた写像から要素を渡すだけで絵が入る。
//      **`IconButton` 自体は `lucide-react` を知らない**ので、(i)① の「import は `icons.ts` の
//      1 本」も構造的に守られる。
/** アイコンの当たり判定（正方形）。`size` は `Button` と同じ 2 段に対応させる。 */
const ICON_BUTTON_SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  default: 'h-10 w-10 px-0',
  sm: 'h-8 w-8 px-0',
};

export type IconButtonProps = Omit<ButtonProps, 'children' | 'loadingLabel' | 'aria-label'> & {
  /**
   * 🔴 アイコンの要素（`T-22-05` 以降は `packages/ui/src/icons.ts` の写像から渡す）。
   *    ここで `lucide-react` を import しない（上の 🔴）。
   */
  readonly icon: ReactNode;
  /** 🔴 **必須**（テキストが無い操作には語が要る。§5-13）。 */
  readonly 'aria-label': string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, className, size = 'default', ...props },
  ref,
) {
  return (
    <Button ref={ref} size={size} className={cn(ICON_BUTTON_SIZE_CLASSES[size], className)} {...props}>
      {icon}
    </Button>
  );
});
