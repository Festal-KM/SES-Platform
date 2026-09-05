// packages/connectors/src/email/ses/aws-sdk-api.ts
// 🔴 **`@aws-sdk/client-sesv2` を import してよい唯一のファイル**（docs/03 §3.2.9「自前実装しない」）。
//
// ここが担うのは「ポート（`SesApi`）と SDK の橋渡し」だけであり、業務判断を 1 つも持たない:
//   - 送信元の決定・`TenantName` の組み立て・宛先分類の判定 … `ses.ts`
//   - 例外の分類（日次枠 / 秒間レート / 恒久 / 応答不明） … `errors.ts`
//   - 保留・上限・CAS … `apps/worker/src/jobs/email-send.ts`
// 🔴 だからここに `try/catch` を書かない。SDK の例外はそのまま投げ、`ses.ts` が
//    `normalizeSesError` で正規化する（分類が 2 箇所に散ると必ず片方が古くなる）。
//
// 🔴 リトライを SDK 側で有効にしない（`maxAttempts: 1`）。外部への到達が確定した後の
//    再試行は二重送信そのものである（`CLAUDE.md` §3.4 / `BR-22`）。再試行の可否は
//    ジョブの `attempts`（`packages/connectors/src/queues.ts`）だけが決める。
//    SDK の既定は 3 回であり、**明示的に 1 に落とさなければ送信系の `attempts: 1` が無意味になる。**
//
// 🔴 本ファイルはパッケージの主バレル（`src/index.ts`）から re-export しない。
//    `@ses/connectors/aws` サブパス（`src/aws.ts`）だけが入口である ——
//    `apps/web` は宛先分類や payload の型のために `@ses/connectors` を import しており、
//    主バレルに載せると Next.js のサーババンドルに AWS SDK 一式が入る。

import {
  GetAccountCommand,
  SendEmailCommand,
  SESv2Client,
  type GetAccountCommandOutput,
  type SendEmailCommandOutput,
} from '@aws-sdk/client-sesv2';

import { ExternalSendError } from './errors.js';
import type { SesApi, SesGetAccountResponse, SesSendEmailRequest, SesSendEmailResponse } from './api.js';

/**
 * `SESv2Client.send` の構造的部分型。
 * 🔴 テストは実クライアントの代わりにこれを満たすスタブを渡す（実 SES に接続しない）。
 */
export type SesCommandSender = {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
  send(command: GetAccountCommand): Promise<GetAccountCommandOutput>;
};

export type SesApiOptions = {
  /** `AWS_REGION`（`packages/config`）。🔴 ここで `process.env` を読まない。 */
  readonly region: string;
  /** 差し替え用（テストのスタブ）。省略時は `SESv2Client` を作る。 */
  readonly client?: SesCommandSender;
};

/**
 * 🔴 SDK の応答は**全フィールドが optional** である（`MessageId?` / `SendQuota?` /
 *    `Max24HourSend?`）。欠けていたときに既定値で埋めない —— 埋めると
 *    「送ったつもりで追跡できない」「枠が無限にあるように見える」に化ける。
 */
function requireMessageId(output: SendEmailCommandOutput): string {
  if (typeof output.MessageId === 'string' && output.MessageId !== '') return output.MessageId;
  // 🔴 送信自体は成功しているので「失敗」ではない。`UNKNOWN`（応答不明）に倒す ——
  //    §15.4 のとおり **再試行してはならない**分類であり、`email-send.ts` はこれを
  //    その場で確定させる（もう一度送る賭けをしない）。
  throw new ExternalSendError(
    'UNKNOWN',
    'MissingMessageId',
    'SES が MessageId を返しませんでした。送信の到達状況を追跡できません。',
  );
}

function toProviderQuota(output: GetAccountCommandOutput): SesGetAccountResponse {
  const quota = output.SendQuota;
  if (
    quota === undefined ||
    typeof quota.Max24HourSend !== 'number' ||
    typeof quota.SentLast24Hours !== 'number'
  ) {
    // 🔴 0 を返さない（`EmailSender.getQuota()` の契約。docs/05 §8.1）。
    //    呼び出し側が `null` に倒し、手元のカウンタだけで判定を続ける。
    throw new ExternalSendError(
      'TRANSIENT',
      'IncompleteSendQuota',
      'SES の GetAccount が SendQuota を返しませんでした。',
    );
  }
  return { SendQuota: { Max24HourSend: quota.Max24HourSend, SentLast24Hours: quota.SentLast24Hours } };
}

/**
 * `SendEmail` のコマンド入力。
 *
 * 🔴 フィールド名は `SesSendEmailRequest`（ポート）と SDK で**同じ綴り**にしてあるため、
 *    詰め替えはしない。ここで名前を変換すると、その変換自体がテストされない差分になる。
 *    ⚠️ `ToAddresses` だけは `readonly [string]` → `string[]` の複製が要る（SDK 側が可変配列）。
 * 🔴 `TenantName` は SESv2 の Tenants（docs/03 §3.2.1 要件 3）。SDK の
 *    `SendEmailRequest.TenantName?: string` と綴りが一致することを確認済み。
 */
export function toSendEmailCommand(request: SesSendEmailRequest): SendEmailCommand {
  return new SendEmailCommand({
    FromEmailAddress: request.FromEmailAddress,
    Destination: { ToAddresses: [...request.Destination.ToAddresses] },
    ConfigurationSetName: request.ConfigurationSetName,
    ...(request.TenantName === undefined ? {} : { TenantName: request.TenantName }),
    Content: {
      Template: {
        TemplateName: request.Content.Template.TemplateName,
        TemplateData: request.Content.Template.TemplateData,
      },
    },
  });
}

/**
 * 🔴 `SesApi` の実装（`createConnectors` の `runtime.ses.api` に渡す）。
 *
 * 認証は AWS SDK の既定の資格情報チェーン（`staging` / `production` は IAM ロール。
 * docs/03 §6.5 と同じ方針）に委ねる。**アクセスキーを引数に取らない** ——
 * 受け取れるようにすると、環境変数から資格情報を渡す経路がここに生える。
 */
export function createSesApi(options: SesApiOptions): SesApi {
  const client: SesCommandSender =
    options.client ??
    new SESv2Client({
      region: options.region,
      // 🔴 SDK 内部の再試行を止める（既定 3 回）。再試行の可否はジョブの `attempts` が決める。
      maxAttempts: 1,
    });

  return {
    async sendEmail(request: SesSendEmailRequest): Promise<SesSendEmailResponse> {
      const output = await client.send(toSendEmailCommand(request));
      return { MessageId: requireMessageId(output) };
    },
    async getAccount(): Promise<SesGetAccountResponse> {
      return toProviderQuota(await client.send(new GetAccountCommand({})));
    },
  };
}
