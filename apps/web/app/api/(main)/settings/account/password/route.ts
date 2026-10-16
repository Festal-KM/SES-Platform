// apps/web/app/api/(main)/settings/account/password/route.ts
// `POST /api/settings/account/password`（`S-048` のパスワード変更。2026-10-16。Issue #95）。
//
// 🔴 **現在のパスワードの照合を必須にする**（`lib/settings/account.ts` の
//    `changeAccountPassword` の 🔴）。セッションを奪われたときに、そのまま本人を追い出す
//    （パスワードを変える）導線を作らないため。
// 🔴 **失敗の理由を区別しない** —— 「現在のパスワードが違う」と「利用者が見つからない」は
//    同じ 422 になる（`docs/04` §S-001 と同じ規律）。
// 🔴 **監査ログに値を書かない。** 記録するのは「本人がパスワードを変えた」という事実だけである
//    （`CLAUDE.md` §3.5 / docs/05 §16.2。ハッシュも平文も `summary` に載せない）。
// 🔴 **ロールで絞らない / `requireExecutable` を掛けない**（親の `route.ts` 冒頭の 🔴 と同じ理由。
//    本人の資格情報の管理は業務操作ではない）。
// ⚠️ **セッションは切らない。** 変更後も同じセッションで作業を続けられる（他端末のセッションを
//    一括で切る機能は `CLAUDE.md` にも `docs/02` にも無く、**先回りして作らない**）。
//    🔴 発行済みの**再設定トークン**は無効化する（`changeAccountPassword` の 🔴）。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { changeAccountPassword } from '../../../../../../lib/settings/account';
import { changeAccountPasswordBodySchema } from '../../../../../../lib/settings/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/settings/account/password',
    guards: [],
    body: changeAccountPasswordBodySchema,
    audit: {
      // 🔴 **`.update` で終わる名にする** —— 監査ログの絞り込みは `action` の接尾辞で
      //    カテゴリに畳んでおり（`lib/audit-logs/categories.ts` の `CREATE_UPDATE_DELETE`）、
      //    `auth.password_change` のような名だと**どのカテゴリにも入らず、画面から探せなくなる**。
      action: 'user.password.update',
      resolve: ({ ctx }) => ({
        targetType: 'User',
        targetId: ctx.userId,
        // 🔴 **値を 1 つも載せない**（キー名すら載せない —— 載せても情報が増えず、
        //    `currentPassword` という語が監査ログに並ぶだけである）。
        summary: {},
      }),
    },
  },
  async ({ ctx, body }) => {
    await changeAccountPassword(ctx, body);
    // 🔴 本文を返さない（返す値が無い。変更の成否は状態コードで示す）。
    return new Response(null, { status: 204 });
  },
);
