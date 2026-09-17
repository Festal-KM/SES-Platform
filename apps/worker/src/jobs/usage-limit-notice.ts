// apps/worker/src/jobs/usage-limit-notice.ts
// 🔴 上限接近（80%）・到達のテナント管理者への通知（docs/02 `F-027` 処理④ / `AC-4` / 章 7.7 /
//    `CLAUDE.md` §11.1「宛先がそのテナントの利用者なら実送信」）。T-10-03。
//
// ============================================================================
// 🔴 通知は 2 経路あり、片方だけでは要件を満たさない
// ============================================================================
//   ① **アプリ内表示** … `S-038`（#69）の水準と、`#70` の停止表示。**宛先分類によらず必ず出る**。
//   ② **メール** … 本ファイル。宛先はテナント管理者（`OWNER` / `ADMIN` = 分類 1）だけであり、
//      `sandbox` でも実送信される（`F-054 AC-9` の列挙「上限接近の通知（`F-027`）」）。
//      振り分けは `email.dispatch` の単一経路（`performEmailSend`）が行い、**ここには環境の分岐が 1 つも無い**。
//
// ============================================================================
// 🔴 このファイルはメールを 1 通も送らない。新しい送信経路も作らない
// ============================================================================
// 行うのは「`EmailDispatch` を予約して `email.dispatch` を積む」ところまでである（`scan-quarantine-notice.ts`
// と同じ形）。冪等性は `EmailDispatch.dedupeKey` の `UNIQUE` が担保し、**`dedupeKey` に暦日を含める**ことで
// 「同じ閾値で日に何度も送らない」を成立させる（docs/05 §9.7 `tenant.closing-notify` と同じ作法）。
//
// 🔴 本文に金額・残量・上限値を載せない（`F-027 AC-6`「通知に金額表示が無い」/ docs/05 §16.2）。
//    差し込み値はアプリへのリンク 1 つだけ（`operational-mail-params.ts`）。何がどうなったかは、
//    閲覧者自身の権限で読める `S-038` が示す。
import {
  emailDispatchDedupeKey,
  reserveEmailDispatch,
  type PendingQuotaLoweringNotice,
  type SystemTenantCtx,
  type TenantAdminRecipient,
} from '@ses/db';
import type { OperationalMailDispatch } from '@ses/connectors';
import type { UsageLimitLevel, UsageLimitMetric } from '@ses/domain';

/**
 * 🔴 SES 側のテンプレート名（`EmailDispatch.templateKey`）。接近と到達で文面が違う
 *    （「近づいています」/「達しました」）ため 2 つ。計測の種類は本文に載せず、`S-038` で示す。
 */
export const USAGE_LIMIT_NOTICE_TEMPLATE_KEY = {
  NEARING: 'USAGE_LIMIT_NEARING',
  REACHED: 'USAGE_LIMIT_REACHED',
} as const satisfies Readonly<Record<Exclude<UsageLimitLevel, 'BELOW'>, string>>;

/**
 * `dedupeKey` の `targetId`（docs/05 §3.9 の `'{templateKey}:{targetId}:{recipientHash}'`）。
 *
 * 🔴 **暦日を鍵に含める**（1 日 1 回）。同じ日に同じ計測・同じ水準で 2 通目を作らない。
 *    日が変われば（そして水準がまた上がれば）改めて 1 通送る。
 * 🔴 区切りに `:` を使わない（`dedupeKey` 自体の 3 分割の形を壊さないため。`scanQuarantineTargetId` と同じ）。
 */
export function usageLimitNoticeTargetId(input: {
  readonly metric: UsageLimitMetric;
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
  readonly dayKey: string;
}): string {
  return `${input.metric}#${input.level}#${input.dayKey}`;
}

export type UsageLimitNoticeDeps = {
  /** 🔴 `email.dispatch` を積む。既定値（no-op）を置かない（「通知したつもりで 1 通も出ていない」を作らない）。 */
  readonly enqueueEmailDispatch: (job: OperationalMailDispatch) => Promise<void>;
};

export type UsageLimitNoticeInput = {
  readonly metric: UsageLimitMetric;
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
  readonly dayKey: string;
  readonly recipients: readonly TenantAdminRecipient[];
  readonly observedAt: Date;
};

/**
 * 🔴 1 つの遷移（計測 × 水準 × 日）について、管理者全員ぶんの `EmailDispatch` を予約して積む。
 * @returns この実行で `email.dispatch` を積んだ通数（重複は `dedupeKey` が畳むので 0 になりうる）。
 */
export async function notifyUsageLimit(
  deps: UsageLimitNoticeDeps,
  ctx: SystemTenantCtx,
  input: UsageLimitNoticeInput,
): Promise<number> {
  const templateKey = USAGE_LIMIT_NOTICE_TEMPLATE_KEY[input.level];
  const targetId = usageLimitNoticeTargetId({ metric: input.metric, level: input.level, dayKey: input.dayKey });

  let queued = 0;
  for (const recipient of input.recipients) {
    const dispatch = await reserveEmailDispatch(ctx, {
      // 🔴 分類は `packages/db` が `Membership` から導いた値（常に分類 1）をそのまま運ぶ（docs/05 §8.2）。
      recipientClass: recipient.recipientClass,
      recipientEmail: recipient.email,
      templateKey,
      dedupeKey: emailDispatchDedupeKey({ templateKey, targetId, recipientEmail: recipient.email }),
      observedAt: input.observedAt,
    });
    // 🔴 `QUEUED` の行だけを積む（`SENT` / `MOCKED` / `HELD_*` / `FAILED` を積み直さない。保留からの復帰は
    //    `send.hold-release` の責務）。「作成できなかったが `QUEUED` のまま」は前回が予約後・enqueue 前に
    //    落ちた行であり、積み直す（積まないと永久に届かない）。
    if (dispatch.status !== 'QUEUED') continue;
    await deps.enqueueEmailDispatch({
      dispatchId: dispatch.dispatchId,
      tenantId: ctx.tenantId,
      recipientClass: recipient.recipientClass,
    });
    queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// 🔴 T-11-02: クォータ引き下げの予告（docs/02 `F-057 AC-3`「引き下げには適用日の指定と対象テナントへの通知が必須」）
// ---------------------------------------------------------------------------
// 運営者が `tenant_quota_overrides` に積んだ引き下げ（`limit < previous_limit`。適用日は翌日以降）を、テナント管理者
// （`OWNER` / `ADMIN` = 分類 1）へ予告する。管理平面（`app_platform_write`）は `email_dispatches` に書けないため、
// 通知の実行はこのジョブ（`usage.limit-check`。毎 10 分）が担う。適用日は翌日以降に限られるので、予告は 24 時間以上前に届く。
// 🔴 `dedupeKey` の `targetId` は**上書き行の ID**である（暦日ではない）。10 分ごとに同じ行を掃いても
//    `reserveEmailDispatch` が既存行を返すだけで 2 通目は作らない（= `tenant_quota_overrides` に「通知済み」列が要らない）。
// 🔴 本文に新旧の上限値・計測名を載せない（差し込みはリンク 1 つ。`operational-mail-params.ts`）。
//    何がいつからどう変わるかは `S-038`（閲覧者の権限で読める）が示す。

/** SES 側のテンプレート名（`EmailDispatch.templateKey`）。 */
export const QUOTA_LOWERED_TEMPLATE_KEY = 'QUOTA_LOWERED';

export type QuotaLoweringNoticeInput = {
  readonly notices: readonly PendingQuotaLoweringNotice[];
  readonly recipients: readonly TenantAdminRecipient[];
  readonly observedAt: Date;
};

/**
 * 🔴 引き下げ 1 行につき管理者全員ぶんの `EmailDispatch` を予約して積む（`notifyUsageLimit` と同じ手順）。
 * @returns この実行で `email.dispatch` を積んだ通数（2 回目以降の実行では `dedupeKey` が畳むので通常 0 になる）。
 */
export async function notifyQuotaLowering(
  deps: UsageLimitNoticeDeps,
  ctx: SystemTenantCtx,
  input: QuotaLoweringNoticeInput,
): Promise<number> {
  let queued = 0;
  for (const notice of input.notices) {
    for (const recipient of input.recipients) {
      const dispatch = await reserveEmailDispatch(ctx, {
        recipientClass: recipient.recipientClass,
        recipientEmail: recipient.email,
        templateKey: QUOTA_LOWERED_TEMPLATE_KEY,
        dedupeKey: emailDispatchDedupeKey({
          templateKey: QUOTA_LOWERED_TEMPLATE_KEY,
          targetId: notice.overrideId,
          recipientEmail: recipient.email,
        }),
        observedAt: input.observedAt,
      });
      // 🔴 `QUEUED` の行だけを積む（`SENT` / `MOCKED` / `HELD_*` / `FAILED` を積み直さない）。既存の `QUEUED` 行は
      //    前回が予約後・enqueue 前に落ちたか送信ジョブが未処理の行であり、積み直す（送信側の CAS が 2 通目を止める）。
      if (dispatch.status !== 'QUEUED') continue;
      await deps.enqueueEmailDispatch({
        dispatchId: dispatch.dispatchId,
        tenantId: ctx.tenantId,
        recipientClass: recipient.recipientClass,
      });
      queued += 1;
    }
  }
  return queued;
}
