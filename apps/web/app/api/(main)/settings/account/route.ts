// apps/web/app/api/(main)/settings/account/route.ts
// `GET/PATCH /api/settings/account`（`S-048` アカウント設定。2026-10-16。Issue #95）。
//
// 🔴 **ロールで絞らない。** 対象は常に「自分」であり、どのロールにも自分の表示名と役職が在る
//    （`VIEWER` / `PARTNER_VIEWER` を含む）。**ここが `requireNotViewer` を掛けない唯一の
//    `PATCH` である** —— あのガードが守っているのは「承認・送信・ダウンロード」であって
//    自分の表示名ではない（`CLAUDE.md` §10.1 の `VIEWER` の定義は業務操作の禁止である）。
// 🔴 **`requireExecutable` も掛けない。** `CLOSING`（解約手続き中）でも**自分の表示名と
//    パスワードは変えられる**べきである —— あの状態で止めるのは「新規作成」であり
//    （`F-004 AC-8`）、本人の資格情報の管理を止めるとデータの返却作業そのものができなくなる。
// 🔴 **対象の利用者 ID を受け取らない**（path にも body にも無い）。自分の 1 行に絞るのは
//    `lib/settings/account.ts` の責務である（同ファイル冒頭の 🔴🔴。`users` の RLS は
//    所属スコープ全体を許すため、ここを緩めると他人の行を書けてしまう）。
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readAccountSettings, updateAccountSettings } from '../../../../../lib/settings/account';
import { updateAccountBodySchema } from '../../../../../lib/settings/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { label: 'GET /api/settings/account', guards: [] },
  async ({ ctx }) => Response.json(await readAccountSettings(ctx)),
);

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/settings/account',
    guards: [],
    body: updateAccountBodySchema,
    // 🔴 `withApiRoute` が**ハンドラ本体の前に** `AuditLog` を書く（`CLAUDE.md` §3.5 の
    //    「作成・更新・削除」）。記録に失敗したら変更されない（`F-005` / `F-012 AC-2`）。
    audit: {
      action: 'user.update',
      resolve: ({ ctx, body }) => ({
        targetType: 'User',
        targetId: ctx.userId,
        // 🔴 `summary` に PII を入れない（docs/05 §16.2）。**変更した項目名だけ**を載せる ——
        //    表示名と役職は本人の属性であり、値そのものを監査ログに写さない。
        summary: { changedKeys: Object.keys(body).sort().join(',') },
      }),
    },
  },
  async ({ ctx, body }) => Response.json(await updateAccountSettings(ctx, body)),
);
