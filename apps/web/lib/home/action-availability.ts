// apps/web/lib/home/action-availability.ts
// 🔴 要対応キューの `操作` 列が**不能になる 4 条件を 1 箇所に集める**（docs/05 §6.11.2 /
//    `docs/04` 申し送り 22 ⑤ / `U-10`）。T-22-09。
//
// ============================================================================
// 🔴 なぜ 1 箇所なのか
// ============================================================================
// `docs/04` 申し送り 22 ⑤ の指摘そのものである: **画面側の条件分岐に散ると、どこかで漏れる。**
// 漏れ方は「押せないボタンが出る」ではなく「**停止中のテナントに実行導線が出る**」であり、
// `F-004 AC-7` / `F-007 AC-2` / `BR-31` の担保が UI の分岐の数だけ薄くなる。
//
// 🔴 **判定順は `requireExecutable`（`lib/api/guards.ts`）と同じ**にする（docs/05 §6.11.2 の表）:
//   ① テナントのライフサイクル（`SUSPENDED` / `CLOSING` / `PURGED`）… **全 4 kind**
//   ② 所属取引先の停止（`partnerSuspendedAt`）… **全 4 kind**
//   ③ ロール … `APPROVE` / `FIX` / `RESEND` / `RESPOND`
//   ④ 送信ドメイン未検証 … 🔴 **`RESEND` だけ**（`APPROVE` / `FIX` / `RESPOND` は対象外）
// より広い停止を先に返すのは、利用者の次の行動（誰に解除を依頼するか）が正しく決まるためである
// （`requireExecutable` 冒頭の 🔴 と同じ理由）。
//
// 🔴 **画面はこの結論と `row.action` の 2 項だけを見る**（`row.action !== null &&
//    availability[row.action.kind].enabled`）。**両方がサーバの与えた事実**であり、
//    画面はロールも状態も見ない。
// 🔴 **`enabled === false` のときボタンを描かず、その位置に `reasonKey` の文言を置く**
//    （`disabled` で表さない。§7.10 / `U-10`）。型（`ActionQueueActionAvailability`）が
//    「不能なのに理由が無い」を禁じている。
import type { TenantLifecycleState, TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import { executionDenialMessageKey } from '../api/guards';
import { deriveMainCapabilities } from './capabilities';
import type { ActionQueueActionAvailability, ActionQueueActionKind } from './types';

/** 🔴 4 kind の並び（応答は毎回 4 エントリを全量返す。docs/05 §6.11.2）。 */
export const ACTION_QUEUE_ACTION_KINDS = [
  'APPROVE',
  'FIX',
  'RESEND',
  'RESPOND',
] as const satisfies readonly ActionQueueActionKind[];

/**
 * 判定材料。🔴 **すべて ctx 由来（+ 起動時設定と DB の事実）であり、リクエスト入力を取らない。**
 *
 * - `mode` … 🔴 代理閲覧（`/admin/impersonate/**`。Phase 2）で同じ表示部品を描くときは
 *   `'IMPERSONATION'` を渡し、**全 kind を `false`** にする（`docs/05` §6.11.2 /
 *   `CLAUDE.md` §10.5「代理状態での実行系操作は不可」）。**部品側で分岐しない。**
 * - `sendingDomainUnverified` … 取引先へ届く送信が実行できない状態か（§8.3 / `F-001 AC-4`）。
 *   🔴 **ホスト文脈でしか意味を持たない**（取引先はそもそも送信・再送を行えない）。
 */
export type ActionQueueAvailabilityFacts = {
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
  readonly partnerSuspendedAt: Date | null;
  readonly sendingDomainUnverified: boolean;
  readonly mode?: 'NORMAL' | 'IMPERSONATION';
};

/**
 * 🔴 不能の理由（`U-10` の理由テキスト）。**キューのセルに収まる短い語**にする ——
 *    `error.tenant.suspended` 等の長文は API のエラー本文であり、表のセルには入らない。
 *    語の出所は `packages/i18n` の 1 箇所だけである（`CLAUDE.md` §3.5）。
 * 🔴 **ライフサイクルの理由は `executionDenialMessageKey` の結論を使う**（停止 / 解約手続き中 /
 *    終了の 3 状態を 1 つの語に畳まない。2 つ目の判定表を作らない）。
 */
const DENIAL_REASON_KEYS = {
  lifecycle: {
    SUSPENDED: 'home.actionQueue.denied.tenantSuspended',
    CLOSING: 'home.actionQueue.denied.tenantClosing',
    PURGED: 'home.actionQueue.denied.tenantPurged',
  },
  partnerSuspended: 'home.actionQueue.denied.partnerSuspended',
  role: 'home.actionQueue.denied.role',
  sendingDomain: 'home.actionQueue.denied.sendingDomain',
  impersonation: 'home.actionQueue.denied.impersonation',
} as const satisfies {
  readonly lifecycle: Readonly<Record<'SUSPENDED' | 'CLOSING' | 'PURGED', MessageKey>>;
  readonly partnerSuspended: MessageKey;
  readonly role: MessageKey;
  readonly sendingDomain: MessageKey;
  readonly impersonation: MessageKey;
};

const ALLOWED: ActionQueueActionAvailability = { enabled: true, reasonKey: null };

function denied(reasonKey: MessageKey): ActionQueueActionAvailability {
  return { enabled: false, reasonKey };
}

/**
 * 🔴 ライフサイクルの不能理由（`null` = 実行可）。`executionDenialMessageKey` が `null` を返す
 *    状態（`SANDBOX` / `ACTIVE`）だけが通る —— **状態が増えたらあちらのコンパイルが落ちる**ので、
 *    ここで「知らない状態を実行可にする」ことは起きない。
 */
function lifecycleReasonKey(state: TenantLifecycleState): MessageKey | null {
  if (executionDenialMessageKey(state) === null) return null;
  // 🔴 `Record` で 3 状態を網羅している（`executionDenialMessageKey` が非 null を返すのはこの 3 つだけ）。
  //    万一増えたら `undefined` になるので、安全側（停止中の語）に倒す。
  return DENIAL_REASON_KEYS.lifecycle[state as 'SUSPENDED' | 'CLOSING' | 'PURGED'] ?? DENIAL_REASON_KEYS.lifecycle.SUSPENDED;
}

/**
 * 🔴 ロールで実行できるか。**既存の `deriveMainCapabilities(ctx.role)` を再利用する**
 *    （docs/05 §6.11.2 の 🔴「2 つ目のロール判定表を作らない」）。
 *
 * ⚠️ docs/05 の表は `approve` → `APPROVE` / `submit` → `RESEND` / `RESPOND` の 3 つだけを挙げている。
 *    🔴 **`FIX` も `submit` に紐づける** —— 閲覧専用ロールに提案の**編集**（`S-020`）の導線を出すと、
 *    押した先で黙ってホームに戻される（`BR-31` / `F-004 AC-6`）。`deriveMainCapabilities` の 4 つの
 *    boolean はいずれも `role !== 'VIEWER'` なので、**新しい判定表を作ったことにはならない**。
 */
function roleAllows(kind: ActionQueueActionKind, role: TenantRole): boolean {
  const capabilities = deriveMainCapabilities(role).execute;
  return kind === 'APPROVE' ? capabilities.approve : capabilities.submit;
}

/**
 * 🔴 4 kind の可否を返す（**毎回 4 エントリ**）。
 */
export function actionQueueActionAvailability(
  facts: ActionQueueAvailabilityFacts,
): Readonly<Record<ActionQueueActionKind, ActionQueueActionAvailability>> {
  const entries = ACTION_QUEUE_ACTION_KINDS.map(
    (kind): readonly [ActionQueueActionKind, ActionQueueActionAvailability] => [
      kind,
      availabilityOf(kind, facts),
    ],
  );
  return Object.fromEntries(entries) as Readonly<
    Record<ActionQueueActionKind, ActionQueueActionAvailability>
  >;
}

function availabilityOf(
  kind: ActionQueueActionKind,
  facts: ActionQueueAvailabilityFacts,
): ActionQueueActionAvailability {
  // 🔴 代理閲覧は最優先（`CLAUDE.md` §10.5。read-only であることが他のどの条件よりも強い）。
  if (facts.mode === 'IMPERSONATION') return denied(DENIAL_REASON_KEYS.impersonation);
  // ① テナントのライフサイクル（全 kind）。
  const lifecycle = lifecycleReasonKey(facts.lifecycleState);
  if (lifecycle !== null) return denied(lifecycle);
  // ② 所属取引先の停止（全 kind）。🔴 ホスト所属では `partnerSuspendedAt` は必ず `null` である。
  if (facts.partnerSuspendedAt !== null) return denied(DENIAL_REASON_KEYS.partnerSuspended);
  // ③ ロール。
  if (!roleAllows(kind, facts.role)) return denied(DENIAL_REASON_KEYS.role);
  // ④ 送信ドメイン未検証。🔴 **`RESEND` だけ**が対象である。
  if (kind === 'RESEND' && facts.sendingDomainUnverified) {
    return denied(DENIAL_REASON_KEYS.sendingDomain);
  }
  return ALLOWED;
}
