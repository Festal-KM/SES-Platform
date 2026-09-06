// apps/web/lib/home/types.ts
// `GET /api/me`（docs/05 §6.3 #8）/ `GET /api/home`（#9）の応答型。`S-003`（ホスト）/
// `S-004`（取引先）。T-03-06（docs/sprints/SP-03-auth-audit-admin0.md）。
//
// 🔴 ロールで応答の型が違う（`HostHomeView` / `PartnerHomeView`。docs/05 §4.8 / §6.3 #9）。
//    「他にも提案があります」「あなたは N 番目」に相当するフィールドを型に持たない
//    （docs/04 program-design 申し送り 1）。`PartnerHomeView` の境界は
//    `apps/web/lib/home/types.test.ts` が型テストで固定する。
//
// 🔴 承認待ち・送信失敗・公開案件・提案依頼は Phase 1、満了間近は Phase 2 が
//    `HomeBlock` にケースを追加する。**追加専用**（既存メンバーの意味を変えない）。
//    T-05-08 で最初のケース（`SCAN_QUARANTINE`）が入った。
import type { AppEnvKind } from '@ses/config';
import type { TenantLifecycleState, TenantRole } from '@ses/db';
import type { QuarantinedScanStatus } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';

/**
 * 🔴 スキャン失敗・隔離の周知（`docs/02` `F-011` 処理④）。T-05-08。
 *
 * 🔴 **ホストにもパートナーにも同じ形で出る。** `F-011` 処理④ は「アプリ内表示は分類によらず
 *    必ず行う（パートナーの担当者が隔離に気づけない状態にならない）」と定めており、
 *    メールがモックになる `sandbox` の分類 2 でも、この表示だけは必ず成立する。
 * 🔴 **他社の情報を含まない。** 中身は `skill_sheets` の RLS（C3 OWNER_SCOPED）で
 *    絞られた自社所有の版だけであり、件数も自社スコープ内である
 *    （`docs/04` §S-004「自社スコープ内の件数は許される」）。
 * 🔴 **氏名を持たない**（`QuarantinedSkillSheetView` と同じ理由。`BR-27`）。
 */
export type ScanQuarantineHomeBlock = {
  readonly kind: 'SCAN_QUARANTINE';
  readonly items: readonly {
    readonly skillSheetId: string;
    readonly engineerId: string;
    readonly version: number;
    readonly scanStatus: QuarantinedScanStatus;
    /** ISO 8601 / 未確定なら `null`。 */
    readonly detectedAt: string | null;
  }[];
};

/**
 * ホームのブロック。**追加専用**（既存メンバーの意味を変えない）。
 * Phase 1 / Phase 2 が要対応キュー・満了間近などのケースを足す。
 */
export type HomeBlock = ScanQuarantineHomeBlock;

export type HostHomeView = {
  readonly audience: 'HOST';
  readonly blocks: readonly HomeBlock[];
  /** 🔴 60 秒ポーリングの差分描画の基準時刻（docs/04 program-design 申し送り 6）。ISO 8601。 */
  readonly changedSince: string;
};

/**
 * 🔴 F-006 AC-2: パートナーのホームに常時表示する「見えない情報が存在すること」の説明。
 *    `messageKey` は固定文言のみを指す（`packages/i18n`）。件数・存在の示唆を一切含まない
 *    （パラメータ化された文言にしない。件数を差し込める形にした時点で示唆の経路になる）。
 */
export type PartnerVisibilityNotice = {
  readonly messageKey: MessageKey;
};

export type PartnerHomeView = {
  readonly audience: 'PARTNER';
  readonly blocks: readonly HomeBlock[];
  readonly changedSince: string;
  readonly visibilityNotice: PartnerVisibilityNotice;
};

export type HomeView = HostHomeView | PartnerHomeView;

/**
 * 🔴 主平面の実行系導線を出すかどうかの判定材料（`BR-31` / `F-004 AC-6` / `F-006 AC-3`）。
 *    Phase 0 には該当する導線が無い（承認・送信・DL は Phase 1 以降）が、`GET /api/me` は
 *    横断で使われる基盤エンドポイントであり、Phase 1 以降の画面がこの型をそのまま使う。
 *    §5.6 の管理平面 `Capabilities`（代理閲覧 / `mode` を持つ）とは別の型である
 *    （主平面のセッションに代理閲覧という概念は無い）。
 */
export type MainCapabilities = {
  readonly execute: {
    readonly approve: boolean;
    readonly submit: boolean;
    readonly download: boolean;
    readonly export: boolean;
  };
};

export type MeUser = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
};

export type MeView = {
  readonly user: MeUser;
  readonly role: TenantRole;
  readonly partnerCompanyId: string | null;
  readonly capabilities: MainCapabilities;
  readonly tenantState: TenantLifecycleState;
  readonly env: AppEnvKind;
};
