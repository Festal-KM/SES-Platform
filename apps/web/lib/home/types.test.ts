// apps/web/lib/home/types.test.ts
// 🔴 F-006 AC-1 / AC-2: `PartnerHomeView` / `HostHomeView` に境界外フィールドが無いことを
//    型テストで固定する（docs/05 §4.8「他にも提案があります」に相当するフィールドを持たない）。
//    実行時の固定は `apps/web/lib/home/service.test.ts` が担う。
//
// 🔴 T-05-08: `HomeBlock` に最初のケース（`SCAN_QUARANTINE`）が入った。**ブロックの中身にも
//    境界がある** —— 氏名・他社の件数・他社の存在を示唆する値を持たないことをここで固定する。
import { describe, expectTypeOf, it } from 'vitest';
import type { QuarantinedScanStatus } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import type { HomeBlock, HostHomeView, PartnerHomeView } from './types';

type ExpectedQuarantineBlock = {
  readonly kind: 'SCAN_QUARANTINE';
  readonly items: readonly {
    readonly skillSheetId: string;
    readonly engineerId: string;
    readonly version: number;
    readonly scanStatus: QuarantinedScanStatus;
    readonly detectedAt: string | null;
  }[];
};

describe('HomeView の境界（型テスト）', () => {
  it('HostHomeView は audience / blocks / changedSince 以外のキーを持たない', () => {
    expectTypeOf<HostHomeView>().toEqualTypeOf<{
      readonly audience: 'HOST';
      readonly blocks: readonly HomeBlock[];
      readonly changedSince: string;
    }>();
  });

  it('🔴 PartnerHomeView は許可された 4 キーのみを持つ（他社の件数・存在フィールドを増やさない）', () => {
    expectTypeOf<PartnerHomeView>().toEqualTypeOf<{
      readonly audience: 'PARTNER';
      readonly blocks: readonly HomeBlock[];
      readonly changedSince: string;
      readonly visibilityNotice: { readonly messageKey: MessageKey };
    }>();
  });

  it('🔴 T-05-08: 隔離ブロックは 5 つのキーのみを持つ（氏名・所属会社名を持たない）', () => {
    expectTypeOf<HomeBlock>().toEqualTypeOf<ExpectedQuarantineBlock>();
  });

  it('🔴 ホストとパートナーで blocks の型が同じである（周知が片側だけにならない）', () => {
    expectTypeOf<HostHomeView['blocks']>().toEqualTypeOf<PartnerHomeView['blocks']>();
  });
});
