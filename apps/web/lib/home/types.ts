// apps/web/lib/home/types.ts
// `GET /api/me`（docs/05 §6.3 #8）/ `GET /api/home`（#9）の応答型。`S-003`（ホスト）/
// `S-004`（取引先）。T-03-06（docs/sprints/SP-03-auth-audit-admin0.md）。
//
// 🔴 ロールで応答の型が違う（`HostHomeView` / `PartnerHomeView`。docs/05 §4.8 / §6.3 #9）。
//    「他にも提案があります」「あなたは N 番目」に相当するフィールドを型に持たない
//    （docs/04 program-design 申し送り 1）。`PartnerHomeView` の境界は
//    `apps/web/lib/home/types.test.ts` が型テストで固定する。
//
// 🔴 Phase 0 は空のダッシュボード（CLAUDE.md §5）。承認待ち・送信失敗・公開案件・提案依頼は
//    Phase 1、満了間近は Phase 2 が `HomeBlock` にケースを追加する。**追加専用**
//    （既存メンバーの意味を変えない）。Phase 0 の時点では実装済みのブロック種別が無いため、
//    `HomeBlock = never` にして「実装していない中身を黙って返す」余地自体を型で塞ぐ
//    （`blocks` は必ず空配列になる）。
import type { AppEnvKind } from '@ses/config';
import type { TenantLifecycleState, TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';

/** Phase 1 以降がケースを追加する（`kind` 判別子を持つ discriminated union を想定）。 */
export type HomeBlock = never;

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
