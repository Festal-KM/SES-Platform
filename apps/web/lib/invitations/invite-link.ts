// apps/web/lib/invitations/invite-link.ts
// 🔴 `#14` の応答（docs/05 §6.4）を **`SandboxInvitationView` / `ProductionInvitationView` の
//    判別可能な合併**にする（T-04-08 / `F-007 AC-4`）。
//
// ============================================================================
// 🔴 なぜ「省略可能なフィールド」ではなく合併なのか
// ============================================================================
// `{ id, inviteUrl?: string, deliveryState }` の 1 つの型にすると、`production` でも
// `inviteUrl` を**書ける型**のままになる。平文トークンは「本人に渡すための唯一の手段」であり、
// 誰でも受諾できる資格情報そのものである（`CLAUDE.md` §3.4）。したがって
// **`production` の応答型にはフィールドごと存在させない**。
//
// 同じ理由で、開示の可否を決める runtime も合併にしてある: `appUrl` を持つのは
// `SANDBOX_LINK_HANDOVER` の枝だけであり、**開示しない環境ではリンクを組み立てる材料が
// そもそも無い**（`if` を書き忘れても URL を作れない）。
//
// ============================================================================
// 🔴 開示の条件は 2 つの AND であり、片方だけでは足りない
// ============================================================================
//   ① `APP_ENV === 'sandbox'`（判定は起動時の 1 箇所 = `lib/db/bootstrap.ts`。`CLAUDE.md` §11.1）
//   ② 宛先分類が 2（パートナー所属）であること
// ②が要る理由: 分類 1（ホスト所属メンバー）は `sandbox` でも**実送信される**（Issue #9 / #10）。
// メールが本人に届くのに画面にもリンクを出すと、平文トークンを不必要に 2 経路へ広げることになる。
import type { AppEnv } from '@ses/config';
import { buildAccountMailLink, type AccountMailDeliveryState } from '@ses/connectors';
import type { AccountMailRecipientClass } from '@ses/db';

/**
 * 招待リンクを画面に出すかどうかの、**起動時に確定した**設定（docs/05 §13.1）。
 *
 * 🔴 リクエストごとに `APP_ENV` を見ない。`lib/db/bootstrap.ts` が 1 度だけ解決し、
 *    ルートはその結果を受け取るだけである（`CLAUDE.md` §11.1 / NFR-ENV-2）。
 */
export type InviteUrlRuntime =
  /** `development` / `demo` / `staging` / `production`。リンクを組み立てる材料を持たない。 */
  | { readonly kind: 'NOT_DISCLOSED' }
  /** 🔴 `sandbox` のみ（`F-007 AC-4`）。取引先招待メールがモックになるため画面で手渡す。 */
  | { readonly kind: 'SANDBOX_LINK_HANDOVER'; readonly appUrl: string };

/** 🔴 テストと非 `sandbox` 経路が使う定数（値を書き下ろさず、この 1 つを使う）。 */
export const INVITE_URL_NOT_DISCLOSED: InviteUrlRuntime = { kind: 'NOT_DISCLOSED' };

/**
 * 🔴 開示設定の**遅延解決**（`lib/db/bootstrap.ts` の `inviteUrlRuntime` がこの形である）。
 *
 * 🔴 なぜ値ではなく関数で受け取るか（`SendingDomainResolver` と同じ理由）:
 *    解決の実体は起動時 DI（`ensureDbConfigured`）であり、**分類 1（自社メンバー宛）の招待は
 *    それに依存しない**（`F-001 AC-5` と同じ構図）。値で受け取ると、開示に関係のない経路まで
 *    起動時 DI の成否に縛られる。呼ばれるのは分類 2 のときだけである。
 */
export type InviteUrlRuntimeResolver = () => InviteUrlRuntime;

/**
 * 🔴 `APP_ENV` から開示設定を決める**唯一の関数**（docs/05 §13.1 / `CLAUDE.md` §11.1）。
 *
 * 🔴 呼び出してよいのは起動時の 1 箇所（`lib/db/bootstrap.ts`）だけである。リクエストごとに
 *    呼ぶと、`APP_ENV` の分岐がアプリ中に散る（NFR-ENV-2）。
 * 🔴 `development` / `demo` を含めない: これらも取引先宛はモックだが、招待リンクの手渡しが
 *    要るのは「見込み客が自分のデータで取引先を招く」`sandbox` だけである（docs/04 §S-014 /
 *    `U-07` / `F-007 AC-4`）。**開示先を広げるのは人間の判断事項**（`CLAUDE.md` §8.6）。
 */
export function resolveInviteUrlRuntime(env: Pick<AppEnv, 'APP_ENV' | 'APP_URL'>): InviteUrlRuntime {
  return env.APP_ENV === 'sandbox'
    ? { kind: 'SANDBOX_LINK_HANDOVER', appUrl: env.APP_URL }
    : INVITE_URL_NOT_DISCLOSED;
}

/**
 * `production`（および `development` / `demo` / `staging`）の `#14` 応答。
 *
 * 🔴 `inviteUrl?: never` を置くのは、**うっかり入れた実装をコンパイルで落とす**ためである。
 *    型に無いだけでは、オブジェクトリテラル以外の経路（スプレッド等）で紛れ込みうる。
 */
export type ProductionInvitationView = {
  readonly disclosure: 'NONE';
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
  readonly inviteUrl?: never;
};

/** 🔴 `sandbox` × 宛先分類 2 のときだけ作られる応答（`F-007 AC-4`）。 */
export type SandboxInvitationView = {
  readonly disclosure: 'SANDBOX_INVITE_URL';
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
  /**
   * 🔴 平文トークンを含む受諾リンク（`S-002`）。
   *    - **この応答が唯一の出口**である（再表示 API を作らない。docs/04 `S-046` と同じ規律）
   *    - DB・監査ログ・サーバログには載らない（`lib/invitations/service.ts` 冒頭の規律）
   *    - 有効期限・1 回限りの受諾・受諾後の失効は `production` の招待と**同一**である
   *      （専用の別トークン・別受諾経路を作らない）
   */
  readonly inviteUrl: string;
};

export type InvitationIssueView = ProductionInvitationView | SandboxInvitationView;

/**
 * `#14` の応答を組み立てる唯一の関数（純粋関数。テストが 4 象限を網羅する）。
 *
 * 🔴 **`token` を受け取るが、開示しない枝では戻り値のどこにも現れない。**
 */
export function buildInvitationIssueView(input: {
  readonly id: string;
  readonly deliveryState: AccountMailDeliveryState;
  readonly recipientClass: AccountMailRecipientClass;
  /** 🔴 平文。この関数の外へ出るのは `SANDBOX_LINK_HANDOVER` × 分類 2 のときだけである。 */
  readonly token: string;
  readonly resolveInviteUrl: InviteUrlRuntimeResolver;
}): InvitationIssueView {
  const base = { id: input.id, deliveryState: input.deliveryState } as const;
  // 🔴 開示の条件は 2 つの AND である。**両方をこの 1 箇所だけに書く**（呼び出し側に
  //    「分類 2 のときだけ渡す」といった前提を置かない）。
  // ② 宛先分類を先に見る —— 分類 1 では起動時設定を 1 度も参照しない（`F-001 AC-5` と同じ構図）。
  if (input.recipientClass !== 'PARTNER_MEMBER') return { disclosure: 'NONE', ...base };
  // ① 環境（起動時に確定）。
  const runtime = input.resolveInviteUrl();
  if (runtime.kind !== 'SANDBOX_LINK_HANDOVER') return { disclosure: 'NONE', ...base };
  return {
    disclosure: 'SANDBOX_INVITE_URL',
    ...base,
    // 🔴 メール本文のリンクと**同じ関数**で組み立てる（別経路を作らない。T-04-08）。
    inviteUrl: buildAccountMailLink(runtime.appUrl, 'INVITATION', input.token),
  };
}
