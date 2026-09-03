// apps/web/lib/auth/device.test.ts
// `classifyDeviceKind` の決定性（CLAUDE.md §13.3 / docs/05 §3.8 `AuditLog.deviceKind`）。
//
// 🔴 モバイルからの承認・ダウンロードが監査ログで「モバイル」として残ることは、
//    「モバイルだけ記録が漏れる実装にしない」（CLAUDE.md §13.3）の前提になる。
import { describe, expect, it } from 'vitest';
import { classifyDeviceKind } from './device';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1';
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('classifyDeviceKind', () => {
  it.each([
    ['iPhone', IPHONE, 'mobile'],
    ['Android スマートフォン', ANDROID_PHONE, 'mobile'],
    ['iPad', IPAD, 'tablet'],
    // 🔴 Android タブレットは UA に "Mobile" を含まない。順序を誤ると全部 mobile になる。
    ['Android タブレット', ANDROID_TABLET, 'tablet'],
    ['デスクトップ Chrome', DESKTOP, 'desktop'],
    ['curl', 'curl/8.7.1', 'api'],
    ['空文字', '', 'api'],
  ] as const)('%s を判定する', (_label, userAgent, expected) => {
    expect(classifyDeviceKind(userAgent)).toBe(expected);
  });

  it('UA が無い（API 直叩き）場合は api', () => {
    expect(classifyDeviceKind(null)).toBe('api');
    expect(classifyDeviceKind(undefined)).toBe('api');
  });

  it('同じ入力に同じ出力（決定的）', () => {
    expect(classifyDeviceKind(IPHONE)).toBe(classifyDeviceKind(IPHONE));
  });
});
