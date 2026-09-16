// apps/web/lib/usage/view.types.test.ts
// 🔴 T-10-03: テナント側の応答型（#69 `UsageView` / #70 `BlockedNoticeView`）に**金額（USD）の項目が存在しない**
//    ことを型で固定する（docs/02 `F-027 AC-6` / `BR-24` / Issue #12 / docs/05 §5.8 / §17.2 #18）。
//
// 🔴 なぜ型テストか: 「無いこと」はユニットテストの入力を増やしても証明できない。型の全キーを列挙して
//    金額らしい名前が 1 つも無いことを**コンパイル時**に確かめる（`tests/static/tenant-usage-no-money.test.ts`
//    〔T-10-04〕が `apps/web/app/api/(main)/**` の応答型を横断的に走査するまでの、この 2 型に閉じた担保）。
// 🔴 例外は `overageEstimateJpy`（請求見込み。残量の提示ではない。docs/04 §S-038 セクション 6）だけであり、
//    その名前は `usd` / `cost` / `price` を含まない（円の請求見込みであることが名前から読める）。
import { describe, expect, it } from 'vitest';
import type { AiDailyStopView, BlockedNoticeView, UsageView } from './view.js';

/** 配列・オブジェクト・合併を再帰的に辿って**すべてのプロパティ名**を列挙する。 */
type DeepKeys<T> = T extends readonly (infer U)[]
  ? DeepKeys<U>
  : T extends object
    ? { [K in keyof T & string]: K | DeepKeys<T[K]> }[keyof T & string]
    : never;

/** 金額らしい名前（大文字小文字の主な綴り）。 */
type MoneyLike =
  `${string}${'usd' | 'Usd' | 'USD' | 'cost' | 'Cost' | 'COST' | 'price' | 'Price' | 'PRICE' | 'amount' | 'Amount'}${string}`;

type UsageViewKeys = DeepKeys<UsageView>;
type BlockedNoticeKeys = DeepKeys<BlockedNoticeView>;

// 🔴 金額らしいキーが 1 つでもあれば `never` にならず、この代入がコンパイルエラーになる。
const USAGE_VIEW_HAS_NO_MONEY_KEY: [Extract<UsageViewKeys, MoneyLike>] extends [never] ? true : never = true;
const BLOCKED_NOTICE_HAS_NO_MONEY_KEY: [Extract<BlockedNoticeKeys, MoneyLike>] extends [never] ? true : never = true;

// 🔴 `gate-inspector` のキーが残量（`aiUnits`）に存在しない（`F-027 AC-7`）。
type AiUnitKeys = keyof UsageView['aiUnits'];
const NO_GATE_INSPECTOR_UNIT: [Extract<AiUnitKeys, `${string}${'gate' | 'Gate' | 'inspector' | 'Inspector'}${string}`>] extends [never]
  ? true
  : never = true;

// 🔴 #70 は停止の事実と理由だけ（残量・上限・リセット時刻・停止時刻を持たない。`F-027 AC-1`）。
const BLOCKED_NOTICE_KEYS_ARE_MINIMAL: [Exclude<BlockedNoticeKeys, 'blocked' | 'reasonKey'>] extends [never] ? true : never = true;

// 🔴 ホストの停止表示には `resetAt` がある（再開時刻。`F-027 AC-1` の「ホストには表示される」）。
const HOST_STOP_HAS_RESET_AT: 'resetAt' extends DeepKeys<AiDailyStopView> ? true : never = true;

describe('🔴 テナント側の応答型に金額（USD）の項目が無い（F-027 AC-6 / BR-24）', () => {
  it('型レベルの検査が成立している（コンパイルが通った時点で担保。ここは対照）', () => {
    expect(USAGE_VIEW_HAS_NO_MONEY_KEY).toBe(true);
    expect(BLOCKED_NOTICE_HAS_NO_MONEY_KEY).toBe(true);
    expect(NO_GATE_INSPECTOR_UNIT).toBe(true);
    expect(BLOCKED_NOTICE_KEYS_ARE_MINIMAL).toBe(true);
    expect(HOST_STOP_HAS_RESET_AT).toBe(true);
  });

  it('対照: 検査そのものが空振りしていない（金額らしいキーを足すと Extract が never でなくなる）', () => {
    type Tampered = UsageView & { readonly aiDailyStop: { readonly costUsd: string } };
    type Found = Extract<DeepKeys<Tampered>, MoneyLike>;
    const found: Found = 'costUsd';
    expect(found).toBe('costUsd');
  });
});
