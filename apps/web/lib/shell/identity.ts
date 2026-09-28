// apps/web/lib/shell/identity.ts
// 共通外枠のヘッダが出す「スコープ表示」と「自分」の材料（docs/04 §3.1 のヘッダの表）。
//
// 🔴 ヘッダが出すのは**自分の所属と自分の氏名だけ**である（組織名 / 自社名 / 利用者の表示名）。
//    他社名・他社の件数・ホストの商流（単価・エンド企業名）を外枠に出さない
//    （`CLAUDE.md` §3.1 の第二境界 / docs/04 §3.2「表現しないこと」）。
// 🔴 分離キーは `ctx` からしか来ない（`CLAUDE.md` §3.1 / `BR-03`）。`where` に置く `id` も
//    リクエスト入力ではなく認証コンテキストの値である。
// 🔴 取引先所属では RLS（C5 `partner_companies_c5_select`）が自社 1 行に閉じているため、
//    この読み取りで他社の社名に到達する経路は無い。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { NotFoundError } from '../api/errors';

export type ShellIdentity = {
  /** テナント（契約 SES 企業）の名前。ヘッダのスコープ表示の 1 段目。 */
  readonly organizationName: string;
  /** 取引先所属のときだけ自社名（2 段目）。ホスト所属は `null`。 */
  readonly partnerCompanyName: string | null;
  /** 自分の表示名（ヘッダの「自分」。ロール名は `ctx.role` から描画側が引く）。 */
  readonly userName: string;
};

/**
 * ヘッダの 1 リクエストぶんの材料を 1 トランザクションで読む。
 *
 * 🔴 行が無いことを既定値で埋めない（黙って空のヘッダを描かない）。自テナント・自分の行は
 *    認証が通っている以上必ず在り、無ければ不変条件が壊れている。
 */
export async function readShellIdentity(ctx: AuthenticatedTenantCtx): Promise<ShellIdentity> {
  return withTenant(ctx, async (db) => {
    const tenant = await db.tenant.findFirst({ select: { name: true } });
    if (tenant === null) throw new NotFoundError();
    const user = await db.user.findFirst({ where: { id: ctx.userId }, select: { displayName: true } });
    if (user === null) throw new NotFoundError();
    if (ctx.partnerCompanyId === null) {
      return { organizationName: tenant.name, partnerCompanyName: null, userName: user.displayName };
    }
    const partner = await db.partnerCompany.findFirst({
      where: { id: ctx.partnerCompanyId },
      select: { name: true },
    });
    if (partner === null) throw new NotFoundError();
    return {
      organizationName: tenant.name,
      partnerCompanyName: partner.name,
      userName: user.displayName,
    };
  });
}
