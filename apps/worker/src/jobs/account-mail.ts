// apps/worker/src/jobs/account-mail.ts
// `account.mail`（招待・パスワード再設定。docs/05 §9.4）。T-04-03。
//
// 🔴 **平文トークンの扱いがこのファイルの要点である**（docs/05 §9.4 / §16.2 / §8.3）:
//    - トークンは payload（Redis）にだけ載り、ジョブの完了とともに消える
//    - **DB には書かない。** `EmailDispatch` に残るのは `sha256(token)` の先頭 16 桁を含む
//      `dedupeKey` だけであり、そこからトークンは復元できない
//    - **ログ・エラー・監査ログにも出さない**（`packages/config` の redact denylist に `token`。
//      本ファイルは例外メッセージにも payload の値を載せない）
//    - 🔴 だから保留（`HELD_*`）からの復帰は**トークンの再発行**でしか行えない
//      （docs/05 §8.3 / §9.4。T-04-05 / `send.hold-release` の責務）
//
// 🔴 宛先分類は payload に載って渡る（enqueue 元の `resolveRecipientClass` が `Membership` /
//    `Invitation` から導いた値。docs/05 §8.2）。ここで導き直さない —— ワーカーが自分で
//    分類すると、API 側と 2 つの判定が並立し、片方が古くなる。
import {
  accountMailDedupeKey,
  ACCOUNT_MAIL_KINDS,
  buildAccountMailLink,
  isAccountMailRecipientClass,
  RECIPIENT_CLASSES,
  type AccountMailJob,
  type AccountMailKind,
  type RecipientClass,
} from '@ses/connectors';
import { dispatchTokenHashPrefix, reserveEmailDispatch, systemTenantCtx } from '@ses/db';
import { performEmailSend, type EmailSendDeps, type EmailSendOutcome } from './email-send.js';
import { InvalidJobPayloadError, requireNonEmptyString, requireUuid } from './payload.js';

export const ACCOUNT_MAIL_JOB = 'account.mail';

/**
 * `kind` → `EmailDispatch.templateKey`。🔴 テンプレート名をハンドラ内に散らさない。
 *
 * 🔴 `send.hold-release`（T-04-04）が「この保留行は `account.mail` 由来か（＝ 平文トークンが
 *    どこにも残っておらず、復帰にはトークン再発行が要るか）」を判定するために読む。
 *    **判定を文字列リテラルで書き分けない** —— 書き分けると、テンプレート名を変えたときに
 *    保留からの復帰だけが静かに壊れる（招待が永久に届かない）。
 */
export const ACCOUNT_MAIL_TEMPLATE_KEY: Readonly<Record<AccountMailKind, string>> = {
  INVITATION: 'ACCOUNT_INVITATION',
  PASSWORD_RESET: 'ACCOUNT_PASSWORD_RESET',
};

const TEMPLATE_KEY = ACCOUNT_MAIL_TEMPLATE_KEY;

/**
 * 🔴 `templateKey` が `account.mail` 由来か（docs/05 §8.3 / §9.4 の復帰手順の分岐）。
 *    真なら復帰は**トークンの再発行**でしか行えない。偽なら `QUEUED` へ戻して再 enqueue でよい。
 */
export function isAccountMailTemplateKey(templateKey: string): boolean {
  return Object.values(ACCOUNT_MAIL_TEMPLATE_KEY).includes(templateKey);
}

/**
 * 🔴 受諾 / 再設定リンクの組み立ては `@ses/connectors` に移した（T-04-08）。
 *    `sandbox` の招待リンク表示（`apps/web`。`F-007 AC-4`）と**同じ URL** でなければならず、
 *    2 アプリで書き分けると片方だけが静かに壊れるため。ここでは再輸出だけを行う。
 */
export { buildAccountMailLink };

function isAccountMailKind(value: unknown): value is AccountMailKind {
  return typeof value === 'string' && (ACCOUNT_MAIL_KINDS as readonly string[]).includes(value);
}

function isRecipientClass(value: unknown): value is RecipientClass {
  return typeof value === 'string' && (RECIPIENT_CLASSES as readonly string[]).includes(value);
}

/**
 * 🔴 payload の門番。`recipientClass` は必須であり、分類 1 / 2 以外は受け付けない
 *    （docs/05 §9.4。業務上の外部送信＝分類 3 / 4 を `account.mail` に載せられない）。
 * 🔴 例外メッセージに `token` の値を載せない（フィールド名だけを言う）。
 */
export function parseAccountMailPayload(raw: unknown): AccountMailJob {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(ACCOUNT_MAIL_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  if (!isAccountMailKind(record.kind)) {
    throw new InvalidJobPayloadError(ACCOUNT_MAIL_JOB, 'kind が INVITATION / PASSWORD_RESET ではありません');
  }
  const recipientClass = record.recipientClass;
  if (!isRecipientClass(recipientClass) || !isAccountMailRecipientClass(recipientClass)) {
    throw new InvalidJobPayloadError(
      ACCOUNT_MAIL_JOB,
      'recipientClass が分類 1（HOST_MEMBER）/ 分類 2（PARTNER_MEMBER）ではありません',
    );
  }
  return {
    tenantId: requireUuid(ACCOUNT_MAIL_JOB, 'tenantId', record.tenantId),
    kind: record.kind,
    targetId: requireUuid(ACCOUNT_MAIL_JOB, 'targetId', record.targetId),
    recipientClass,
    token: requireNonEmptyString(ACCOUNT_MAIL_JOB, 'token', record.token),
  };
}

export type AccountMailDeps = EmailSendDeps & {
  /** `APP_URL`（`packages/config`）。🔴 ハンドラで組み立てず、起動時の設定から渡す。 */
  readonly appUrl: string;
  /**
   * 宛先アドレスの引き当て（招待なら `Invitation.email`、再設定なら `User.email`）。
   * 🔴 payload に宛先を載せない（Redis に PII を置かない）ため、ここで DB から読む。
   *    引き当てられなければ `null`（招待が取り消された等）。
   */
  readonly resolveRecipientEmail: (job: AccountMailJob) => Promise<string | null>;
};

export type AccountMailHandler = (payload: unknown, jobId: string) => Promise<EmailSendOutcome>;

export function createAccountMailHandler(deps: AccountMailDeps): AccountMailHandler {
  return async (payload, jobId) => {
    const job = parseAccountMailPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: ACCOUNT_MAIL_JOB, jobId });

    const recipientEmail = await deps.resolveRecipientEmail(job);
    if (recipientEmail === null) {
      // 対象が取り消された / 見えない。**送らずに正常終了する**（再試行しても直らない）。
      return { kind: 'ALREADY_SETTLED', status: 'NO_RECIPIENT' };
    }

    // 🔴 `dedupeKey` にトークンのハッシュを含める（docs/05 §9.4）。
    //    同じトークンでの再試行は同じ行に収束し（1 通）、再発行された新しいトークンは別の行になる。
    const dispatch = await reserveEmailDispatch(ctx, {
      recipientClass: job.recipientClass,
      recipientEmail,
      templateKey: TEMPLATE_KEY[job.kind],
      dedupeKey: accountMailDedupeKey({
        kind: job.kind,
        targetId: job.targetId,
        tokenHashPrefix: dispatchTokenHashPrefix(job.token),
      }),
      observedAt: deps.now(),
    });

    return performEmailSend(deps, {
      ctx,
      dispatch: {
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        recipientClass: dispatch.recipientClass,
        recipientEmail: dispatch.recipientEmail,
        templateKey: dispatch.templateKey,
        dedupeKey: dispatch.dedupeKey,
      },
      // 🔴 テンプレートの差し込み値にだけ平文トークンが現れる（メール本文に載せるため）。
      //    この値は `EmailSender.send` の引数として渡るだけで、DB にもログにも残らない。
      params: { link: buildAccountMailLink(deps.appUrl, job.kind, job.token) },
    });
  };
}
