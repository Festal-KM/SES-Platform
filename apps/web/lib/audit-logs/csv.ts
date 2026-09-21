// apps/web/lib/audit-logs/csv.ts
// `S-041` の CSV エクスポート（#10b `GET /api/audit-logs/export`。docs/05 §6.3 #10b / §6.4「CSV エクスポート」行 /
// `docs/04` §S-041 セクション 4）の CSV 生成（純粋関数）。T-12-18 ⑪。
//
// 🔴 ヘッダは **6 列固定** = 画面の既存 5 列 + `actorDisplayName`（`AUDIT_LOG_CSV_COLUMNS`）。列の増減は `csv.test.ts` の
//    インラインスナップショットの差分になる。`id` / `detailSuppressedReason` は載せない。
// 🔴 **行の詳細（許可リストを通った項目）の列は無い**（許可リストとパートナー由来の規則を CSV 生成側にも複製すると 2 実装になる。
//    `docs/04` §S-041）。本モジュールは応答の固定形（`AuditLogListItem`）のうち 6 列に対応するプロパティしか読まず、
//    行の詳細に相当する識別子を持たない（`tests/static/audit-detail-single-path.test.ts` の CSV 検査が固定する）。
// 🔴 セルの無害化・引用・BOM・改行は `packages/domain/src/export/csv.ts` の `encodeCsv`（`sanitizeCsvCellText` を内側で掛ける）を
//    **共用**する（返却 CSV〔`S-042`〕と監査 CSV で 2 実装にしない。T-12-17 ⑲ (a) / [Issue #68](https://github.com/Festal-KM/SES-Platform/issues/68)）。
//    先頭が `=` / `+` / `-` / `@` / タブ / CR の値（`actorDisplayName` / `action` / `target` に来うる）には `'` が前置される。
import { encodeCsv, type CsvCell } from '@ses/domain';
import type { AuditLogListItem } from './view';

/** 🔴 6 列固定（docs/05 §6.4「CSV エクスポート」行 ②）。並びもこのまま。 */
export const AUDIT_LOG_CSV_COLUMNS = [
  'createdAt',
  'actorKind',
  'actorDisplayName',
  'action',
  'target',
  'ipAndDevice',
] as const;

export type AuditLogCsvColumn = (typeof AUDIT_LOG_CSV_COLUMNS)[number];

/** `Content-Type`（UTF-8 BOM 付き RFC 4180。日本語版の表計算ソフトで開いて文字化けしない）。 */
export const AUDIT_LOG_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/** 画面の「対象」列と同じ合成（`targetType:targetId`。どちらも無ければ空）。 */
function targetCell(item: AuditLogListItem): string {
  const parts = [item.targetType, item.targetId].filter((part): part is string => part !== null);
  return parts.join(':');
}

/** 画面の「IP・デバイス種別」列と同じ合成（`ipAddress deviceKind` を空白 1 つで連結。無い側は落とす）。 */
function ipAndDeviceCell(item: AuditLogListItem): string {
  const parts = [item.ipAddress, item.deviceKind].filter((part): part is string => part !== null);
  return parts.join(' ');
}

/** 1 行を 6 列に写す。🔴 `SYSTEM` / `PLATFORM_USER` の表示名は空（#10 の `actorDisplayName` そのまま）。 */
export function auditLogToCsvRow(item: AuditLogListItem): readonly CsvCell[] {
  return [
    item.createdAt,
    item.actorKind,
    item.actorDisplayName ?? '',
    item.action,
    targetCell(item),
    ipAndDeviceCell(item),
  ];
}

/**
 * ヘッダ 1 行 + データ行の CSV 文字列（UTF-8 BOM 付き。行末 `\r\n`）。純粋関数。
 * 🔴 `items` は #10（`listAuditLogs`）が返した固定形であり、ここで境界の判定はしない（読む列を選ぶだけ）。
 */
export function auditLogsToCsv(items: readonly AuditLogListItem[]): string {
  return encodeCsv(AUDIT_LOG_CSV_COLUMNS, items.map(auditLogToCsvRow));
}
