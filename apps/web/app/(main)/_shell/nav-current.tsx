'use client';

// apps/web/app/(main)/_shell/nav-current.tsx
// 🔴 **現在地（カレントナビ）をクライアント遷移に追随させる 2 つの島**。2026-10-04。
//
// ============================================================================
// 🔴 なぜ `'use client'` が 1 枚挟まるのか（**理由はこれ 1 つだけ**）
// ============================================================================
// **App Router のレイアウトは、クライアントのソフトナビゲーションで再描画されない。**
// `(main)/layout.tsx` は主平面の全画面で共有されるため、`/` から `/engineers` へリンクで
// 移動してもレイアウトの出力は差分に含まれず、**サイドバーは最初に着地した画面のまま光り続ける**。
// サインイン直後はホームに着地するので、**以後どこへ移動してもホームが光る**（2026-10-04 に
// 人間が報告した症状であり、demo 環境で Playwright で再現・確認した。実測表は
// `packages/ui/src/lib/current-nav-path.ts` 冒頭）。
//
// 🔴 **`usePathname()` はレイアウトの中でも遷移ごとに更新される** —— 更新されないのは
//    「サーバで描いた出力」であり、**ツリーに居るクライアントコンポーネントは再描画される**
//    （`usePathname()` は Next のルータコンテキストを読むため）。したがって直し方は
//    **ハイライトを当てる最小の部分だけを島にする**ことである。
//
// 🔴 **`AppShell` / `layout.tsx` / 各画面に `'use client'` を付けない。** 付けると外枠に包まれる
//    主平面の全画面がクライアントバンドルへ移り、`tests/static/client-db-boundary.test.ts` の
//    前提が「全画面が閉包に入る」形で崩れる。島は**この 1 枚**であり、
//    `./global-search.tsx`（`⌘K` の判定）/ `./account-menu.tsx`（Radix）と同じ構えである。
// 🔴 **`packages/ui` 側に `'use client'` を増やさない** —— あちらは
//    `tests/static/ui-overlay-contract.test.ts` が「宣言のあるファイル = overlay 6 部品」で
//    凍結しており、主バレルから `'use client'` のファイルへ辺が伸びると
//    **`Button` 1 つのサーバ画面まで引き込む**（`packages/ui/src/index.client.ts` の 🔴）。
//    そこで**差し替え口（`linkComponent` / `sectionGate`）を部品側に開け、島はここに置く。**
//
// ============================================================================
// 🔴 この島が守るもの
// ============================================================================
// 1. 🔴 **判定を増やさない。** 現在地の規則（ホームは完全一致 / `/engineers` が
//    `/engineer-shares` を飲み込まない / どのセクションに居るか）は `@ses/ui` の
//    `matchesCurrentNavPath` / `currentNavSectionIndex` / `navLinkClassName` にしか無い。
// 2. 🔴 **サーバの値を「初回描画の現在地」として尊重する。** `usePathname()` が無い
//    （水和前 / Next の外）ときは、**サーバが計算した `aria-current` と `initialIndex` を
//    そのまま使う** —— そうすれば JS が効かない環境でも初回は正しく光る。
// 3. 🔴 **クラスを持たない。** 色・状態のクラスは部品（`packages/ui`）が決め、ここは
//    渡された 2 つの文字列から選ぶだけである（`tests/static/ui-state-in-primitives.test.ts` (j):
//    `apps/web/app/**` に `hover:` / `data-[state=…]:` を 1 件も書かない）。
// 4. 🔴 **文言を持たない**（語はすべて `./main-shell.tsx`〔サーバ〕が `packages/i18n` から渡す）。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  currentNavSectionIndex,
  matchesCurrentNavPath,
  navLinkClassName,
  type SectionGateProps,
  type SidebarLinkProps,
} from '@ses/ui';

/**
 * 外枠のリンク（🔴 **`packages/ui` の `linkComponent` に渡す唯一の実装**）。
 *
 * 🔴 `matchPaths` を持つ項目（サイドバーの項目と第 2 階層のタブ）だけが現在地を取り直す。
 *    持たない項目（ワードマーク / 上限インジケータ / ボトムタブ / 「その他」のパネル）は
 *    **サーバの判定のまま**であり、現にどれも現在地の表現を持たない。
 * 🔴 **`matchPaths` を DOM に出さない**（未知の属性を `<a>` に流すと React が警告する）。
 */
export function NavLink({
  href,
  className,
  currentClassName,
  matchPaths,
  children,
  ...rest
}: SidebarLinkProps) {
  const pathname = usePathname();
  // 🔴 水和前（`null`）/ 射程を持たない項目では、**サーバが決めた `aria-current` を使う**（上の 2）。
  const current =
    typeof pathname === 'string' && matchPaths !== undefined
      ? matchesCurrentNavPath(pathname, matchPaths)
      : rest['aria-current'] === 'page';
  return (
    <Link
      {...rest}
      href={href}
      className={navLinkClassName(current, className, currentClassName)}
      aria-current={current ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

/**
 * 第 2 階層の帯を**どれか 1 つだけ**描く器（🔴 `packages/ui` の `sectionGate` に渡す実装）。
 *
 * 🔴 **タブの色だけ直しても足りない** —— 帯は「いまどのセクションに居るか」で出る / 出ないが
 *    変わるので、1 本だけ渡す形では `/settings` へ移動しても**案件管理のタブが残り続ける**
 *    （実測した症状そのもの）。候補を全部受け取り、ここで選び直す。
 * 🔴 **添字が 1 つしか無い形**なので、帯が 2 本出る状態を構造的に作れない。
 */
export function SectionNavGate({ candidates, initialIndex, bands }: SectionGateProps) {
  const pathname = usePathname();
  const index =
    typeof pathname === 'string' ? currentNavSectionIndex(pathname, candidates) : initialIndex;
  if (index < 0) return null;
  return <>{bands[index] ?? null}</>;
}
