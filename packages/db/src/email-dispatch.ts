// packages/db/src/email-dispatch.ts
// 🔴 `EmailDispatch`（docs/05 §3.9 / §8.2 / §9.4）を書く**唯一の経路**。T-04-03。
//
// ============================================================================
// 🔴 なぜここに閉じるのか
// ============================================================================
// `email.dispatch` は送信系キューの中で唯一 `attempts: 3` を許される（docs/05 §9.4）。
// その安全性は 2 つの仕掛けだけで成り立っている:
//   ① payload の型（`OperationalMailDispatch` / `AccountMailJob`）が宛先分類 1 / 2 / 分類外に限る
//   ② 🔴 **`dedupeKey` の `UNIQUE`** —— 再試行しても行は 1 つで、送信も 1 通
// ②を迂回する INSERT が 1 箇所でもあると、①だけでは二重送信を止められない。だから
// 「`email_dispatches` に書く」操作は本ファイルの関数以外に存在しない形にする。
//
// 🔴 状態の更新はすべて **CAS（`WHERE id = $1 AND status = 'QUEUED'`）** である。
//    0 件更新は「他の実行が既に確定させた」であり、**エラーではない**（重複起動の正常系）。
//    呼び出し側は戻り値の boolean で分岐し、0 件を成功として扱わない。
//
// 🔴 `HELD_*` は失敗ではない（docs/05 §3.9 の列コメント）。`failure_reason` を書かない。

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { usagePeriodKey } from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { EMAIL_DISPATCH_STATUSES } from './schema-value-sets.js';
import type { EmailDispatchStatus, EmailRecipientClass } from './schema-value-sets.js';
import { hashSecretToken } from './tokens.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 🔴 `dedupeKey` に載せるトークンのハッシュ（docs/05 §9.4）。
 *    **平文トークンは DB に一切書かない。** ハッシュの先頭 16 桁だけを鍵の一部にする。
 *
 * 🔴 ハッシュ関数は `tokens.ts` の 1 つだけを使う（T-04-05）。ここで `createHash` を
 *    もう一度書くと、保存されるハッシュ（`Invitation.tokenHash`）と `dedupeKey` の前提が
 *    別々に変わりうる。
 */
export function dispatchTokenHashPrefix(token: string): string {
  return hashSecretToken(token).slice(0, 16);
}

/** 宛先アドレスのハッシュ（`dedupeKey` の `{recipientHash}` 部分。docs/05 §3.9）。 */
export function dispatchRecipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 運用メールの `dedupeKey`（docs/05 §3.9 の `'{templateKey}:{targetId}:{recipientHash}'`）。
 * `account.mail` は別の規約（`'{kind}:{targetId}:{sha256(token) の先頭 16 桁}'`）であり、
 * 組み立ては `@ses/connectors` の `accountMailDedupeKey` が持つ。
 */
export function emailDispatchDedupeKey(input: {
  readonly templateKey: string;
  readonly targetId: string;
  readonly recipientEmail: string;
}): string {
  return `${input.templateKey}:${input.targetId}:${dispatchRecipientHash(input.recipientEmail)}`;
}

/**
 * `email_dispatches` の 1 行（予約結果）。
 *
 * 🔴 `created === false` は **`dedupeKey` が既に存在した**ということであり、
 *    「重複起動が正しく 1 通に収束した」ことを意味する（異常ではない）。
 *    呼び出し側は既存行の `status` を見て、送るか終わるかを決める。
 */
export type EmailDispatchReservation = {
  readonly dispatchId: string;
  readonly dedupeKey: string;
  readonly created: boolean;
  readonly status: EmailDispatchStatus;
  readonly recipientClass: EmailRecipientClass;
  readonly recipientEmail: string;
  readonly templateKey: string;
};

export type EmailDispatchInput = {
  readonly recipientClass: EmailRecipientClass;
  readonly recipientEmail: string;
  readonly templateKey: string;
  readonly dedupeKey: string;
  readonly observedAt: Date;
};

type ReservationRow = {
  readonly id: string;
  readonly status: string;
  readonly recipient_class: string;
  readonly recipient_email: string;
  readonly template_key: string;
};

/**
 * 🔴 送信の予約（docs/05 §9.4）。**`ON CONFLICT (dedupe_key) DO NOTHING`** で行を 1 つに収束させる。
 *
 * 🔴 `upsert`（読んでから書く）にしない。`email.dispatch` は `attempts: 3` であり、
 *    再試行が並行して走りうる。読んでから書くと両方が「無い」と判断して 2 行作ろうとし、
 *    片方が `UNIQUE` 違反で**例外になって再試行に乗る**（ループする）。
 *    `DO NOTHING` + 既存行の再取得なら、何回走っても静かに同じ 1 行へ収束する。
 */
export async function reserveEmailDispatch(
  ctx: HostTenantCtx,
  input: EmailDispatchInput,
): Promise<EmailDispatchReservation> {
  const id = uuidV7(input.observedAt);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const inserted = await tx.$queryRaw<ReservationRow[]>(Prisma.sql`
        INSERT INTO email_dispatches
          (id, tenant_id, recipient_class, recipient_email, template_key, dedupe_key, status)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${input.recipientClass}, ${input.recipientEmail},
           ${input.templateKey}, ${input.dedupeKey}, 'QUEUED')
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id::text AS id, status, recipient_class, recipient_email, template_key`);

      const created = inserted[0];
      if (created !== undefined) return toReservation(created, input.dedupeKey, true);

      const existing = await tx.$queryRaw<ReservationRow[]>(Prisma.sql`
        SELECT id::text AS id, status, recipient_class, recipient_email, template_key
        FROM email_dispatches
        WHERE dedupe_key = ${input.dedupeKey}`);
      const row = existing[0];
      if (row === undefined) {
        // 🔴 `DO NOTHING` で 0 行かつ SELECT でも 0 行 ＝ **他テナントの行と衝突した**
        //    （`dedupe_key` はグローバル `UNIQUE`。RLS で自分には見えない）。
        //    送らずに失敗させる —— 黙って新しい行を作ると `UNIQUE` の意味が消える。
        throw new EmailDispatchConflictError(input.dedupeKey);
      }
      return toReservation(row, input.dedupeKey, false);
    },
  );
}

function toReservation(row: ReservationRow, dedupeKey: string, created: boolean): EmailDispatchReservation {
  return {
    dispatchId: row.id,
    dedupeKey,
    created,
    status: row.status as EmailDispatchStatus,
    recipientClass: row.recipient_class as EmailRecipientClass,
    recipientEmail: row.recipient_email,
    templateKey: row.template_key,
  };
}

/**
 * 🔴 `dedupeKey` が自テナントの外の行と衝突した（`UNIQUE` はグローバル）。
 *    テンプレート・対象 ID・宛先ハッシュのどれかの組み立てが誤っている実装バグである。
 *    握り潰して別のキーで送ると、冪等性の根拠そのものが無くなる。
 */
export class EmailDispatchConflictError extends Error {
  constructor(readonly dedupeKey: string) {
    super(
      `EmailDispatch の dedupeKey が既存の行と衝突しました（自テナントからは参照できません）。` +
        '冪等キーの組み立てを確認してください（docs/05 §9.4）。',
    );
    this.name = 'EmailDispatchConflictError';
  }
}

/** `QUEUED` からの確定（CAS）。0 件更新なら `false`（他の実行が処理済み）。 */
async function settleFromQueued(
  ctx: HostTenantCtx,
  statement: (dispatchId: string) => Prisma.Sql,
  dispatchId: string,
): Promise<boolean> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>(statement(dispatchId));
      return updated.length === 1;
    },
  );
}

/** 🔴 実送信の成功を確定する（`QUEUED → SENT`）。 */
export async function markEmailDispatchSent(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly sesMessageId: string; readonly sentAt: Date },
): Promise<boolean> {
  return settleFromQueued(
    ctx,
    (id) => Prisma.sql`
      UPDATE email_dispatches
         SET status = 'SENT', ses_message_id = ${input.sesMessageId}, sent_at = ${input.sentAt}::timestamptz
       WHERE id = ${id}::uuid AND status = 'QUEUED'
      RETURNING id::text AS id`,
    input.dispatchId,
  );
}

/**
 * モックのメールコネクタで完了した（`QUEUED → MOCKED`）。
 * 🔴 `SENT` と区別する。`tenant.purge-scan` は「予告が配送済みか」を状態で判定しており、
 *    `MOCKED` を配送済みとみなしてよいのは全モック環境だけである（docs/05 §9.7）。
 */
export async function markEmailDispatchMocked(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly sentAt: Date },
): Promise<boolean> {
  return settleFromQueued(
    ctx,
    (id) => Prisma.sql`
      UPDATE email_dispatches
         SET status = 'MOCKED', sent_at = ${input.sentAt}::timestamptz
       WHERE id = ${id}::uuid AND status = 'QUEUED'
      RETURNING id::text AS id`,
    input.dispatchId,
  );
}

/**
 * `HELD_*` に置ける状態（docs/05 §8.3 / §8.3-Q）。🔴 失敗ではない。
 *
 * 🔴 **`EMAIL_DISPATCH_STATUSES`（CHECK の 7 値）から `HELD_` 接頭辞で導出する。列挙しない。**
 *    `send.hold-release` の走査対象と、保留に置ける状態と、この定数が**同じ 1 つの出所**から
 *    出ていることが、docs/05 §17.2 #19-② の「走査対象が `{'HELD_DOMAIN_UNVERIFIED',
 *    'HELD_PROVIDER_QUOTA'}` と一致する」の担保である（手で書き写すと、値が増えたときに
 *    片方だけ古くなり、**新しい保留が永久に復帰しない**）。
 */
export const EMAIL_DISPATCH_HOLD_STATUSES = EMAIL_DISPATCH_STATUSES.filter(
  (status): status is Extract<EmailDispatchStatus, `HELD_${string}`> => status.startsWith('HELD_'),
);

export type EmailDispatchHoldStatus = (typeof EMAIL_DISPATCH_HOLD_STATUSES)[number];

/**
 * 🔴 保留に置く（`QUEUED → HELD_*`）。docs/05 §8.3 / §8.3-Q ④。
 *
 * 🔴 **`failure_reason` を書かない。** 保留は「まだ 1 回も送っていない」状態であり、
 *    失敗として記録すると `A-005` の失敗ジョブ数・未対応件数に混ざる（§8.3-Q ⑦）。
 * 🔴 呼び出し側はこの後 **throw せずに正常終了する**（throw すると `attempts: 3` に乗る）。
 */
export async function holdEmailDispatch(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly status: EmailDispatchHoldStatus; readonly heldAt: Date },
): Promise<boolean> {
  return settleFromQueued(
    ctx,
    (id) => Prisma.sql`
      UPDATE email_dispatches
         SET status = ${input.status}, held_at = ${input.heldAt}::timestamptz
       WHERE id = ${id}::uuid AND status = 'QUEUED'
      RETURNING id::text AS id`,
    input.dispatchId,
  );
}

/**
 * 🔴 送らずに打ち切る（`QUEUED → SUPPRESSED`）。
 *
 * 用途は 2 つある。どちらも**障害ではない**ので `FAILED` にしない:
 *   - `reason='RATE_LIMIT'`: テナントの日次上限に到達した（`F-027 AC-2`。docs/05 §8.7）。
 *     🔴 送信基盤の枠（`HELD_PROVIDER_QUOTA`）と DB で区別する —— 対処する相手が違う
 *     （こちらはテナントの利用量であり、案内先は `S-038`。§8.3-Q ⑥）。
 *   - `reason='REISSUED'`: 保留中の招待をトークン再発行で置き換えた（docs/05 §8.3。T-04-05）。
 */
export async function suppressEmailDispatch(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly reason: 'RATE_LIMIT' | 'REISSUED' },
): Promise<boolean> {
  return settleFromQueued(
    ctx,
    (id) => Prisma.sql`
      UPDATE email_dispatches
         SET status = 'SUPPRESSED', failure_reason = ${input.reason}
       WHERE id = ${id}::uuid AND status = 'QUEUED'
      RETURNING id::text AS id`,
    input.dispatchId,
  );
}

/**
 * 🔴 恒久的な失敗を確定する（`QUEUED → FAILED`）。docs/05 §15.4「恒久的（人間対応）」。
 *    一時的なエラー・保留をここへ落とさない（`A-005` の障害指標が汚れる）。
 */
export async function failEmailDispatch(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly failureReason: string },
): Promise<boolean> {
  return settleFromQueued(
    ctx,
    (id) => Prisma.sql`
      UPDATE email_dispatches
         SET status = 'FAILED', failure_reason = ${input.failureReason}
       WHERE id = ${id}::uuid AND status = 'QUEUED'
      RETURNING id::text AS id`,
    input.dispatchId,
  );
}

/**
 * 保留から抜けるときに行を閉じる理由（docs/05 §8.3 の復帰手順①②）。
 *
 * - `REISSUED`: 新しいトークンの行に**置き換わった**（この行は二度と送られない）
 * - `EXPIRED`:  受諾期限を過ぎていた等で**再発行しなかった**（再招待 / 再要求は人の明示操作）
 *
 * 🔴 どちらも「失敗」ではない。`FAILED` に落とさないのは、`A-005` の失敗指標に
 *    保留由来のものを混ぜないためである（§8.3-Q ⑦）。
 */
export type HeldEmailDispatchCloseReason = 'REISSUED' | 'EXPIRED';

/**
 * 🔴 保留（`HELD_*`）から抜ける CAS の SQL。**呼び出し側のトランザクションに載せる。**
 *
 * 文だけを返すのは、招待のトークン再発行が
 * 「この CAS」と「`Invitation.tokenHash` の差し替え」を**同一トランザクション**で行う契約だから
 * である（docs/05 §8.3）。関数として実行してしまうと別トランザクションになり、
 * 片方だけ成立した状態（＝ 届かない招待 / 二重の有効リンク）が生まれうる。
 */
export function closeHeldEmailDispatchSql(input: {
  readonly dispatchId: string;
  readonly fromStatus: EmailDispatchHoldStatus;
  readonly reason: HeldEmailDispatchCloseReason;
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE email_dispatches
       SET status = 'SUPPRESSED', failure_reason = ${input.reason}
     WHERE id = ${input.dispatchId}::uuid AND status = ${input.fromStatus}
    RETURNING id::text AS id`;
}

/**
 * 🔴 保留（`HELD_*`）から抜ける 2 経路のうちの 1 つ（`send.hold-release`。docs/05 §9.4 / §8.3）。
 *
 * 用途は「保留中の `account.mail` 由来の行を、送らずに閉じる」ことである。平文トークンは
 * payload（Redis）と共に消えており DB に残っていないため、この行はもう送りようがない。
 *
 * 🔴 CAS（`WHERE status = fromStatus`）が 0 件なら他の実行が処理済み ＝ 正常系。
 * 🔴 `SUPPRESSED` に落とすので、この行が二度と送られることはない。
 */
export async function closeHeldEmailDispatch(
  ctx: HostTenantCtx,
  input: {
    readonly dispatchId: string;
    readonly fromStatus: EmailDispatchHoldStatus;
    readonly reason: HeldEmailDispatchCloseReason;
  },
): Promise<boolean> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>(closeHeldEmailDispatchSql(input));
      return updated.length === 1;
    },
  );
}

/**
 * 🔴 保留から抜ける 2 経路のうちのもう 1 つ（`HELD_* → QUEUED`。docs/05 §9.4）。
 *
 * 招待・再設定**以外**の運用メールは本文が DB 側にあり、平文トークンを持たない。したがって
 * 単に `QUEUED` へ戻して `email.dispatch` を再 enqueue すればよい。
 *
 * 🔴 再 enqueue されたジョブは §8.3-Q の判定を**最初から通る**（`held_at` を NULL に戻すのは
 *    そのためである）。**保留を経たものだけが判定を免れる経路を作らない。**
 * 🔴 CAS が 0 件なら他の実行が処理済み ＝ 正常系（`send.hold-release` は 10 分ごとに走る）。
 */
export async function requeueHeldEmailDispatch(
  ctx: HostTenantCtx,
  input: { readonly dispatchId: string; readonly fromStatus: EmailDispatchHoldStatus },
): Promise<boolean> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE email_dispatches
           SET status = 'QUEUED', held_at = NULL
         WHERE id = ${input.dispatchId}::uuid AND status = ${input.fromStatus}
        RETURNING id::text AS id`);
      return updated.length === 1;
    },
  );
}

export type EmailDispatchRow = {
  readonly dispatchId: string;
  readonly status: EmailDispatchStatus;
  readonly recipientClass: EmailRecipientClass;
  readonly recipientEmail: string;
  readonly templateKey: string;
  readonly dedupeKey: string;
};

/** 保留中の 1 行（`send.hold-release` が走査する形）。 */
export type HeldEmailDispatchRow = EmailDispatchRow & {
  readonly status: EmailDispatchHoldStatus;
  /** 🔴 復帰の順序（**古い順**）を決める唯一の根拠。docs/05 §9.4。 */
  readonly heldAt: Date | null;
};

/**
 * 🔴 `send.hold-release` が走査する保留行（docs/05 §9.4）。**`heldAt` の昇順**で返す。
 *
 * 🔴 走査対象は `EMAIL_DISPATCH_HOLD_STATUSES`（= CHECK の 7 値のうち `HELD_` 接頭辞を持つもの）
 *    であり、**列挙を手で書かない**。値が増えたときに片方だけ更新される状態を作らないためである
 *    （`tests/static/provider-quota-hold.test.ts` が集合の一致を固定する。docs/05 §17.2 #19-②）。
 * 🔴 古い順に返す理由: 枠が回復しても一度に戻せる件数は限られる（`headroom`）。新しいものから
 *    戻すと、古い保留が永久に後回しになる（招待が届かないまま期限切れになる）。
 */
export async function listHeldEmailDispatches(
  ctx: HostTenantCtx,
  input: { readonly limit: number },
): Promise<readonly HeldEmailDispatchRow[]> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new RangeError(`limit は 1 以上の整数である必要があります（${input.limit}）。`);
  }
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          recipient_class: string;
          recipient_email: string;
          template_key: string;
          dedupe_key: string;
          held_at: Date | null;
        }>
      >(Prisma.sql`
        SELECT id::text AS id, status, recipient_class, recipient_email, template_key, dedupe_key, held_at
          FROM email_dispatches
         WHERE status IN (${Prisma.join([...EMAIL_DISPATCH_HOLD_STATUSES])})
         ORDER BY held_at ASC NULLS FIRST, id ASC
         LIMIT ${input.limit}`);
      return rows.map((row) => ({
        dispatchId: row.id,
        status: row.status as EmailDispatchHoldStatus,
        recipientClass: row.recipient_class as EmailRecipientClass,
        recipientEmail: row.recipient_email,
        templateKey: row.template_key,
        dedupeKey: row.dedupe_key,
        heldAt: row.held_at,
      }));
    },
  );
}

/** 1 行を読む（ジョブが payload の `dispatchId` から復元するための唯一の経路）。 */
export async function readEmailDispatch(
  ctx: HostTenantCtx,
  dispatchId: string,
): Promise<EmailDispatchRow | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const row = await tx.emailDispatch.findFirst({
        where: { id: dispatchId },
        select: {
          id: true,
          status: true,
          recipientClass: true,
          recipientEmail: true,
          templateKey: true,
          dedupeKey: true,
        },
      });
      if (row === null) return null;
      return {
        dispatchId: row.id,
        status: row.status as EmailDispatchStatus,
        recipientClass: row.recipientClass as EmailRecipientClass,
        recipientEmail: row.recipientEmail,
        templateKey: row.templateKey,
        dedupeKey: row.dedupeKey,
      };
    },
  );
}

/**
 * その日の送信済み通数（`UsageCounter(DAY,'EMAIL_COUNT')`）。
 * 🔴 これは**判定の入力**であって枠の消費ではない。消費は `reserveEmailDailyQuota` が原子的に行う。
 */
export async function readEmailDailyCount(ctx: HostTenantCtx, observedAt: Date): Promise<number> {
  const periodKey = usagePeriodKey('DAY', observedAt);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const row = await tx.usageCounter.findFirst({
        where: { periodKind: 'DAY', periodKey, metric: 'EMAIL_COUNT' },
        select: { value: true },
      });
      return row === null ? 0 : Number(row.value.toString());
    },
  );
}

/**
 * 🔴 テナントの**日次**メール上限の原子的な予約（docs/05 §8.7 / `F-027 AC-2`）。
 *
 * `ON CONFLICT DO UPDATE ... WHERE usage_counters.value < $limit` が要点である:
 *   - 上限未満なら +1 して新しい値を返す（`allowed: true`）
 *   - 上限に達していれば **0 件更新**になり、加算も起こらない（`allowed: false`）
 * 「読んでから判定して書く」と、並行実行が両方とも上限手前を読んで両方送ってしまう。
 *
 * 🔴 分次（1 分 30 通）はここではない。分次は揮発してよいスライディングウィンドウであり、
 *    `@ses/connectors` の `MinuteWindowCounter` が持つ（docs/05 §8.7）。
 * 🔴 予約に成功したのに送れなかった分は戻さない。戻す実装は「送っていないのに枠が空く」競合を
 *    生み、上限が上限でなくなる（超過は必ず安全側に倒す）。
 */
export async function reserveEmailDailyQuota(
  ctx: HostTenantCtx,
  input: { readonly limit: number; readonly observedAt: Date },
): Promise<{ readonly allowed: boolean; readonly value: number }> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new RangeError(`メールの日次上限は 1 以上の整数である必要があります（${input.limit}）。`);
  }
  const periodKey = usagePeriodKey('DAY', input.observedAt);
  const id = uuidV7(input.observedAt);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        INSERT INTO usage_counters
          (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, 'DAY', ${periodKey},
           'EMAIL_COUNT', 1, 0, ${input.observedAt}::timestamptz)
        ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
          SET value = usage_counters.value + 1,
              observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
          WHERE usage_counters.value < ${input.limit}::numeric
        RETURNING value::text AS value`);

      const row = rows[0];
      if (row !== undefined) return { allowed: true, value: Number(row.value) };

      // 0 件更新 ＝ 上限到達。現在値を読み直して呼び出し側に返す（表示と監視の根拠）。
      const current = await tx.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        SELECT value::text AS value FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid AND period_kind = 'DAY'
           AND period_key = ${periodKey} AND metric = 'EMAIL_COUNT'`);
      return { allowed: false, value: Number(current[0]?.value ?? input.limit) };
    },
  );
}
