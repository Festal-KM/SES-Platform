// apps/worker/src/jobs/tenant-closing-notify.ts
// 🔴 `tenant.closing-notify`（毎日 02:08 JST。docs/05 §9.7 / `docs/02` `F-064 AC-10` / 章 7.7-④ / `CLAUDE.md` §4.2 `Tenant`）。T-10-12。
//
// ============================================================================
// 🔴 このジョブがやることは 1 つだけである
// ============================================================================
//   `CLOSING` のテナントの管理者（`OWNER` / `ADMIN` = 分類 1）へ、**削除予告**を 2 段で積む。
//     - `ENTERED` … `CLOSING` に入った日以降に 1 回（削除予定日 = `closing_entered_at + TENANT_PURGE_GRACE_DAYS` を本文に明記）
//     - `D7`      … 削除予定日の 7 日前以降に 1 回
//   起票条件は 🔴 **「期限を過ぎ、かつ未処理」**（docs/05 §9.1。日付一致にしない）。ジョブが止まった日があっても翌日に取り返す。
//   「未処理」= その `(tenantId, phase)` に `QUEUED` / `HELD_*` / `SENT` / `MOCKED` の `EmailDispatch` が無いこと
//   （`@ses/domain` の `isClosingNoticePhaseFiled`）。`FAILED` / `SUPPRESSED` だけなら翌日に再起票される
//   （`dedupeKey` に暦日を含めるため `UNIQUE` に当たらない）。
//
// ============================================================================
// 🔴 このファイルはメールを 1 通も送らない。新しい送信経路も作らない
// ============================================================================
// 行うのは「`EmailDispatch` を予約して `email.dispatch` を積む」ところまで（`usage-limit-notice.ts` / `scan-quarantine-notice.ts`
// と同じ形）。🔴 **分類 1（テナント所属利用者宛）なので `sandbox` でも実送信される** —— その振り分けは `email.dispatch` の
// 単一経路（`performEmailSend` → `isMockedDelivery`）が宛先分類で行い、**ここには環境の分岐が 1 つも無い**（`CLAUDE.md` §11.1）。
// 環境枠（`MAIL_PROVIDER_DAILY_QUOTA`）に当たれば `HELD_PROVIDER_QUOTA` で保留され `send.hold-release` が配送する（docs/05 §8.3-Q）。
//
// 🔴 配送の**確認**（削除に進めるか）はこのジョブの責務ではない。`tenant.purge-scan` / `tenant.purge`（T-10-09）が
//    `readClosingNoticeDelivery`（`packages/db`）で判定する。「予告ジョブを enqueue したから通知済み」とはみなさない。
//
// 🔴 母集団は `CLOSING` のテナント（`TENANT_CLOSING_NOTIFY_POPULATION`。ファンアウトは `runtime.ts`）。列挙と実行の間に
//    状態が変わりうるので、ハンドラは `tenants` の行を読み直して `CLOSING` でなければ何もしない。`ctx.lifecycleState` は
//    `SystemTenantCtx` では固定値なので判定に使わない（`context.ts` の注記）。
// 🔴 `Tenant` の状態を動かさない（`CLOSING → PURGED` は T-10-09）。本文にテナント名と期日以外を載せない。
import type { InternalJobName, OperationalMailDispatch } from '@ses/connectors';
import {
  emailDispatchDedupeKey,
  readClosingNoticePhaseStatuses,
  readTenantAdminRecipients,
  readTenantClosingSchedule,
  reserveEmailDispatch,
  systemTenantCtx,
  type SchedulerFanoutPopulation,
  type SystemTenantCtx,
} from '@ses/db';
import {
  closingNoticeSchedule,
  closingNoticeTargetId,
  dueClosingNoticePhases,
  isClosingNoticePhaseFiled,
  TENANT_CLOSING_NOTICE_PHASES,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
  usagePeriodKey,
  type TenantClosingNoticePhase,
} from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const TENANT_CLOSING_NOTIFY_JOB = 'tenant.closing-notify' satisfies InternalJobName;

/** 🔴 毎日 02:08 JST（docs/05 §9.7。`retention.notify` 02:05 の後、`tenant.purge-scan` 02:10 の前）。時刻の出所はここ 1 箇所。 */
export const TENANT_CLOSING_NOTIFY_SCHEDULE = { cron: '8 2 * * *', timeZone: 'Asia/Tokyo' } as const;

/**
 * 🔴 ファンアウトの母集団（migration 20260926000000）。**`CLOSING` だけ**。既定の `LIVE`（`SANDBOX` / `ACTIVE`）には
 *    解約手続き中のテナントが含まれないため、宣言で明示しないとこのジョブは 1 社にも配られない。
 */
export const TENANT_CLOSING_NOTIFY_POPULATION = 'CLOSING' satisfies SchedulerFanoutPopulation;

export type TenantClosingNotifyPayload = { readonly tenantId: string };

export function parseTenantClosingNotifyPayload(raw: unknown): TenantClosingNotifyPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(TENANT_CLOSING_NOTIFY_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  // 🔴 分離キーは payload から来るが、それはスケジュール側（テナントのファンアウト）が確定させた値である
  //    （docs/05 §9.1「payload に tenantId を必ず含める」）。
  return { tenantId: requireUuid(TENANT_CLOSING_NOTIFY_JOB, 'tenantId', record.tenantId) };
}

export type TenantClosingNotifyDeps = {
  /** 🔴 現在時刻の注入（期日の判定と `dedupeKey` の暦日をテストで固定する）。 */
  readonly now: () => Date;
  /** `TENANT_PURGE_GRACE_DAYS`（`packages/config`。既定 30）。削除予定日 = `closing_entered_at + purgeGraceDays`。 */
  readonly purgeGraceDays: number;
  /** 🔴 `email.dispatch` を積む。既定値（no-op）を置かない（「予告したつもりで 1 通も出ていない」を作らない）。 */
  readonly enqueueEmailDispatch: (job: OperationalMailDispatch) => Promise<void>;
};

export type TenantClosingNoticePhaseOutcome = {
  readonly phase: TenantClosingNoticePhase;
  /** その段の期日（暦日キー）。 */
  readonly dueOn: string;
  /**
   * - `NOT_DUE` … 期日がまだ来ていない
   * - `ALREADY_FILED` … 起票済み（`QUEUED` / `HELD_*` / `SENT` / `MOCKED` の行がある）。積み増さない
   * - `FILED` … この実行で起票した（`queued` 通を積んだ。宛先 0 人なら 0）
   */
  readonly status: 'NOT_DUE' | 'ALREADY_FILED' | 'FILED';
  /** 宛先の人数（`FILED` のとき。分類 1 の `OWNER` / `ADMIN`）。 */
  readonly recipients: number;
  /** この実行で `email.dispatch` を積んだ通数（`dedupeKey` が畳めば `recipients` より少なくなりうる）。 */
  readonly queued: number;
};

export type TenantClosingNotifyOutcome =
  /** 列挙と実行の間に `CLOSING` を離れた / `closing_entered_at` が無い。何もしない（正常系）。 */
  | { readonly kind: 'SKIPPED'; readonly reason: 'NOT_CLOSING' | 'NO_CLOSING_ENTERED_AT' }
  | {
      readonly kind: 'CHECKED';
      readonly todayKey: string;
      /** 削除予定日（暦日キー）。本文に載せた値と同じ計算。 */
      readonly purgeScheduledOn: string;
      readonly phases: readonly TenantClosingNoticePhaseOutcome[];
    };

/**
 * 🔴 1 テナント分の予告（`runScheduled` → ファンアウト → 本関数）。
 *
 * 宛先の引き当て（`readTenantAdminRecipients`）は、起票する段が 1 つでもあるときだけ行う（毎日全社の `memberships` を
 * 読まない）。2 段が同じ日に期限を過ぎていれば同じ宛先に 2 通（段ごとに 1 通）積む。
 */
export async function notifyTenantClosing(
  deps: TenantClosingNotifyDeps,
  ctx: SystemTenantCtx,
): Promise<TenantClosingNotifyOutcome> {
  const tenant = await readTenantClosingSchedule(ctx);
  if (tenant.lifecycleState !== 'CLOSING') return { kind: 'SKIPPED', reason: 'NOT_CLOSING' };
  if (tenant.closingEnteredAt === null) return { kind: 'SKIPPED', reason: 'NO_CLOSING_ENTERED_AT' };

  const now = deps.now();
  const todayKey = usagePeriodKey('DAY', now);
  // 🔴 暦は `Asia/Tokyo` 固定（docs/05 §9.1）。`closing_entered_at` の UTC 時刻を JST の暦日に落としてから日数を数える。
  const closingEnteredDayKey = usagePeriodKey('DAY', tenant.closingEnteredAt);
  const schedule = closingNoticeSchedule({ closingEnteredDayKey, graceDays: deps.purgeGraceDays });
  const due = new Set(dueClosingNoticePhases({ todayKey, closingEnteredDayKey, graceDays: deps.purgeGraceDays }));

  let recipients: Awaited<ReturnType<typeof readTenantAdminRecipients>> | null = null;
  const phases: TenantClosingNoticePhaseOutcome[] = [];
  for (const phase of TENANT_CLOSING_NOTICE_PHASES) {
    const dueOn = schedule.dueOn[phase];
    if (!due.has(phase)) {
      phases.push({ phase, dueOn, status: 'NOT_DUE', recipients: 0, queued: 0 });
      continue;
    }
    // 🔴 「未処理」の判定は段ごと（`dedupeKey` の `targetId` 接頭辞 `{tenantId}#{phase}#`）。
    if (isClosingNoticePhaseFiled(await readClosingNoticePhaseStatuses(ctx, phase))) {
      phases.push({ phase, dueOn, status: 'ALREADY_FILED', recipients: 0, queued: 0 });
      continue;
    }
    recipients ??= await readTenantAdminRecipients(ctx);
    const targetId = closingNoticeTargetId({ tenantId: ctx.tenantId, phase, dayKey: todayKey });
    let queued = 0;
    for (const recipient of recipients) {
      const dispatch = await reserveEmailDispatch(ctx, {
        // 🔴 分類は `packages/db` が `Membership` から導いた値（常に分類 1）をそのまま運ぶ（docs/05 §8.2）。
        recipientClass: recipient.recipientClass,
        recipientEmail: recipient.email,
        templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
        dedupeKey: emailDispatchDedupeKey({
          templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
          targetId,
          recipientEmail: recipient.email,
        }),
        observedAt: now,
      });
      // 🔴 `QUEUED` の行だけを積む（`SENT` / `MOCKED` / `HELD_*` / `FAILED` を積み直さない。保留からの復帰は
      //    `send.hold-release` の責務）。⚠️ ここに来る `dispatch` は本実行で予約した行だけである —— 前回が予約後・
      //    enqueue 前に落ちた `QUEUED` 行は、上の段単位の未処理判定が「起票済み」と見るため本ジョブでは再 enqueue
      //    されない（T-10-12 レビュー申し送り 1）。その場合は配送確認が偽のまま削除は進まず、`A-005` 項目 15
      //    `NOTICE_PENDING` / 項目 16 の `QUEUED` 滞留に現れるので人手で対処する（同日 `QUEUED` の再 enqueue 経路を
      //    足すなら docs/05 §9.7 に決着を追記してから）。
      if (dispatch.status !== 'QUEUED') continue;
      await deps.enqueueEmailDispatch({
        dispatchId: dispatch.dispatchId,
        tenantId: ctx.tenantId,
        recipientClass: recipient.recipientClass,
      });
      queued += 1;
    }
    phases.push({ phase, dueOn, status: 'FILED', recipients: recipients.length, queued });
  }

  return { kind: 'CHECKED', todayKey, purgeScheduledOn: schedule.purgeScheduledOn, phases };
}

export type TenantClosingNotifyHandler = (payload: unknown, jobId: string) => Promise<TenantClosingNotifyOutcome>;

export function createTenantClosingNotifyHandler(deps: TenantClosingNotifyDeps): TenantClosingNotifyHandler {
  return async (payload, jobId) => {
    const job = parseTenantClosingNotifyPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: TENANT_CLOSING_NOTIFY_JOB, jobId });
    return notifyTenantClosing(deps, ctx);
  };
}
