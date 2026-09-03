// apps/web/lib/auth/device.ts
// `AuthenticatedTenantCtx.deviceKind` と `AuditLog.deviceKind` の判定（docs/05 §4.3 / §3.8）。
//
// 🔴 これは**リクエスト由来の情報だが分離キーではない**（CLAUDE.md §3.1 は分離キーだけを
//    禁じている）。監査ログに「モバイルからの操作か」を残すために要る
//    （CLAUDE.md §13.3「スキルシートのダウンロードは、デバイスを問わず監査ログに記録する」）。
// 🔴 判定結果で**権限や参照範囲を変えない**。表示の分岐と記録にだけ使う。
import type { DeviceKind } from '@ses/db';

/**
 * User-Agent からデバイス種別を判定する。純粋関数（テスト可能・決定的）。
 *
 * - UA が無い / 空 → `'api'`（ブラウザ以外からの直叩き）
 * - タブレットの判定をスマートフォンより先に行う（Android のタブレットは
 *   UA に `Android` を含み `Mobile` を含まないため、順序を逆にすると全部 mobile になる）
 */
export function classifyDeviceKind(userAgent: string | null | undefined): DeviceKind {
  if (userAgent === null || userAgent === undefined) return 'api';
  const ua = userAgent.trim();
  if (ua === '') return 'api';
  const lower = ua.toLowerCase();

  if (lower.includes('ipad')) return 'tablet';
  if (lower.includes('tablet')) return 'tablet';
  // Android で "Mobile" を含まないものはタブレット（Chrome の UA 仕様）。
  if (lower.includes('android') && !lower.includes('mobile')) return 'tablet';

  if (lower.includes('iphone') || lower.includes('ipod')) return 'mobile';
  if (lower.includes('android')) return 'mobile';
  if (lower.includes('mobile')) return 'mobile';

  if (
    lower.includes('mozilla') ||
    lower.includes('safari') ||
    lower.includes('chrome') ||
    lower.includes('firefox') ||
    lower.includes('edg/')
  ) {
    return 'desktop';
  }
  return 'api';
}
