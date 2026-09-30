// apps/web/app/(main)/audit-logs/audit-log-detail.tsx
// `S-041` 行の詳細（行を開いたときの展開部。docs/04 §S-041「行の詳細」/ §11-15 / `U-17`。T-11-09）。
//
// 🔴 この部品は**描くだけ**である。選ぶ（許可リスト）のは `packages/domain` の `pickAuditDetail`、
//    伏せる（第二境界の判定）のはサーバ（`apps/web/lib/audit-logs/service.ts`）。ここは応答の固定形
//    （`AuditDetailView` / `detailSuppressedReason`）を「項目 / 変更前 / 変更後」の定義リストに並べる。
//    `@ses/domain` の `pickAuditDetail` / `AUDIT_DETAIL_ALLOWLIST` / `maskAuditSummary` を import しない
//    （docs/05 §17.2 #32 ③ が固定する）。
// 🔴 `SUPPRESSED` は理由テキストを**常時**置く（空白にしない）。0 キーは「詳細はありません」。
// 🔴 `null` 要素（削除済み・解決不能）は空欄にせず `削除済みの取引先` を描く（docs/04 §10.3 の null 規約）。
//    20 社を超えても「他 N 社」で省略しない（docs/04 §10.3 `S-041` 行。省略した瞬間に `F-014 AC-5` が欠ける）。
// 🔴 未知の列挙値・キーはトークンのまま描く（形の検査を通った大文字スネークであり自由文ではない）。
// 🔴 モバイルでも展開でき、3 列は縦に積む（`grid` の 1 列 → `sm` 以上で 3 列。`CLAUDE.md` §13.3）。
//
// 🔴 **SP-22 `T-22-07` で変えたのは見せ方だけである**（`docs/04` §7.9 / `docs/05` §17.7.1 (a)(f)(g)）:
//    実色（`text-slate-*` / `bg-slate-100` / `border-slate-100`）を semantic トークンへ、`text-sm` を
//    `--text-body`（**実寸は同じ 14px**）へ、`px-1.5 py-0.5` を spacing 7 段（`px-1`）へ寄せた。
//    🔴 **描くキー・値の種別・伏せる規則・testid は 1 つも変えていない**（許可リストの判定は
//    `packages/domain` の `pickAuditDetail` とサーバ側に在り、この部品は描くだけである）。
import type { AuditDetailEntryView, AuditDetailValueView, AuditLogListItem } from '../../../lib/audit-logs/view';
import type { AuditLogDetailMessages } from '../../../lib/audit-logs/detail-labels';

type Row =
  | { readonly kind: 'SINGLE'; readonly label: string; readonly entry: AuditDetailEntryView }
  | {
      readonly kind: 'PAIR';
      readonly label: string;
      readonly before: AuditDetailEntryView;
      readonly after: AuditDetailEntryView;
    };

/** 対（`pair.id` が同じ 2 件）を 1 行に畳む。片側しか無ければ単値（`membership.revoke` の `beforeRole`）。 */
function toRows(entries: readonly AuditDetailEntryView[], messages: AuditLogDetailMessages): readonly Row[] {
  const rows: Row[] = [];
  const consumed = new Set<number>();
  entries.forEach((entry, index) => {
    if (consumed.has(index)) return;
    if (entry.pair === null) {
      rows.push({ kind: 'SINGLE', label: messages.keyLabels[entry.key] ?? entry.key, entry });
      return;
    }
    const otherIndex = entries.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        !consumed.has(candidateIndex) &&
        candidate.pair !== null &&
        candidate.pair.id === entry.pair?.id &&
        candidate.pair.side !== entry.pair?.side,
    );
    if (otherIndex === -1) {
      rows.push({
        kind: 'SINGLE',
        label: messages.pairSideLabels[`${entry.pair.id}.${entry.pair.side}`] ?? messages.keyLabels[entry.key] ?? entry.key,
        entry,
      });
      return;
    }
    consumed.add(otherIndex);
    const other = entries[otherIndex] as AuditDetailEntryView;
    const [before, after] = entry.pair.side === 'BEFORE' ? [entry, other] : [other, entry];
    rows.push({ kind: 'PAIR', label: messages.pairLabels[entry.pair.id] ?? entry.pair.id, before, after });
  });
  return rows;
}

function enumLabel(key: string, token: string, messages: AuditLogDetailMessages): string {
  return messages.enumLabels[`${key}.${token}`] ?? messages.enumLabels[token] ?? token;
}

function nameLabel(key: string, value: string | null, messages: AuditLogDetailMessages): string {
  if (value !== null) return value;
  return messages.nullLabels[key] ?? messages.deletedPartnerCompany;
}

function ValueText({
  entryKey,
  value,
  messages,
}: {
  readonly entryKey: string;
  readonly value: AuditDetailValueView;
  readonly messages: AuditLogDetailMessages;
}) {
  switch (value.kind) {
    case 'ENUM':
      return <>{enumLabel(entryKey, value.value, messages)}</>;
    case 'BOOLEAN':
      return <>{value.value === null ? messages.booleanUnknown : value.value ? messages.booleanTrue : messages.booleanFalse}</>;
    case 'NUMBER':
      return <>{String(value.value)}</>;
    case 'DATE':
      return <>{value.value === null ? (messages.nullLabels[entryKey] ?? messages.dateNone) : value.value}</>;
    case 'FIELD_NAMES':
      return value.value.length === 0 ? (
        <>{messages.emptyList}</>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {value.value.map((name) => (
            <li key={name} className="rounded-sm bg-bg-inset px-1 font-mono text-xs text-fg">
              {messages.keyLabels[name] ?? name}
            </li>
          ))}
        </ul>
      );
    case 'NAME':
      return <>{nameLabel(entryKey, value.value, messages)}</>;
    case 'NAME_LIST':
      return value.value.length === 0 ? (
        <>{messages.emptyList}</>
      ) : (
        <ul className="flex flex-wrap gap-x-2 gap-y-1">
          {value.value.map((name, index) => (
            <li
              key={`${index}-${name ?? 'deleted'}`}
              data-testid={name === null ? 'audit-logs-detail-deleted-partner' : undefined}
              className={name === null ? 'text-fg-muted' : undefined}
            >
              {name ?? messages.deletedPartnerCompany}
            </li>
          ))}
        </ul>
      );
  }
}

export type AuditLogDetailProps = {
  readonly item: Pick<AuditLogListItem, 'id' | 'detail' | 'detailSuppressedReason'>;
  readonly messages: AuditLogDetailMessages;
};

export function AuditLogDetail({ item, messages }: AuditLogDetailProps) {
  if (item.detailSuppressedReason !== null) {
    return (
      <p data-testid="audit-logs-detail-suppressed" className="text-body text-fg-muted">
        {messages.suppressed[item.detailSuppressedReason]}
      </p>
    );
  }
  const rows = toRows(item.detail.entries, messages);
  if (rows.length === 0) {
    return (
      <p data-testid="audit-logs-detail-empty" className="text-body text-fg-muted">
        {messages.empty}
      </p>
    );
  }
  const hasPair = rows.some((row) => row.kind === 'PAIR');
  const gridClasses = hasPair
    ? 'sm:grid-cols-[minmax(8rem,1fr)_2fr_2fr] sm:gap-x-4'
    : 'sm:grid-cols-[minmax(8rem,1fr)_4fr] sm:gap-x-4';
  return (
    <div data-testid="audit-logs-detail-list" role="table" className="text-body">
      <div role="row" className={`hidden text-xs font-medium text-fg-muted sm:grid ${gridClasses}`}>
        <span role="columnheader">{messages.columnItem}</span>
        {hasPair ? (
          <>
            <span role="columnheader">{messages.columnBefore}</span>
            <span role="columnheader">{messages.columnAfter}</span>
          </>
        ) : (
          <span role="columnheader">{messages.columnValue}</span>
        )}
      </div>
      {rows.map((row) =>
        row.kind === 'PAIR' ? (
          <div
            key={`pair-${row.before.key}-${row.after.key}`}
            role="row"
            data-testid={`audit-logs-detail-row-${row.before.key}`}
            className={`grid grid-cols-1 gap-y-1 border-t border-border py-2 ${gridClasses}`}
          >
            <span role="rowheader" className="font-medium text-fg">
              {row.label}
            </span>
            <span role="cell" className="whitespace-normal">
              <span className="mr-1 text-xs text-fg-muted sm:hidden">{messages.columnBefore}:</span>
              <ValueText entryKey={row.before.key} value={row.before.value} messages={messages} />
            </span>
            <span role="cell" className="whitespace-normal">
              <span className="mr-1 text-xs text-fg-muted sm:hidden">{messages.columnAfter}:</span>
              <ValueText entryKey={row.after.key} value={row.after.value} messages={messages} />
            </span>
          </div>
        ) : (
          <div
            key={`single-${row.entry.key}`}
            role="row"
            data-testid={`audit-logs-detail-row-${row.entry.key}`}
            className={`grid grid-cols-1 gap-y-1 border-t border-border py-2 ${gridClasses}`}
          >
            <span role="rowheader" className="font-medium text-fg">
              {row.label}
            </span>
            <span role="cell" className={hasPair ? 'whitespace-normal sm:col-span-2' : 'whitespace-normal'}>
              <ValueText entryKey={row.entry.key} value={row.entry.value} messages={messages} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}
