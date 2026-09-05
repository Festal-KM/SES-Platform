// packages/connectors/src/email/ses/identity.test.ts
// 🔴 SP-04 テスト計画（ユニット）の「DNS レコードの生成」と、docs/05 §8.3「検証」の判定。T-04-04。
//
// 🔴 実 SES / 実 DNS に接続しない（入力は `GetEmailIdentity` の応答の形をした素のオブジェクト）。
import { describe, expect, it } from 'vitest';
import type { SesGetEmailIdentityResponse } from './api.js';
import {
  buildDkimCnameRecords,
  buildMailFromRecords,
  decideSendingDomainVerification,
  mailFromDomainFor,
} from './identity.js';

const DOMAIN = 'example.co.jp';

describe('提示する DNS レコード（docs/03 §3.2.7 / `S-036`）', () => {
  it('🔴 Easy DKIM は CNAME 3 本（`{token}._domainkey.{domain}` → `{token}.dkim.amazonses.com`）', () => {
    expect(buildDkimCnameRecords(DOMAIN, ['t1', 't2', 't3'])).toEqual([
      {
        type: 'CNAME',
        name: 't1._domainkey.example.co.jp',
        value: 't1.dkim.amazonses.com',
        purposeKey: 'DKIM',
      },
      {
        type: 'CNAME',
        name: 't2._domainkey.example.co.jp',
        value: 't2.dkim.amazonses.com',
        purposeKey: 'DKIM',
      },
      {
        type: 'CNAME',
        name: 't3._domainkey.example.co.jp',
        value: 't3.dkim.amazonses.com',
        purposeKey: 'DKIM',
      },
    ]);
  });

  it('トークン数は SES が返した数に従う（3 本を前提に固定長で組み立てない）', () => {
    expect(buildDkimCnameRecords(DOMAIN, [])).toEqual([]);
    expect(buildDkimCnameRecords(DOMAIN, ['t1'])).toHaveLength(1);
  });

  it('🔴 Custom MAIL FROM は `mail.{domain}` の MX + TXT（SPF）', () => {
    expect(mailFromDomainFor(DOMAIN)).toBe('mail.example.co.jp');
    expect(buildMailFromRecords(mailFromDomainFor(DOMAIN), 'ap-northeast-1')).toEqual([
      {
        type: 'MX',
        name: 'mail.example.co.jp',
        value: 'feedback-smtp.ap-northeast-1.amazonses.com',
        priority: 10,
        purposeKey: 'MAIL_FROM_MX',
      },
      {
        type: 'TXT',
        name: 'mail.example.co.jp',
        value: 'v=spf1 include:amazonses.com ~all',
        purposeKey: 'MAIL_FROM_SPF',
      },
    ]);
  });

  it('🔴 リージョンは引数で受け取る（`process.env` を読まない / ハードコードしない）', () => {
    const [mx] = buildMailFromRecords('mail.example.co.jp', 'us-east-1');
    expect(mx?.value).toBe('feedback-smtp.us-east-1.amazonses.com');
  });
});

describe('🔴 検証状態の判定（docs/05 §8.3「検証」）', () => {
  const success: SesGetEmailIdentityResponse = {
    VerifiedForSendingStatus: true,
    DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
    MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'SUCCESS' },
  };

  it('すべて SUCCESS なら検証済み', () => {
    expect(decideSendingDomainVerification(success)).toEqual({
      verified: true,
      mailFromDomain: 'mail.example.co.jp',
      dkimTokens: ['t1', 't2', 't3'],
    });
  });

  it('🔴 DKIM だけ通っていても検証済みにしない（SPF が失敗して迷惑メール判定される）', () => {
    expect(
      decideSendingDomainVerification({
        ...success,
        MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'PENDING' },
      }),
    ).toEqual({ verified: false, failureReason: 'MAIL_FROM_NOT_VERIFIED' });
  });

  it('DKIM が未検証なら DKIM_NOT_VERIFIED（利用者が次に直すもの）', () => {
    expect(
      decideSendingDomainVerification({
        ...success,
        DkimAttributes: { Status: 'PENDING', Tokens: ['t1'] },
      }),
    ).toEqual({ verified: false, failureReason: 'DKIM_NOT_VERIFIED' });
  });

  it('MAIL FROM が未設定なら MAIL_FROM_NOT_CONFIGURED（provision の途中で止まっている）', () => {
    expect(decideSendingDomainVerification({ ...success, MailFromAttributes: null })).toEqual({
      verified: false,
      failureReason: 'MAIL_FROM_NOT_CONFIGURED',
    });
  });

  it('🔴 identity 全体が未検証なら IDENTITY_NOT_VERIFIED（欠けを検証済み側に倒さない）', () => {
    expect(decideSendingDomainVerification({ ...success, VerifiedForSendingStatus: false })).toEqual({
      verified: false,
      failureReason: 'IDENTITY_NOT_VERIFIED',
    });
  });
});
