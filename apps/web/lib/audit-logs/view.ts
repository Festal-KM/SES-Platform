// apps/web/lib/audit-logs/view.ts
// `GET /api/audit-logs`（#10 / `S-041`）の応答型（docs/05 §6.4「#10 の改訂」。T-11-09）。
//
// 🔴 `summary` というプロパティは**型に存在しない**（`view.types.test.ts` が固定）。画面が受け取るのは、
//    `packages/domain` の `pickAuditDetail` が許可リストで選び、`listAuditLogs` が ID を表示名に解決した
//    **固定形の DTO** だけである。値は 7 種の判別可能な合併で、**自由文を表す種類が無い**。
// 🔴 `NAME` / `NAME_LIST` の `null` = 解決できない（削除済み）。画面が「削除済みの取引先」を描く
//    （`docs/04` §10.3 の `null` 規約。空欄にしない）。配列は位置を保つ（長さ = ID の数）。
import type { AuditActorKind, AuditDeviceKind } from '@ses/db';
import type { AuditDetailPair, AuditDetailSuppressedReason } from '@ses/domain';

export type AuditDetailValueView =
  | { readonly kind: 'ENUM'; readonly value: string }
  | { readonly kind: 'BOOLEAN'; readonly value: boolean | null }
  | { readonly kind: 'NUMBER'; readonly value: number }
  | { readonly kind: 'DATE'; readonly value: string | null }
  | { readonly kind: 'FIELD_NAMES'; readonly value: readonly string[] }
  | { readonly kind: 'NAME'; readonly value: string | null }
  | { readonly kind: 'NAME_LIST'; readonly value: readonly (string | null)[] };

export type AuditDetailEntryView = {
  /** `summary` のキー名（i18n のラベルキー）。 */
  readonly key: string;
  readonly pair: AuditDetailPair | null;
  readonly value: AuditDetailValueView;
};

export type AuditDetailView = { readonly entries: readonly AuditDetailEntryView[] };

export type AuditLogListItem = {
  readonly id: string;
  readonly createdAt: string;
  readonly actorKind: AuditActorKind;
  readonly actorId: string | null;
  /** 🔴 `actorKind === 'USER'` のときのみ解決する。削除済み・未確認の利用者は `null`。 */
  readonly actorDisplayName: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly ipAddress: string | null;
  readonly deviceKind: AuditDeviceKind | null;
  /** 許可リスト適用 + 名前解決済みの詳細。`SUPPRESSED` / 0 キーのときは `{ entries: [] }`。 */
  readonly detail: AuditDetailView;
  /** 🔴 主体がパートナー所属で台帳系 4 族の行（`U-17`）。画面は理由テキストを常時描く。 */
  readonly detailSuppressedReason: AuditDetailSuppressedReason | null;
};
