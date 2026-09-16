// apps/web/lib/proposals/send-failure-rows.ts
// `S-022` 送信失敗一覧の表示値の組み立て（docs/04 §S-022 / `F-023` / `F-024 AC-2` / docs/05 §10.6 / §15.4）。T-09-08。
//
// 🔴 画面（`app/(main)/proposals/send-failures/**`）ではなくここに置く理由は `approval-rows.ts` と同じ: `app/**` はユニットテストの
//    対象外であり、「応答不明が失敗と同じ語にならない」「3 回超で運営への案内が付く」「`RESERVATION_CONFLICT` は試行の確認を促す」
//    を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 **失敗の種別（`failureKind`）は `SendAttempt.failure_kind` / `proposals.last_failure_reason` のオープンな文字列**
//    （docs/05 §15.4 の分類 `PERMANENT:<code>` / `TRANSIENT:<code>` / `UNKNOWN:<code>` と、送信ジョブ固有の `PROVIDER_QUOTA` /
//    `DOMAIN_UNVERIFIED` / `RESERVATION_CONFLICT`）。画面の語（`docs/04` §S-022「失敗理由の語」6 つ + 競合）に**畳む**のはここだけ。
//    🔴 **「応答不明」を「失敗」と同じ語にしない** —— 再送の判断が変わる（届いている可能性が最も高い区分）。
import { t, type MessageKey } from '@ses/i18n';
import { formatDateTimeJst } from '../format/datetime';
import { formatThousands } from '../format/number';
import { formatElapsed } from './approval-rows';
import { proposalApproveHref, SENDING_DOMAIN_SETTINGS_HREF } from './hrefs';
import type { ProposalSendFailureView, SendFailureAttemptView } from './send-failures';

/** 画面の失敗理由の区分（`docs/04` §S-022「失敗理由の語」+ `RESERVATION_CONFLICT` + 記録なし + その他）。 */
export type SendFailureCategory =
  | 'UNKNOWN'
  | 'DOMAIN_UNVERIFIED'
  | 'AUTH'
  | 'RECIPIENT'
  | 'RATE'
  | 'PROVIDER'
  | 'RESERVATION_CONFLICT'
  | 'OTHER'
  | 'NONE';

const CATEGORY_MESSAGE_KEYS = {
  UNKNOWN: 'sendFailures.failureKind.UNKNOWN',
  DOMAIN_UNVERIFIED: 'sendFailures.failureKind.DOMAIN_UNVERIFIED',
  AUTH: 'sendFailures.failureKind.AUTH',
  RECIPIENT: 'sendFailures.failureKind.RECIPIENT',
  RATE: 'sendFailures.failureKind.RATE',
  PROVIDER: 'sendFailures.failureKind.PROVIDER',
  RESERVATION_CONFLICT: 'sendFailures.failureKind.RESERVATION_CONFLICT',
  OTHER: 'sendFailures.failureKind.OTHER',
  NONE: 'sendFailures.failureKind.NONE',
} as const satisfies Record<SendFailureCategory, MessageKey>;

/** 🔴 「繰り返し失敗しています。運営に問い合わせてください」を添える試行回数の閾値（`docs/04` §S-022「3 回を超えた行」）。 */
export const REPEATED_FAILURE_THRESHOLD = 3;

/** SES の恒久エラーのうち、送信アカウント側の問題（`docs/03` §3.2.9）。画面の語は「認証エラー」。 */
const AUTH_PROVIDER_CODES = new Set(['AccountSuspendedException', 'SendingPausedException']);
/** 宛先・内容の拒否。画面の語は「宛先アドレスが無効」。 */
const RECIPIENT_PROVIDER_CODES = new Set(['MessageRejected', 'BadRequestException', 'NotFoundException']);
/** 受理されなかったスロットリング / 上限（`packages/connectors` の `THROTTLED_CODES` と同じ語）。 */
const RATE_PROVIDER_CODES = new Set(['ThrottlingException', 'TooManyRequestsException', 'LimitExceededException']);

/**
 * `failureKind` を画面の区分に畳む（純粋関数）。
 * - `null` … 記録なし（`NONE`。`SUBMIT_FAILED` なのに `last_failure_reason` が無い = 想定外だが黙って「その他」にしない）
 * - `UNKNOWN` / `UNKNOWN:<name>` … 🔴 応答不明（届いたか分からない）
 * - `DOMAIN_UNVERIFIED` / `PERMANENT:MailFromDomainNotVerifiedException` … 送信元ドメインが未検証
 * - `RESERVATION_CONFLICT` … ④ の競合（この実行では外部を呼んでいない。既存の試行の記録を確認してから）
 * - `PROVIDER_QUOTA` / `TRANSIENT:<スロットリング>` … 送信上限に達した
 * - `PERMANENT:<アカウント停止>` … 認証エラー / `PERMANENT:<宛先・内容の拒否>` … 宛先アドレスが無効
 * - `TRANSIENT:<その他>` … 外部サービスの障害 / それ以外 … その他
 */
export function classifySendFailureKind(kind: string | null): SendFailureCategory {
  if (kind === null || kind.trim().length === 0) return 'NONE';
  if (kind === 'UNKNOWN' || kind.startsWith('UNKNOWN:')) return 'UNKNOWN';
  if (kind === 'DOMAIN_UNVERIFIED' || kind === 'PERMANENT:MailFromDomainNotVerifiedException') return 'DOMAIN_UNVERIFIED';
  if (kind === 'RESERVATION_CONFLICT') return 'RESERVATION_CONFLICT';
  if (kind === 'PROVIDER_QUOTA') return 'RATE';
  const separator = kind.indexOf(':');
  const family = separator === -1 ? kind : kind.slice(0, separator);
  const code = separator === -1 ? '' : kind.slice(separator + 1);
  if (family === 'PERMANENT') {
    if (AUTH_PROVIDER_CODES.has(code)) return 'AUTH';
    if (RECIPIENT_PROVIDER_CODES.has(code)) return 'RECIPIENT';
    return 'OTHER';
  }
  if (family === 'TRANSIENT') return RATE_PROVIDER_CODES.has(code) ? 'RATE' : 'PROVIDER';
  return 'OTHER';
}

export function sendFailureCategoryLabel(category: SendFailureCategory): string {
  return t(CATEGORY_MESSAGE_KEYS[category]);
}

/** `SendAttempt.status`（`SEND_ATTEMPT_STATUSES`。DB の CHECK が保証する 4 値）。 */
export type SendFailureAttemptStatus = 'RESERVED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

const ATTEMPT_STATUS_MESSAGE_KEYS = {
  RESERVED: 'sendFailures.attempt.status.RESERVED',
  SUCCEEDED: 'sendFailures.attempt.status.SUCCEEDED',
  FAILED: 'sendFailures.attempt.status.FAILED',
  UNKNOWN: 'sendFailures.attempt.status.UNKNOWN',
} as const satisfies Record<SendFailureAttemptStatus, MessageKey>;

/** 試行 1 件の表示値（`docs/04` §S-022 詳細パネル / 再送の確認ステップ）。 */
export type SendFailureAttemptRowView = {
  readonly seq: number;
  readonly status: SendFailureAttemptStatus;
  readonly statusLabel: string;
  /** その試行自身の失敗理由（`RESERVED` / `SUCCEEDED` は `null`）。 */
  readonly failureLabel: string | null;
  readonly settledAt: string | null;
  /** 送信基盤側の ID（`SUCCEEDED` のときだけ。無ければ描かない）。 */
  readonly externalId: string | null;
};

function attemptRow(attempt: SendFailureAttemptView): SendFailureAttemptRowView {
  // 🔴 status は send_attempts の CHECK が保証する 4 値（SendFailureAttemptStatus）。
  const status = attempt.status as SendFailureAttemptStatus;
  return {
    seq: attempt.attemptSeq,
    status,
    statusLabel: t(ATTEMPT_STATUS_MESSAGE_KEYS[status]),
    failureLabel: attempt.failureKind === null ? null : sendFailureCategoryLabel(classifySendFailureKind(attempt.failureKind)),
    settledAt: attempt.settledAt === null ? null : formatDateTimeJst(attempt.settledAt),
    externalId: attempt.externalId,
  };
}

/** `S-022` の 1 行の表示値。 */
export type SendFailureRowView = {
  readonly id: string;
  readonly recipient: string;
  readonly engineer: string;
  readonly project: string;
  /** 提示単価（確認ダイアログの再掲用。未設定は `valueNone`）。 */
  readonly unitPrice: string;
  readonly failureCategory: SendFailureCategory;
  readonly failureLabel: string;
  /** 種別コード（`failureKind` の生値。運営への問い合わせに使う。PII を含まない）。 */
  readonly failureKindRaw: string | null;
  /** 🔴 応答不明 = 届いている可能性が最も高い区分。画面は失敗と別の見た目で描く。 */
  readonly deliveryUnknown: boolean;
  readonly lastAttemptAtIso: string;
  readonly lastAttemptAt: string;
  readonly elapsed: string;
  readonly attemptCount: number;
  readonly attemptCountLabel: string;
  /** 試行ごとの記録（`attemptSeq` 昇順）。詳細パネルと再送の確認ステップの両方に描く。 */
  readonly attempts: readonly SendFailureAttemptRowView[];
  /** 🔴 3 回超（`REPEATED_FAILURE_THRESHOLD`）。運営への問い合わせを添える。 */
  readonly repeated: boolean;
  /** 行に添える注記（応答不明 / 競合 / 繰り返し）。順序は固定。 */
  readonly notes: readonly string[];
  readonly approveHref: string;
  /** `DOMAIN_UNVERIFIED` のときだけ `S-036` への導線。 */
  readonly sendingDomainHref: string | null;
};

function none(): string {
  return t('sendFailures.valueNone');
}

/** 最終試行の時刻（確定時刻 → 開始時刻 → 失敗の確定時刻、の順で最初にあるもの）。 */
function lastAttemptAtOf(item: ProposalSendFailureView): string {
  const last = item.attempts.at(-1);
  return last?.settledAt ?? last?.startedAt ?? item.failedAt;
}

export function sendFailureRow(item: ProposalSendFailureView, now: Date): SendFailureRowView {
  const failureCategory = classifySendFailureKind(item.lastFailureReason);
  const lastAttemptAtIso = lastAttemptAtOf(item);
  const attemptCount = item.attempts.length;
  const repeated = attemptCount > REPEATED_FAILURE_THRESHOLD;
  const notes: string[] = [];
  if (failureCategory === 'UNKNOWN') notes.push(t('sendFailures.note.unknown'));
  if (failureCategory === 'RESERVATION_CONFLICT') notes.push(t('sendFailures.note.reservationConflict'));
  if (repeated) notes.push(t('sendFailures.note.repeated'));
  // 🔴 応答不明（区分 UNKNOWN）に加え、②競合時は「勝った側の試行」が実は届いている可能性がある
  //    （`RESERVATION_CONFLICT` は自分は外部を呼んでいない）、③試行の記録に `RESERVED` / `SUCCEEDED` /
  //    `UNKNOWN` が残っていれば、いずれも「失敗と決めつけない」対象（琥珀）。
  const deliveryUnknown =
    failureCategory === 'UNKNOWN' ||
    item.lastFailureReason === 'RESERVATION_CONFLICT' ||
    item.attempts.some((attempt) => attempt.status === 'RESERVED' || attempt.status === 'SUCCEEDED' || attempt.status === 'UNKNOWN');
  return {
    id: item.id,
    recipient: item.recipientCompanyName.trim().length === 0 ? none() : item.recipientCompanyName,
    engineer: item.engineerDisplayName ?? none(),
    project: item.projectName ?? none(),
    unitPrice: item.offeredUnitPrice === null ? none() : formatThousands(item.offeredUnitPrice),
    failureCategory,
    failureLabel: sendFailureCategoryLabel(failureCategory),
    failureKindRaw: item.lastFailureReason,
    deliveryUnknown,
    lastAttemptAtIso,
    lastAttemptAt: formatDateTimeJst(lastAttemptAtIso),
    elapsed: formatElapsed(item.failedAt, now),
    attemptCount,
    attemptCountLabel: `${formatThousands(attemptCount)}${t('sendFailures.attemptCountSuffix')}`,
    attempts: item.attempts.map(attemptRow),
    repeated,
    notes,
    approveHref: proposalApproveHref(item.id),
    sendingDomainHref: failureCategory === 'DOMAIN_UNVERIFIED' ? SENDING_DOMAIN_SETTINGS_HREF : null,
  };
}

export function sendFailureRows(items: readonly ProposalSendFailureView[], now: Date): readonly SendFailureRowView[] {
  return items.map((item) => sendFailureRow(item, now));
}

/** セクション 1「未対応の件数と最も古い経過時間」（`docs/04` §S-022）。 */
export type SendFailureSummaryView = {
  readonly count: number;
  readonly countLabel: string;
  /** 最も古い失敗からの経過（0 件なら `null`）。 */
  readonly oldestElapsed: string | null;
};

export function sendFailureSummary(items: readonly ProposalSendFailureView[], now: Date): SendFailureSummaryView {
  // 🔴 一覧は `updated_at` 昇順（失敗が古い順）なので先頭が最古。並びに依存しない形で最小値を取る。
  const oldest = items.reduce<string | null>(
    (acc, item) => (acc === null || item.failedAt < acc ? item.failedAt : acc),
    null,
  );
  return {
    count: items.length,
    countLabel: `${t('sendFailures.summary.countPrefix')}${formatThousands(items.length)}${t('sendFailures.summary.countSuffix')}`,
    oldestElapsed: oldest === null ? null : `${t('sendFailures.summary.oldestPrefix')}${formatElapsed(oldest, now)}`,
  };
}
