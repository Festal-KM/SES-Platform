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
// ============================================================================
// 🔴 主体表示（`docs/04` §3.3-2 の区別手段 #3 / `BR-44`）をここで解決する
// ============================================================================
// `docs/04` §3.3-2 は管理平面の区別手段を 3 つ定めており、#1 平面帯（`app/admin/layout.tsx`）と
// #2 横並びタブ（`console-nav.tsx`）に続く **#3 が「運営者の主体表示」**である。主平面のヘッダは
// 同じ §3.3 の「自分（氏名 + ロール）」を実装済みであり、**同じ節の片側だけを欠けさせない**。
//
// 🔴 **並びは 平面帯 → 主体 → ナビ → 本文**（`docs/04` §3.3-2）。主体表示はナビの**上**に置く ——
//    「どの平面か」→「誰として」→「どこへ行けるか」の順に読めることが、read-only の前提を
//    忘れた操作（代理閲覧・停止）を防ぐ道筋である。
//
// 🔴 **追加の DB 読み取りを発生させない。** 表示名は `resolvePlatformCtxOutcome`（=
//    認証で `platform_users` の行を既に読んでいる）が返す `displayName` を使い、ロールは
//    `ctx.platformRole` を使う。さらに同関数は `cache()` で包まれているため、
//    **外枠とページで 1 回**しか走らない（`lib/auth/platform-session.ts` の 🔴）。
//
// 🔴 未認証 / 2FA 未充足では主体表示を描かない（描く材料が無い）。**ここで redirect もしない** ——
//    遷移先は各ページが決める（2 箇所で redirect すると、どちらが効いたのか読めなくなる）。
//
// 🔴 `'use client'` を宣言しない（状態を持たない）。
import type { ReactNode } from 'react';
import { resolvePlatformCtxOutcome } from '../../../lib/auth/platform-session';
import { currentAppEnv } from '../../../lib/db/bootstrap';
import { AdminConsoleNav, type AdminNavTabId } from './console-nav';
import { AdminConsoleSubject } from './console-subject';

export async function AdminConsoleFrame({
  current,
  children,
}: {
  /** いま開いているタブ。管理平面のホーム（どのタブにも属さない）は `null`。 */
  readonly current: AdminNavTabId | null;
  readonly children: ReactNode;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  return (
    <>
      {outcome.status === 'AUTHENTICATED' ? (
        <AdminConsoleSubject
          userName={outcome.displayName}
          platformRole={outcome.ctx.platformRole}
        />
      ) : null}
      {/* 🔴 `APP_ENV` は起動時に確定した値を読むだけ（`CLAUDE.md` §11.1。ここで分岐を書かない）。 */}
      <AdminConsoleNav appEnv={currentAppEnv()} current={current} />
      {children}
    </>
  );
}
