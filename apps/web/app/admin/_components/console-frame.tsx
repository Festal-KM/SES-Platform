// apps/web/app/admin/_components/console-frame.tsx
// 認証済みの運営者コンソールの外枠（横並びタブ 5 グループ + 中身）。
//
// ============================================================================
// 🔴 なぜ `app/admin/layout.tsx` ではなく、この部品を各区画のレイアウトから描くのか
// ============================================================================
// `app/admin/layout.tsx` は **`A-001` 運営者サインイン（`/admin/signin`）も包む**。docs/04 §3.3-2 は
// `A-001` を「**未認証のためナビを持たない**」と定めており、`/admin/**` の唯一のレイアウトに
// ナビを置くと、**サインイン画面にナビが出る**（押しても認証で弾かれるだけの導線が、まだ
// 認証していない利用者に見える）。Next.js のレイアウトは**自分のパスを知らない**ため、
// レイアウト側で `signin` だけを除くことはできない。
//
// したがってナビは**認証済みの区画のレイアウト**（`tenants` / `usage` / `monitoring` /
// `audit-logs` / `demo`）と管理平面のホームから描く。`app/admin/layout.tsx` は従来どおり
// **平面帯だけ**を持つ（docs/04 §3.3-2 の区別手段 #1。環境バナー → 平面帯 → 本文の順は
// `app/layout.render.test.tsx` が固定している）。
//
// 🔴 新しい区画（`/admin/xxx`）を足すときは、その区画にも `layout.tsx` を置いて本部品を描く。
//    置き忘れると、その画面からだけ他の画面へ移動できなくなる（本タスクが回収した欠落そのもの）。
//    `tests/static/admin-console-frame.test.ts` がその置き忘れを機械で検出する。
//
// 🔴 `'use client'` を宣言しない（状態を持たない）。
import type { ReactNode } from 'react';
import { currentAppEnv } from '../../../lib/db/bootstrap';
import { AdminConsoleNav, type AdminNavTabId } from './console-nav';

export function AdminConsoleFrame({
  current,
  children,
}: {
  /** いま開いているタブ。管理平面のホーム（どのタブにも属さない）は `null`。 */
  readonly current: AdminNavTabId | null;
  readonly children: ReactNode;
}) {
  return (
    <>
      {/* 🔴 `APP_ENV` は起動時に確定した値を読むだけ（`CLAUDE.md` §11.1。ここで分岐を書かない）。 */}
      <AdminConsoleNav appEnv={currentAppEnv()} current={current} />
      {children}
    </>
  );
}
