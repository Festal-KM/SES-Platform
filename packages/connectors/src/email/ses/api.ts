// packages/connectors/src/email/ses/api.ts
// 🔴 Amazon SES（SESv2）への**呼び出しの形**（docs/03 §3.2.9 / docs/05 §8.3）。T-04-03。
//
// ============================================================================
// 🔴 なぜ SDK を直接 import せず「ポート」を置くのか
// ============================================================================
// ① **実 SES を叩かないユニットテスト**を成立させるため。`SesEmailSender` はこのポートだけに
//    依存し、テストはモックの実装を注入する（`packages/connectors` に AWS の資格情報も
//    ネットワークも要らない）。
// ② `@aws-sdk/client-sesv2` の `SendEmailCommandInput` / `GetAccountCommandOutput` と
//    **構造的に一致**させてある。アダプタ（`SESv2Client.send(new SendEmailCommand(request))`）は
//    このオブジェクトをそのままコマンドに渡すだけであり、変換ロジックを持たない。
// 🔴 したがってフィールド名は AWS の綴り（PascalCase）のままにする。内部型に寄せて書き換えると、
//    アダプタに「名前の詰め替え」が生まれ、そこがテストされない差分になる。
//
// 🔴 **本ポートの実装は `aws-sdk-api.ts` の 1 ファイルだけ**であり、`@aws-sdk/client-sesv2` を
//    import してよいのもそのファイルだけである（`tests/static/aws-sdk-single-path.test.ts` が固定）。
//    公開経路は `@ses/connectors/aws` サブパス 1 本であり、主バレル（`@ses/connectors`）からは
//    到達できない —— 主バレルは `apps/web` も import するため、載せると Next.js のサーババンドルに
//    AWS SDK 一式が同梱されてしまう。
//    ✅ フィールド名は SDK の `SendEmailRequest` / `GetAccountResponse` と一致することを確認済み
//    （`TenantName?: string` は SESv2 の Tenants 対応版に実在する）。したがってアダプタは
//    詰め替えを持たない（`ToAddresses` の readonly → 可変配列の複製だけが例外）。

/**
 * `SendEmail`（SESv2）のリクエスト。
 *
 * 🔴 `TenantName` は SES Tenants（docs/03 §3.2.1 要件 3 / docs/05 §8.3）。**必ず渡す** ——
 *    渡さないとテナント別レピュテーション・テナント別サプレッション・レピュテーション悪化時の
 *    自動停止のいずれも効かず、1 テナントの不達が全テナントを道連れにする。
 * 🔴 `Destination.ToAddresses` は**常に 1 件**である（`docs/03` §3.2.4「1 通 1 宛先」/
 *    `CLAUDE.md` §6「一斉送信を実装しない」）。配列の長さを型で 1 に固定し、
 *    「複数宛先をまとめて送る」実装が書けないようにする。
 */
export type SesSendEmailRequest = {
  readonly FromEmailAddress: string;
  readonly Destination: { readonly ToAddresses: readonly [string] };
  readonly ConfigurationSetName: string;
  readonly TenantName?: string;
  readonly Content: {
    readonly Template: {
      readonly TemplateName: string;
      /** JSON 文字列（SES テンプレートの差し込み値）。🔴 ログに出さない（denylist の `payload`）。 */
      readonly TemplateData: string;
    };
  };
};

export type SesSendEmailResponse = {
  readonly MessageId: string;
};

/** `GetAccount`（SESv2）の応答のうち本プロダクトが読む部分（docs/05 §8.3-Q ③）。 */
export type SesGetAccountResponse = {
  readonly SendQuota: {
    /** 24 時間あたりの送信上限。サンドボックスは 200（docs/03 §3.2.4）。 */
    readonly Max24HourSend: number;
    readonly SentLast24Hours: number;
  };
};

/**
 * 🔴 `SesEmailSender` が依存する唯一の外部境界。
 *
 * 実装は 2 つだけである:
 *   - AWS SDK のアダプタ（`production` / `staging` / `sandbox`）
 *   - テストが注入するモック（`packages/connectors/src/email/ses/ses.test.ts`）
 * 🔴 `packages/connectors/src/mock/**`（`development` / `demo` / E2E のモック）は
 *    ここではなく `EmailSender` そのものを実装する。層を取り違えないこと ——
 *    こちらは「SES の API を模す」ものであり、あちらは「メール送信という機能を模す」ものである。
 */
export interface SesApi {
  sendEmail(request: SesSendEmailRequest): Promise<SesSendEmailResponse>;
  getAccount(): Promise<SesGetAccountResponse>;
}
