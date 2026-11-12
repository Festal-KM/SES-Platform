'use client';

// apps/web/app/(main)/_shell/account-menu.tsx
// 🔴 上部バーの「自分」（会社名 + 氏名 + アバター + `DropdownMenu`）。`docs/04` §3.1 改訂 23。2026-10-02。
//
// ============================================================================
// 🔴 なぜ `'use client'` が 1 枚挟まるのか（**理由はこれ 1 つだけ**）
// ============================================================================
// `DropdownMenu` は Radix であり **`@ses/ui/client`** に在る。🔴 **`@ses/ui/client` を import する側は
// 自身が `'use client'` を宣言していなければならない**（`packages/ui/src/index.client.ts` 冒頭 /
// 検査 (i)⑤）。外枠（`AppShell` / `TopBar`）は**主バレル側**であり、そこに overlay を載せると
// **`Button` 1 つのサーバ画面まで Radix を引き込む**（同ファイルの 🔴）。したがって島はここ 1 枚。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. 🔴 **アバターは画像を扱わない**（イニシャルの円のみ。顔写真は `CLAUDE.md` §3.2 のマスキング
//    対象であり、**アップロード経路を 1 つも増やさない**。`packages/ui/src/components/avatar.tsx`）。
// 2. 🔴 **氏名とロール名のテキストを必ず置く**（`app-header-account`。凍結値）—— ロールが見えることが
//    「なぜこの操作ができないか」の一次説明になる（§3.1）。アバターだけにしない。
// 3. 🔴 **項目は実在する画面への遷移とサインアウトだけ。** `自分の設定` に相当する画面は無いので
//    置かない（**404 を作らない**。§3.1 の 🔴）。`組織設定`（`S-035`）は**到達できるときだけ**
//    渡される（判定は `lib/shell/nav.ts` の 1 箇所。ここでロールを見ない = 2 つのロール表を作らない）。
// 4. 🔴 **破壊的操作をメニューに隠さない**（`packages/ui` の `DropdownMenu` が型で禁じている）。
//    サインアウトは破壊的ではない（データを消さない）。🔴 **失敗したら「サインアウトした」風に
//    見せない** —— `POST /api/auth/signout` は**監査ログの書き込みに失敗したらセッションを
//    破棄せず 500 を返す**（`F-005` / `F-012 AC-2`「記録に失敗したら操作を成立させない」）ので、
//    成功のときだけ `S-001` へ送り、失敗したら**その場を再読込する**（嘘の遷移を作らない）。
// 5. ⚠️ **会社名はトリガに出さない**（`docs/04` §3.1 改訂 23 は「会社名 + 氏名の 2 段」と定めるが、
//    **2 つの理由で 1 段にした**): ①`Button` の高さは §7.9 の 2 段（32 / 40px）しかなく、2 行を
//    入れるには**寸法の段を増やす**ことになる ②🔴 **モバイル（393px）で横スクロールが出た**
//    （実測: 取引先セッションのヘッダが 34px 溢れ、`home.mobile.spec.ts` の
//    `expectNoHorizontalOverflow` が落ちた。`whitespace-nowrap` の当たり判定は縮まない）。
//    🔴 **情報は失われていない** —— 自社名はスコープ表示（`app-header-scope-company`）が
//    **常時 2 段で**持っており、§3.2 の第二境界の常時表現はそこで成立している
//    （改訂 23 が足したのは「冗長化」であって、唯一の表示箇所ではない）。
//
// 🔴 **文言を持たない**（語は `main-shell.tsx`〔サーバ〕が `packages/i18n` から解決して渡す）。
import Link from 'next/link';
import { Avatar, Button } from '@ses/ui';
import { DropdownMenu, type DropdownMenuItems } from '@ses/ui/client';

export type AccountMenuProps = {
  /** 🔴 **解決済みのイニシャル 1〜2 文字**（`packages/ui` の `Avatar` は切り出しをしない）。 */
  readonly initials: string;
  /** 氏名 + ロール名（`山田太郎（営業）`。**解決済み**）。 */
  readonly accountLabel: string;
  /** `組織設定`（`S-035`）。🔴 **到達できないロールでは `null`**（項目ごと描かない）。 */
  readonly organizationSettings: { readonly href: string; readonly label: string } | null;
  readonly signOutLabel: string;
  /** メニューを開く当たり判定の読み上げ語。 */
  readonly menuLabel: string;
};

/**
 * 🔴 サインアウト（`POST /api/auth/signout`。`F-003 AC-3`）。
 *    応答は 204 で、**監査ログ（`auth.logout`）は API が先に書く**（上の 4）。
 */
async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/signout', { method: 'POST', cache: 'no-store' });
  // 🔴 成功したときだけサインイン画面へ。失敗したら**その場を再読込**して「まだサインインして
  //    いる」という事実を画面に出す（`window.location.assign('/signin')` を無条件に呼ぶと、
  //    セッションが生きているのに「サインアウトした」ように見える）。
  window.location.assign(response.ok ? '/signin' : '/');
}

export function AccountMenu({
  initials,
  accountLabel,
  organizationSettings,
  signOutLabel,
  menuLabel,
}: AccountMenuProps) {
  const signOutItem = {
    kind: 'action' as const,
    label: signOutLabel,
    onSelect: () => {
      void signOut();
    },
  };
  // 🔴 タプルの合併（`DropdownMenuItems`）に**文脈型で**収める（`as` の抜け道を使わない）。
  const items: DropdownMenuItems =
    organizationSettings === null
      ? [signOutItem]
      : [
          { kind: 'link', label: organizationSettings.label, href: organizationSettings.href },
          signOutItem,
        ];
  return (
    <DropdownMenu
      align="end"
      items={items}
      // 🔴 `packages/ui` は `next/*` に依存しない。遷移の項目はここで `next/link` を渡す。
      linkComponent={Link}
      data-testid="app-header-account-menu"
      trigger={
        // 🔴 当たり判定は `@ses/ui` の `Button`（`ghost` / `sm`）である —— 画面側で
        //    `hover:` / `focus-visible:` を書かない（§7.10 / 検査 (j)）。
        <Button variant="ghost" size="sm" aria-label={menuLabel} data-testid="app-header-account-trigger">
          <Avatar initials={initials} title={accountLabel} />
          {/* 🔴 凍結値（`app-header-account`）。氏名 + ロール名のテキスト（上の 2）。 */}
          <span data-testid="app-header-account">{accountLabel}</span>
        </Button>
      }
    />
  );
}
