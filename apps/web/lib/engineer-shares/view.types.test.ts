// apps/web/lib/engineer-shares/view.types.test.ts
// 🔴 `GET /api/engineer-shares`（#29）の応答の**型**を固定する（T-11-11。docs/05 §6.4「#29 の改訂」/ §17.2 #33 ①）。
//
// 🔴 なぜ型で固定するのか（`projects/list-view.types.test.ts` と同じ理由）: `undefined` を返す実装は
//    `JSON.stringify` が落とすので手元では正しく見え、シリアライザを 1 つ変えた日に漏れる。
//    「フィールドが存在しない」を型で言い切っておけば、値を入れた実装は**コンパイルで落ちる**。
// 🔴 実行時の固定（`Object.keys(body)` が `['items','nextCursor']`）は `tests/isolation/engineer-shares.test.ts` が担う。
//
// 🔴 本ファイルは `import type` だけを使う（`service.ts` の実行時依存〔`@ses/db`〕を引き込まない）。
import { describe, expectTypeOf, it } from 'vitest';
import type { RoundedAnonymousAttributes } from '@ses/domain';
import type { CursorPage } from '../api/pagination';
import type {
  EngineerShareCandidateView,
  EngineerShareListView,
  EngineerShareUpdateView,
} from './service';

describe('🔴 EngineerShareListView は `{ items, nextCursor }` の 2 キー（総件数・残件数を返さない。docs/05 §4.8）', () => {
  it('`CursorPage<EngineerShareCandidateView>` と同一の型である', () => {
    expectTypeOf<EngineerShareListView>().toEqualTypeOf<CursorPage<EngineerShareCandidateView>>();
  });

  it('🔴 `total` / `remaining` / `page` / `ledgerEmpty` をキーとして持たない', () => {
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('total');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('remaining');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('page');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('ledgerEmpty');
    expectTypeOf<keyof EngineerShareListView>().toEqualTypeOf<'items' | 'nextCursor'>();
  });

  it('🔴 総件数を入れた実装はコンパイルできない', () => {
    const withTotal: EngineerShareListView = {
      items: [],
      nextCursor: null,
      // @ts-expect-error 🔴 「他に N 件あります」に相当するフィールドを型に持たない（docs/05 §4.8）。
      total: 3,
    };
    const withLedgerEmpty: EngineerShareListView = {
      items: [],
      nextCursor: null,
      // @ts-expect-error 🔴 初回空の判定は `hasAnyEngineer` を API とは別に読む（応答に足さない）。
      ledgerEmpty: true,
    };
    expectTypeOf(withTotal).toEqualTypeOf<EngineerShareListView>();
    expectTypeOf(withLedgerEmpty).toEqualTypeOf<EngineerShareListView>();
  });
});

describe('🔴 items[] の形（`engineerId` / `displayName` / `shared` / `sharedOn` / `proposalRequestCount` / `previewedFields`）を変えない', () => {
  it('キー集合が固定されている', () => {
    expectTypeOf<keyof EngineerShareCandidateView>().toEqualTypeOf<
      'engineerId' | 'displayName' | 'shared' | 'sharedOn' | 'proposalRequestCount' | 'previewedFields'
    >();
    expectTypeOf<EngineerShareCandidateView['previewedFields']>().toEqualTypeOf<RoundedAnonymousAttributes>();
  });

  it('🔴 丸める前の値（生の単価・稼働可能日・市区町村・連絡先）のフィールドが無い', () => {
    expectTypeOf<EngineerShareCandidateView>().not.toHaveProperty('unitPriceMin');
    expectTypeOf<EngineerShareCandidateView>().not.toHaveProperty('availableFrom');
    expectTypeOf<EngineerShareCandidateView>().not.toHaveProperty('city');
    expectTypeOf<EngineerShareCandidateView>().not.toHaveProperty('contactEmail');
  });
});

describe('🔴 PUT の応答は `{ engineerId, shared, sharedOn, previewedFields }` のまま（`sharedAt` を足さない。`P-A-23`）', () => {
  it('キー集合が固定されている', () => {
    expectTypeOf<keyof EngineerShareUpdateView>().toEqualTypeOf<
      'engineerId' | 'shared' | 'sharedOn' | 'previewedFields'
    >();
    expectTypeOf<EngineerShareUpdateView>().not.toHaveProperty('sharedAt');
  });
});
