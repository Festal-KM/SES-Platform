'use client';

// apps/web/app/(main)/_shell/global-search.tsx
// 🔴 上部バーの検索の入口（`docs/04` §3.1 の ③ / 改訂 23）。2026-10-02。
//
// ============================================================================
// 🔴 なぜ `'use client'` が 1 枚挟まるのか（**理由はこれ 1 つだけ**）
// ============================================================================
// 近道の表示を **`⌘K`（macOS）/ `Ctrl+K`（それ以外）で出し分ける**という要件は、
// **プラットフォームの判定**を要する。サーバは `Sec-CH-UA-Platform` を送らないブラウザ
// （Safari / Firefox）で判定できず、**Mac で `Ctrl+K` と出す**嘘になる。
//
// 🔴 **外枠（`AppShell` / `TopBar`）をクライアント化しない**ために、この 1 枚だけを島にする
//    （`main-shell.tsx` 冒頭の 🔴: 外枠に `'use client'` を付けると主平面の**全画面**が
//    クライアントバンドルへ移る）。島の中身は入力欄 1 つであり、状態も `useEffect` 1 本である。
//
// 🔴 **既定は `Ctrl+K`**（サーバ描画 = hydration 前の値）。macOS だけマウント後に差し替える ——
//    逆（既定を `⌘K`）にすると、**Windows の利用者が一瞬 Mac の記号を見る**。日本の SES 事業者の
//    事務端末は Windows が多数であり、既定は多数側に寄せる。
// 🔴 **キーバインド自体は実装しない**（Phase 2）。`GlobalSearchBox` は**遷移**であり、近道の表示は
//    「その画面に入る近道の予告」である（`packages/ui/src/components/global-search-box.tsx` の 🔴）。
//
// 🔴 **文言を持たない**（`packages/i18n` の値は `main-shell.tsx`〔サーバ〕が解決して渡す）。
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GlobalSearchBox } from '@ses/ui';

export type GlobalSearchProps = {
  /** 🔴 **既存の検索画面**への遷移先（`S-005`）。動かない検索窓を置かない（§3.1 の ③）。 */
  readonly href: string;
  readonly placeholder: string;
  readonly label: string;
  /** macOS の近道（`⌘K`）。 */
  readonly shortcutMac: string;
  /** それ以外の近道（`Ctrl+K`）。🔴 **サーバ描画で出るのはこちら**（上の 🔴）。 */
  readonly shortcutDefault: string;
};

/**
 * 🔴 macOS かどうか（**純粋関数**。テストは `./global-search.render.test.tsx`）。
 *
 * 🔴 `navigator.platform` は非推奨だが、**`userAgentData.platform` を持たないブラウザ
 *    （Safari / Firefox）でも Mac を見分けられる唯一の値**である。したがって両方を見る。
 * 🔴 **判定に失敗したら `false`（= `Ctrl+K`）に倒す**（例外を投げない。ヘッダは全画面に乗る）。
 */
export function isMacPlatform(platform: string | undefined, userAgent: string | undefined): boolean {
  const haystack = `${platform ?? ''} ${userAgent ?? ''}`;
  return /mac/i.test(haystack);
}

export function GlobalSearch({
  href,
  placeholder,
  label,
  shortcutMac,
  shortcutDefault,
}: GlobalSearchProps) {
  const [hint, setHint] = useState(shortcutDefault);
  useEffect(() => {
    // 🔴 `window` の有無を見てから触る（サーバ描画では走らないが、島の中でも前提を置かない）。
    if (typeof navigator === 'undefined') return;
    const data: { readonly platform?: string } | undefined = (
      navigator as Navigator & { userAgentData?: { readonly platform?: string } }
    ).userAgentData;
    if (isMacPlatform(data?.platform ?? navigator.platform, navigator.userAgent)) setHint(shortcutMac);
  }, [shortcutMac]);
  return (
    <GlobalSearchBox
      href={href}
      placeholder={placeholder}
      label={label}
      shortcutHint={hint}
      // 🔴 `packages/ui` は `next/*` に依存しない（`docs/05` §2.3.1）。ここで渡す。
      linkComponent={Link}
      className="w-full"
    />
  );
}
