// apps/web/lib/home/types.test.ts
// 🔴 F-006 AC-1 / AC-2: `PartnerHomeView` / `HostHomeView` に境界外フィールドが無いことを
//    型テストで固定する（docs/05 §4.8「他にも提案があります」に相当するフィールドを持たない）。
//    実行時の固定は `apps/web/lib/home/service.test.ts` が担う。
import { describe, expectTypeOf, it } from 'vitest';
import type { MessageKey } from '@ses/i18n';
import type { HostHomeView, PartnerHomeView } from './types';

describe('HomeView の境界（型テスト）', () => {
  it('HostHomeView は audience / blocks / changedSince 以外のキーを持たない', () => {
    expectTypeOf<HostHomeView>().toEqualTypeOf<{
      readonly audience: 'HOST';
      readonly blocks: readonly never[];
      readonly changedSince: string;
    }>();
  });

  it('🔴 PartnerHomeView は許可された 4 キーのみを持つ（他社の件数・存在フィールドを増やさない）', () => {
    expectTypeOf<PartnerHomeView>().toEqualTypeOf<{
      readonly audience: 'PARTNER';
      readonly blocks: readonly never[];
      readonly changedSince: string;
      readonly visibilityNotice: { readonly messageKey: MessageKey };
    }>();
  });
});
