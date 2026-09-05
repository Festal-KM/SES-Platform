// packages/domain/src/recipient/classify.ts
// 宛先分類（docs/05 §8.2 / docs/02 章 7.6 NFR-ENV-1 の判定表 / CLAUDE.md §11.1）。T-04-02。
//
// 🔴 なぜ packages/domain に置くか（docs/05 §8.2 の 🔴 / T-04-01 の申し送り）:
//    分類する側（`packages/db` の `resolveRecipientClass`）と、必須引数として受け取る側
//    （`packages/connectors` の `EmailSender.send`）の**両方**が同じ union を知る必要がある。
//    `packages/db` と `packages/connectors` は相互に依存できない（CLAUDE.md §2.1）ため、
//    共有点は `packages/domain` しか無い。T-04-01 が `packages/connectors/src/types.ts` に
//    置いていた暫定の二重宣言は、本ファイルへの re-export に置き換えた。
//
// 🔴 純粋関数である（DB を読まない / 現在時刻を見ない）。事実（`RecipientFacts`）を集めるのは
//    `packages/db` の責務であり、**判定そのものはここ 1 箇所に閉じる**。
//    2 箇所で判定すると、片方だけ判定順を間違えたときに「取引先の担当者へ実送信」が起こる。

/**
 * 宛先分類（docs/02 章 7.6 の判定表）。
 *
 * 🔴 判定は `packages/db` の `resolveRecipientClass` が `Membership` / `Invitation` から
 *    機械的に導く。**呼び出し側に自己申告させない。** 既定値を持たせない（省略はコンパイルエラー）。
 * 🔴 `packages/db` の `EMAIL_RECIPIENT_CLASSES`（`EmailDispatch.recipientClass` の CHECK）と
 *    同じ値集合でなければならない（`tests/static/connector-selection-mirror.test.ts` が突合する）。
 */
export const RECIPIENT_CLASSES = [
  /** 分類 1: ホスト（テナント）所属利用者。招待中の本人を含む。`sandbox` でも実送信。 */
  'HOST_MEMBER',
  /** 分類 2: パートナー所属利用者。🔴 `sandbox` ではモック（Issue #10）。 */
  'PARTNER_MEMBER',
  /** 分類 3: 提案先・エンド企業。テナント外の宛先の既定値（安全側）。 */
  'CLIENT',
  /** 分類 4: エンジニア本人。 */
  'ENGINEER',
  /** 分類外: 運営者（`PlatformUser`）。`sandbox` でも実送信。 */
  'PLATFORM',
] as const;

export type RecipientClass = (typeof RECIPIENT_CLASSES)[number];

/**
 * 分類の材料（docs/05 §8.2）。
 *
 * - `isPlatformUser`: 宛先が `PlatformUser`（運営者）か。テナント平面の DB ロールからは
 *   `platform_users` を読めない（CLAUDE.md §10.5）ため、これが真になるのは管理平面の経路だけである。
 * - `membership`: 宛先の所属（`Membership`。招待中の本人は `Invitation` の行で代用する）。
 *   未所属・引き当て不能なら `null`。
 * - `tenantId`: **送信元テナント**。`membership.tenantId` と一致して初めてホスト所属と見なす。
 */
export type RecipientFacts = {
  readonly isPlatformUser: boolean;
  readonly membership: {
    readonly tenantId: string;
    /** null = ホスト所属。非 null = パートナー所属。 */
    readonly partnerCompanyId: string | null;
  } | null;
  readonly tenantId: string | null;
};

/**
 * 宛先分類を決める唯一の関数（docs/05 §8.2 / docs/02 章 7.6 の判定順）。
 *
 * 判定順（🔴 **この順序を変えない**）:
 *   ① `isPlatformUser`                                   → `PLATFORM`（分類外・実送信）
 *   ② `membership.partnerCompanyId !== null`             → `PARTNER_MEMBER`（分類 2・`sandbox` はモック）
 *   ③ `membership !== null && membership.tenantId === tenantId` → `HOST_MEMBER`（分類 1・実送信）
 *   ④ それ以外                                            → `CLIENT`（分類 3・モック）
 *
 * 🔴 **②を③より先に判定する。** 逆にすると、テナントに所属している取引先企業の担当者
 *    （`PARTNER_ADMIN` / `PARTNER_SALES`）が分類 1 に落ち、`sandbox` から**実在の取引先へ
 *    メールが飛ぶ**（docs/02 章 7.6 / Issue #9 / #10 / CLAUDE.md §11.1 の最悪の事故）。
 * 🔴 ④が `CLIENT`（モック側）であることがタイブレーカーである（docs/02 章 7.6 NFR-ENV-1）。
 *    「判断に迷うものは業務上の外部送信側に倒す」。
 */
export function classifyRecipient(facts: RecipientFacts): RecipientClass {
  if (facts.isPlatformUser) return 'PLATFORM';
  const membership = facts.membership;
  if (membership === null) return 'CLIENT';
  if (membership.partnerCompanyId !== null) return 'PARTNER_MEMBER';
  if (facts.tenantId !== null && membership.tenantId === facts.tenantId) return 'HOST_MEMBER';
  return 'CLIENT';
}
