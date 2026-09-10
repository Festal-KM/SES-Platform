// apps/web/lib/auth/qr-code.test.ts
// 自前実装の QR エンコーダ（`qr-code.ts`）の検証。
//
// 🔴 このモジュールが壊れても**画面は何も言わずに読めない QR を出し続ける**（E2E は
//    `otpauth://` のテキストからシークレットを読むため、QR の中身を見ていない）。
//    そのため「動いたように見える」で済ませず、**外部の参照実装（Python `qrcode`）の出力と
//    ビット単位で一致すること**を固定値で示す（`__fixtures__/qr-code-reference.ts`）。
// 🔴 併せて、このモジュールと登録ウィザードのコンポーネントが**外部へ 1 バイトも送らない**
//    ことを構造として固定する（`otpauth://` URL は TOTP のシークレットを含む。CLAUDE.md §3.5 / §7）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QR_REFERENCE_CASES } from './__fixtures__/qr-code-reference';
import {
  alignmentPatternPositions,
  encodeQrCode,
  gfMultiply,
  maskPenaltyScore,
  qrCodeSvgPath,
  reedSolomonDivisor,
  reedSolomonRemainder,
  type QrCode,
} from './qr-code';
import { buildOtpauthUrl } from './totp';

const here = path.dirname(fileURLToPath(import.meta.url));

function rowsOf(code: QrCode): string[] {
  return code.modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}

describe('参照実装（Python qrcode）との一致', () => {
  it.each(QR_REFERENCE_CASES)(
    '$label: 型番・サイズ・全モジュールが参照実装と一致する',
    ({ text, version, maskPattern, rows }) => {
      const code = encodeQrCode(text, { maskPattern });
      expect(code).not.toBeNull();
      expect(code?.version).toBe(version);
      expect(code?.maskPattern).toBe(maskPattern);
      expect(code?.size).toBe(rows.length);
      // 🔴 行ごとに比較する（1 本の巨大な文字列で比較すると、失敗時にどこがずれたか読めない）。
      expect(rowsOf(code as QrCode)).toEqual([...rows]);
    },
  );

  it('対照: マスクが違えば行列も違う（フィクスチャが空振りしていない）', () => {
    const a = encodeQrCode('otpauth://totp/a', { maskPattern: 0 });
    const b = encodeQrCode('otpauth://totp/a', { maskPattern: 1 });
    expect(rowsOf(a as QrCode)).not.toEqual(rowsOf(b as QrCode));
  });
});

describe('マスクの自動選択（ISO/IEC 18004 8.8.2）', () => {
  const texts = QR_REFERENCE_CASES.map((c) => c.text).filter(
    (text, index, all) => all.indexOf(text) === index,
  );

  it.each(texts)('減点が最小のマスクを選ぶ（同点なら小さい番号）: %s', (text) => {
    const scores = Array.from({ length: 8 }, (_unused, mask) =>
      maskPenaltyScore(encodeQrCode(text, { maskPattern: mask }) as QrCode),
    );
    const best = scores.indexOf(Math.min(...scores));
    const auto = encodeQrCode(text) as QrCode;
    expect(auto.maskPattern).toBe(best);
    // 自動選択の結果は、その番号を固定した場合と完全に同じ行列になる。
    expect(rowsOf(auto)).toEqual(rowsOf(encodeQrCode(text, { maskPattern: best }) as QrCode));
  });
});

describe('型番の選択（レベル M・バイトモードの公表容量）', () => {
  // ISO/IEC 18004 の容量表（誤り訂正レベル M / 8 ビットバイトモード）。外部アンカー。
  const CAPACITY_BYTES: readonly number[] = [
    14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  ];

  it.each(CAPACITY_BYTES.map((bytes, i) => ({ version: i + 1, bytes })))(
    '$bytes バイトはちょうど型番 $version に収まる',
    ({ version, bytes }) => {
      expect(encodeQrCode('a'.repeat(bytes))?.version).toBe(version);
    },
  );

  it.each(CAPACITY_BYTES.slice(0, -1).map((bytes, i) => ({ version: i + 2, bytes: bytes + 1 })))(
    '$bytes バイトは 1 段大きい型番 $version になる',
    ({ version, bytes }) => {
      expect(encodeQrCode('a'.repeat(bytes))?.version).toBe(version);
    },
  );

  it('🔴 容量を超える入力は例外ではなく null（呼び出し側は手入力用の表示だけで続行できる）', () => {
    expect(encodeQrCode('a'.repeat(667))).toBeNull();
  });

  it.each([-1, 8, 1.5, Number.NaN])(
    '🔴 範囲外の maskPattern (%s) は黙って既定に倒さず RangeError にする',
    (mask) => {
      // データの条件（容量超過 = null）と呼び出し側の誤り（例外）を分けている。
      expect(() => encodeQrCode('otpauth://totp/a', { maskPattern: mask })).toThrow(RangeError);
    },
  );

  it('UTF-8 のバイト数で判定する（文字数ではない）', () => {
    // 「あ」は UTF-8 で 3 バイト。5 文字 = 15 バイト → 型番 2（型番 1 は 14 バイトまで）。
    expect(encodeQrCode('あ'.repeat(5))?.version).toBe(2);
    expect(encodeQrCode('a'.repeat(15))?.version).toBe(2);
  });
});

describe('Reed-Solomon（GF(2^8)）', () => {
  it('既知ベクトル: 型番 1 / レベル M の 10 符号語', () => {
    // ISO/IEC 18004 の解説で広く使われる "HELLO WORLD"（型番 1-M）のデータ符号語と
    // その誤り訂正符号語。GF の乗算・生成多項式・剰余の 3 つを一度に固定する。
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it('GF の乗算は 0 と 1 を単位元として扱う', () => {
    expect(gfMultiply(0, 0xff)).toBe(0);
    expect(gfMultiply(1, 0xff)).toBe(0xff);
    // x^7 * x = x^8 → 原始多項式で還元されて 0x1d。
    expect(gfMultiply(0x80, 0x02)).toBe(0x1d);
  });
});

describe('機能パターン', () => {
  it('位置合わせパターンの中心座標が附属書 E と一致する', () => {
    expect(alignmentPatternPositions(1)).toEqual([]);
    expect(alignmentPatternPositions(2)).toEqual([6, 18]);
    expect(alignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPatternPositions(13)).toEqual([6, 34, 62]);
    expect(alignmentPatternPositions(20)).toEqual([6, 34, 62, 90]);
  });

  it('3 つの位置検出パターンとタイミングパターンと固定の暗モジュールが置かれる', () => {
    const code = encodeQrCode('otpauth://totp/a') as QrCode;
    const { size, modules } = code;
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      expect(modules[oy][ox]).toBe(true);
      expect(modules[oy + 1][ox + 1]).toBe(false);
      expect(modules[oy + 3][ox + 3]).toBe(true);
    }
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
    // ISO/IEC 18004 8.9 の常に暗のモジュール。
    expect(modules[size - 8][8]).toBe(true);
  });
});

describe('実際の otpauth:// URL', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  it('主平面（発行者名が ASCII）を符号化できる', () => {
    const url = buildOtpauthUrl({ secret, accountLabel: 'owner@example.test', issuer: 'SES Platform' });
    const code = encodeQrCode(url);
    expect(code).not.toBeNull();
    expect(code?.version).toBeLessThanOrEqual(20);
  });

  it('管理平面（発行者名に日本語を含む最長ケース）を符号化できる', () => {
    const url = buildOtpauthUrl({
      secret,
      accountLabel: 'ops@example.test',
      issuer: 'SES Platform 運営者コンソール',
    });
    const code = encodeQrCode(url);
    expect(code).not.toBeNull();
    // 余裕があること自体を固定する（発行者名が伸びても QR が消えないことの担保）。
    expect(code?.version).toBeLessThanOrEqual(15);
  });
});

describe('SVG パス', () => {
  it('暗モジュールの総数がパスの矩形の合計幅と一致する', () => {
    const code = encodeQrCode('otpauth://totp/a') as QrCode;
    const darkCount = code.modules.reduce(
      (sum, row) => sum + row.filter((dark) => dark).length,
      0,
    );
    const widths = [...qrCodeSvgPath(code).matchAll(/h(\d+)v1/g)].map((m) => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(darkCount);
  });

  it('パスに座標とコマンド以外の文字が現れない（属性値として安全）', () => {
    const code = encodeQrCode('otpauth://totp/a') as QrCode;
    expect(qrCodeSvgPath(code)).toMatch(/^[Mhvz \d-]+$/);
  });
});

describe('🔴 外部送信の経路を持たないこと（CLAUDE.md §3.5 / §7）', () => {
  // `otpauth://` URL は TOTP のシークレットそのものである。外部の QR 生成 API・CDN・画像
  // サービスへ渡す実装（fetch / <img src> / new Image / 外部 URL）が 1 つでも混ざったら、
  // それはシークレットの外部送信である。**生成に関わるファイルの構造として塞ぐ。**
  const FILES = [
    path.join(here, 'qr-code.ts'),
    path.join(here, '..', '..', 'app', '_components', 'otpauth-qr.tsx'),
  ];
  const FORBIDDEN = [/\bfetch\s*\(/, /new\s+Image\b/, /\bsrc\s*=/, /https?:\/\//, /XMLHttpRequest/];

  it.each(FILES)('%s が外部送信の語を含まない', (file) => {
    const source = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
  });
});
