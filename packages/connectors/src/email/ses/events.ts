// packages/connectors/src/email/ses/events.ts
// 🔴 SES のバウンス・苦情通知を**内部型に正規化する**（`CLAUDE.md` §3.4「外部 API 応答は
//    生のまま保存せず、正規化した内部型に変換してから永続化する」/ docs/05 §8.5 / docs/03 §3.2.5）。
//
// 🔴 宛先はここで**ハッシュ化する**（docs/05 §16.2 / §8.6 の denylist に `recipientEmail`）。
//    `EmailEvent.payload` に生アドレスが入ると、運営者の監査ログ横断検索（`A-006`）や
//    Sentry 経由でエンドユーザーの PII が漏れる（`CLAUDE.md` §10.5「運営者にも見せないもの」）。
//
// 🔴 未知の形は**握り潰さず例外にする**。`EmailEvent` は `F-059`（運用監視）とテナント別
//    サプレッションの根拠であり、「解釈できなかったので 0 件」は障害を無かったことにする。

import { createHash } from 'node:crypto';

/**
 * SES が発行するイベント種別（configuration set の event destination）。
 * 🔴 `packages/db` の `EMAIL_EVENT_TYPES`（`email_events.event_type` の CHECK）と
 *    **同じ値集合**でなければならない。突合は `tests/static/connector-selection-mirror.test.ts`。
 *    値は SES の実値そのもの（内部語彙に翻訳しない）である。
 */
export const SES_EVENT_TYPES = ['Bounce', 'Complaint', 'Delivery', 'Reject', 'Delay'] as const;

export type SesEventType = (typeof SES_EVENT_TYPES)[number];

/**
 * 正規化済みのメールイベント。
 *
 * 🔴 生アドレスを**持たない**（`recipientHashes` だけ）。型として持てないようにすることで、
 *    「保存する直前に消し忘れる」経路を消す。
 */
export type NormalizedEmailEvent = {
  readonly sesMessageId: string;
  readonly eventType: SesEventType;
  /** 🔴 SES が示す発生時刻。受信時刻ではない（順序逆転の判定に使う。docs/05 §8.5）。 */
  readonly occurredAt: Date;
  /** 宛先の SHA-256（`recipientHash`）。テナント別サプレッションの突合キー。 */
  readonly recipientHashes: readonly string[];
  /** 分類の補足（`bounceType` / `complaintFeedbackType` 等）。🔴 PII を含めない。 */
  readonly diagnostics: Readonly<Record<string, string>>;
};

/** 解釈できない SES 通知（握り潰さず失敗させる）。 */
export class SesEventParseError extends Error {
  constructor(reason: string) {
    super(`SES のイベント通知を解釈できません（${reason}）。`);
    this.name = 'SesEventParseError';
  }
}

/**
 * 宛先アドレスのハッシュ（docs/05 §16.2）。
 * 🔴 小文字化してから取る（`A@example.com` と `a@example.com` を別人にしない）。
 */
export function hashRecipient(address: string): string {
  return createHash('sha256').update(address.trim().toLowerCase(), 'utf8').digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function isSesEventType(value: string): value is SesEventType {
  return (SES_EVENT_TYPES as readonly string[]).includes(value);
}

/** イベント種別ごとの詳細オブジェクトのキー（SES の綴り）。 */
const DETAIL_KEY: Readonly<Record<SesEventType, string>> = {
  Bounce: 'bounce',
  Complaint: 'complaint',
  Delivery: 'delivery',
  Reject: 'reject',
  Delay: 'deliveryDelay',
};

/** 詳細オブジェクトから拾ってよい補足フィールド（🔴 PII になりうるものを列挙しない）。 */
const DIAGNOSTIC_KEYS = [
  'bounceType',
  'bounceSubType',
  'complaintFeedbackType',
  'complaintSubType',
  'delayType',
  'reason',
] as const;

function recipientsOf(detail: Record<string, unknown> | null, mail: Record<string, unknown>): string[] {
  const listKeys = ['bouncedRecipients', 'complainedRecipients', 'delayedRecipients', 'recipients'];
  for (const key of listKeys) {
    const list = detail?.[key];
    if (!Array.isArray(list)) continue;
    const addresses = list
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const record = asRecord(entry);
        return record === null ? null : stringOf(record, 'emailAddress');
      })
      .filter((value): value is string => value !== null);
    if (addresses.length > 0) return addresses;
  }
  // 🔴 詳細が宛先を持たない種別（Delivery / Reject）は `mail.destination` に落ちる。
  const destination = mail.destination;
  if (Array.isArray(destination)) {
    return destination.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function occurredAtOf(detail: Record<string, unknown> | null, mail: Record<string, unknown>): Date {
  const raw = (detail === null ? null : stringOf(detail, 'timestamp')) ?? stringOf(mail, 'timestamp');
  if (raw === null) throw new SesEventParseError('timestamp がありません');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new SesEventParseError('timestamp が日時として不正です');
  return parsed;
}

/**
 * 🔴 SES のイベント JSON（SNS の `Message` を JSON.parse したもの）を正規化する。
 *
 * SES は種別を `eventType`（event destination 経由）または `notificationType`
 * （旧来の SNS 通知）で示す。**どちらでも同じ内部型になる**ようにする ——
 * プロバイダの都合による表記差を、下流（`EmailEvent` / 監視 / サプレッション）に持ち込まない。
 */
export function normalizeSesEvent(raw: unknown): NormalizedEmailEvent {
  const record = asRecord(raw);
  if (record === null) throw new SesEventParseError('オブジェクトではありません');

  const kind = stringOf(record, 'eventType') ?? stringOf(record, 'notificationType');
  if (kind === null) throw new SesEventParseError('eventType / notificationType がありません');
  if (!isSesEventType(kind)) throw new SesEventParseError(`未知の eventType です（${kind}）`);

  const mail = asRecord(record.mail);
  if (mail === null) throw new SesEventParseError('mail がありません');
  const sesMessageId = stringOf(mail, 'messageId');
  if (sesMessageId === null) throw new SesEventParseError('mail.messageId がありません');

  const detail = asRecord(record[DETAIL_KEY[kind]]);
  const diagnostics: Record<string, string> = {};
  if (detail !== null) {
    for (const key of DIAGNOSTIC_KEYS) {
      const value = stringOf(detail, key);
      if (value !== null) diagnostics[key] = value;
    }
  }

  return {
    sesMessageId,
    eventType: kind,
    occurredAt: occurredAtOf(detail, mail),
    recipientHashes: recipientsOf(detail, mail).map(hashRecipient),
    diagnostics,
  };
}

/**
 * 🔴 `WebhookDelivery.payload` に保存する形（docs/05 §3.9「秘匿値は redact 後に保存」/ §16.2）。
 *
 * 🔴 **受信時に正規化してから保存する。** 生の SES イベントには宛先アドレスが入っており、
 *    そのまま保存すると `A-006`（運営者の監査ログ横断検索）や Sentry からエンドユーザーの
 *    PII に到達できてしまう（`CLAUDE.md` §10.5）。ハッシュにした後の形だけを DB に置く。
 */
export type SerializedEmailEvent = {
  readonly sesMessageId: string;
  readonly eventType: SesEventType;
  /** ISO 8601（UTC）。 */
  readonly occurredAt: string;
  readonly recipientHashes: readonly string[];
  readonly diagnostics: Readonly<Record<string, string>>;
};

export function serializeNormalizedEmailEvent(event: NormalizedEmailEvent): SerializedEmailEvent {
  return {
    sesMessageId: event.sesMessageId,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    recipientHashes: [...event.recipientHashes],
    diagnostics: event.diagnostics,
  };
}

/** 保存済みの正規化イベントを読み戻す（`webhook.process` が使う）。 */
export function parseNormalizedEmailEvent(raw: unknown): NormalizedEmailEvent {
  const record = asRecord(raw);
  if (record === null) throw new SesEventParseError('保存済みイベントがオブジェクトではありません');

  const sesMessageId = stringOf(record, 'sesMessageId');
  const eventType = stringOf(record, 'eventType');
  const occurredAtRaw = stringOf(record, 'occurredAt');
  if (sesMessageId === null || eventType === null || occurredAtRaw === null) {
    throw new SesEventParseError('保存済みイベントに必須フィールドがありません');
  }
  if (!isSesEventType(eventType)) throw new SesEventParseError(`未知の eventType です（${eventType}）`);
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) throw new SesEventParseError('occurredAt が日時として不正です');

  const hashes = record.recipientHashes;
  const diagnostics = asRecord(record.diagnostics) ?? {};
  const normalizedDiagnostics: Record<string, string> = {};
  for (const [key, value] of Object.entries(diagnostics)) {
    if (typeof value === 'string') normalizedDiagnostics[key] = value;
  }

  return {
    sesMessageId,
    eventType,
    occurredAt,
    recipientHashes: Array.isArray(hashes)
      ? hashes.filter((value): value is string => typeof value === 'string')
      : [],
    diagnostics: normalizedDiagnostics,
  };
}

/**
 * 🔴 `WebhookDelivery.dedupeKey`（docs/05 §8.5 の表: `ses:{messageId}:{eventType}:{timestamp}`）。
 *
 * SNS は at-least-once であり同じ通知が複数回届く（docs/03 §3.2.5）。3 要素を含めることで
 * 「同じメールの同じ種別の同じ時刻」だけが重複と判定される（別のバウンスは別の行になる）。
 */
export function sesWebhookDedupeKey(event: NormalizedEmailEvent): string {
  return `ses:${event.sesMessageId}:${event.eventType}:${event.occurredAt.toISOString()}`;
}
