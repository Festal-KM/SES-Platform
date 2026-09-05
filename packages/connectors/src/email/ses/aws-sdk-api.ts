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
  CreateEmailIdentityCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SendEmailCommand,
  SESv2Client,
  type CreateEmailIdentityCommandOutput,
  type CreateTenantCommandOutput,
  type CreateTenantResourceAssociationCommandOutput,
  type GetAccountCommandOutput,
  type GetEmailIdentityCommandOutput,
  type PutEmailIdentityMailFromAttributesCommandOutput,
  type SendEmailCommandOutput,
} from '@aws-sdk/client-sesv2';

import { ExternalSendError } from './errors.js';
import type {
  SesApi,
  SesCreateEmailIdentityResponse,
  SesGetAccountResponse,
  SesGetEmailIdentityResponse,
  SesIdentityApi,
  SesSendEmailRequest,
  SesSendEmailResponse,
} from './api.js';

/**
 * `SESv2Client.send` の構造的部分型。
 * 🔴 テストは実クライアントの代わりにこれを満たすスタブを渡す（実 SES に接続しない）。
 */
export type SesCommandSender = {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
  send(command: GetAccountCommand): Promise<GetAccountCommandOutput>;
  send(command: CreateTenantCommand): Promise<CreateTenantCommandOutput>;
  send(command: CreateEmailIdentityCommand): Promise<CreateEmailIdentityCommandOutput>;
  send(
    command: PutEmailIdentityMailFromAttributesCommand,
  ): Promise<PutEmailIdentityMailFromAttributesCommandOutput>;
  send(
    command: CreateTenantResourceAssociationCommand,
  ): Promise<CreateTenantResourceAssociationCommandOutput>;
  send(command: GetEmailIdentityCommand): Promise<GetEmailIdentityCommandOutput>;
};

export type SesApiOptions = {
  /** `AWS_REGION`（`packages/config`）。🔴 ここで `process.env` を読まない。 */
  readonly region: string;
  /**
   * `AWS_ACCOUNT_ID`（`packages/config`）。identity の ARN を組み立てるために要る
   * （`CreateTenantResourceAssociation` の `ResourceArn`。docs/05 §8.3）。
   */
  readonly accountId: string;
  /** 差し替え用（テストのスタブ）。省略時は `SESv2Client` を作る。 */
  readonly client?: SesCommandSender;
};

/**
 * SES の identity ARN（`CreateTenantResourceAssociation` の `ResourceArn`）。
 * 🔴 ここだけで組み立てる。呼び出し側に文字列連結を書かせない。
 */
export function sesIdentityArn(options: {
  readonly region: string;
  readonly accountId: string;
  readonly identity: string;
}): string {
  return `arn:aws:ses:${options.region}:${options.accountId}:identity/${options.identity}`;
}

/**
 * 🔴 「既に存在する」を成功として扱うための判定（docs/05 §8.3「既存なら no-op」）。
 *
 * `domain.provision` は `attempts: 3` であり、既存のテナント / identity に対して再実行されうる。
 * 🔴 クラス（`AlreadyExistsException`）を import せず `name` で判定するのは、SDK のマイナー版で
 *    公開エクスポートが変わっても壊れないようにするためである（名前は API 契約の一部で変わらない）。
 * 🔴 それ以外の例外は握り潰さない（そのまま投げ、ジョブの再試行 / 失敗に載せる）。
 */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AlreadyExistsException'
  );
}

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
 * 🔴 DKIM トークンが無い応答を「トークン 0 本」として通さない。
 *    通すと画面に CNAME が 1 本も出ず、利用者は「設定するものが無い」と誤解したまま
 *    永久に検証されない状態になる（`docs/04` 申し送り 8 の「状態であってエラーではない」の逆で、
 *    これは**実際に異常**である）。
 */
function requireDkimTokens(tokens: readonly string[] | undefined): readonly string[] {
  if (tokens === undefined || tokens.length === 0) {
    throw new ExternalSendError(
      'PERMANENT',
      'MissingDkimTokens',
      'SES が DKIM トークンを返しませんでした。DNS レコードを提示できません。',
    );
  }
  return tokens;
}

/**
 * `GetEmailIdentity` の応答を内部型へ正規化する。
 *
 * 🔴 SDK の応答は全フィールドが optional である。**欠けを「検証済み」側に倒さない** ——
 *    `VerifiedForSendingStatus` が無ければ `false`、`DkimAttributes.Status` が無ければ
 *    `'NOT_STARTED'` として扱い、`MailFromAttributes` が無ければ `null` にする。
 *    判定（`decideSendingDomainVerification`）は「すべて `SUCCESS`」でのみ検証済みとするため、
 *    欠けはそのまま未検証になる（fail-closed）。
 */
function toGetEmailIdentityResponse(output: GetEmailIdentityCommandOutput): SesGetEmailIdentityResponse {
  const mailFrom = output.MailFromAttributes;
  return {
    VerifiedForSendingStatus: output.VerifiedForSendingStatus === true,
    DkimAttributes: {
      Status: output.DkimAttributes?.Status ?? 'NOT_STARTED',
      Tokens: output.DkimAttributes?.Tokens ?? [],
    },
    MailFromAttributes:
      mailFrom === undefined || mailFrom.MailFromDomain === undefined
        ? null
        : {
            MailFromDomain: mailFrom.MailFromDomain,
            MailFromDomainStatus: mailFrom.MailFromDomainStatus ?? 'PENDING',
          },
  };
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
export function createSesApi(options: SesApiOptions): SesApi & SesIdentityApi {
  const client: SesCommandSender =
    options.client ??
    new SESv2Client({
      region: options.region,
      // 🔴 SDK 内部の再試行を止める（既定 3 回）。再試行の可否はジョブの `attempts` が決める。
      maxAttempts: 1,
    });

  async function getEmailIdentity(domain: string): Promise<SesGetEmailIdentityResponse> {
    return toGetEmailIdentityResponse(await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain })));
  }

  return {
    async sendEmail(request: SesSendEmailRequest): Promise<SesSendEmailResponse> {
      const output = await client.send(toSendEmailCommand(request));
      return { MessageId: requireMessageId(output) };
    },
    async getAccount(): Promise<SesGetAccountResponse> {
      return toProviderQuota(await client.send(new GetAccountCommand({})));
    },

    // --- identity（docs/05 §8.3。すべて冪等）------------------------------------
    identityArn(identity: string): string {
      return sesIdentityArn({ region: options.region, accountId: options.accountId, identity });
    },
    async createTenant(tenantName: string): Promise<void> {
      try {
        await client.send(new CreateTenantCommand({ TenantName: tenantName }));
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    },
    async createEmailIdentity(input): Promise<SesCreateEmailIdentityResponse> {
      try {
        const output = await client.send(
          new CreateEmailIdentityCommand({
            EmailIdentity: input.domain,
            ConfigurationSetName: input.configurationSetName,
          }),
        );
        return { DkimAttributes: { Tokens: requireDkimTokens(output.DkimAttributes?.Tokens) } };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        // 🔴 既存 identity の DKIM トークンを読み直す。**新しいトークンを発行し直さない**
        //    （利用者が既に DNS に入れた CNAME が無効になり、検証がやり直しになる）。
        const existing = await getEmailIdentity(input.domain);
        return { DkimAttributes: { Tokens: existing.DkimAttributes.Tokens } };
      }
    },
    async putEmailIdentityMailFromAttributes(input): Promise<void> {
      await client.send(
        new PutEmailIdentityMailFromAttributesCommand({
          EmailIdentity: input.domain,
          MailFromDomain: input.mailFromDomain,
          // 🔴 MX が引けないときに Amazon のサブドメインへ落とさない（`REJECT_MESSAGE`）。
          //    落とすと「MAIL FROM が未検証のまま送れてしまう」= `BR-51` の抜け穴になる。
          BehaviorOnMxFailure: 'REJECT_MESSAGE',
        }),
      );
    },
    async createTenantResourceAssociation(input): Promise<void> {
      try {
        await client.send(
          new CreateTenantResourceAssociationCommand({
            TenantName: input.tenantName,
            ResourceArn: sesIdentityArn({
              region: options.region,
              accountId: options.accountId,
              identity: input.identity,
            }),
          }),
        );
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    },
    getEmailIdentity,
  };
}
