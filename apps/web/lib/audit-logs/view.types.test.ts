// apps/web/lib/audit-logs/view.types.test.ts
// 🔴 T-11-09: `GET /api/audit-logs`（#10）の応答型に **`summary` が無い**ことを型で固定する
//    （docs/05 §6.4「#10 の改訂」「応答の型」の 3 点）。
//
// 🔴 なぜ型テストか: 「生 JSON が画面に届かない」は結合テストの入力を増やしても証明できない。
//    `summary: unknown` を型に通す変更は、ここがコンパイルエラーで落とす。
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AuditLogListItem as ServiceItem } from './service';
import type { AuditDetailEntryView, AuditDetailValueView, AuditDetailView, AuditLogListItem } from './view';

type DetailKind = AuditDetailValueView['kind'];

/** ② 7 値の閉集合。 */
const KINDS_ARE_CLOSED: [
  DetailKind,
] extends ['ENUM' | 'BOOLEAN' | 'NUMBER' | 'DATE' | 'FIELD_NAMES' | 'NAME' | 'NAME_LIST']
  ? ['ENUM' | 'BOOLEAN' | 'NUMBER' | 'DATE' | 'FIELD_NAMES' | 'NAME' | 'NAME_LIST'] extends [DetailKind]
    ? true
    : never
  : never = true;

/** ③ 自由文を表す種類が無い。 */
type FreeTextLike = 'TEXT' | 'STRING' | 'FREE_TEXT' | 'RAW' | 'JSON' | 'UNKNOWN' | 'ANY';
const NO_FREE_TEXT_KIND: [Extract<DetailKind, FreeTextLike>] extends [never] ? true : never = true;

/** 値の型に `unknown` / 入れ子オブジェクトが無い（プリミティブと配列だけ）。 */
type ValueOf<K extends DetailKind> = Extract<AuditDetailValueView, { kind: K }>['value'];
const ENUM_IS_STRING: [ValueOf<'ENUM'>] extends [string] ? true : never = true;
const NAME_IS_NULLABLE_STRING: [ValueOf<'NAME'>] extends [string | null] ? true : never = true;
const NAME_LIST_KEEPS_POSITION: [ValueOf<'NAME_LIST'>] extends [readonly (string | null)[]] ? true : never = true;

describe('🔴 #10 の応答型に summary が無い（docs/05 §6.4「#10 の改訂」）', () => {
  it('① AuditLogListItem は summary を持たない（service の再 export も同じ型）', () => {
    expectTypeOf<AuditLogListItem>().not.toHaveProperty('summary');
    expectTypeOf<ServiceItem>().not.toHaveProperty('summary');
    expectTypeOf<ServiceItem>().toEqualTypeOf<AuditLogListItem>();
    expectTypeOf<AuditDetailView>().not.toHaveProperty('summary');
    expectTypeOf<AuditDetailEntryView>().not.toHaveProperty('summary');
  });

  it('既存 10 項目 + detail + detailSuppressedReason の 12 キー', () => {
    expectTypeOf<keyof AuditLogListItem>().toEqualTypeOf<
      | 'id'
      | 'createdAt'
      | 'actorKind'
      | 'actorId'
      | 'actorDisplayName'
      | 'action'
      | 'targetType'
      | 'targetId'
      | 'ipAddress'
      | 'deviceKind'
      | 'detail'
      | 'detailSuppressedReason'
    >();
    expectTypeOf<AuditLogListItem['detailSuppressedReason']>().toEqualTypeOf<'PARTNER_LEDGER' | null>();
  });

  it('② ③ 種類は 7 値の閉集合で、自由文を表す種類が無い（コンパイルが通った時点で担保。ここは対照）', () => {
    expect(KINDS_ARE_CLOSED).toBe(true);
    expect(NO_FREE_TEXT_KIND).toBe(true);
    expect(ENUM_IS_STRING).toBe(true);
    expect(NAME_IS_NULLABLE_STRING).toBe(true);
    expect(NAME_LIST_KEEPS_POSITION).toBe(true);
  });

  it('対照: 検査そのものが空振りしていない（TEXT を足すと Extract が never でなくなる）', () => {
    type Tampered = AuditDetailValueView | { readonly kind: 'TEXT'; readonly value: string };
    type Found = Extract<Tampered['kind'], FreeTextLike>;
    const found: Found = 'TEXT';
    expect(found).toBe('TEXT');
  });
});
