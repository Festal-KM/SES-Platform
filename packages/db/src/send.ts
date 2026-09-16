// packages/db/src/send.ts
// 🔴 `SendAttempt`（docs/05 §3.9 / §10.1 / §10.2 ④⑥ / §10.6 / docs/03 §4.7 / `CLAUDE.md` §3.4）を書く**唯一の経路**。T-09-05。
//
// ============================================================================
// 🔴 なぜここに閉じるのか
// ============================================================================
// 外部 API（Amazon SES / 電子署名）には冪等性キーの受け口が無い（docs/03 §3.1.4 / `U-1`）。したがって
// 「取引先への二重送信」（`CLAUDE.md` §7 の 0 件）を止めているのは、状態の CAS（`castProposalToSubmitting`。T-09-04）と
// **`send_attempts` の 2 本の `UNIQUE`**（`(entity_type, entity_id, attempt_seq)` / `idempotency_key`）だけである。
// この `UNIQUE` を迂回する INSERT が 1 箇所でもあれば防御線は消えるので、「`send_attempts` に書く」操作は本ファイル以外に
// 存在しない形にする（`email-dispatch.ts` が `EmailDispatch` に対して採るのと同じ規律）。
//
// ============================================================================
// 🔴 `attempt_seq` の規律（docs/05 §10.1 / §10.6）—— 関数の形で表す
// ============================================================================
//   ① **人間の明示操作でしか増えない。** 採番は `nextSendAttemptSeq(ctx: HumanTenantCtx, …)` だけが行う
//      （`MAX(attempt_seq) + 1`。連番なので docs/05 §10.1 の「既存行数 + 1」と同値。行が消されても衝突しない）。
//      引数の型が `HumanTenantCtx`（`job` を持たない = `SystemTenantCtx` を渡せない）であり、呼び出し元は
//      `apps/web/**`（#43 / #44 / #60 / #61）に限る（`tests/static/auth-db-callers.test.ts`。`apps/worker/**` は 0 件）。
//   ② **ジョブは採番しない。** `reserveSendAttempt(ctx: SystemTenantCtx, …)` は、ジョブ payload が運んできた値
//      （`SendAttemptOrigin`）をそのまま INSERT する。`INITIAL` は `attempt_seq = 1` 固定、`RESEND` は採番済みの
//      `attemptSeq`（2 以上）と **`requestedBy`（人間）が必須**。「ジョブの中で数えて +1 する」実装は書けない ——
//      書けると、確定済みの試行の後にジョブが再実行されただけで新しい行（= 新しいキー = もう 1 通）が生まれる。
//   ③ **同じ試行の再実行は 1 行に収束する。** 同じ `(entity_type, entity_id, attempt_seq)` の 2 回目の INSERT は
//      `ON CONFLICT DO NOTHING` で 0 行になり、`ALREADY_RESERVED` として返る（例外にしない。呼び出し側は外部 API を
//      呼ばずに終了する。docs/05 §10.2 ④）。トークンは INSERT が 1 行返ったときだけ作る（**唯一の生成経路**）。
//
// 🔴 確定（`settleSendAttempt`）は `RESERVED` からの CAS（`WHERE status = 'RESERVED'`）である。0 件更新は
//    「既に確定済み」であり、`ALREADY_SETTLED` として返す（`SUBMITTING` は片道。`CLAUDE.md` §4.2）。
//    `RESERVED` へ戻す関数は存在しない。
//
// 🔴 分離キーは ctx から取る（`CLAUDE.md` §3.1）。`send_attempts` は C2 HOST_ONLY（docs/05 §4.4）であり、
//    RLS が母集団を決める。ジョブ文脈（`SystemTenantCtx`）は常にホスト相当である。
import { Prisma } from '@prisma/client';
import { idempotencyKey, isValidAttemptSeq, type SendAttemptToken, type SendEntityType } from '@ses/domain';
import { SYSTEM_ACTOR_ID, type AuthenticatedTenantCtx, type SystemTenantCtx } from './context.js';
import type { SendAttemptStatus } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

/** 送信の対象（`SendAttempt` の `(entity_type, entity_id)`）。 */
export type SendTarget = {
  readonly entityType: SendEntityType;
  readonly entityId: string;
};

/**
 * 🔴 人間の操作の文脈。`SystemTenantCtx`（`job` を持つ）は**構造的に渡せない**。
 *    `nextSendAttemptSeq` の引数型であり、「`attempt_seq` は人間の明示操作でしか増えない」（docs/05 §10.6）を型で表す。
 *    `resolveTenantCtx` が返す `AuthenticatedTenantCtx` は `job` を持たないのでそのまま渡せる。
 */
export type HumanTenantCtx = AuthenticatedTenantCtx & { readonly job?: undefined };

/** 初回の送信（#43 / #60）の `attempt_seq`。 */
export const INITIAL_SEND_ATTEMPT_SEQ = 1;

/**
 * 🔴 この試行が「どの人間の操作に由来するか」（docs/05 §10.6「`attempt_seq` の採番」）。ジョブ payload が運ぶ。
 *
 * - `INITIAL` … 初回の送信。`attempt_seq = 1`、`requested_by = NULL`（system）
 * - `RESEND` … 🔴 人間の明示的な再送（#44 / #61。`acknowledged: true` を経ている）。`attemptSeq` は
 *   `nextSendAttemptSeq` が採番した 2 以上の値、`requestedBy` は指示した人間の `User.id`（必須）
 *
 * `attemptSeq: number` を裸で受ける形にしない —— 2 以上の値が `requestedBy` 無しで INSERT される経路を型で塞ぐ。
 */
export type SendAttemptOrigin =
  | { readonly kind: 'INITIAL' }
  | { readonly kind: 'RESEND'; readonly attemptSeq: number; readonly requestedBy: string };

export type ReserveSendAttemptInput = SendTarget & {
  readonly origin: SendAttemptOrigin;
  /** 🔴 現在時刻は呼び出し側から渡す（`packages/domain` と同じ規律。`started_at` と行 ID の時刻）。 */
  readonly now: Date;
};

/** `send_attempts` の 1 行（読み取り用。`S-022` / 送信ジョブの事前判定）。 */
export type SendAttemptView = {
  readonly attemptSeq: number;
  readonly idempotencyKey: string;
  readonly status: SendAttemptStatus;
  readonly externalId: string | null;
  readonly failureKind: string | null;
  readonly failureDetail: string | null;
  readonly startedAt: Date;
  readonly settledAt: Date | null;
  readonly requestedBy: string | null;
};

/**
 * 予約の帰結。
 *
 * - `RESERVED` … 行を作った。**外部 API を呼んでよいのはこの場合だけ**（`token` を送信関数に渡す）
 * - `ALREADY_RESERVED` … 🔴 同じ `(entity_type, entity_id, attempt_seq)` または同じ `idempotency_key` の行が既にある
 *   （= 同じ試行が既に送信中 / 送信済み / 確定済み）。**外部 API を呼ばずに終了する**（docs/05 §10.2 ④）。
 *   `existing` は既存の行（呼び出し側が「送信中なのか確定済みなのか」を見て後始末を決める）
 */
export type SendAttemptReservation =
  | { readonly outcome: 'RESERVED'; readonly token: SendAttemptToken }
  | { readonly outcome: 'ALREADY_RESERVED'; readonly existing: SendAttemptView };

/**
 * 確定の内容（docs/05 §10.2 ⑥ / §10.6）。
 *
 * 🔴 `failureKind` / `failureDetail` に**トークン・宛先・本文・氏名を載せない**（`CLAUDE.md` §3.4 / docs/05 §16.2）。
 *    載せてよいのは §15.4 の分類と、正規化済みの短い説明だけである（外部 API の応答本文をそのまま入れない）。
 */
export type SendAttemptSettlement =
  | { readonly status: 'SUCCEEDED'; readonly externalId: string }
  | { readonly status: 'FAILED'; readonly failureKind: string; readonly failureDetail?: string }
  /** 応答不明（タイムアウト / 接続断）。🔴 隔離状態であり、自動再送しない（docs/05 §10.6）。 */
  | { readonly status: 'UNKNOWN'; readonly failureKind: string; readonly failureDetail?: string };

export type SettleSendAttemptInput = SendAttemptSettlement & {
  readonly now: Date;
};

/**
 * 確定の帰結。
 *
 * - `SETTLED` … `RESERVED → {SUCCEEDED|FAILED|UNKNOWN}` を 1 件更新した
 * - `ALREADY_SETTLED` … 既に確定済み（CAS が 0 件）。**上書きしない**（確定は 1 回）
 * - `NOT_FOUND` … 行が見えない（RLS の C2 で 0 件 = 境界外 / 不存在。区別しない。docs/05 §4.8）
 */
export type SendAttemptSettlementOutcome =
  | { readonly outcome: 'SETTLED' }
  | { readonly outcome: 'ALREADY_SETTLED'; readonly status: SendAttemptStatus }
  | { readonly outcome: 'NOT_FOUND' };

/** `failure_detail` の上限（外部応答の本文を丸ごと入れる実装を実行時にも止める）。 */
const FAILURE_DETAIL_MAX_LENGTH = 500;

type SendAttemptRow = {
  readonly attempt_seq: number;
  readonly idempotency_key: string;
  readonly status: string;
  readonly external_id: string | null;
  readonly failure_kind: string | null;
  readonly failure_detail: string | null;
  readonly started_at: Date;
  readonly settled_at: Date | null;
  readonly requested_by: string | null;
};

type IdRow = { readonly id: string };

/**
 * 🔴 `SendAttemptOrigin` が規律に反している（`RESEND` なのに `attemptSeq < 2`、または `requestedBy` が空）。
 *    実装バグであり、黙って 1 に丸めたり `NULL` で書いたりしない —— 丸めると「人間が指示していない再送」が
 *    記録上は初回として残る。
 */
export class SendAttemptOriginError extends Error {
  constructor(detail: string) {
    super(`SendAttempt の由来が不正です（docs/05 §10.6「attempt_seq は人間の明示操作でのみ増える」）: ${detail}`);
    this.name = 'SendAttemptOriginError';
  }
}

/**
 * 🔴 `idempotency_key` または `(entity_type, entity_id, attempt_seq)` が**自テナントの外**の行と衝突した
 *    （`UNIQUE` はグローバルであり、RLS で自分には見えない）。`entity_id` は UUID なので通常は起こりえず、
 *    ctx と対象の組み立てが誤っている実装バグである。握り潰して送らない・別のキーで送らない
 *    （`EmailDispatchConflictError` と同じ扱い）。
 */
export class SendAttemptConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(
      'SendAttempt の冪等性キーが既存の行と衝突しました（自テナントからは参照できません）。' +
        '対象 ID と ctx の組み立てを確認してください（docs/05 §10.1）。',
    );
    this.name = 'SendAttemptConflictError';
  }
}

function attemptSeqOf(origin: SendAttemptOrigin): number {
  if (origin.kind === 'INITIAL') return INITIAL_SEND_ATTEMPT_SEQ;
  if (!isValidAttemptSeq(origin.attemptSeq) || origin.attemptSeq <= INITIAL_SEND_ATTEMPT_SEQ) {
    throw new SendAttemptOriginError(`RESEND の attemptSeq は 2 以上の整数です: ${String(origin.attemptSeq)}`);
  }
  if (origin.requestedBy.length === 0) {
    throw new SendAttemptOriginError('RESEND には指示した人間（requestedBy）が必須です');
  }
  return origin.attemptSeq;
}

function toView(row: SendAttemptRow): SendAttemptView {
  return {
    attemptSeq: row.attempt_seq,
    idempotencyKey: row.idempotency_key,
    status: row.status as SendAttemptStatus,
    externalId: row.external_id,
    failureKind: row.failure_kind,
    failureDetail: row.failure_detail,
    startedAt: row.started_at,
    settledAt: row.settled_at,
    requestedBy: row.requested_by,
  };
}

const VIEW_COLUMNS = Prisma.sql`attempt_seq, idempotency_key, status, external_id, failure_kind, failure_detail,
         started_at, settled_at, requested_by::text AS requested_by`;

async function findByKeyOrTriple(
  tx: TenantTransactionClient,
  target: SendTarget,
  attemptSeq: number,
  key: string,
): Promise<SendAttemptView | null> {
  const rows = await tx.$queryRaw<SendAttemptRow[]>(Prisma.sql`
    SELECT ${VIEW_COLUMNS}
      FROM send_attempts
     WHERE idempotency_key = ${key}
        OR (entity_type = ${target.entityType} AND entity_id = ${target.entityId}::uuid AND attempt_seq = ${attemptSeq}::int)
     ORDER BY attempt_seq ASC
     LIMIT 1`);
  const row = rows[0];
  return row === undefined ? null : toView(row);
}

// ============================================================================
// 採番（人間の明示操作だけ。docs/05 §10.1 / §10.6）
// ============================================================================

/**
 * 🔴 次の `attempt_seq` を採番する。**読むだけで行は作らない**（行を作るのは送信ジョブの `reserveSendAttempt`）。
 *
 * - 初回（行が無い）は `1`。`SendAttemptOrigin` は `INITIAL`
 * - 2 以上なら **人間の再送**であり、呼び出し側（#44 / #61）は `acknowledged: true` を経て
 *   `{ kind: 'RESEND', attemptSeq, requestedBy: ctx.userId }` をジョブ payload に載せる
 *
 * 🔴 引数は `HumanTenantCtx`。ジョブ文脈（`SystemTenantCtx`）は型として渡せず、実行時にも `SYSTEM_ACTOR_ID` を弾く。
 *    呼び出し元は `apps/web/**` に限る（`tests/static/auth-db-callers.test.ts`）。
 */
export async function nextSendAttemptSeq(ctx: HumanTenantCtx, target: SendTarget): Promise<number> {
  if (ctx.userId === SYSTEM_ACTOR_ID) {
    throw new SendAttemptOriginError('attempt_seq の採番は人間の操作の文脈でしか行えません');
  }
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) => nextSendAttemptSeqInTx(tx, target),
  );
}

/**
 * 🔴 採番の **1 実装**（`MAX(attempt_seq) + 1`）。`nextSendAttemptSeq`（人間の操作）と、T-09-06 の
 *    `resolveProposalSendResumeOrigin`（`proposal-send.ts`。保留からの自動復帰が「人間が採番した同じ値」を復元する）
 *    が共有する。🔴 復帰は**採番ではない** —— 保留は ④（`reserveSendAttempt`）に到達していないため行が無く、
 *    人間が #43 / #44 で採番した値 = `MAX + 1` のままである（docs/05 §10.4「同じ `attemptSeq` で再 enqueue」）。
 *    式を 2 箇所に書くと片方だけがずれ、復帰したジョブが別の試行として INSERT される（= もう 1 通）。
 * @internal `packages/db` の内側からのみ使う（index.ts から export しない）。
 */
export async function nextSendAttemptSeqInTx(tx: TenantTransactionClient, target: SendTarget): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ readonly next_seq: number }>>(Prisma.sql`
    SELECT (COALESCE(MAX(attempt_seq), 0) + 1)::int AS next_seq
      FROM send_attempts
     WHERE entity_type = ${target.entityType}
       AND entity_id = ${target.entityId}::uuid`);
  return rows[0]?.next_seq ?? INITIAL_SEND_ATTEMPT_SEQ;
}

// ============================================================================
// 予約（docs/05 §10.2 ④）。`SendAttemptToken` の唯一の生成経路
// ============================================================================

/**
 * 🔴 `SendAttempt` を `RESERVED` で INSERT し、成功したときだけ `SendAttemptToken` を返す。
 *
 * 🔴 **`SystemTenantCtx` 限定。** 予約は送信ジョブ（`send.proposal` / `send.contract` / `send.interview-invite`）の
 *    ④ でだけ起きる。`apps/web` は `SystemTenantCtx` を組み立てられない。
 * 🔴 呼ぶ前に状態の CAS（`castProposalToSubmitting`。§10.2 ③）が 1 件更新であること。順序 ③ → ④ → ⑤ は
 *    送信ジョブの 1 入口（`runExternalSend`。T-09-06）が担い、ここでは提案の状態に触れない。
 * 🔴 `ON CONFLICT DO NOTHING`（読んでから書かない）。同じ試行の並行実行は静かに 1 行へ収束し、負けた側は
 *    `ALREADY_RESERVED` を受けて**外部 API を呼ばずに終了する**。一意制約違反を例外として伝播させない ——
 *    伝播すると呼び出し側が「失敗」として扱い、`SUBMIT_FAILED` → 人間の再送 → もう 1 通、という経路を誘発する。
 */
export async function reserveSendAttempt(
  ctx: SystemTenantCtx,
  input: ReserveSendAttemptInput,
): Promise<SendAttemptReservation> {
  const attemptSeq = attemptSeqOf(input.origin);
  const requestedBy = input.origin.kind === 'RESEND' ? input.origin.requestedBy : null;
  const key = idempotencyKey(input.entityType, input.entityId, attemptSeq);
  const id = uuidV7(input.now);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<SendAttemptReservation> => {
      const inserted = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        INSERT INTO send_attempts
          (id, tenant_id, entity_type, entity_id, attempt_seq, idempotency_key, status, started_at, requested_by)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.entityType}, ${input.entityId}::uuid, ${attemptSeq}::int,
           ${key}, 'RESERVED', ${input.now}::timestamptz, ${requestedBy}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id::text AS id`);

      if (inserted[0] !== undefined) {
        // 🔴 唯一のブランド付与地点（`tests/static/send-attempt-token-single-path.test.ts`）。
        const token = {
          idempotencyKey: key,
          attemptSeq,
          entityType: input.entityType,
          entityId: input.entityId,
        } as SendAttemptToken;
        return { outcome: 'RESERVED', token };
      }

      const existing = await findByKeyOrTriple(tx, input, attemptSeq, key);
      if (existing === null) throw new SendAttemptConflictError(key);
      return { outcome: 'ALREADY_RESERVED', existing };
    },
  );
}

// ============================================================================
// 確定（docs/05 §10.2 ⑥ / §10.6）。`RESERVED` からの CAS
// ============================================================================

/**
 * 🔴 `RESERVED → SUCCEEDED | FAILED | UNKNOWN` の CAS。**確定は 1 回**であり、確定済みの行を上書きしない。
 *
 * 🔴 `UNKNOWN`（応答不明）は隔離状態である（docs/05 §10.6）。ここから `RESERVED` に戻す関数も、
 *    `SUCCEEDED` / `FAILED` に確定し直す関数も無い。人間が到達を確認して**新しい `attempt_seq` で再送**する。
 */
export async function settleSendAttempt(
  ctx: SystemTenantCtx,
  token: SendAttemptToken,
  input: SettleSendAttemptInput,
): Promise<SendAttemptSettlementOutcome> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) => settleSendAttemptInTx(tx, token, input),
  );
}

/**
 * 🔴 確定の **1 実装**（`RESERVED` からの CAS）。`settleSendAttempt` と、T-09-06 の `settleProposalSubmission`
 *    （`proposal-send.ts`。`SendAttempt` の確定と `Proposal` の `SUBMITTING → SUBMITTED / SUBMIT_FAILED` を
 *    **同じトランザクション**で行う。docs/05 §10.2 ⑥「確定は 1 tx」）が共有する。
 * @internal `packages/db` の内側からのみ使う（index.ts から export しない）。
 */
export async function settleSendAttemptInTx(
  tx: TenantTransactionClient,
  token: SendAttemptToken,
  input: SettleSendAttemptInput,
): Promise<SendAttemptSettlementOutcome> {
  const externalId = input.status === 'SUCCEEDED' ? input.externalId : null;
  const failureKind = input.status === 'SUCCEEDED' ? null : input.failureKind;
  const failureDetail =
    input.status === 'SUCCEEDED' || input.failureDetail === undefined
      ? null
      : input.failureDetail.slice(0, FAILURE_DETAIL_MAX_LENGTH);

  const updated = await tx.$queryRaw<IdRow[]>(Prisma.sql`
    UPDATE send_attempts
       SET status = ${input.status},
           external_id = ${externalId},
           failure_kind = ${failureKind},
           failure_detail = ${failureDetail},
           settled_at = ${input.now}::timestamptz
     WHERE idempotency_key = ${token.idempotencyKey}
       AND status = 'RESERVED'
    RETURNING id::text AS id`);
  if (updated[0] !== undefined) return { outcome: 'SETTLED' };

  const current = await findByKeyOrTriple(tx, token, token.attemptSeq, token.idempotencyKey);
  if (current === null) return { outcome: 'NOT_FOUND' };
  return { outcome: 'ALREADY_SETTLED', status: current.status };
}

// ============================================================================
// 読み取り（送信ジョブの事前判定 / `S-022`）
// ============================================================================

/**
 * 対象の試行を `attempt_seq` 昇順で返す（見えなければ空）。
 * 送信ジョブは ② の遅延判定で「payload の `attemptSeq` の行が既にある」を見て、**CAS の前に**重複起動を止められる。
 */
export async function listSendAttempts(ctx: AuthenticatedTenantCtx, target: SendTarget): Promise<SendAttemptView[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<SendAttemptRow[]>(Prisma.sql`
        SELECT ${VIEW_COLUMNS}
          FROM send_attempts
         WHERE entity_type = ${target.entityType}
           AND entity_id = ${target.entityId}::uuid
         ORDER BY attempt_seq ASC`);
      return rows.map(toView);
    },
  );
}

/** 1 つの試行（`attempt_seq` 指定）。見えなければ `null`。 */
export async function readSendAttempt(
  ctx: AuthenticatedTenantCtx,
  target: SendTarget & { readonly attemptSeq: number },
): Promise<SendAttemptView | null> {
  if (!isValidAttemptSeq(target.attemptSeq)) {
    throw new RangeError(`attemptSeq は 1 以上の整数である必要があります（${String(target.attemptSeq)}）。`);
  }
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<SendAttemptRow[]>(Prisma.sql`
        SELECT ${VIEW_COLUMNS}
          FROM send_attempts
         WHERE entity_type = ${target.entityType}
           AND entity_id = ${target.entityId}::uuid
           AND attempt_seq = ${target.attemptSeq}::int
         LIMIT 1`);
      const row = rows[0];
      return row === undefined ? null : toView(row);
    },
  );
}
