// packages/connectors/src/email/ses/identity.ts
// 🔴 送信元ドメインの **DNS レコードの提示** と **検証状態の正規化**（docs/05 §8.3 / docs/03 §3.2.7）。T-04-04。
//
// 🔴 ここは純粋関数だけである（外部 API を呼ばない）。`domain.provision` / `domain.verify` の
//    ジョブは「SES を呼ぶ」責務、本ファイルは「その応答を内部型へ正規化する」責務であり、
//    分けることで**実 SES 無しでレコードの形と判定を固定できる**。
//
// 🔴 サービス固有の生応答（`VerifiedForSendingStatus` / `DkimAttributes.Status` …）を
//    そのまま DB や画面へ持ち出さない（`CLAUDE.md` §3.4）。出ていくのは
//    `SendingDomainDnsRecord[]` と `SendingDomainVerification` だけである。

import type { SesGetEmailIdentityResponse } from './api.js';

/**
 * 画面（`S-036`）に提示する DNS レコード 1 行。
 *
 * 🔴 **秘匿値ではない**（DKIM の公開鍵をホストする CNAME であり、DNS に公開する前提のもの）。
 *    したがってログ・応答に載せてよい。逆に「隠すべきもの」と誤解して伏せると、
 *    利用者が設定できなくなる。
 */
export type SendingDomainDnsRecord = {
  readonly type: 'CNAME' | 'MX' | 'TXT';
  /** DNS に登録する名前（FQDN）。 */
  readonly name: string;
  readonly value: string;
  /** MX のみ。 */
  readonly priority?: number;
  /**
   * 🔴 何のためのレコードかを機械可読な形で持つ（画面が i18n キーへ写像する）。
   *    文言そのものをここに書かない（`CLAUDE.md` §3.5 / `BR-32`）。
   */
  readonly purposeKey: 'DKIM' | 'MAIL_FROM_MX' | 'MAIL_FROM_SPF';
};

/** 🔴 Custom MAIL FROM のサブドメイン（docs/05 §8.3 の `'mail.' + domain`）。**1 箇所で決める。** */
export function mailFromDomainFor(domain: string): string {
  return `mail.${domain}`;
}

/**
 * Easy DKIM の CNAME 3 本（docs/03 §3.2.7）。
 * 🔴 トークン数は SES が返した数に従う（3 本を前提に固定長で組み立てない）。
 */
export function buildDkimCnameRecords(
  domain: string,
  tokens: readonly string[],
): readonly SendingDomainDnsRecord[] {
  return tokens.map((token) => ({
    type: 'CNAME',
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
    purposeKey: 'DKIM',
  }));
}

/**
 * Custom MAIL FROM の MX / TXT（docs/03 §3.2.7）。
 * 🔴 `region` は引数で受け取る（`packages/connectors` は `process.env` を読まない。`CLAUDE.md` §3.5）。
 */
export function buildMailFromRecords(
  mailFromDomain: string,
  region: string,
): readonly SendingDomainDnsRecord[] {
  return [
    {
      type: 'MX',
      name: mailFromDomain,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      purposeKey: 'MAIL_FROM_MX',
    },
    {
      type: 'TXT',
      name: mailFromDomain,
      value: 'v=spf1 include:amazonses.com ~all',
      purposeKey: 'MAIL_FROM_SPF',
    },
  ];
}

/**
 * 🔴 検証の失敗理由（`TenantSendingDomain.lastFailureReason` に入る**コード**）。
 *
 * 🔴 文言ではなくコードを保存する（`CLAUDE.md` §3.5 / `BR-32`）。画面は
 *    `settings.sendingDomain.failure.*` の i18n キーへ写像する。
 * 🔴 これは**状態であってエラーではない**（`docs/04` 申し送り 8 / `S-036`）。
 *    「DNS の反映待ち」を障害として扱わない。
 */
export const SENDING_DOMAIN_FAILURE_REASONS = [
  /** DKIM の CNAME がまだ見つからない（反映待ちを含む）。 */
  'DKIM_NOT_VERIFIED',
  /** Custom MAIL FROM の MX / TXT がまだ見つからない。 */
  'MAIL_FROM_NOT_VERIFIED',
  /** MAIL FROM が未設定（`domain.provision` の途中で止まっている）。 */
  'MAIL_FROM_NOT_CONFIGURED',
  /** DKIM / MAIL FROM は揃っているが、identity 全体がまだ送信可でない。 */
  'IDENTITY_NOT_VERIFIED',
] as const;

export type SendingDomainFailureReason = (typeof SENDING_DOMAIN_FAILURE_REASONS)[number];

/**
 * 正規化した検証結果。
 * 🔴 「検証済み」と「まだ」の 2 値であり、**理由は失敗の説明ではなく次にやることの手がかり**である。
 */
export type SendingDomainVerification =
  | { readonly verified: true; readonly mailFromDomain: string; readonly dkimTokens: readonly string[] }
  | { readonly verified: false; readonly failureReason: SendingDomainFailureReason };

/**
 * 🔴 `GetEmailIdentity` の応答から検証状態を決める（docs/05 §8.3「検証」）。
 *
 * 判定は「`VerifiedForSendingStatus` + DKIM `Status` + MailFrom `Status` が**すべて** `SUCCESS`」
 * である。1 つでも欠けたら未検証であり、**部分的に成立していても送信を許さない**
 * （DKIM だけ通った状態で送ると SPF が失敗し、迷惑メール判定される）。
 *
 * 🔴 理由の優先順は「利用者が次に直すもの」の順にする（DKIM → MAIL FROM → identity 全体）。
 */
export function decideSendingDomainVerification(
  response: SesGetEmailIdentityResponse,
): SendingDomainVerification {
  if (response.DkimAttributes.Status !== 'SUCCESS') {
    return { verified: false, failureReason: 'DKIM_NOT_VERIFIED' };
  }
  const mailFrom = response.MailFromAttributes;
  if (mailFrom === null) {
    return { verified: false, failureReason: 'MAIL_FROM_NOT_CONFIGURED' };
  }
  if (mailFrom.MailFromDomainStatus !== 'SUCCESS') {
    return { verified: false, failureReason: 'MAIL_FROM_NOT_VERIFIED' };
  }
  if (!response.VerifiedForSendingStatus) {
    return { verified: false, failureReason: 'IDENTITY_NOT_VERIFIED' };
  }
  return {
    verified: true,
    mailFromDomain: mailFrom.MailFromDomain,
    dkimTokens: response.DkimAttributes.Tokens,
  };
}
