// apps/worker/src/jobs/email-dispatch.ts
// `email.dispatch`（docs/05 §9.4）。分類 1 / 分類外の運用メール。T-04-03。
//
// 🔴 このジョブだけが送信系で `attempts: 3` を許される（docs/05 §9.10）。根拠は 2 つあり、
//    **どちらもコードの形で保証されている必要がある**:
//      ① payload の型 `HostOrPlatformDispatch` が宛先分類 1 / 分類外しか載せられない
//         （分類 2 / 3 / 4 = 取引先・提案先・エンジニア本人はコンパイルエラー）
//      ② `EmailDispatch.dedupeKey` の `UNIQUE` と `QUEUED` からの CAS で、
//         何回再試行しても実送信は 1 通に収束する
//
// 🔴 payload に宛先・本文を載せない（docs/05 §9.4）。載っているのは `dispatchId` だけであり、
//    宛先は DB の行から読む。Redis に PII を置かないための構造である。
import type { HostOrPlatformDispatch } from '@ses/connectors';
import { readEmailDispatch, systemTenantCtx } from '@ses/db';
import { performEmailSend, type EmailSendDeps, type EmailSendOutcome } from './email-send.js';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const EMAIL_DISPATCH_JOB = 'email.dispatch';

/**
 * 🔴 payload の門番。`recipientClass` は**必須**であり、分類 1 / 分類外以外は受け付けない
 *    （docs/05 §8.2「分類が未指定の送信を成立させない」/ §9.4）。
 *
 * 🔴 既定値で補完しない。補完すると「分類が欠けた送信が、既定で実送信側に落ちる」ことになり、
 *    `attempts: 3` を許した前提（宛先が分類 1 / 分類外に限られる）が崩れる。
 */
export function parseEmailDispatchPayload(raw: unknown): HostOrPlatformDispatch {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(EMAIL_DISPATCH_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  const dispatchId = requireUuid(EMAIL_DISPATCH_JOB, 'dispatchId', record.dispatchId);
  const recipientClass = record.recipientClass;
  if (recipientClass !== 'HOST_MEMBER' && recipientClass !== 'PLATFORM') {
    throw new InvalidJobPayloadError(
      EMAIL_DISPATCH_JOB,
      'recipientClass が分類 1（HOST_MEMBER）/ 分類外（PLATFORM）ではありません',
    );
  }
  const tenantId =
    record.tenantId === null
      ? null
      : requireUuid(EMAIL_DISPATCH_JOB, 'tenantId', record.tenantId);
  return { dispatchId, tenantId, recipientClass };
}

/**
 * 🔴 運営者宛（分類外）の運用メールは、まだ送る経路が無い。
 *
 * `email_dispatches` は **C2 HOST_ONLY**（docs/05 §4.4）であり、`tenant_id IS NULL` の行は
 * テナント平面の DB ロール（`app_tenant`）から読み書きできない。管理平面側（`app_platform_write`）
 * にも `email_dispatches` への書き込み権限は無い（migration 20260904010000 は `SELECT` のみ）。
 * 🔴 したがって「送ったつもりで送れていない」を作らないため、**ここで明示的に失敗させる**
 *    （`CLAUDE.md` §11.1）。`F-055`（運営者の招待・パスワード再設定）を実装するタスクが、
 *    運営者宛の送信経路（権限と RLS を含む）を設計したうえでこの分岐を置き換える。
 */
export class PlatformDispatchNotSupportedError extends Error {
  constructor() {
    super(
      '運営者宛（分類外）の email.dispatch はまだ実装されていません。' +
        'email_dispatches は C2 HOST_ONLY であり tenant_id IS NULL の行に到達できません（docs/05 §4.4）。',
    );
    this.name = 'PlatformDispatchNotSupportedError';
  }
}

export type EmailDispatchDeps = EmailSendDeps & {
  /**
   * テンプレートの差し込み値を解決する。
   * 🔴 `EmailDispatch` は差し込み値の列を持たない（docs/05 §3.9）。運用メールのテンプレートを
   *    導入するタスク（`F-027` の上限接近通知 = SP-10、`F-064` の削除予告 = SP-10）が、
   *    テンプレートごとの解決をここに与える。**空を既定にしない**ため必須引数にしてある。
   */
  readonly resolveTemplateParams: (
    dispatch: { readonly templateKey: string; readonly dispatchId: string },
  ) => Promise<Readonly<Record<string, unknown>>>;
};

export type EmailDispatchHandler = (payload: unknown, jobId: string) => Promise<EmailSendOutcome>;

export function createEmailDispatchHandler(deps: EmailDispatchDeps): EmailDispatchHandler {
  return async (payload, jobId) => {
    const job = parseEmailDispatchPayload(payload);
    if (job.tenantId === null) throw new PlatformDispatchNotSupportedError();

    const ctx = systemTenantCtx(job.tenantId, { queue: EMAIL_DISPATCH_JOB, jobId });
    const dispatch = await readEmailDispatch(ctx, job.dispatchId);
    if (dispatch === null) {
      // 🔴 行が無い ＝ payload とデータが食い違っている。黙って成功させない。
      throw new InvalidJobPayloadError(EMAIL_DISPATCH_JOB, 'dispatchId に対応する行がありません');
    }

    return performEmailSend(deps, {
      ctx,
      dispatch,
      params: await deps.resolveTemplateParams({
        templateKey: dispatch.templateKey,
        dispatchId: dispatch.dispatchId,
      }),
    });
  };
}
