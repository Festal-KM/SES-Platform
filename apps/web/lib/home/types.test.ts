// apps/web/lib/home/types.test.ts
// 🔴 F-006 AC-1 / AC-2: `PartnerHomeView` / `HostHomeView` に境界外フィールドが無いことを
//    型テストで固定する（docs/05 §4.8「他にも提案があります」に相当するフィールドを持たない）。
//    実行時の固定は `apps/web/lib/home/service.test.ts` が担う。
//
// 🔴 T-05-08: `HomeBlock` に最初のケース（`SCAN_QUARANTINE`）が入った。**ブロックの中身にも
//    境界がある** —— 氏名・他社の件数・他社の存在を示唆する値を持たないことをここで固定する。
// 🔴 T-12-15: 2 つ目のケース（`ACTION_QUEUE`。要対応キュー）が入った。行は
//    `engineerId` / 所属会社名 / 件数の合計 / 順位（「あなたは N 番目」）に相当するキーを持たない。
// 🔴 T-22-09: 3 つ目のケース（`SUMMARY`。`SummaryStrip` の件数）が入り、行に `stateBadge` / `action` が
//    足された（docs/05 §6.11.1 / §6.11.2）。🔴 **取引先の指標に他社を示唆する `kind` が無いこと**と、
//    🔴 **`enabled === false` のとき `reasonKey` が非 null であること**を型で固定する。
import { describe, expectTypeOf, it } from 'vitest';
import type { ProposalRequestState, ProposalState, QuarantinedScanStatus } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import type {
  ActionQueueActionAvailability,
  ActionQueueActionKind,
  ActionQueueHomeBlock,
  ActionQueueKind,
  ActionQueueRow,
  HomeBlock,
  HostHomeView,
  HostSummaryMetricKind,
  PartnerHomeView,
  PartnerSummaryMetricKind,
  SummaryHomeBlock,
  SummaryMetric,
  SummaryMetricDelta,
} from './types';

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
  readonly stateBadge:
    | { readonly entity: 'PROPOSAL'; readonly state: ProposalState }
    | { readonly entity: 'PROPOSAL_REQUEST'; readonly state: ProposalRequestState };
  readonly action: { readonly kind: ActionQueueActionKind; readonly href: string } | null;
};

type ExpectedActionQueueBlock = {
  readonly kind: 'ACTION_QUEUE';
  readonly targetIds: readonly string[];
  readonly items: readonly ExpectedActionQueueRow[];
  readonly actionAvailability: Readonly<Record<ActionQueueActionKind, ActionQueueActionAvailability>>;
};

type ExpectedSummaryBlock =
  | {
      readonly kind: 'SUMMARY';
      readonly audience: 'HOST';
      readonly items: readonly SummaryMetric<HostSummaryMetricKind>[];
      /** ✅ 2026-10-02（改訂 23）: 初回空（案件も人材も 0 件）。🔴 **真偽値 1 つだけ**。 */
      readonly initialEmpty: boolean;
    }
  | {
      readonly kind: 'SUMMARY';
      readonly audience: 'PARTNER';
      readonly items: readonly SummaryMetric<PartnerSummaryMetricKind>[];
      readonly initialEmpty: boolean;
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

  it('🔴 HomeBlock は隔離ブロック / 要対応キュー / 件数の 3 ケース（追加専用。既存メンバーの意味を変えない）', () => {
    expectTypeOf<HomeBlock>().toEqualTypeOf<
      ExpectedQuarantineBlock | ExpectedActionQueueBlock | ExpectedSummaryBlock
    >();
  });

  it('🔴 T-05-08: 隔離ブロックは 5 つのキーのみを持つ（氏名・所属会社名を持たない）', () => {
    expectTypeOf<Extract<HomeBlock, { kind: 'SCAN_QUARANTINE' }>>().toEqualTypeOf<ExpectedQuarantineBlock>();
  });

  it('🔴 T-12-15 / T-22-09: 要対応キューの行は 10 キーのみ（engineerId / 所属会社名 / 件数の合計 / 順位を持たない）', () => {
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

// ============================================================================
// 🔴 T-22-09: `SummaryStrip` の指標の境界（docs/05 §6.11.1 / `BR-07` / `F-004 AC-4`）
// ============================================================================
describe('🔴 SUMMARY ブロックの境界（型テスト）', () => {
  it('✅ 改訂 23: ホストの指標は 4 kind（`docs/04` §4.1 の表 = 今日やること / 返信待ち / 面談予定 / 今週の提案）', () => {
    expectTypeOf<HostSummaryMetricKind>().toEqualTypeOf<
      'ACTION_QUEUE' | 'AWAITING_REPLY' | 'INTERVIEWS' | 'PROPOSALS_THIS_WEEK'
    >();
  });

  it('🔴 取引先の指標は 4 kind で、すべて自社スコープの件数である', () => {
    expectTypeOf<PartnerSummaryMetricKind>().toEqualTypeOf<
      'REQUESTS_TO_ANSWER' | 'AWAITING_REPLY' | 'INTERVIEWS' | 'PUBLISHED_THIS_WEEK'
    >();
  });

  it('🔴 他社を示唆する kind が型として存在しない（フィルタで落とすのではなく存在させない）', () => {
    // 🔴 `BR-07` / `F-004 AC-4`: 他社の件数・比較・順位・「他 N 社」に相当する指標は
    //    **応答の型に存在してはならない**。存在すれば、どこかの経路で値が入る。
    type Forbidden =
      | 'TOTAL_PROJECTS'
      | 'TOTAL_PROPOSALS'
      | 'RANK'
      | 'COMPARISON'
      | 'OTHER_COMPANIES'
      | 'SAME_PROJECT_PROPOSALS';
    // `Extract` が空（`never`）= どちらの kind 集合にも含まれていない。
    expectTypeOf<Extract<PartnerSummaryMetricKind, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<HostSummaryMetricKind, Forbidden>>().toEqualTypeOf<never>();
  });

  it('🔴 1 指標のキーは kind / count / href / delta の 4 つだけ（ラベル・色・前月比・率を持たない）', () => {
    expectTypeOf<SummaryMetric<HostSummaryMetricKind>>().toEqualTypeOf<{
      readonly kind: HostSummaryMetricKind;
      readonly count: number;
      readonly href: string | null;
      readonly delta: SummaryMetricDelta | null;
    }>();
    expectTypeOf<SummaryMetric<HostSummaryMetricKind>>().not.toHaveProperty('label');
    expectTypeOf<SummaryMetric<HostSummaryMetricKind>>().not.toHaveProperty('previousCount');
    expectTypeOf<SummaryMetric<HostSummaryMetricKind>>().not.toHaveProperty('rate');
    expectTypeOf<SummaryMetric<HostSummaryMetricKind>>().not.toHaveProperty('amount');
  });

  it('🔴 ✅ 改訂 23: 差分は「件数の差 + 基準」の 2 キーだけ（率 / % / 達成率を型として持てない）', () => {
    expectTypeOf<SummaryMetricDelta>().toEqualTypeOf<{
      readonly basis: 'PREVIOUS_DAY' | 'PREVIOUS_WEEK';
      readonly count: number;
    }>();
    expectTypeOf<SummaryMetricDelta>().not.toHaveProperty('percent');
    expectTypeOf<SummaryMetricDelta>().not.toHaveProperty('rate');
    expectTypeOf<SummaryMetricDelta>().not.toHaveProperty('ratio');
    expectTypeOf<SummaryMetricDelta>().not.toHaveProperty('previousCount');
    // 🔴 **前月比・前年比の基準を作らない**（§7.2 は前月比を全画面で禁じている）。
    expectTypeOf<SummaryMetricDelta['basis']>().not.toEqualTypeOf<string>();
  });

  it('🔴 所属で分けた 2 つの合併型である（ホストの kind を取引先の応答に入れられない）', () => {
    expectTypeOf<SummaryHomeBlock>().toEqualTypeOf<ExpectedSummaryBlock>();
    type PartnerItems = Extract<SummaryHomeBlock, { audience: 'PARTNER' }>['items'];
    expectTypeOf<PartnerItems>().toEqualTypeOf<readonly SummaryMetric<PartnerSummaryMetricKind>[]>();
  });
});

// ============================================================================
// 🔴 T-22-09: `操作` の可否（docs/05 §6.11.2）
// ============================================================================
describe('🔴 actionAvailability の境界（型テスト）', () => {
  it('操作は 4 kind（一括操作の kind を持たない）', () => {
    expectTypeOf<ActionQueueActionKind>().toEqualTypeOf<'APPROVE' | 'FIX' | 'RESEND' | 'RESPOND'>();
  });

  it('🔴 `enabled === false` のとき `reasonKey` は非 null（理由の無い不能を型で禁じる）', () => {
    type Denied = Extract<ActionQueueActionAvailability, { enabled: false }>;
    expectTypeOf<Denied['reasonKey']>().toEqualTypeOf<MessageKey>();
    type Allowed = Extract<ActionQueueActionAvailability, { enabled: true }>;
    expectTypeOf<Allowed['reasonKey']>().toEqualTypeOf<null>();
  });

  it('🔴 可否はブロック直下に 4 エントリ揃って在る（行ごとに持たない = 差分と矛盾しない）', () => {
    expectTypeOf<ActionQueueHomeBlock['actionAvailability']>().toEqualTypeOf<
      Readonly<Record<ActionQueueActionKind, ActionQueueActionAvailability>>
    >();
    expectTypeOf<ActionQueueRow>().not.toHaveProperty('actionAvailability');
    // 🔴 行の `action` は 1 つ（配列にしない）。
    expectTypeOf<NonNullable<ActionQueueRow['action']>>().toEqualTypeOf<{
      readonly kind: ActionQueueActionKind;
      readonly href: string;
    }>();
  });

  it('🔴 状態バッジは「エンティティ + 状態」の組だけ（色・バリアント名・表示文字列を持たない）', () => {
    expectTypeOf<ActionQueueRow['stateBadge']>().toEqualTypeOf<
      | { readonly entity: 'PROPOSAL'; readonly state: ProposalState }
      | { readonly entity: 'PROPOSAL_REQUEST'; readonly state: ProposalRequestState }
    >();
    expectTypeOf<ActionQueueRow['stateBadge']>().not.toHaveProperty('variant');
    expectTypeOf<ActionQueueRow['stateBadge']>().not.toHaveProperty('label');
    expectTypeOf<ActionQueueRow['stateBadge']>().not.toHaveProperty('color');
  });
});
