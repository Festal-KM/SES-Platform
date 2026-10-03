// apps/web/app/admin/_components/console-subject.tsx
// 管理平面の**主体表示** —— 「いま誰として、どの権限で見ているか」（docs/04 §3.3-2 の区別手段 #3 / `BR-44`）。
//
// ============================================================================
// 🔴 なぜ要るのか（`docs/04` §3.3-2 は区別手段を 3 つ定めている）
// ============================================================================
// #1 平面帯（`app/admin/layout.tsx`）/ #2 横並びタブ（`console-nav.tsx`）/ **#3 運営者の主体表示**。
// 管理平面では **`PLATFORM_SUPPORT` に描かれない導線が実在する**（`A-014` テナントの開設 /
// `A-004` のクォータ変更フォーム。`BR-44` は「グレーアウトで見せない」と定める）。つまり
// **「その項目が見えない理由」の一次説明がロール表示しかない** —— 見えていなければ、運営者は
// 「機能が壊れている」と読む。主平面のヘッダが「自分（氏名 + ロール名）」を常時出しているのと同じ
// 理由であり、同じ節の片側だけを欠けさせない。
//
// 🔴 **出すのは自分の氏名とロールだけ**（`CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーで
//    あって内容ではない」）。テナント名・対象の件数・代理閲覧の状態などをここに足さない。
// 🔴 **平面帯の直下（ナビの上）に置く**（`docs/04` §3.3-2）。帯 → 主体 → ナビ → 本文の順であり、
//    「どの平面か」→「誰として」→「どこへ行けるか」の順に読めることが誤操作防止の道筋である。
// 🔴 文言は `packages/i18n`（`CLAUDE.md` §3.5）。🔴 `'use client'` を宣言しない（状態を持たない）。
// 🔴 アイコンを付けない（`docs/04` §7.5）。
//
// 🔴 SP-22 段⑤（`T-22-14`）: 色を §7.9 の semantic トークンへ寄せた
//    （`bg-white` → `bg-bg`〔**値は同じ白**〕/ `border-slate-200` → `border-border` /
//    `text-slate-700` → `text-fg` / `text-slate-500` → `text-fg-muted`）。
//    🔴 面（`bg-surface`）は使わない —— 面を持てるのは `packages/ui` の部品だけである
//    （`tests/static/ui-shadow-and-size.test.ts`）。ここは**帯**であってカードではない。
import type { PlatformRole } from '@ses/db';
import { t, type MessageKey } from '@ses/i18n';

/**
 * 運営者ロールの表示名。
 *
 * 🔴 `Record<PlatformRole, …>` にすることで、ロールが増えたら文言の割り当てをコンパイラが強制する
 *    （`lib/tenants/labels.ts` の `TENANT_ROLE_MESSAGE_KEYS` と同じ形）。
 * 🔴 テナント側のロール名（`members.role.*`）を**再利用しない**。運営者は別テーブル・別認証であり
 *    （`CLAUDE.md` §10.5）、同じ語で呼ぶと平面の取り違えを招く。
 * 🔴 ここに置く（`lib/**` に出さない）理由: 使うのは管理平面の外枠だけである。両平面が使う写像
 *    （`lib/tenants/labels.ts`）と違い、共有の必要が無いものを `lib/` に出すと、主平面のコードから
 *    管理平面の語彙へ 1 ホップで届いてしまう。
 */
export const PLATFORM_ROLE_MESSAGE_KEYS: Readonly<Record<PlatformRole, MessageKey>> = {
  PLATFORM_OWNER: 'shell.admin.subject.role.PLATFORM_OWNER',
  PLATFORM_SUPPORT: 'shell.admin.subject.role.PLATFORM_SUPPORT',
};

export type AdminConsoleSubjectProps = {
  /** 運営者自身の表示名（`platform_users.display_name`）。 */
  readonly userName: string;
  readonly platformRole: PlatformRole;
};

export function AdminConsoleSubject({ userName, platformRole }: AdminConsoleSubjectProps) {
  return (
    <p
      className="border-b border-border bg-bg px-4 py-1 text-xs text-fg"
      data-testid="admin-console-subject"
      data-platform-role={platformRole}
    >
      <span className="mr-2 font-bold text-fg-muted">{t('shell.admin.subject.label')}</span>
      <span data-testid="admin-console-subject-name">{userName}</span>
      <span className="ml-2" data-testid="admin-console-subject-role">
        {`（${t(PLATFORM_ROLE_MESSAGE_KEYS[platformRole])}）`}
      </span>
    </p>
  );
}
