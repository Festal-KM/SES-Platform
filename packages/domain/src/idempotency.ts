// packages/domain/src/idempotency.ts
// 外部送信の冪等性キーと予約トークン（docs/05 §10.1 / §10.2 / docs/03 §4.7 / CLAUDE.md §3.4）。T-09-05。
//
// 🔴 なぜ packages/domain に置くか（docs/05 §10.1「トークン型の宣言場所」/ T-04-01 の申し送り）:
//    トークンは `packages/db` が**発行**し、`packages/connectors` の送信関数が**必須引数として受け取る**。
//    両パッケージは相互に依存できない（CLAUDE.md §2.1）ため、共有点は domain しか無い
//    （`RecipientClass` / `ScanStatus` / `AiRole` と同じ整理）。T-04-01 が `packages/connectors/src/types.ts` に
//    置いていた暫定の宣言は、本ファイルへの re-export に置き換えた（二重宣言の解消）。
//
// 🔴 純粋関数である。乱数・現在時刻・I/O を持ち込まない（`tests/static/domain-purity.test.ts`）。
//    冪等性キーが**決定的**であること（同じ入力に同じ出力）は、この規律の直接の帰結である。

/**
 * `SendAttempt` の対象エンティティ（docs/05 §3.9 / §10.1）。
 *
 * 🔴 **`send_attempts.entity_type` の CHECK 制約と同じ値集合でなければならない**
 *    （`tests/static/schema-enum-drift.test.ts` が migration.sql と突合する。`packages/db` の
 *    `SEND_ATTEMPT_ENTITY_TYPES` は本定数の re-export であり、独自に宣言しない）。
 *    ジョブ名は `send.interview-invite` だが、エンティティ種別は `'INTERVIEW'` である。混同しない。
 */
export const SEND_ENTITY_TYPES = ['PROPOSAL', 'INTERVIEW', 'CONTRACT'] as const;

export type SendEntityType = (typeof SEND_ENTITY_TYPES)[number];

export function isSendEntityType(value: string): value is SendEntityType {
  return (SEND_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * 🔴 冪等性キーの生成規約（docs/05 §10.1 / docs/03 §4.7 / `program-design` 申し送り 3）。
 *
 *   `${entityType.toLowerCase()}:${entityId}:${attemptSeq}`   例: `'proposal:018f…:1'`
 *
 * 🔴 **決定的である。乱数 UUID にしない。** 乱数だと「同じ送信の再実行」（同じキー = 送らない）と
 *    「人間が意図した再送」（新しい `attemptSeq` = 新しいキー）が区別できず、キーとして機能しない。
 * 🔴 `attemptSeq` は **1 以上の整数**。人間の明示的な再送でのみ増える（採番は `packages/db` の
 *    `nextSendAttemptSeq`。ジョブはここに渡す値を自分で採番しない。docs/05 §10.6）。
 *
 * @throws {InvalidIdempotencyKeyInputError} `entityId` が空、または `attemptSeq` が正の整数でないとき。
 *   黙って `'proposal::0'` のようなキーを返すと、`UNIQUE(idempotency_key)` が別の対象同士で衝突し
 *   （= 別の送信が「送信済み」に見える）、防御線が逆に事故を隠す。
 */
export function idempotencyKey(entityType: SendEntityType, entityId: string, attemptSeq: number): string {
  if (!isSendEntityType(entityType)) {
    throw new InvalidIdempotencyKeyInputError(`entityType が不正です: ${String(entityType)}`);
  }
  if (entityId.length === 0 || entityId.includes(':')) {
    throw new InvalidIdempotencyKeyInputError('entityId は空でなく、区切り文字 ":" を含んではなりません');
  }
  if (!isValidAttemptSeq(attemptSeq)) {
    throw new InvalidIdempotencyKeyInputError(`attemptSeq は 1 以上の整数です: ${String(attemptSeq)}`);
  }
  return `${entityType.toLowerCase()}:${entityId}:${attemptSeq}`;
}

/** `attempt_seq` として許される値（1 以上の整数）。 */
export function isValidAttemptSeq(attemptSeq: number): boolean {
  return Number.isInteger(attemptSeq) && attemptSeq >= 1;
}

export class InvalidIdempotencyKeyInputError extends Error {
  constructor(detail: string) {
    super(`冪等性キーを組み立てられません（docs/05 §10.1）: ${detail}`);
    this.name = 'InvalidIdempotencyKeyInputError';
  }
}

// --- 送信の予約トークン（docs/05 §10.1 / §10.2）-----------------------------

declare const SendAttemptTokenBrand: unique symbol;

/**
 * 🔴 **外部から構築できない**（docs/05 §10.1 / §10.2）。`SendAttempt` の INSERT（`status='RESERVED'`）に
 *    成功したときだけ `packages/db` の `reserveSendAttempt` が返す。**他に生成経路が無い。**
 *    `EmailSender.send` / `EsignProvider.createAndSend` が必須引数に取るため、
 *    **予約を経ない外部送信はコンパイルできない**（docs/03 `program-design` 申し送り 3）。
 *
 * 🔴 ブランドは export しない（`declare const` のモジュール内シンボル）。したがってこの型の値を作る手段は
 *    `as SendAttemptToken` の型アサーションだけであり、その記述が `packages/db/src/send.ts` 以外に無いことを
 *    `tests/static/send-attempt-token-single-path.test.ts` が走査する（`MaskedText` と同じ規律）。
 */
export type SendAttemptToken = {
  readonly idempotencyKey: string;
  readonly attemptSeq: number;
  readonly entityType: SendEntityType;
  readonly entityId: string;
  readonly [SendAttemptTokenBrand]: true;
};

declare const DispatchTokenBrand: unique symbol;

/**
 * 🔴 運用メール（`email.dispatch` / `account.mail`）用のトークン（docs/05 §9.4）。`EmailDispatch` 行の作成に
 *    成功したときだけ `packages/db` の予約結果から作る（`packages/connectors` の `dispatchTokenFor`）。
 *    `dedupeKey` の `UNIQUE` が「再試行しても 1 通」を担保する。
 */
export type DispatchToken = {
  readonly dispatchId: string;
  readonly dedupeKey: string;
  readonly [DispatchTokenBrand]: true;
};

declare const MeterSubmissionTokenBrand: unique symbol;

/** 🔴 `BillingMeterSubmission` に INSERT できた実行だけが Stripe を呼ぶ（docs/05 §9.8 / §10.7）。 */
export type MeterSubmissionToken = {
  readonly submissionId: string;
  readonly identifier: string;
  readonly [MeterSubmissionTokenBrand]: true;
};
