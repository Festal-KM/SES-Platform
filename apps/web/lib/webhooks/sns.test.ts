// apps/web/lib/webhooks/sns.test.ts
// 🔴 SNS の署名検証（docs/03 §3.2.5「必ず検証する」/ docs/05 §8.5 手順①）。
//
// 🔴 **実在の SNS エンドポイントにも Amazon の証明書にも接続しない。**
//    自己生成した RSA 鍵でフィクスチャに署名し、証明書ローダを注入して検証する。
//
// ここで固定するのは 4 点である:
//   ① 正しく署名されたメッセージが通る（対照。空振り防止）
//   ② 🔴 本文を 1 文字でも改竄すると落ちる
//   ③ 🔴 `SigningCertURL` が Amazon のホストでなければ、証明書を**取りに行かない**
//      （ここが緩むと、攻撃者の証明書で任意のペイロードを通せる）
//   ④ 古いメッセージ（リプレイ）を拒否する
import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSigningCertUrl,
  parseSnsMessage,
  SNS_MAX_MESSAGE_AGE_MS,
  SnsSignatureError,
  snsStringToSign,
  verifySnsMessage,
  type SnsMessage,
} from './sns';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', '..', '..', 'tests', 'fixtures', 'ses');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** フィクスチャを読み、自己生成鍵で署名し直した SNS メッセージにする。 */
function signedFixture(name: string, overrides: Partial<SnsMessage> = {}): SnsMessage {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>;
  const draft = { ...raw, ...overrides } as unknown as SnsMessage;
  const signer = createSign('RSA-SHA1');
  signer.update(snsStringToSign(draft), 'utf8');
  signer.end();
  return { ...draft, Signature: signer.sign(privateKey, 'base64') };
}

const NOW = new Date('2026-09-05T03:00:05.000Z');

function options(loadCertificate = vi.fn(async () => publicKeyPem)) {
  return { loadCertificate, now: () => NOW };
}

describe('parseSnsMessage', () => {
  it('フィクスチャを解釈できる（対照）', () => {
    const message = parseSnsMessage(readFileSync(path.join(fixturesDir, 'bounce.notification.json'), 'utf8'));
    expect(message.Type).toBe('Notification');
    expect(message.TopicArn).toContain('ses-platform-test-events');
  });

  it.each(['not json', '[]', '{"Type":"Unknown"}', '{"Type":"Notification"}'])(
    '形が不正なら SnsSignatureError（%s）',
    (body) => {
      expect(() => parseSnsMessage(body)).toThrow(SnsSignatureError);
    },
  );
});

describe('snsStringToSign（AWS の仕様。順序も仕様の一部）', () => {
  it('Notification は Message / MessageId / Subject / Timestamp / TopicArn / Type の順', () => {
    const message = parseSnsMessage(readFileSync(path.join(fixturesDir, 'bounce.notification.json'), 'utf8'));
    const keys = snsStringToSign(message)
      .split('\n')
      .filter((_, index) => index % 2 === 0)
      .filter((value) => value !== '');
    expect(keys).toEqual(['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']);
  });

  it('🔴 存在しない任意フィールド（Subject）は行ごと省く（空行を入れない）', () => {
    const message = parseSnsMessage(
      readFileSync(path.join(fixturesDir, 'complaint.notification.json'), 'utf8'),
    );
    expect(snsStringToSign(message)).not.toContain('Subject');
  });

  it('SubscriptionConfirmation は SubscribeURL / Token を含む（別の集合である）', () => {
    const message = parseSnsMessage(
      readFileSync(path.join(fixturesDir, 'subscription-confirmation.json'), 'utf8'),
    );
    const signing = snsStringToSign(message);
    expect(signing).toContain('SubscribeURL');
    expect(signing).toContain('Token');
  });
});

describe('assertSigningCertUrl（🔴 信頼の起点）', () => {
  it('Amazon SNS のホストなら通る', () => {
    expect(
      assertSigningCertUrl('https://sns.ap-northeast-1.amazonaws.com/SimpleNotificationService-a.pem')
        .hostname,
    ).toBe('sns.ap-northeast-1.amazonaws.com');
  });

  it.each([
    'http://sns.ap-northeast-1.amazonaws.com/a.pem',
    'https://evil.example.com/a.pem',
    'https://sns.ap-northeast-1.amazonaws.com.evil.example/a.pem',
    'https://sns.ap-northeast-1.amazonaws.com/a.txt',
    'not-a-url',
  ])('🔴 %s は拒否する', (url) => {
    expect(() => assertSigningCertUrl(url)).toThrow(SnsSignatureError);
  });
});

describe('verifySnsMessage', () => {
  it('正しく署名されたメッセージは通る（対照。空振り防止）', async () => {
    await expect(verifySnsMessage(signedFixture('bounce.notification.json'), options())).resolves.toBeUndefined();
  });

  it('🔴 本文を改竄すると落ちる', async () => {
    const message = signedFixture('bounce.notification.json');
    const tampered = { ...message, Message: message.Message.replace('Permanent', 'Transient') };
    await expect(verifySnsMessage(tampered, options())).rejects.toBeInstanceOf(SnsSignatureError);
  });

  it('🔴 TopicArn を差し替えても落ちる（署名対象に含まれる）', async () => {
    const message = signedFixture('bounce.notification.json');
    const tampered = { ...message, TopicArn: 'arn:aws:sns:ap-northeast-1:999999999999:evil' };
    await expect(verifySnsMessage(tampered, options())).rejects.toBeInstanceOf(SnsSignatureError);
  });

  it('🔴 SigningCertURL が Amazon 以外なら、証明書を取りに行かずに落ちる', async () => {
    const loadCertificate = vi.fn(async () => publicKeyPem);
    const message = signedFixture('bounce.notification.json', {
      SigningCertURL: 'https://evil.example.com/a.pem',
    });
    await expect(verifySnsMessage(message, options(loadCertificate))).rejects.toBeInstanceOf(
      SnsSignatureError,
    );
    expect(loadCertificate).not.toHaveBeenCalled();
  });

  it('🔴 別の鍵で署名されたメッセージは落ちる', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await expect(
      verifySnsMessage(signedFixture('bounce.notification.json'), options(vi.fn(async () => otherPem))),
    ).rejects.toBeInstanceOf(SnsSignatureError);
  });

  it('🔴 古いメッセージ（リプレイ）を拒否する', async () => {
    const message = signedFixture('bounce.notification.json');
    const late = {
      loadCertificate: vi.fn(async () => publicKeyPem),
      now: () => new Date(new Date(message.Timestamp).getTime() + SNS_MAX_MESSAGE_AGE_MS + 1_000),
    };
    await expect(verifySnsMessage(message, late)).rejects.toBeInstanceOf(SnsSignatureError);
  });

  it('SignatureVersion が未知なら落ちる', async () => {
    const message = signedFixture('bounce.notification.json', { SignatureVersion: '9' });
    await expect(verifySnsMessage(message, options())).rejects.toBeInstanceOf(SnsSignatureError);
  });

  it('SubscriptionConfirmation も同じ手順で検証できる', async () => {
    const message = signedFixture('subscription-confirmation.json');
    const at = {
      loadCertificate: vi.fn(async () => publicKeyPem),
      now: () => new Date('2026-09-05T01:00:10.000Z'),
    };
    await expect(verifySnsMessage(message, at)).resolves.toBeUndefined();
  });
});
