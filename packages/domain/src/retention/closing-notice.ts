// packages/domain/src/retention/closing-notice.ts
// 🔴 削除予告（`tenant.closing-notify`）の**判定の定義**（docs/05 §9.7 / `docs/02` `F-064 AC-10` / 章 7.7-④）。T-10-12。
//
// ============================================================================
// 🔴 ここに置くもの（純粋関数。DB・現在時刻・環境を一切読まない）
// ============================================================================
//   ① 2 段の期日（`ENTERED` = `CLOSING` に入った日 / `D7` = 削除予定日の 7 日前）と削除予定日の暦日計算
//      —— 暦は `usagePeriodKey` が作った `Asia/Tokyo` の暦日キー（`YYYY-MM-DD`）の上で整数演算する
//      （`day-keys.ts`。`Date` を生成しない）。
//   ② 「その段はもう起票済みか」（未処理判定）—— 起票条件は「期限を過ぎ、かつ未処理」であり日付一致ではない
//      （docs/05 §9.1。ジョブが止まった日があっても翌日に取り返す）。
//   ③ 🔴 「予告は配送済みか」（削除可否の判定）—— `tenant.purge-scan` / `tenant.purge` の enqueue 条件・再評価条件。
//      **`A-005` 項目 15 の `classifyPurgeNotice`（表示の分類）とは用途が違う別関数**である。状態集合は同じだが、
//      こちらは `MOCKED` を配送済みとみなすかどうかを**環境（引数）で切り替える**。
//   ④ `EmailDispatch.dedupeKey` の `targetId` の規約（`{tenantId}#{phase}#{yyyy-mm-dd}`）。
//
// 🔴 状態の文字列は `packages/db` の `EMAIL_DISPATCH_STATUSES`（CHECK の 7 値）と同じ値である。domain は db に
//    依存できないため文字列で持ち、`packages/db/src/tenant-closing-notice.test.ts` が集合の包含を固定する。

import { compareDayKeys, shiftDayKey } from '../usage/day-keys.js';

/** 🔴 削除予告のテンプレート（`EmailDispatch.templateKey`）。書く側（ジョブ）と読む側（`A-005` / 配送確認）の単一出所。 */
export const TENANT_CLOSING_NOTICE_TEMPLATE_KEY = 'TENANT_CLOSING_NOTICE';

/** 予告の 2 段（docs/05 §9.7）。`ENTERED` = `CLOSING` に入った日 / `D7` = 削除予定日の 7 日前。 */
export const TENANT_CLOSING_NOTICE_PHASES = ['ENTERED', 'D7'] as const;

export type TenantClosingNoticePhase = (typeof TENANT_CLOSING_NOTICE_PHASES)[number];

/** `D7` の「7」。削除予定日から遡る日数（docs/05 §9.7「`closingEnteredAt + 23日`」= 30 − 7）。 */
export const CLOSING_NOTICE_D7_DAYS_BEFORE_PURGE = 7;

export function isTenantClosingNoticePhase(value: string): value is TenantClosingNoticePhase {
  return (TENANT_CLOSING_NOTICE_PHASES as readonly string[]).includes(value);
}

export type ClosingNoticeScheduleInput = {
  /** `tenants.closing_entered_at` を `Asia/Tokyo` の暦日キーにしたもの（`usagePeriodKey('DAY', …)`）。 */
  readonly closingEnteredDayKey: string;
  /** `TENANT_PURGE_GRACE_DAYS`（`packages/config`。既定 30）。 */
  readonly graceDays: number;
};

export type ClosingNoticeSchedule = {
  /** 削除予定日（`closing_entered_at + graceDays`。暦日キー）。本文に明記する値。 */
  readonly purgeScheduledOn: string;
  /** 各段の期日（この日以降に起票する）。 */
  readonly dueOn: Readonly<Record<TenantClosingNoticePhase, string>>;
};

function assertGraceDays(graceDays: number): void {
  if (!Number.isInteger(graceDays) || graceDays <= 0) {
    throw new RangeError(`削除までの猶予日数は 1 以上の整数である必要があります（${graceDays}）。`);
  }
}

/**
 * 削除予定日と 2 段の期日を求める。
 *
 * 🔴 `D7` の期日は `purgeScheduledOn − 7 日` だが、猶予が 7 日以下なら `ENTERED` と同じ日（入った日）に丸める
 *    （期日が過去へ出て「入った日より前に期限を過ぎていた」形にしない。どちらも同じ日に起票される）。
 */
export function closingNoticeSchedule(input: ClosingNoticeScheduleInput): ClosingNoticeSchedule {
  assertGraceDays(input.graceDays);
  const purgeScheduledOn = shiftDayKey(input.closingEnteredDayKey, input.graceDays);
  const d7Offset = Math.max(0, input.graceDays - CLOSING_NOTICE_D7_DAYS_BEFORE_PURGE);
  return {
    purgeScheduledOn,
    dueOn: {
      ENTERED: input.closingEnteredDayKey,
      D7: shiftDayKey(input.closingEnteredDayKey, d7Offset),
    },
  };
}

export type DueClosingNoticePhasesInput = ClosingNoticeScheduleInput & {
  /** 実行日（`usagePeriodKey('DAY', now)`）。 */
  readonly todayKey: string;
};

/**
 * 🔴 「期限を過ぎた」段（`dueOn <= today`）を、段の定義順で返す。
 *
 * 日付一致にしない: ジョブが 1 日止まっていても翌日の実行で `ENTERED` が返る。同じ日に両段が期限を過ぎていれば
 * 両方返る（それぞれ 1 通ずつ。未処理判定は段ごとに行う）。
 */
export function dueClosingNoticePhases(input: DueClosingNoticePhasesInput): readonly TenantClosingNoticePhase[] {
  const { dueOn } = closingNoticeSchedule(input);
  return TENANT_CLOSING_NOTICE_PHASES.filter((phase) => compareDayKeys(dueOn[phase], input.todayKey) <= 0);
}

// ---------------------------------------------------------------------------
// 未処理判定（起票側）
// ---------------------------------------------------------------------------

/**
 * 🔴 「その段はもう起票済み」とみなす状態（docs/05 §9.7「未処理 = `QUEUED` / `HELD_PROVIDER_QUOTA` / `SENT` /
 *    `MOCKED` の行が無いこと」）。`HELD_*` は接頭辞で見る（`HELD_DOMAIN_UNVERIFIED` は分類 1 には起きないが、
 *    起きたとしても「保留中」であって未処理ではない。保留中に毎日 1 通ずつ積み増す形にしない）。
 *
 * 🔴 `FAILED` / `SUPPRESSED` は**含めない** = 翌日に再起票される（`dedupeKey` に暦日が入るため `UNIQUE` に当たらない）。
 */
export const CLOSING_NOTICE_FILED_STATUSES = ['QUEUED', 'SENT', 'MOCKED'] as const;

const HELD_STATUS_PREFIX = 'HELD_';

/** その段の `EmailDispatch` の状態の集合から、「起票済み（未処理ではない）」かを返す。 */
export function isClosingNoticePhaseFiled(statuses: readonly string[]): boolean {
  return statuses.some(
    (status) =>
      (CLOSING_NOTICE_FILED_STATUSES as readonly string[]).includes(status) || status.startsWith(HELD_STATUS_PREFIX),
  );
}

// ---------------------------------------------------------------------------
// 配送済み判定（削除可否。`tenant.purge-scan` / `tenant.purge` が使う）
// ---------------------------------------------------------------------------

export type ClosingNoticeDeliveryOptions = {
  /**
   * 🔴 `MOCKED`（疑似送信）を配送済みとみなすか。**送信系が全てモックの環境（`development` / `demo`）だけ true**
   *    （`packages/config` の `isAllMockEmailEnv`）。`sandbox` の分類 1 は実送信されるため `MOCKED` は「届いていない」。
   *    値は起動時に解決した環境から来る（呼び出し側が `true` を書かない）。
   */
  readonly mockedCountsAsDelivered: boolean;
};

export type ClosingNoticeDelivery = {
  /** 🔴 削除に進んでよいか = `deliveredCount >= 1 && pendingCount === 0`。 */
  readonly delivered: boolean;
  /** `SENT`（+ 全モック環境なら `MOCKED`）の行数。 */
  readonly deliveredCount: number;
  /** `QUEUED` / `HELD_*` の行数。🔴 1 件でもあれば削除に進まない（保留は「通知済み」ではない。`docs/02` 章 7.7-④）。 */
  readonly pendingCount: number;
  /** `FAILED` の行数（翌日の再起票を待つ）。 */
  readonly failedCount: number;
  /** `SUPPRESSED` の行数（送らずに閉じた。配送済みでも保留でもない）。 */
  readonly suppressedCount: number;
  /** 🔴 配送済みに数えなかった `MOCKED` の行数（`mockedCountsAsDelivered=false` のとき）。0 でなければ環境の取り違えの手掛かり。 */
  readonly mockedIgnoredCount: number;
  readonly total: number;
};

/**
 * 🔴 予告行の状態の集合 → 配送済みか（docs/05 §9.7 `tenant.purge-scan` の enqueue 条件）。
 *
 *   - `SENT`（全モック環境では `MOCKED` も）が **1 件以上**、かつ
 *   - `QUEUED` / `HELD_*` が **0 件**
 * のときだけ `delivered: true`。行が 1 件も無ければ `false`（予告していないものは削除しない）。
 *
 * 🔴 `A-005` 項目 15 の `classifyPurgeNotice` と食い違わせない: 全モック環境では
 *    `delivered === (classifyPurgeNotice(statuses) === null)` かつ「`pendingCount === 0`」が成り立つ
 *    （`packages/db/src/tenant-closing-notice.test.ts` が全部分集合で固定する）。表示は「`SENT` / `MOCKED` が
 *    あれば載せない」だが、削除は「保留が 1 件も残っていない」ことまで要求する（保留中に前の 1 通が届いていても、
 *    その保留分が届く前に消さない）。
 */
export function classifyClosingNoticeDelivery(
  statuses: readonly string[],
  options: ClosingNoticeDeliveryOptions,
): ClosingNoticeDelivery {
  let deliveredCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let suppressedCount = 0;
  let mockedIgnoredCount = 0;
  for (const status of statuses) {
    if (status === 'SENT') deliveredCount += 1;
    else if (status === 'MOCKED') {
      if (options.mockedCountsAsDelivered) deliveredCount += 1;
      else mockedIgnoredCount += 1;
    } else if (status === 'QUEUED' || status.startsWith(HELD_STATUS_PREFIX)) pendingCount += 1;
    else if (status === 'FAILED') failedCount += 1;
    else if (status === 'SUPPRESSED') suppressedCount += 1;
    // 🔴 未知の状態は数えない（CHECK の 7 値以外は来ない。来ても配送済みには倒さない）。
  }
  return {
    delivered: deliveredCount >= 1 && pendingCount === 0,
    deliveredCount,
    pendingCount,
    failedCount,
    suppressedCount,
    mockedIgnoredCount,
    total: statuses.length,
  };
}

// ---------------------------------------------------------------------------
// `dedupeKey` の `targetId`（docs/05 §3.9 の `'{templateKey}:{targetId}:{recipientHash}'`）
// ---------------------------------------------------------------------------

/** `targetId` の区切り。🔴 `:` を使わない（`dedupeKey` 自体の 3 分割の形を壊さない。`scanQuarantineTargetId` と同じ）。 */
const TARGET_ID_SEPARATOR = '#';

export type ClosingNoticeTargetIdInput = {
  readonly tenantId: string;
  readonly phase: TenantClosingNoticePhase;
  /** 起票日の暦日キー（`YYYY-MM-DD`）。🔴 `FAILED` の翌日再起票が `UNIQUE` に当たらないための要素。 */
  readonly dayKey: string;
};

/**
 * `targetId = '{tenantId}#{phase}#{yyyy-mm-dd}'`。
 *
 * 🔴 `tenantId` を含めるのは、`dedupe_key` が**グローバル** `UNIQUE` だからである（同じ日に別テナントの管理者が
 *    同じアドレスであっても衝突しない）。`phase` を含めるのは「未処理」を段ごとに判定するため（接頭辞で引く）。
 */
export function closingNoticeTargetId(input: ClosingNoticeTargetIdInput): string {
  return `${closingNoticeTargetIdPrefix(input)}${input.dayKey}`;
}

/** その `(tenantId, phase)` の全起票日に共通する接頭辞（`'{tenantId}#{phase}#'`）。未処理判定の絞り込みに使う。 */
export function closingNoticeTargetIdPrefix(input: Pick<ClosingNoticeTargetIdInput, 'tenantId' | 'phase'>): string {
  return `${input.tenantId}${TARGET_ID_SEPARATOR}${input.phase}${TARGET_ID_SEPARATOR}`;
}

/**
 * 🔴 `dedupeKey`（`'TENANT_CLOSING_NOTICE:{targetId}:{recipientHash}'`）から段を復元する（`closingNoticeTargetId` の逆）。
 *    差し込み値の組み立て（`email.dispatch` の `resolveTemplateParams`）が本文の段（入った日 / 7 日前）を決める唯一の手掛かり。
 *    形が合わなければ `null`（呼び出し側が例外にする。黙って `ENTERED` に倒さない）。
 */
export function parseClosingNoticeDedupeKey(
  dedupeKey: string,
): { readonly tenantId: string; readonly phase: TenantClosingNoticePhase; readonly dayKey: string } | null {
  const parts = dedupeKey.split(':');
  if (parts.length !== 3 || parts[0] !== TENANT_CLOSING_NOTICE_TEMPLATE_KEY) return null;
  const target = (parts[1] ?? '').split(TARGET_ID_SEPARATOR);
  if (target.length !== 3) return null;
  const [tenantId, phase, dayKey] = target;
  if (tenantId === undefined || tenantId === '' || phase === undefined || dayKey === undefined || dayKey === '') return null;
  if (!isTenantClosingNoticePhase(phase)) return null;
  return { tenantId, phase, dayKey };
}
