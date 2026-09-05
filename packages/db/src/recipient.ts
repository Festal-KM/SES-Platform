// packages/db/src/recipient.ts
// 宛先分類の**引き当て**（docs/05 §8.2 / `docs/02` 章 7.6 NFR-ENV-1 / CLAUDE.md §11.1）。T-04-02。
//
// 🔴 **呼び出し側に自己申告させない。** 送信ハンドラが渡せるのは
//    「宛先の利用者 ID / 招待 ID」か「テナント外の宛先である」ことだけであり、
//    分類そのものは `Membership` / `Invitation` の行から機械的に導く。
//    文字列で分類を受け取る API をここに作らない（作った瞬間、取り違えが実送信になる）。
//
// 🔴 判定ロジックは `@ses/domain` の `classifyRecipient` 1 箇所にある。本ファイルの責務は
//    「事実（`RecipientFacts`）を、分離境界を守ったまま DB から集めること」だけである。
//
// 🔴 送信元テナントも**リクエスト入力から受け取らない**（CLAUDE.md §3.1）。`withTenant` が
//    開いたトランザクションで `tenants` を 1 行読む —— RLS の C1（`id = app_tenant_id()`）に
//    より、返るのは常に「今のスコープのテナント」であり、呼び出し側が偽装できない。
import {
  classifyRecipient,
  isAccountMailRecipientClass,
  type AccountMailRecipientClass,
  type OutsiderRecipientClass,
  type RecipientClass,
} from '@ses/domain';
import type { AuthenticatedPlatformCtx } from './platform-context.js';
import type { EmailRecipientClass } from './schema-value-sets.js';
import type { withTenant } from './with-tenant.js';

/**
 * `withTenant` が `fn` に渡すクライアントの型（`TenantDb`）をシグネチャから取り出す。
 * 🔴 `TenantDb` は export しない（docs/05 §4.3 規約 4）ため型を再定義せずここで引き出す
 *    （`audit.ts` の `TenantDbArg` と同じ手法）。
 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * `resolveRecipientClass` が読む最小の能力。
 * 🔴 3 デリゲートだけを要求する（`TenantDb` 全体を引数に取らない）。呼び出し側が
 *    「分類のついでに他の表を触る」ことを型として作れないようにするため。
 */
export type RecipientLookupDb = Pick<TenantDbArg, 'tenant' | 'membership' | 'invitation'>;

/**
 * 分類の対象（docs/05 §8.2）。
 *
 * 🔴 **分類そのものは受け取らない。** 受け取るのは「誰宛か」を指す ID だけである。
 * 🔴 `invitationId` は「招待中の本人」（CLAUDE.md §11.1 の分類 1 の但し書き）を扱うためにある。
 *    まだ `User` / `Membership` が存在しないため、所属は `Invitation` の行から導く。
 */
export type RecipientSubject =
  | { readonly userId: string }
  | { readonly invitationId: string };

/**
 * 🔴 テナント文脈から導ける分類（`PLATFORM` を含まない）。
 *
 * `platform_users` はテナント平面の DB ロール（`app_tenant`）に GRANT されておらず、
 * RLS 以前に**読めない**（CLAUDE.md §10.5「別テーブル・別認証」/ migration 20260904000000）。
 * したがって「テナントの送信経路が運営者宛と誤判定する」ことは構造的に起こらない。
 * 分類外（運営者宛）は管理平面の `platformRecipientClass()` だけが返す。
 */
export type TenantRecipientClass = Exclude<RecipientClass, 'PLATFORM'>;

// 🔴 `EmailDispatch.recipientClass` の CHECK 値集合（`schema-value-sets.ts`）と
//    `@ses/domain` の union が食い違わないことを**型で**固定する。
//    ずれると、分類は導けたのに INSERT が CHECK 違反で落ちる（送信経路が実行時に壊れる）。
//    値の並びの突合は `tests/static/connector-selection-mirror.test.ts` が行う。
type AssertRecipientClassSetsMatch = [EmailRecipientClass] extends [RecipientClass]
  ? [RecipientClass] extends [EmailRecipientClass]
    ? true
    : never
  : never;
const RECIPIENT_CLASS_SETS_MATCH: AssertRecipientClassSetsMatch = true;
void RECIPIENT_CLASS_SETS_MATCH;

/**
 * 🔴 不変条件違反（テナント文脈で `PLATFORM` が導かれた）。
 *    握り潰して実送信側へ倒さず、送信そのものを失敗させる（CLAUDE.md §11.1）。
 */
class TenantRecipientClassInvariantError extends Error {
  constructor() {
    super(
      'テナント文脈の宛先分類が PLATFORM になりました（不変条件違反）。' +
        'platform_users はテナント平面から読めないため、この分類はここでは導かれません（CLAUDE.md §10.5）。',
    );
    this.name = 'TenantRecipientClassInvariantError';
  }
}

/**
 * 宛先分類を引き当てる（docs/05 §8.2）。
 *
 * @param db `withTenant` / `withHostTenant` が開いたトランザクションのクライアント。
 * @param subject 宛先の利用者 / 招待。`null` = テナントに所属しない宛先。
 * @param fallback 🔴 `subject` が `null` のときにだけ使う既定値。型が分類 3 / 4 に限られており、
 *   **実送信側（分類 1 / 分類外）を既定値にできない**（docs/02 章 7.6 のタイブレーカー）。
 *
 * 🔴 引き当てに失敗した（行が見えない / 所属が無い）場合も `CLIENT`（モック側）に倒れる。
 *    「分からないから実送信」には決してならない。
 * 🔴 パートナー文脈から呼ぶと、RLS（C5）により他社・ホストの `Membership` は 0 件になり、
 *    やはり `CLIENT` に倒れる。分離境界を跨いで分類を引くことはできない。
 */
export async function resolveRecipientClass(
  db: RecipientLookupDb,
  subject: RecipientSubject | null,
  fallback: OutsiderRecipientClass,
): Promise<TenantRecipientClass> {
  if (subject === null) return fallback;

  // 🔴 送信元テナントは DB スコープから読む（引数で受け取らない）。RLS の C1 により 1 行だけ返る。
  const tenant = await db.tenant.findFirst({ select: { id: true } });

  const membership =
    'userId' in subject
      ? await db.membership.findFirst({
          where: { userId: subject.userId, revokedAt: null },
          select: { tenantId: true, partnerCompanyId: true },
        })
      : // 招待中の本人（CLAUDE.md §11.1 の分類 1 の但し書き / docs/05 §8.2）。
        //  受諾前は `Membership` が無いため、所属は `Invitation` の行が示す。
        await db.invitation.findFirst({
          where: { id: subject.invitationId },
          select: { tenantId: true, partnerCompanyId: true },
        });

  const recipientClass = classifyRecipient({
    isPlatformUser: false,
    membership,
    tenantId: tenant?.id ?? null,
  });
  if (recipientClass === 'PLATFORM') throw new TenantRecipientClassInvariantError();
  return recipientClass;
}

/**
 * 🔴 `account.mail`（招待・パスワード再設定）に載せられる分類か（docs/05 §9.4）。
 *    `@ses/domain` の判定をそのまま再輸出する（`packages/db` の利用者が
 *    `@ses/domain` を直接 import せずに narrowing できるようにするためだけの再輸出）。
 */
export { isAccountMailRecipientClass };
export type { AccountMailRecipientClass, OutsiderRecipientClass, RecipientClass };

/**
 * 🔴 分類外（運営者宛。`F-055`）。**管理平面の認証済み文脈からしか得られない。**
 *
 * `AuthenticatedPlatformCtx` は `resolvePlatformCtx` でしか作れず、この関数は
 * `@ses/db/platform` サブパスからのみ export される（主平面のコードは ESLint で
 * `@ses/db/platform` を import できない。docs/05 §5.2 / CLAUDE.md §10.5）。
 * 「テナント側のコードが運営者宛だと言い張って実送信側に倒す」経路をモジュールの形として作らない。
 */
export function platformRecipientClass(ctx: AuthenticatedPlatformCtx): 'PLATFORM' {
  const recipientClass = classifyRecipient({
    isPlatformUser: true,
    membership: null,
    tenantId: null,
  });
  if (recipientClass !== 'PLATFORM') {
    throw new Error(
      `運営者（${ctx.platformRole}）の宛先分類が PLATFORM 以外になりました（不変条件違反）。`,
    );
  }
  return recipientClass;
}
