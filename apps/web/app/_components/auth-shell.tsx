// apps/web/app/_components/auth-shell.tsx
// 認証系 5 画面（`S-001` サインイン / `S-002` 招待の受諾 / `S-046` パスワード再設定の
// 依頼・確定 / `A-001` 運営者サインイン）に共通する外枠。
//
// 🔴 **主平面と管理平面の両方が使う。** `otpauth-qr.tsx` と同じ理由でここに置く ——
//    同じ見た目を 5 箇所に書くと、**片方だけ直る**状態が必ず生まれる
//    （`docs/sprints/SP-21` T-21-02 ①「同じ見た目のローカル実装を 2 つ作らない」）。
//
// 🔴 **`'use client'` を付けない。** 状態もイベントハンドラも持たない。付けると、
//    この外枠を描いていたサーバコンポーネント（5 画面すべて）がクライアントバンドルへ移る
//    （T-04-06 の P0 事故と同じ壊れ方。`tests/static/client-db-boundary.test.ts`）。
//
// 🔴 **文言を持たない。** ワードマークは呼び出し側が `packages/i18n` から解決して渡す
//    （CLAUDE.md §3.5 / BR-32）。
//
// ============================================================================
// T-21-03: 手書き CSS からの移設（見え方を変えていない）
// ============================================================================
// | 旧クラス（globals.css）  | 旧宣言                                   | Tailwind          |
// |---|---|---|
// | `.ses-auth-layout`      | `min-height:100dvh`                      | `min-h-dvh`       |
// |                         | `display:flex` / `justify-content:center` | `flex justify-center` |
// |                         | `padding:1.5rem 1rem`                    | `px-4 py-6`       |
// | `.ses-auth-card`        | `width:100%` / `max-width:24rem`         | `w-full max-w-sm` |
// | `.ses-wordmark`         | `font-size:1.125rem`                     | `text-lg`         |
// |                         | `font-weight:700`                        | `font-bold`       |
// |                         | `margin-bottom:2rem`                     | `mb-8`            |
//
// ⚠️ 1 点だけ厳密には同値でない: `text-lg` は font-size に加えて `line-height: 1.75rem` を
//    与えるが、旧 `.ses-wordmark` は font-size だけで行間は基底の 1.6（= 1.8rem）を継いでいた。
//    差は 1 行あたり 0.8px であり、ワードマークは常に 1 行である。**行間を打ち消す指定を
//    足さない** —— 打ち消すと、ここだけ Tailwind のタイポグラフィから外れる。
//
// 🔴 `S-001` / `S-046` は T1（モバイル完結）である（`CLAUDE.md` §13.2 / `docs/04` §S-001）。
//    **単一カラムのまま、幅で出し分けない** —— ここに `sm:` 以降のバリアントを足して
//    「広い画面では 2 カラム」にすると、モバイルが劣った版に見える構造ができる。
import type { ReactNode } from 'react';

export type AuthShellProps = {
  /** ワードマーク（`t('product.name')`）。🔴 文言はここで解決しない。 */
  readonly wordmark: ReactNode;
  readonly children: ReactNode;
};

export function AuthShell({ wordmark, children }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh justify-center px-4 py-6">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-lg font-bold">{wordmark}</p>
        {children}
      </div>
    </main>
  );
}
