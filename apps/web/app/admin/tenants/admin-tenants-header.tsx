// apps/web/app/admin/tenants/admin-tenants-header.tsx
// `A-002` の画面ヘッダ（タイトル / `A-014` の導線 / `閲覧のみ`）の**純粋な描画**。SP-22 `T-22-08`。
//
// ============================================================================
// 🔴 なぜ `page.tsx` から切り出したのか
// ============================================================================
// ここには **`BR-44` のロール差分**が在る —— `A-014`（テナントの開設）の導線は
// **`PLATFORM_OWNER` にだけ描かれ、`PLATFORM_SUPPORT` には存在しない**（`docs/04` §A-002 の
// 空状態 / §A-014 権限差分 / `F-001` の `PP` = `−`）。🔴 **グレーアウトでは見せない**（§3.3 の 🔴 /
// §8.1 と同じ原則。`disabled` で表すと「権限が無い」ではなく「今は押せない」に読める）。
//
// 🔴 ところが `page.tsx` は Next.js のサーバコンポーネントであり、**ユニットテストの対象外**である
//    （`vitest.config.ts` の include の注記）。したがってロール差分が render テストで固定できていなかった
//    —— 描画の形で「`PLATFORM_SUPPORT` の DOM に導線が 1 つも無い」ことを示せるのは、
//    ロールを props で受け取る純粋な部品だけである。`T-22-08` でここへ切り出した。
//
// 🔴 **判定はここ 1 箇所である**（`page.tsx` 側に `canProvision` の二重判定を残さない）。
//    拒否の本体は `A-014` の画面と API-A4 のガードであり、ここは**導線を描かないこと**だけを担う。
// 🔴 `'use client'` を宣言しない（状態を持たない）。🔴 文言は props（`packages/i18n`）から受ける。
// 🔴 アイコンを付けない（`docs/04` §7.5 / §3.3 の改訂 16 ②: 管理平面にアイコンを足さない）。
import Link from 'next/link';
import type { PlatformRole } from '@ses/db';
import { Badge, SECONDARY_LINK_CLASSES } from '@ses/ui';

/** `A-014`（テナントの開設）の URL。🔴 ここ以外から描かない（`BR-44`）。 */
const PROVISIONING_PATH = '/admin/tenants/new';

export type AdminTenantsHeaderMessages = {
  readonly title: string;
  /** `A-014` への導線の語（`admin.provisioning.link`）。 */
  readonly provision: string;
  /** 🔴 `BR-37`「運営者コンソールは既定 read-only」の常時表示（`admin.readOnly.badge`）。 */
  readonly readOnlyBadge: string;
};

export type AdminTenantsHeaderProps = {
  /** 🔴 いまの運営者のロール。**`PLATFORM_OWNER` だけが `A-014` の導線を見る**（`BR-44`）。 */
  readonly platformRole: PlatformRole;
  readonly messages: AdminTenantsHeaderMessages;
};

export function AdminTenantsHeader({ platformRole, messages }: AdminTenantsHeaderProps) {
  const canProvision = platformRole === 'PLATFORM_OWNER';
  return (
    <div className="mb-6 flex items-center justify-between gap-3">
      <h1 className="text-title font-bold text-fg" data-testid="admin-tenants-title">
        {messages.title}
      </h1>
      <div className="flex items-center gap-3">
        {/* 🔴 `PLATFORM_SUPPORT` には**要素そのものが無い**（`aria-disabled` / `opacity` で残さない）。 */}
        {canProvision ? (
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={PROVISIONING_PATH}
            data-testid="admin-tenants-provision-link"
          >
            {messages.provision}
          </Link>
        ) : null}
        {/* 🔴 `BR-37`: 書き込み操作なしを常時明示する。
            🔴 バッジの射程は「テナントの**業務データ**に対して閲覧のみ」である（`docs/04` §3.3-4）。
               開設（`A-014`）は契約領域の操作であり、このバッジと共存する。 */}
        <Badge data-testid="admin-tenants-read-only-badge">{messages.readOnlyBadge}</Badge>
      </div>
    </div>
  );
}
