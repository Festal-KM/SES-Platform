// apps/worker/src/jobs/send-proposal.ts
// 🔴 提案の送信ジョブ `send.proposal`（docs/05 §10.2 / §10.4 / §10.5 / §10.6 / §9.4 / `F-022` / `CLAUDE.md` §3.4 / §4.2）。T-09-06。
//
// ============================================================================
// 🔴 §10.2 の順序がこのファイルの本体である（設計の要。順序を入れ替えない）
// ============================================================================
//   ① 事前判定（🔴 CAS より前）
//      a. テナント状態（`tenants` から読む。`ctx.lifecycleState` は常に `'ACTIVE'` 固定なので使わない）→ `TENANT_SUSPENDED`
//      b. 提案の状態 `APPROVED`（違えば外部を呼ばずに終了。多重実行 / 状態違い）
//      c. ゲートの有効性（`readProposalGateFreshness`。承認 CAS と同じ述語）→ `GATE_STALE`
//      d. 送信元ドメイン（`resolveVerifiedSendingDomain`。未検証なら `DOMAIN_UNVERIFIED`）
//      e. テナントの日次 / 分次上限（`decideEmailRate`。`BLOCK` → `RATE_LIMIT` / `DEFER` → 同じ `attemptSeq` のまま待機）
//         + 送信基盤（環境全体）の 24h 枠（`decideProviderQuota`。`HOLD` → `PROVIDER_QUOTA`。🔴 `RATE_LIMIT` と別の値）
//   ② 遅延判定（🔴 CAS より前）
//      a. enqueue からの経過 > `SEND_STALE_THRESHOLD_MINUTES` → `GATE_STALE`（自動復帰しない。§10.5）
//      b. 承認後に内容が変わっていないか —— ①-c の読み取りと ③ の CAS の `WHERE` が**同じ述語**（`passedReviewGateExistsSql`）
//         であり、③ が 0 件なら `GATE_STALE` に倒れる（判定を 2 回書かない）
//      c. 提案先・凍結（`EngineerSnapshot`）が消えていないか → `GATE_STALE`
//      d. 🔴 payload の `attemptSeq` の `SendAttempt` が既にあれば CAS の前に終了（古い重複ジョブが ③ を通った直後に
//         ④ で `ALREADY_RESERVED` になり、`SUBMITTING` のまま誰も確定しない行を作らない。T-09-05 申し送り 3）
//      → 日次枠の**原子的な予約**（`reserveEmailDailyQuota`。①-e の判定は消費ではない。`email-send.ts` ⑤ と同じ）
//   ③ CAS `APPROVED → SUBMITTING`（`castProposalToSubmitting`。0 件なら外部を呼ばず終了）
//   ④ `SendAttempt` の予約（`reserveSendAttempt`。`ALREADY_RESERVED` なら外部を呼ばず、③ の行を `SUBMIT_FAILED` に確定）
//   ⑤ 外部呼び出し（`EmailSender.send`。🔴 トランザクションの外。宛先分類は `resolveRecipientClass` が決める）
//   ⑥ 確定（`settleProposalSubmission`。🔴 1 トランザクション。成功 → `SUBMITTED` / 明示的失敗・応答不明 → `SUBMIT_FAILED`）
//
// 🔴 保留（①②）は**状態を動かさない**（`APPROVED` のまま `sendHoldReasonKey` を立てる。`SUBMIT_FAILED` にしない）。
//    事前判定を CAS の前に置くから「この失敗は自動復帰してよいか」の分岐が要らない（§10.2 の 🔴）。
// 🔴 再試行しない（`attempts: 1`。`packages/connectors/src/queues.ts`）。応答不明は `UNKNOWN` + `SUBMIT_FAILED`（§10.6 の隔離）。
//    復帰は人間の #44 だけ。⑤ の後に例外を握り潰す必要は無い —— 再試行が無いので throw しても二重送信にならない
//    （失敗ジョブとして `A-005` に出るほうが「`SUBMITTING` 滞留」だけより早く気づける）。
// 🔴 ジョブは `attemptSeq` を採番しない（payload の値を `SendAttemptOrigin` に写すだけ。docs/05 §10.6）。
import {
  deferJob,
  ExternalSendError,
  isMockedDelivery,
  ProviderQuotaExceededError,
  SEND_PROPOSAL_JOB,
  SendingDomainRequiredError,
  type ConnectorImplementationKind,
  type EmailSender,
  type JobDeferral,
  type MinuteWindowCounter,
  type ProviderSendCounter,
  type SendProposalJob,
  type VerifiedSendingDomain,
} from '@ses/connectors';
import {
  castProposalToSubmitting,
  failProposalSubmissionWithoutAttempt,
  holdProposalSend,
  PROPOSAL_SEND_ENTITY_TYPE,
  readEmailDailyCount,
  readProposalForSend,
  readProposalGateFreshness,
  readSendAttempt,
  reserveEmailDailyQuota,
  reserveSendAttempt,
  resolveRecipientClass,
  resolveTenantQuotas,
  resolveVerifiedSendingDomain,
  settleProposalSubmission,
  systemTenantCtx,
  withTenant,
  type ProposalForSend,
  type SendAttemptOrigin,
  type SendAttemptSettlement,
  type SettleProposalSubmissionOutcome,
  type SystemTenantCtx,
  type TenantQuotaDefaults,
} from '@ses/db';
import {
  decideEmailRate,
  decideProviderQuota,
  isExecutableTenantLifecycleState,
  isSendStale,
  isValidAttemptSeq,
  proposalMachine,
  type ProposalState,
  type ProviderQuotaObservation,
  type RecipientClass,
  type SendHoldReasonKey,
} from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export { SEND_PROPOSAL_JOB } from '@ses/connectors';

/** 提案メールのテンプレート（`EmailSender.send` の `templateKey`）。 */
export const PROPOSAL_SUBMISSION_TEMPLATE_KEY = 'PROPOSAL_SUBMISSION';

/**
 * 🔴 本ジョブが動かす遷移と、その所有者（`PROPOSAL_TRANSITION_OWNERS` の `SEND_JOB`。T-09-02 の申し送り）。
 *    `send-proposal.test.ts` が `proposalTransitionOwner()` の実値と突き合わせて固定する —— #48 の `MANUAL` と重ならない。
 */
export const PROPOSAL_SEND_TRANSITIONS = [
  { from: 'APPROVED', to: 'SUBMITTING' },
  { from: 'SUBMITTING', to: 'SUBMITTED' },
  { from: 'SUBMITTING', to: 'SUBMIT_FAILED' },
] as const satisfies readonly { readonly from: ProposalState; readonly to: ProposalState }[];

// 🔴 遷移表に無い組はここでコンパイル / 実行時に落ちる（状態を列挙で書き写さない）。
for (const transition of PROPOSAL_SEND_TRANSITIONS) proposalMachine.transition(transition.from, transition.to);

/** 検証済みの payload（`SendProposalJob` の `enqueuedAt` を `Date` にしたもの）。 */
export type SendProposalPayload = Omit<SendProposalJob, 'enqueuedAt'> & { readonly enqueuedAt: Date };

/**
 * 🔴 payload の門番（docs/05 §9.1）。**不正なら例外にし、既定値で補完しない。**
 *
 * 🔴 `attemptSeq >= 2` なのに `requestedBy` が無い / `attemptSeq` が正の整数でない payload はここで落とす
 *    （T-09-05 申し送り 9）。④ の `SendAttemptOriginError` は ③ の**後**に投げられるため、そこまで進ませると
 *    `SUBMITTING` のまま試行の無い行が残る。
 */
export function parseSendProposalPayload(raw: unknown): SendProposalPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(SEND_PROPOSAL_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  const tenantId = requireUuid(SEND_PROPOSAL_JOB, 'tenantId', record.tenantId);
  const proposalId = requireUuid(SEND_PROPOSAL_JOB, 'proposalId', record.proposalId);
  const attemptSeq = record.attemptSeq;
  if (typeof attemptSeq !== 'number' || !isValidAttemptSeq(attemptSeq)) {
    throw new InvalidJobPayloadError(SEND_PROPOSAL_JOB, 'attemptSeq が 1 以上の整数ではありません');
  }
  const requestedBy =
    record.requestedBy === null || record.requestedBy === undefined
      ? null
      : requireUuid(SEND_PROPOSAL_JOB, 'requestedBy', record.requestedBy);
  if (attemptSeq >= 2 && requestedBy === null) {
    throw new InvalidJobPayloadError(
      SEND_PROPOSAL_JOB,
      'attemptSeq が 2 以上（人間の再送）なのに requestedBy がありません（docs/05 §10.6）',
    );
  }
  if (typeof record.enqueuedAt !== 'string') {
    throw new InvalidJobPayloadError(SEND_PROPOSAL_JOB, 'enqueuedAt が文字列ではありません');
  }
  const enqueuedAt = new Date(record.enqueuedAt);
  if (Number.isNaN(enqueuedAt.getTime())) {
    throw new InvalidJobPayloadError(SEND_PROPOSAL_JOB, 'enqueuedAt が日時として解釈できません');
  }
  return { tenantId, proposalId, attemptSeq, requestedBy, enqueuedAt };
}

/** payload → `SendAttemptOrigin`（docs/05 §10.6。`1` = `INITIAL` / `>= 2` = `RESEND`）。 */
export function sendAttemptOriginOf(payload: Pick<SendProposalPayload, 'attemptSeq' | 'requestedBy'>): SendAttemptOrigin {
  if (payload.attemptSeq === 1) return { kind: 'INITIAL' };
  if (payload.requestedBy === null) {
    // `parseSendProposalPayload` が先に落とすので到達しない。握り潰さず落とす。
    throw new InvalidJobPayloadError(SEND_PROPOSAL_JOB, 'RESEND には requestedBy が必須です');
  }
  return { kind: 'RESEND', attemptSeq: payload.attemptSeq, requestedBy: payload.requestedBy };
}

export type SendProposalDeps = {
  /** `createConnectors` / `createEmailSender` が組み立てた単一経路。実装種別による分岐はここには無い。 */
  readonly emailSender: EmailSender;
  /** 起動時に確定した実装種別（`SENT` と `MOCKED` を取り違えないため。docs/05 §13.2）。 */
  readonly emailImplementationKind: ConnectorImplementationKind;
  /** 分次のスライディングウィンドウ（docs/05 §8.7）。 */
  readonly minuteWindow: MinuteWindowCounter;
  /**
   * 🔴 T-12-12: 上書きが無いときの上限（`packages/config`）。日次上限は `resolveTenantQuotas(ctx, { now, defaults })` が解いた値
   *    （既定値 + `tenant_quota_overrides`）を ①-e と予約の両方で使う。`email-send.ts` と同じ規律で、固定の `dailyLimit` を渡す口は無い。
   */
  readonly quotaDefaults: TenantQuotaDefaults;
  /** `EMAIL_MINUTE_LIMIT_PER_TENANT`（`packages/config`）。🔴 分次上限は上書きの対象外（docs/05 §5.8.1 ⑧）。 */
  readonly minuteLimit: number;
  /** `MAIL_PROVIDER_DAILY_QUOTA`（環境全体の枠。テナントの上限と混同しない。§8.3-Q ⑥）。 */
  readonly providerDailyQuota: number;
  /** 🔴 `SesEmailSender` に渡したものと同一のインスタンス（`email-send.ts` と同じ規律）。 */
  readonly providerSentCounter: ProviderSendCounter;
  /**
   * 🔴 送信元の独自ドメイン（docs/05 §8.3）。未検証なら `null`。**共通ドメインを代わりに返してはならない**（`BR-51`）。
   *    既定の実体は `resolveSendingDomainFromDb`。差し替えてよいのはテストだけである。
   */
  readonly resolveSendingDomain: (ctx: SystemTenantCtx) => Promise<VerifiedSendingDomain | null>;
  /** `SEND_STALE_THRESHOLD_MINUTES`（`packages/config`。既定 30）。 */
  readonly staleThresholdMinutes: number;
  /** 🔴 現在時刻の注入（テストで固定するため）。 */
  readonly now: () => Date;
};

/** `resolveSendingDomain` の本番の実体（`email-send.ts` の `resolveSendingDomainFromDb` と同じ 1 関数を指す）。 */
export const resolveProposalSendingDomainFromDb: SendProposalDeps['resolveSendingDomain'] = (ctx) =>
  resolveVerifiedSendingDomain(ctx);

/**
 * ジョブの結果。🔴 **どれも「例外ではない」終わり方**である（例外になるのは payload の不正と DB の障害だけ）。
 *
 * - `SENT` … 外部へ 1 通出て `SUBMITTED` に確定した（`mocked` = モック sink で終わった〔`development` / `demo` / `sandbox` の分類 3〕）
 * - `FAILED` … 外部呼び出しが明示的に失敗（`FAILED`）/ 応答不明（`UNKNOWN`）で `SUBMIT_FAILED` に確定した。**自動再送しない**
 * - `HELD` … ①② に抵触し、`APPROVED` のまま `sendHoldReasonKey` を立てた（外部呼び出し 0）。`applied = false` は
 *   保留を書こうとしたら既に `APPROVED` でなかった（多重実行）
 * - `SKIPPED` … 外部を呼ばずに終了（対象が無い / `APPROVED` でない / 同じ試行が既にある / ③ の CAS で負けた）
 * - `RESERVATION_CONFLICT` … ③ を通った後に ④ が `ALREADY_RESERVED`（稀な保険）。外部を呼ばず `SUBMIT_FAILED` に確定
 * - `SETTLE_ANOMALY` … ⑤ の後、⑥ で試行または提案が期待した状態でなかった。**外部呼び出しの事実は `SendAttempt` に残る**
 */
export type SendProposalOutcome =
  | { readonly kind: 'SENT'; readonly attemptSeq: number; readonly externalId: string; readonly mocked: boolean }
  | { readonly kind: 'FAILED'; readonly attemptSeq: number; readonly settlement: 'FAILED' | 'UNKNOWN'; readonly failureKind: string }
  | { readonly kind: 'HELD'; readonly reasonKey: SendHoldReasonKey; readonly applied: boolean }
  | {
      readonly kind: 'SKIPPED';
      readonly reason: 'NOT_FOUND' | 'NOT_APPROVED' | 'ATTEMPT_EXISTS' | 'CAS_LOST';
      readonly detail: string | null;
    }
  | { readonly kind: 'RESERVATION_CONFLICT'; readonly attemptSeq: number; readonly settled: boolean }
  | { readonly kind: 'SETTLE_ANOMALY'; readonly attemptSeq: number; readonly outcome: SettleProposalSubmissionOutcome };

export type SendProposalHandler = (payload: unknown, jobId: string) => Promise<SendProposalOutcome | JobDeferral>;

/**
 * 🔴 送信基盤の枠の観測（`email-send.ts` の `readProviderQuota` と同じ規律）。取得に失敗したら `null` を返し、
 *    手元のカウンタで判定を続ける（止めない側に倒さない）。
 */
async function readProviderQuota(deps: SendProposalDeps): Promise<ProviderQuotaObservation | null> {
  try {
    return await deps.emailSender.getQuota();
  } catch {
    return null;
  }
}

/** 提案先が設定されているか（②-c。経路 4 由来の `DRAFT` は空文字で始まるが、#39 が空を止めるのでここでは保険）。 */
function hasRecipient(proposal: ProposalForSend): boolean {
  return proposal.recipientCompanyName.trim().length > 0 && proposal.recipientEmail.trim().length > 0;
}

/**
 * ⑤ で投げられた例外の分類（docs/05 §15.4 / §10.6 / §8.3-Q ⑤）。
 *
 * 🔴 `send.*` に `TRANSIENT` の再試行は無い（`attempts: 1`）。受理されなかったことが確定している失敗も、
 *    恒久的な失敗も、どちらも `FAILED`（明示的失敗）として `SUBMIT_FAILED` に確定させ、人間の再送に委ねる。
 * 🔴 `UNKNOWN`（タイムアウト / 送信経路の 5xx / 分類できない例外）は「届いたかどうかが分からない」。**再試行しない**。
 * 🔴 `ProviderQuotaExceededError`（CAS の後に SES が同期的に日次枠超過を返した稀な競合）は `email.dispatch` と違い
 *    **保留に戻さない**（外部呼び出しを 1 回行った以上 `SUBMIT_FAILED`。`BR-22`。§8.3-Q ⑤）。
 */
function classifySendError(error: unknown): SendAttemptSettlement {
  if (error instanceof ProviderQuotaExceededError) {
    return { status: 'FAILED', failureKind: 'PROVIDER_QUOTA', failureDetail: 'provider daily quota exceeded (synchronous)' };
  }
  if (error instanceof SendingDomainRequiredError) {
    return { status: 'FAILED', failureKind: 'DOMAIN_UNVERIFIED', failureDetail: 'sending domain required' };
  }
  if (error instanceof ExternalSendError) {
    const failureKind = `${error.kind}:${error.providerCode}`;
    return error.kind === 'UNKNOWN'
      ? { status: 'UNKNOWN', failureKind, failureDetail: error.message.slice(0, 200) }
      : { status: 'FAILED', failureKind, failureDetail: error.message.slice(0, 200) };
  }
  // 🔴 分類できない例外は「外部への到達を否定できない」ので応答不明として隔離する。
  //    例外のメッセージを載せない（宛先・本文が混ざりうる。§16.2）。名前だけ。
  const name = error instanceof Error ? error.name : 'UnexpectedError';
  return { status: 'UNKNOWN', failureKind: `UNKNOWN:${name}` };
}

export function createSendProposalHandler(deps: SendProposalDeps): SendProposalHandler {
  return async (raw, jobId) => {
    const payload = parseSendProposalPayload(raw);
    const origin = sendAttemptOriginOf(payload);
    const ctx = systemTenantCtx(payload.tenantId, { queue: SEND_PROPOSAL_JOB, jobId });
    const target = { entityType: PROPOSAL_SEND_ENTITY_TYPE, entityId: payload.proposalId } as const;
    const now = deps.now();

    const hold = async (reasonKey: SendHoldReasonKey): Promise<SendProposalOutcome> => {
      const outcome = await holdProposalSend(ctx, { proposalId: payload.proposalId, reasonKey, now });
      return { kind: 'HELD', reasonKey, applied: outcome.kind === 'HELD' };
    };

    // ------------------------------------------------------------------
    // ① 事前判定（🔴 CAS より前）
    // ------------------------------------------------------------------
    const proposal = await readProposalForSend(ctx, payload.proposalId);
    if (proposal === null) return { kind: 'SKIPPED', reason: 'NOT_FOUND', detail: null };

    // a. テナント状態（`tenants` から読んだ値。`ctx.lifecycleState` を使わない）。
    if (!isExecutableTenantLifecycleState(proposal.tenantLifecycleState)) return hold('TENANT_SUSPENDED');

    // b. 提案の状態。`APPROVED` でなければ外部を呼ばずに終了（多重実行 / 状態違い）。
    if (proposal.state !== 'APPROVED') return { kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: proposal.state };

    // c. ゲートの有効性（承認 CAS / 送信 CAS と同じ述語）。
    const freshness = await readProposalGateFreshness(ctx, payload.proposalId);
    if (freshness === null) return { kind: 'SKIPPED', reason: 'NOT_FOUND', detail: null };
    if (!freshness.gateFresh) return hold('GATE_STALE');

    // d. 送信元ドメイン（🔴 共通ドメインへフォールバックしない。未検証は保留であって失敗ではない。`F-022 AC-7`）。
    const fromDomain = await deps.resolveSendingDomain(ctx);
    if (fromDomain === null) return hold('DOMAIN_UNVERIFIED');

    // e. テナントの上限（日次 = 停止 / 分次 = 待機）。🔴 外部の 429 に頼らない。
    //    🔴 T-12-12: 日次上限は `resolveTenantQuotas`（既定値 + 上書き。判定・表示・`email-send.ts` と同じ 1 関数）から。
    const { emailDailyLimit: dailyLimit } = await resolveTenantQuotas(ctx, { now, defaults: deps.quotaDefaults });
    const minute = await deps.minuteWindow.peek(ctx.tenantId, now);
    const rate = decideEmailRate({
      dailyLimit,
      dailySent: await readEmailDailyCount(ctx, now),
      minuteLimit: deps.minuteLimit,
      minuteSent: minute.count,
      minuteWindowOldestAt: minute.oldestAt,
      now,
    });
    if (rate.kind === 'BLOCK') return hold('RATE_LIMIT');
    if (rate.kind === 'DEFER') {
      // 🔴 待機であって保留ではない（docs/05 §10.5）。状態も保留列も動かさず、同じジョブを後で再実行する。
      return deferJob(rate.retryAfterSec * 1_000);
    }

    // e'. 送信基盤（環境全体）の 24h 枠。🔴 `RATE_LIMIT` と別の値（対処するのは運営者。§8.3-Q ⑥）。
    const provider = decideProviderQuota({
      envLimit: deps.providerDailyQuota,
      provider: await readProviderQuota(deps),
      localSent24h: await deps.providerSentCounter.countLast24h(now),
      now,
    });
    if (provider.kind === 'HOLD') return hold('PROVIDER_QUOTA');

    // ------------------------------------------------------------------
    // ② 遅延判定（🔴 CAS より前）
    // ------------------------------------------------------------------
    // a. enqueue から時間が経ちすぎたものは黙って送らない（`GATE_STALE`。自動復帰しない）。
    if (isSendStale({ enqueuedAt: payload.enqueuedAt, now, thresholdMinutes: deps.staleThresholdMinutes })) {
      return hold('GATE_STALE');
    }
    // b. 内容の再確認は ①-c と ③ の CAS が同じ述語で行う（ファイル冒頭）。
    // c. 提案先・凍結が消えていないか。
    if (!proposal.snapshotPresent || !hasRecipient(proposal)) return hold('GATE_STALE');
    // d. 🔴 同じ試行の行が既にあれば CAS の前に終了（`SUBMITTING` のまま確定しない行を作らない）。
    const existing = await readSendAttempt(ctx, { ...target, attemptSeq: payload.attemptSeq });
    if (existing !== null) return { kind: 'SKIPPED', reason: 'ATTEMPT_EXISTS', detail: existing.status };

    // 日次枠の原子的な予約（①-e の判定は消費ではない）。並行実行の取りこぼしはここで閉じる。
    // 🔴 予約に成功したのに ③ で負けた分は戻さない（`reserveEmailDailyQuota` の契約。超過は安全側に倒す）。
    const quota = await reserveEmailDailyQuota(ctx, { limit: dailyLimit, observedAt: now });
    if (!quota.allowed) return hold('RATE_LIMIT');
    await deps.minuteWindow.record(ctx.tenantId, now);

    // ------------------------------------------------------------------
    // ③ CAS `APPROVED → SUBMITTING`（0 件なら外部を呼ばない）
    // ------------------------------------------------------------------
    const cast = await castProposalToSubmitting(ctx, { proposalId: payload.proposalId, now });
    if (cast.kind === 'NOT_FOUND') return { kind: 'SKIPPED', reason: 'NOT_FOUND', detail: null };
    if (cast.kind === 'NOT_APPROVED') return { kind: 'SKIPPED', reason: 'CAS_LOST', detail: cast.state };
    if (cast.kind === 'GATE_STALE') return hold('GATE_STALE');

    // ------------------------------------------------------------------
    // ④ `SendAttempt` の予約（`SendAttemptToken` の唯一の生成経路）
    // ------------------------------------------------------------------
    const reservation = await reserveSendAttempt(ctx, { ...target, origin, now });
    if (reservation.outcome === 'ALREADY_RESERVED') {
      // 🔴 稀な保険（②-d を通った直後に別の実行が予約した）。外部を呼ばず、③ で入れた `SUBMITTING` を
      //    `SUBMIT_FAILED(RESERVATION_CONFLICT)` に確定して人間の判断に委ねる（docs/05 §10.4 の T-09-06 の決着）。
      const settled = await failProposalSubmissionWithoutAttempt(ctx, {
        proposalId: payload.proposalId,
        attemptSeq: payload.attemptSeq,
        now,
      });
      return { kind: 'RESERVATION_CONFLICT', attemptSeq: payload.attemptSeq, settled };
    }
    const { token } = reservation;

    // ------------------------------------------------------------------
    // ⑤ 外部呼び出し（🔴 トランザクションの外。DB ロックを持たない）
    // ------------------------------------------------------------------
    // 🔴 宛先分類は自己申告しない。提案先はテナントに所属しない宛先（`subject = null`）であり、`resolveRecipientClass` の
    //    `fallback` の型は分類 3 / 4 に限られる（実送信側の既定値を持たない。docs/05 §8.2）。
    const recipientClass: RecipientClass = await withTenant(ctx, (db) => resolveRecipientClass(db, null, 'CLIENT'));
    let settlement: SendAttemptSettlement;
    try {
      const result = await deps.emailSender.send({
        recipientClass,
        to: proposal.recipientEmail,
        templateKey: PROPOSAL_SUBMISSION_TEMPLATE_KEY,
        // 🔴 本文と件名はゲート（PII 層 / 商流層）を通った内容そのもの。添付は版の参照だけを載せる
        //    （実体の添付は `EmailSendInput` に無い。T-09-06 の申し送り）。
        params: {
          recipientCompanyName: proposal.recipientCompanyName,
          subject: proposal.subject ?? '',
          body: proposal.body ?? '',
          attachmentSkillSheetId: proposal.attachment?.skillSheetId ?? null,
        },
        tenantId: ctx.tenantId,
        fromDomain,
        token,
      });
      settlement = { status: 'SUCCEEDED', externalId: result.externalId };
    } catch (error) {
      settlement = classifySendError(error);
    }

    // ------------------------------------------------------------------
    // ⑥ 確定（🔴 1 トランザクション。`SendAttempt` と `Proposal` を同時に）
    // ------------------------------------------------------------------
    const settleNow = deps.now();
    const settled = await settleProposalSubmission(ctx, {
      proposalId: payload.proposalId,
      token,
      settlement,
      requestedBy: payload.requestedBy,
      now: settleNow,
    });
    if (settled.kind !== 'SETTLED') return { kind: 'SETTLE_ANOMALY', attemptSeq: payload.attemptSeq, outcome: settled };

    if (settlement.status === 'SUCCEEDED') {
      return {
        kind: 'SENT',
        attemptSeq: payload.attemptSeq,
        externalId: settlement.externalId,
        mocked: isMockedDelivery(deps.emailImplementationKind, recipientClass),
      };
    }
    return {
      kind: 'FAILED',
      attemptSeq: payload.attemptSeq,
      settlement: settlement.status,
      failureKind: settlement.failureKind,
    };
  };
}
