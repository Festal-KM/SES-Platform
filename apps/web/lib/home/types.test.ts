// apps/web/lib/home/types.test.ts
// 🔴 F-006 AC-1 / AC-2: `PartnerHomeView` / `HostHomeView` に境界外フィールドが無いことを
//    型テストで固定する（docs/05 §4.8「他にも提案があります」に相当するフィールドを持たない）。
//    実行時の固定は `apps/web/lib/home/service.test.ts` が担う。
//
// 🔴 T-05-08: `HomeBlock` に最初のケース（`SCAN_QUARANTINE`）が入った。**ブロックの中身にも
//    境界がある** —— 氏名・他社の件数・他社の存在を示唆する値を持たないことをここで固定する。
// 🔴 T-12-15: 2 つ目のケース（`ACTION_QUEUE`。要対応キュー）が入った。行は 8 キーだけであり、
//    `engineerId` / 所属会社名 / 件数の合計 / 順位（「あなたは N 番目」）に相当するキーを持たない。
import { describe, expectTypeOf, it } from 'vitest';
import type { QuarantinedScanStatus } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import type { ActionQueueHomeBlock, ActionQueueKind, ActionQueueRow, HomeBlock, HostHomeView, PartnerHomeView } from './types';

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

type ExpectedActionQueueRow = {
  readonly kind: ActionQueueKind;
  readonly targetId: string;
  readonly subjectLabel: string;
  readonly counterpartyLabel: string | null;
  readonly since: string;
  readonly deadline: string | null;
  readonly rowVersion: number;
  readonly href: string;
};

type ExpectedActionQueueBlock = {
  readonly kind: 'ACTION_QUEUE';
  readonly targetIds: readonly string[];
  readonly items: readonly ExpectedActionQueueRow[];
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

  it('🔴 HomeBlock は隔離ブロックと要対応キューの 2 ケース（追加専用。既存メンバーの意味を変えない）', () => {
    expectTypeOf<HomeBlock>().toEqualTypeOf<ExpectedQuarantineBlock | ExpectedActionQueueBlock>();
  });

  it('🔴 T-05-08: 隔離ブロックは 5 つのキーのみを持つ（氏名・所属会社名を持たない）', () => {
    expectTypeOf<Extract<HomeBlock, { kind: 'SCAN_QUARANTINE' }>>().toEqualTypeOf<ExpectedQuarantineBlock>();
  });

  it('🔴 T-12-15: 要対応キューの行は 8 キーのみ（engineerId / 所属会社名 / 件数の合計 / 順位を持たない）', () => {
    expectTypeOf<ActionQueueRow>().toEqualTypeOf<ExpectedActionQueueRow>();
    expectTypeOf<ActionQueueHomeBlock>().toEqualTypeOf<ExpectedActionQueueBlock>();
    // 🔴 「他にも N 件」「あなたは N 番目」に相当するキーが**型として存在しない**。
    expectTypeOf<ActionQueueRow>().not.toHaveProperty('engineerId');
    expectTypeOf<ActionQueueRow>().not.toHaveProperty('partnerCompanyName');
    expectTypeOf<ActionQueueRow>().not.toHaveProperty('rank');
    expectTypeOf<ActionQueueHomeBlock>().not.toHaveProperty('total');
    expectTypeOf<ActionQueueHomeBlock>().not.toHaveProperty('countByKind');
  });

  it('🔴 T-12-15: 種別は Phase 1 の 5 つ（LOST / DECLINED / WITHDRAWN / EXPIRED は「対応が要るもの」ではないので種別に無い）', () => {
    expectTypeOf<ActionQueueKind>().toEqualTypeOf<
      'SEND_FAILED' | 'APPROVAL_PENDING' | 'GATE_FAILED' | 'SEND_HELD' | 'PROPOSAL_REQUEST_PENDING'
    >();
  });

  it('🔴 ホストとパートナーで blocks の型が同じである（周知が片側だけにならない）', () => {
    expectTypeOf<HostHomeView['blocks']>().toEqualTypeOf<PartnerHomeView['blocks']>();
  });
});
