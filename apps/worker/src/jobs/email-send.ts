// apps/worker/src/jobs/email-send.ts
// 🔴 `email.dispatch` / `account.mail` に共通の**送信の 1 手順**（docs/05 §9.4 / §8.3 / §8.3-Q / §8.7）。
//
// ============================================================================
// 🔴 手順の順序がこのファイルの本体である
// ============================================================================
//   ① `EmailDispatch` 行を読み、`QUEUED` でなければ何もしない（重複起動の正常系）
//   ② ドメイン判定 —— 取引先へ届く分類で独自ドメインが未検証なら `HELD_DOMAIN_UNVERIFIED`
//      （docs/05 §8.3。🔴 **共通ドメインへフォールバックしない**）
//   ③ レート判定 —— 日次超過は `SUPPRESSED(RATE_LIMIT)`、分次超過は `DEFERRED`（docs/05 §8.7）
//   ④ 日次枠の**原子的な予約**（並行実行の取りこぼしを閉じる）
//   ⑤ 送信 → `QUEUED → SENT` / `MOCKED` の CAS
//   ⑥ 例外の分類 —— 送信基盤の日次枠超過だけは `HELD_PROVIDER_QUOTA`（保留）にして**正常終了**
//
// 🔴 ②③は「外部を呼ぶ前」でなければ意味がない（docs/05 §15.4「事前判定で防げるものは
//    外部を呼ぶ前に保留。エラーにしない」）。
// 🔴 保留・上限で **throw しない**。throw すると BullMQ の `attempts: 3` に乗り、
//    5s / 30s 後に同じ判定へ戻ってくるだけである（保留は障害ではない）。
// 🔴 一時的なエラー（`TRANSIENT`）だけを throw する。そこが `attempts: 3` の存在理由であり、
//    二重送信は `EmailDispatch.dedupeKey` の `UNIQUE` と `QUEUED` からの CAS が止める。
//    🔴 `TRANSIENT` は「**SES が受理しなかったことが確定している**」拒否だけである
//    （送信経路の 5xx は `UNKNOWN` に分類され、再試行に乗らない。`ses/errors.ts`）。
//
// 🔴 **「外部への到達を否定できない呼び出しの後」は、何が起きても throw しない**
//    （iteration 2 / 3 の修正）。該当するのは 2 箇所であり、**規律は同じ**である:
//      ⑤ 送信が成功した後の記録（`QUEUED → SENT` / `MOCKED`）… → `SENT_UNRECORDED`
//      ⑥ `UNKNOWN` / `PERMANENT` の確定（`QUEUED → FAILED`）… → `FAILED{ recorded: false }`
//    どちらも DB の一時障害で throw すると `attempts: 3` で再実行され、行は `QUEUED` のままなので
//    **もう 1 通送る**。記録が欠けた 1 通は監視（docs/05 §16.5 の `QUEUED` 滞留）で拾えるが、
//    二重送信は取り返しがつかない（`CLAUDE.md` §3.4 / §7 の 0 件）。
//    🔴 判断の軸は「送信が成功したか」ではなく「**外部への到達を否定できるか**」である。
//    否定できるもの（分類判定より前 / `TRANSIENT` / `ProviderQuotaExceededError`）だけが
//    throw してよい。
import {
  dispatchTokenFor,
  isMockedDelivery,
  ExternalSendError,
  ProviderQuotaExceededError,
  type ConnectorImplementationKind,
  type EmailSender,
  type MinuteWindowCounter,
  type VerifiedSendingDomain,
} from '@ses/connectors';
import {
  failEmailDispatch,
  holdEmailDispatch,
  markEmailDispatchMocked,
  markEmailDispatchSent,
  readEmailDailyCount,
  reserveEmailDailyQuota,
  suppressEmailDispatch,
  type EmailDispatchRow,
  type SystemTenantCtx,
} from '@ses/db';
import { decideEmailRate, isExternalRecipientClass } from '@ses/domain';

/**
 * ジョブの結果。🔴 **どれも「例外ではない」終わり方**である。
 * 呼び出し側（BullMQ の配線。SP-07）は `DEFERRED` のときだけ `retryAfterSec` 後に
 * **同じ payload で**再スケジュールする（docs/05 §10.5。`attemptSeq` を増やさない）。
 */
export type EmailSendOutcome =
  | { readonly kind: 'SENT'; readonly externalId: string }
  | { readonly kind: 'MOCKED' }
  | { readonly kind: 'ALREADY_SETTLED'; readonly status: string }
  | { readonly kind: 'HELD_DOMAIN_UNVERIFIED' }
  | { readonly kind: 'HELD_PROVIDER_QUOTA' }
  | { readonly kind: 'RATE_LIMITED'; readonly dailyLimit: number }
  | { readonly kind: 'DEFERRED'; readonly retryAfterSec: number }
  /**
   * 恒久的な失敗、または**応答不明**（`UNKNOWN`）の確定。
   *
   * 🔴 `recorded: false` は「その確定を DB に書けなかった」ことを表す（iteration 3 の修正）。
   *    行は `QUEUED` のまま残るため、`SENT_UNRECORDED` と**同じ監視シグナル**に合流する
   *    （docs/05 §16.5 の「`QUEUED` 滞留（送信済み未記録の疑い）」）。
   */
  | { readonly kind: 'FAILED'; readonly failureReason: string; readonly recorded: boolean }
  /**
   * 🔴 **外部への送信は成功したが、その事実を DB に記録できなかった**（iteration 2 の修正）。
   *
   * 起こりうるのは 2 通り:
   *   - `failureReason: 'RECORD_ERROR'` … 記録の UPDATE が例外（DB の一時障害など）
   *   - `failureReason: 'CAS_LOST'` … `QUEUED` からの CAS が 0 件（送信中に他の実行が行を確定させた）
   *
   * 🔴 **この結果を throw に変えてはならない。** throw すると BullMQ の `attempts: 3` に乗り、
   *    行は `QUEUED` のままなので**もう 1 通送る**（`CLAUDE.md` §3.4 / `BR-21` の直接違反）。
   *    「記録が欠けた 1 通」は監視（`email_dispatches` に `QUEUED` のまま `sentAt` が無い行）で
   *    拾えるが、**二重送信は取り返しがつかない**。安全側はこちらである。
   */
  | {
      readonly kind: 'SENT_UNRECORDED';
      readonly externalId: string | null;
      readonly failureReason: 'RECORD_ERROR' | 'CAS_LOST';
    };

export type EmailSendDeps = {
  /** `createConnectors` が組み立てた単一経路。実装種別による分岐はここには無い。 */
  readonly emailSender: EmailSender;
  /** 🔴 `SENT` と `MOCKED` を取り違えないための、起動時に確定した実装種別（docs/05 §13.2）。 */
  readonly emailImplementationKind: ConnectorImplementationKind;
  /** 分次のスライディングウィンドウ（docs/05 §8.7）。 */
  readonly minuteWindow: MinuteWindowCounter;
  /** `EMAIL_DAILY_LIMIT_PER_TENANT` / `EMAIL_MINUTE_LIMIT_PER_TENANT`（`packages/config`）。 */
  readonly dailyLimit: number;
  readonly minuteLimit: number;
  /**
   * 🔴 送信元の独自ドメイン（docs/05 §8.3）。未検証なら `null` を返すこと。
   *    **共通ドメインを代わりに返してはならない**（`BR-51`。返した瞬間に
   *    「成功したように見えて違反している」状態になる）。
   */
  readonly resolveSendingDomain: (ctx: SystemTenantCtx) => Promise<VerifiedSendingDomain | null>;
  /** 🔴 現在時刻の注入（レート窓・保留時刻をテストで固定するため）。 */
  readonly now: () => Date;
};

export type EmailSendRequest = {
  readonly ctx: SystemTenantCtx;
  readonly dispatch: EmailDispatchRow;
  /** テンプレートの差し込み値。🔴 平文トークンを含みうるので**ログに出さない**（denylist の `token`）。 */
  readonly params: Readonly<Record<string, unknown>>;
};

/**
 * 🔴 `EmailDispatch` 1 行に対する送信の実行（`email.dispatch` / `account.mail` の共通本体）。
 *
 * 2 つのジョブで**同じ関数**を通す理由: 保留・上限・CAS の順序が 1 つでも違うと、片方の経路だけ
 * 二重送信やフォールバックが起こりうる。順序を 2 箇所に書き分けない。
 */
export async function performEmailSend(
  deps: EmailSendDeps,
  request: EmailSendRequest,
): Promise<EmailSendOutcome> {
  const { ctx, dispatch } = request;

  // ① 重複起動（`attempts: 3` の再試行 / 復帰と手動実行の競合）は正常系。
  if (dispatch.status !== 'QUEUED') {
    return { kind: 'ALREADY_SETTLED', status: dispatch.status };
  }

  const now = deps.now();

  // ② ドメイン判定（docs/05 §8.3）。🔴 フォールバックしない。
  const fromDomain = await deps.resolveSendingDomain(ctx);
  if (fromDomain === null && isExternalRecipientClass(dispatch.recipientClass)) {
    // 🔴 ここ（外部呼び出しの**前**）の CAS が 0 件でも分岐しない理由:
    //    0 件 ＝「他の実行が先にこの行を確定させた」であり、**どちらの実行も 1 通も送っていない**。
    //    送信後の CAS（下記⑤）とは意味が違う —— あちらは「送ったのに記録できていない」であり、
    //    監視で拾う必要があるので `SENT_UNRECORDED` として返す。
    await holdEmailDispatch(ctx, {
      dispatchId: dispatch.dispatchId,
      status: 'HELD_DOMAIN_UNVERIFIED',
      heldAt: now,
    });
    return { kind: 'HELD_DOMAIN_UNVERIFIED' };
  }

  // ③ レート判定（docs/05 §8.7 / `F-027 AC-2`）。🔴 外部の 429 に頼らない。
  const minute = await deps.minuteWindow.peek(ctx.tenantId, now);
  const decision = decideEmailRate({
    dailyLimit: deps.dailyLimit,
    dailySent: await readEmailDailyCount(ctx, now),
    minuteLimit: deps.minuteLimit,
    minuteSent: minute.count,
    minuteWindowOldestAt: minute.oldestAt,
    now,
  });
  if (decision.kind === 'BLOCK') {
    await suppressEmailDispatch(ctx, { dispatchId: dispatch.dispatchId, reason: 'RATE_LIMIT' });
    return { kind: 'RATE_LIMITED', dailyLimit: decision.dailyLimit };
  }
  if (decision.kind === 'DEFER') {
    // 🔴 状態を変えない（`QUEUED` のまま）。待機は状態ではない（docs/05 §10.5）。
    return { kind: 'DEFERRED', retryAfterSec: decision.retryAfterSec };
  }

  // ④ 並行実行を閉じる原子的な予約。③をすり抜けた同時実行はここで落ちる。
  const reservation = await reserveEmailDailyQuota(ctx, { limit: deps.dailyLimit, observedAt: now });
  if (!reservation.allowed) {
    await suppressEmailDispatch(ctx, { dispatchId: dispatch.dispatchId, reason: 'RATE_LIMIT' });
    return { kind: 'RATE_LIMITED', dailyLimit: deps.dailyLimit };
  }
  await deps.minuteWindow.record(ctx.tenantId, now);

  // ⑤ 送信（単一経路）。予約を経ていない送信は型として書けない（`token` が必須）。
  let externalId: string;
  try {
    const result = await deps.emailSender.send({
      recipientClass: dispatch.recipientClass,
      to: dispatch.recipientEmail,
      templateKey: dispatch.templateKey,
      params: request.params,
      tenantId: ctx.tenantId,
      fromDomain,
      token: dispatchTokenFor(dispatch),
    });
    externalId = result.externalId;
  } catch (error) {
    return settleFailure(request, error, now);
  }

  // 🔴 ここから先は「外部への送信が既に済んでいる」領域である。**何があっても throw しない。**
  //    throw すると `attempts: 3` に乗り、行が `QUEUED` のままなのでもう 1 通送る（`BR-21`）。
  const mocked = isMockedDelivery(deps.emailImplementationKind, dispatch.recipientClass);
  let recorded: boolean;
  try {
    recorded = mocked
      ? await markEmailDispatchMocked(ctx, { dispatchId: dispatch.dispatchId, sentAt: now })
      : await markEmailDispatchSent(ctx, {
          dispatchId: dispatch.dispatchId,
          sesMessageId: externalId,
          sentAt: now,
        });
  } catch {
    // 🔴 例外の内容を握り潰しているのではなく、**再試行に乗せない**ために外へ出さない。
    //    記録が欠けた事実は戻り値（`SENT_UNRECORDED`）と DB の状態（`QUEUED` のまま）に残る。
    return { kind: 'SENT_UNRECORDED', externalId: mocked ? null : externalId, failureReason: 'RECORD_ERROR' };
  }

  // 🔴 0 件更新を成功として無視しない（`packages/db/src/email-dispatch.ts` 冒頭の契約）。
  //    送信前の CAS なら「他の実行が処理済み」で正常系だが、**送信後**の 0 件更新は
  //    「送ったのに記録できていない」であり、監視で拾うべき事象である。
  if (!recorded) {
    return { kind: 'SENT_UNRECORDED', externalId: mocked ? null : externalId, failureReason: 'CAS_LOST' };
  }

  return mocked ? { kind: 'MOCKED' } : { kind: 'SENT', externalId };
}

/**
 * ⑥ 送信で投げられた例外の始末（docs/05 §8.3-Q ⑤ / §15.4）。
 *
 * 🔴 `TRANSIENT` だけを再 throw する。それ以外は**この場で確定させる** ——
 *    恒久的なエラーを再試行しても直らず、`attempts` を空撃ちして failed に積むだけになる。
 * 🔴 `UNKNOWN`（応答不明）も再試行しない（docs/05 §15.4 / §10.6）。届いたかどうかが
 *    分からない以上、もう一度送るのは二重送信の賭けである。**送信経路の 5xx はここに入る**
 *    （`ses/errors.ts` が `operation='send'` のとき `UNKNOWN` に分類する）。
 *
 * 🔴 **確定の書き込み自体が失敗しても throw しない**（iteration 3 の修正）。
 *    `UNKNOWN` は「外部への到達を否定できない」呼び出しであり、その後の `failEmailDispatch` が
 *    DB の一時障害で throw すると `attempts: 3` で再実行され、行は `QUEUED` のままなので
 *    **もう 1 通送る**。⑤（送信成功後）と**同じ規律**である —— 判断の軸は「送信が成功したか」
 *    ではなく「**外部への到達を否定できるか**」だからである。
 *    🔴 `ProviderQuotaExceededError` はこの規律の対象外でよい: SES が受理を拒否したことが
 *    確定しており（1 通も出ていない）、再試行されても二重送信にならない。
 */
async function settleFailure(
  request: EmailSendRequest,
  error: unknown,
  now: Date,
): Promise<EmailSendOutcome> {
  const { ctx, dispatch } = request;

  if (error instanceof ProviderQuotaExceededError) {
    // 🔴 保留であって失敗ではない（docs/05 §8.3-Q ⑤）。`failureReason` を書かない。
    //    ここが throw して再試行されても、外部へは 1 通も出ていないので安全である。
    await holdEmailDispatch(ctx, {
      dispatchId: dispatch.dispatchId,
      status: 'HELD_PROVIDER_QUOTA',
      heldAt: now,
    });
    return { kind: 'HELD_PROVIDER_QUOTA' };
  }

  if (error instanceof ExternalSendError && error.kind === 'TRANSIENT') {
    // 🔴 `TRANSIENT` は「SES が受理しなかったことが確定している」拒否だけである（`ses/errors.ts`）。
    //    だからここでだけ再試行に乗せてよい。
    throw error;
  }

  const failureReason =
    error instanceof ExternalSendError
      ? `${error.kind}:${error.providerCode}`
      : 'UNKNOWN:UnexpectedError';

  // 🔴 書き込みの失敗を外へ出さない（上記の理由）。`recorded` で「確定を書けたか」を返し、
  //    書けなかった場合は行が `QUEUED` のまま残って §16.5 の滞留監視に載る。
  let recorded = false;
  try {
    recorded = await failEmailDispatch(ctx, { dispatchId: dispatch.dispatchId, failureReason });
  } catch {
    recorded = false;
  }
  return { kind: 'FAILED', failureReason, recorded };
}
