// apps/web/lib/auth/totp.test.ts
// 🔴 TOTP を自前実装した以上、正しさは**仕様の公式テストベクタ**で固定する
//    （RFC 6238 Appendix B / RFC 4648 §10）。実装を書き換えたら必ずここで落ちる。
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateTotpSecret,
  normalizeTotpInput,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  totpCode,
  totpStep,
  verifyTotpCode,
} from './totp';

/** RFC 6238 Appendix B の HMAC-SHA1 の種（ASCII "12345678901234567890"）。 */
const RFC6238_SECRET_ASCII = '12345678901234567890';
const RFC6238_SECRET = base32Encode(Buffer.from(RFC6238_SECRET_ASCII, 'utf8'));

/** RFC 6238 Appendix B の SHA1 行（T の秒 → 8 桁コード）。 */
const RFC6238_VECTORS: readonly (readonly [number, string])[] = [
  [59, '94287082'],
  [1_111_111_109, '07081804'],
  [1_111_111_111, '14050471'],
  [1_234_567_890, '89005924'],
  [2_000_000_000, '69279037'],
  [20_000_000_000, '65353130'],
];

describe('base32（RFC 4648 §10 のテストベクタ）', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encode(%s) === %s（パディング無し）', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain, 'utf8'))).toBe(encoded);
  });

  it('decode は encode の逆（往復して一致する）', () => {
    const bytes = Buffer.from('foobar', 'utf8');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('空白・ハイフン・小文字・パディングを許容する（利用者の貼り付けを想定）', () => {
    expect(base32Decode('mzxw6-ytb oi==').toString('utf8')).toBe('foobar');
  });

  it('🔴 base32 に無い文字は読み飛ばさず例外にする', () => {
    expect(() => base32Decode('MZXW6YTB01')).toThrow();
  });
});

describe('TOTP（RFC 6238 Appendix B / SHA-1）', () => {
  it.each(RFC6238_VECTORS)('T=%d 秒で 8 桁コードが %s になる', (seconds, expected) => {
    expect(totpCode(RFC6238_SECRET, new Date(seconds * 1000), { digits: 8 })).toBe(expected);
  });

  it('6 桁は 8 桁の下位 6 桁である（同じ動的切り詰めの剰余）', () => {
    for (const [seconds, expected] of RFC6238_VECTORS) {
      expect(totpCode(RFC6238_SECRET, new Date(seconds * 1000), { digits: 6 })).toBe(
        expected.slice(-6),
      );
    }
  });

  it('既定は 6 桁 / 30 秒である', () => {
    expect(TOTP_DIGITS).toBe(6);
    expect(TOTP_PERIOD_SECONDS).toBe(30);
    expect(totpCode(RFC6238_SECRET, new Date(59_000))).toHaveLength(6);
  });

  it('同じ 30 秒の窓では同じコード、次の窓では別のコードになる', () => {
    // 30〜59 秒は同じステップ 1、60 秒でステップ 2 に進む。
    const step = totpStep(new Date(30_000));
    expect(totpStep(new Date(59_999))).toBe(step);
    expect(totpStep(new Date(60_000))).toBe(step + 1);
  });
});

describe('verifyTotpCode', () => {
  const at = new Date(1_111_111_109_000);
  const current = totpCode(RFC6238_SECRET, at);

  it('現在の窓のコードを受理する', () => {
    expect(verifyTotpCode(RFC6238_SECRET, current, at)).toBe(true);
  });

  it('前後 1 ステップ（±30 秒）のずれを許容する', () => {
    const previous = totpCode(RFC6238_SECRET, new Date(at.getTime() - 30_000));
    const next = totpCode(RFC6238_SECRET, new Date(at.getTime() + 30_000));
    expect(verifyTotpCode(RFC6238_SECRET, previous, at)).toBe(true);
    expect(verifyTotpCode(RFC6238_SECRET, next, at)).toBe(true);
  });

  it('🔴 2 ステップ以上ずれたコードは受理しない（窓を広げない）', () => {
    const old = totpCode(RFC6238_SECRET, new Date(at.getTime() - 90_000));
    expect(verifyTotpCode(RFC6238_SECRET, old, at)).toBe(false);
  });

  it('空白・ハイフン付きの入力を正規化して受理する', () => {
    expect(verifyTotpCode(RFC6238_SECRET, `${current.slice(0, 3)} ${current.slice(3)}`, at)).toBe(
      true,
    );
    expect(normalizeTotpInput(' 123-456 ')).toBe('123456');
  });

  it.each([
    ['空文字', ''],
    ['桁不足', '1234'],
    ['桁超過', '1234567'],
    ['数字以外', 'abcdef'],
    ['符号付き', '-12345'],
  ])('🔴 %s は計算せずに拒否する', (_label, code) => {
    expect(verifyTotpCode(RFC6238_SECRET, code, at)).toBe(false);
  });

  it('別のシークレットのコードは受理しない', () => {
    const other = generateTotpSecret();
    expect(verifyTotpCode(other, current, at)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('160 ビット（base32 で 32 文字）を返し、毎回異なる', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(32);
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });
});

describe('buildOtpauthUrl', () => {
  const url = buildOtpauthUrl({
    secret: RFC6238_SECRET,
    accountLabel: 'owner@example.test',
    issuer: 'SES Platform',
  });

  it('Key Uri Format に従う（issuer とラベルを URL エンコードする）', () => {
    expect(url.startsWith('otpauth://totp/SES%20Platform:owner%40example.test?')).toBe(true);
  });

  it('シークレットとパラメータを含む', () => {
    const params = new URL(url).searchParams;
    expect(params.get('secret')).toBe(RFC6238_SECRET);
    expect(params.get('issuer')).toBe('SES Platform');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});
