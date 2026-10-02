// packages/ui/src/components/section-header.tsx
// 🔴 セクションの見出し（2026-10-02 の人間のブリーフ）。**アイコン + 見出し + 件数バッジ +
//    右端の `すべて見る`**。ホーム（`S-003` / `S-004`）の各セクションの頭に置く。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. 🔴 **見出しの段は `--text-lg`（16px / 600）で固定**（§7.3 の 2 段目 = セクション見出し）。
//    **画面タイトル（20px）より強くしない。** サイズの prop を持たない。
// 2. 🔴 **`すべて見る` の `href` は必須である。** 件数だけ見せて一覧へ行けない見出しを作らない
//    （§7.2: 行動の変わらない数値を置かない）。**出すか出さないかの判断は呼び出し側**であり、
//    出す以上は遷移先が在る。
// 3. 🔴 **件数は `null` を渡せば描かない。** 取引先に件数を出せない場面がある
//    （`CLAUDE.md` §3.1: 件数は他社情報の示唆になりうる。`F-004 AC-4`）——
//    **`0` を描かないのではなく、渡さなければ描かない**（判断は呼び出し側に在る）。
// 4. 🔴 **アイコンは `--icon-sm`（16px）1 段だけ**。`docs/04` §7.9 改訂 23 が
//    「`--icon-sm` = 行内・ボタン内・**`SectionHeader` の見出し横**」と名指しで許可している
//    （§7.5 の「見出しにアイコンを付けない」は、改訂 23 がこの 1 箇所について解いた）。
//    🔴 **比喩アイコンは構造的に入らない**（`../icons.ts` の閉じた写像）。
// 5. 🔴 **`'use client'` を宣言しない / 文言を持たない**（`../index.ts` の共通規約 4・5）。
//    🔴 **`children` / `ReactNode` の prop を持たない**（`./drawer.tsx` と同じ理由）。
import type { ComponentType } from 'react';
import { Badge } from './badge.js';
import type { SidebarLinkProps } from './sidebar.js';
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import { Icon, type IconName } from '../icons.js';

export type SectionHeaderLink = {
  readonly href: string;
  /** 語（`すべて見る`）。🔴 解決済みの文字列（`packages/i18n` は呼び出し側）。 */
  readonly label: string;
};

export type SectionHeaderProps = {
  /** 🔴 `../icons.ts` の閉じた写像の名前。 */
  readonly icon: IconName;
  readonly title: string;
  /**
   * 件数バッジ（`12 件`）。🔴 **整形済みの文字列**で、`null` なら描かない（上の 3）。
   * 🔴 **金額を渡さない**（`BR-24`）。
   */
  readonly count: string | null;
  /** 🔴 **必須**（上の 2）。 */
  readonly link: SectionHeaderLink;
  /** 見出しと導線に付ける `data-testid` の接頭辞。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** 🔴 §7.3 の 2 段目（16px / 600）。**これ以上大きくしない。** */
const TITLE_CLASSES = 'm-0 flex min-w-0 items-center gap-2 text-lg font-semibold text-fg';

export function SectionHeader({
  icon,
  title,
  count,
  link,
  testIdPrefix,
  linkComponent: Link = DefaultLink,
  className,
}: SectionHeaderProps) {
  return (
    <div
      data-testid={`${testIdPrefix}root`}
      className={cn('mb-2 flex flex-wrap items-center gap-x-4 gap-y-1', className)}
    >
      <h2 className={TITLE_CLASSES}>
        {/* 🔴 印であって意味ではない（`aria-hidden` は `Icon` が立てる）。語は見出しが持つ。 */}
        <Icon name={icon} />
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      {count === null ? null : (
        <Badge variant="neutral" data-testid={`${testIdPrefix}count`}>
          {count}
        </Badge>
      )}
      {/* 🔴 右端の導線。**副次的な導線の 1 実装**（`../lib/link-classes.ts`）から見た目を取る。 */}
      <Link
        className={cn('ml-auto shrink-0 rounded-sm underline', SECONDARY_LINK_CLASSES)}
        href={link.href}
        data-testid={`${testIdPrefix}link`}
      >
        {link.label}
      </Link>
    </div>
  );
}
