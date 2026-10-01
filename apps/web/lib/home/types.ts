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
//    ✅ T-12-15 で 2 つ目のケース（`ACTION_QUEUE`。要対応キューの Phase 1 分）が入った。
//    ✅ T-22-09 で 3 つ目のケース（`SUMMARY`。`SummaryStrip` の件数）が入った（docs/05 §6.11.1）。
import type { AppEnvKind } from '@ses/config';
import type { TenantLifecycleState, TenantRole } from '@ses/db';
import type { ProposalRequestState, ProposalState, QuarantinedScanStatus } from '@ses/domain';
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
 * 🔴 要対応キューの種別（`docs/04` §S-003 セクション 1 の Phase 1 分 = 5 つ。T-12-15）。
 *
 * 4 つの「うまくいかなかった」（`GATE_FAILED` / `SUBMIT_FAILED` / `LOST` / `DECLINED`）のうち、キューに載るのは
 * **`GATE_FAILED` と `SUBMIT_FAILED`（= `SEND_FAILED`）だけ**である（`LOST` / `DECLINED` は終端であり「対応が要るもの」ではない。
 * `F-024 AC-2` / `BR-23` / `BR-60`）。`SEND_HELD`（送信保留）は `SEND_FAILED` と**別の種別**（docs/05 §10.4「失敗率の指標に混入させない」）。
 * `面談日程が未確定` / `延長確認` は Phase 2 が足す（追加専用）。
 */
export type ActionQueueKind =
  | 'SEND_FAILED'
  | 'APPROVAL_PENDING'
  | 'GATE_FAILED'
  | 'SEND_HELD'
  | 'PROPOSAL_REQUEST_PENDING';

/**
 * 🔴 行に置く「その行に対する 1 つの操作」の種類（docs/05 §6.11.2 の表。T-22-09）。
 *
 * 🔴 **1 行につき 1 つで、配列にしない**（ホームに一括操作を置かない。`docs/04` §S-003 / `F-021 AC-4`）。
 * 🔴 **画面は種別と状態から操作を推測しない** —— `action` はサーバ（`lib/home/action-queue.ts` の
 *    1 関数）が決める。
 */
export type ActionQueueActionKind = 'APPROVE' | 'FIX' | 'RESEND' | 'RESPOND';

/**
 * 🔴 操作が不能な 4 条件の結論（docs/05 §6.11.2。**ブロック直下に置く** = ctx 由来で全行に一様）。
 *
 * 🔴 **`enabled === false` のとき `reasonKey` は非 null であることを型で強制する**（判別共用体）。
 *    理由を持たない不能を作ると、画面はボタンを描かないまま**何も説明できない空白**になる
 *    （`U-10`「無効化されたボタンを置かないが、何も無い空白にもしない」）。
 * 🔴 **なぜ行ではなくブロック直下か**: ドメイン検証の完了やロール変更では行の `updated_at` が
 *    動かないため、行に持たせると差分応答（`rowVersion >= changedSince`）に乗らず
 *    クライアントの `action` が古いまま残る。ブロック直下なら**毎回全量返る**。
 */
export type ActionQueueActionAvailability =
  | { readonly enabled: true; readonly reasonKey: null }
  | { readonly enabled: false; readonly reasonKey: MessageKey };

/**
 * 🔴 行の状態バッジ（docs/05 §6.11.2）。**「エンティティ + 状態」の組**で返す。
 *
 * 🔴 **色・バリアント名・表示文字列を応答に入れない**（`StatusBadge` が色を決める。`docs/04` §5-13。
 *    1 箇所でしか色が決まらないことが §7.4 の意味の対応を守る唯一の方法である）。
 * 🔴 状態の型は**既存の単一出所**（`@ses/domain` の `ProposalState` / `ProposalRequestState`）を使う。
 *    新しい列挙を起こさない。
 */
export type ActionQueueStateBadge =
  | { readonly entity: 'PROPOSAL'; readonly state: ProposalState }
  | { readonly entity: 'PROPOSAL_REQUEST'; readonly state: ProposalRequestState };

/**
 * 🔴 要対応キューの 1 行（docs/05 §6.3 #9「T-12-15 の実装の決着」）。
 *
 * - `subjectLabel`（対象）… 提案の行 = 案件名 + **凍結側**のエンジニア名（`engineer_snapshots.display_name`。`S-019` と同じ出所）。
 *   🔴 ホストの `PROPOSAL_REQUEST_PENDING` の行 = 案件名 + 「共有候補（匿名）」の一語（`S-017` と同じ。経路 4 の段階であり、
 *   エンジニア名・`engineerId`・所属会社名を**型としても値としても**持たない）。
 * - `counterpartyLabel`（相手）… 提案先の社名。提案依頼の行は `null`（ホストには依頼先の社名を出さない。取引先には不要）。
 * - `since` … 経過時間の起点（提案 = `proposals.updated_at` / 依頼 = `proposal_requests.created_at`）。ISO 8601。
 * - `deadline` … 提案依頼の返答期限（`expiresAt`）。提案の行は `null`。
 * - `rowVersion` … 60 秒ポーリングの差分判別（`since` のエポックミリ秒。docs/04 申し送り 6）。
 * - `href` … 種別ごとの遷移先（`S-022` / `S-021` / `S-020` / `S-019` / `S-017` or `S-018`）。
 * - `stateBadge` … ✅ T-22-09（`docs/04` 改訂 16 の `状態` 列）。（`docs/04` の文面は「承認待ちの中の
 *   `GATE_RUNNING` 由来と `APPROVAL_PENDING` 由来が区別できない」。ただし本実装は `GATE_RUNNING` をキューに載せない
 *   〔`proposalActionKindOf`〕ので当てはまらない。）本実装で効くのは、種別だけでは読めない
 *   **`SEND_HELD` 行 = `APPROVED`（承認済みで送信待ち）/ `SEND_FAILED` 行 = `SUBMIT_FAILED`（送信失敗）** の現在の提案状態で、
 *   **押す前にどこで止まっているか**が読める。
 * - `action` … ✅ T-22-09（同・`操作` 列）。🔴 **ホストの `PROPOSAL_REQUEST_PENDING` は `null`**
 *   （返答するのは取引先であり、ホストにこの行の操作は無い）。
 */
export type ActionQueueRow = {
  readonly kind: ActionQueueKind;
  readonly targetId: string;
  readonly subjectLabel: string;
  readonly counterpartyLabel: string | null;
  readonly since: string;
  readonly deadline: string | null;
  readonly rowVersion: number;
  readonly href: string;
  readonly stateBadge: ActionQueueStateBadge;
  readonly action: { readonly kind: ActionQueueActionKind; readonly href: string } | null;
};

/**
 * 🔴 要対応キュー（`S-003` セクション 1 / `S-004` セクション 1・2）。T-12-15。
 *
 * - `targetIds` … **いまキューにある全行**の `targetId`（表示順）。`?changedSince=` を付けた差分応答でも全件を返す —— クライアントが
 *   「消えた行」（承認された・応諾された等）を判別する唯一の材料。
 * - `items` … `changedSince` 未指定なら全行、指定なら `rowVersion >= changedSince` の行だけ（変わっていない行は返さない）。
 * 🔴 **種別ごとの件数を 1 つの合計に丸めるフィールドを持たない**（丸めると 4 つの「うまくいかなかった」の混同の表示になる）。
 * 🔴 母集団は RLS（`proposals` = C5: 作成者 + ホスト / `proposal_requests` = C5: 依頼先 + ホスト）が決める。取引先に載るのは
 *    `PROPOSAL_REQUEST_PENDING`（自社宛）と `GATE_FAILED`（自社提案）だけであり、他社の件数・存在・順位を示唆する値を持たない。
 * 🔴 0 件でもブロックを省かない（`SCAN_QUARANTINE` と違い、キューは「空である」ことを画面が明示する。docs/04 §S-003「要対応 0 件」）。
 * 🔴 T-22-09: `actionAvailability` は **4 エントリを毎回全量返す**（差分と矛盾させない。上の
 *    `ActionQueueActionAvailability` の 🔴）。行が 0 件でも返る。
 */
export type ActionQueueHomeBlock = {
  readonly kind: 'ACTION_QUEUE';
  readonly targetIds: readonly string[];
  readonly items: readonly ActionQueueRow[];
  readonly actionAvailability: Readonly<Record<ActionQueueActionKind, ActionQueueActionAvailability>>;
};

/**
 * 🔴 `SummaryStrip` の指標（`Q-04-4` / docs/05 §6.11.1）。T-22-09。
 *
 * 🔴 **所属で分けた 2 つの合併型にする**（`HostHomeView` / `PartnerHomeView` と同じ形）。
 * 🔴 **`TOTAL_*` / `RANK` / `COMPARISON` / `OTHER_COMPANIES` / `SAME_PROJECT_PROPOSALS` に
 *    類する `kind` を作らない** —— **フィルタで落とすのではなく、型に存在させない**
 *    （`BR-07` / `F-004 AC-4`）。取引先の 5 指標はすべて**自社スコープの件数**である。
 * 🔴 **ラベルを返さない。** `kind`（閉集合）→ 文言キーの写像は画面側の 1 箇所に置く
 *    （数の意味を API とクライアントの 2 箇所で決めない）。
 * 🔴 **Phase 1 に出るのはホスト 3 / 取引先 4**（`Assignment` と `INTERVIEW_SCHEDULED` は Phase 2）。
 *    `kind` は 5 つ宣言してあるが、Phase 1 の応答には現れない（docs/05 §6.11.1 の表）。
 */
export type HostSummaryMetricKind =
  | 'PROJECTS'
  | 'ENGINEERS'
  | 'PROPOSALS_IN_FLIGHT'
  | 'INTERVIEWS_SCHEDULED'
  | 'ASSIGNMENTS_ACTIVE';

export type PartnerSummaryMetricKind =
  | 'PUBLISHED_PROJECTS'
  | 'OWN_ENGINEERS'
  | 'SHARED_ENGINEERS'
  | 'PROPOSALS_IN_FLIGHT'
  | 'ASSIGNMENTS_ACTIVE';

/**
 * 1 指標。🔴 **`count` は 0 でも返す**（描かない判断は画面側。docs/05 §6.11.1）。
 * 🔴 `href` が `null` = その指標から遷移しない（到達できないロールを含む）。
 */
export type SummaryMetric<K> = {
  readonly kind: K;
  readonly count: number;
  readonly href: string | null;
};

export type SummaryHomeBlock =
  | {
      readonly kind: 'SUMMARY';
      readonly audience: 'HOST';
      readonly items: readonly SummaryMetric<HostSummaryMetricKind>[];
    }
  | {
      readonly kind: 'SUMMARY';
      readonly audience: 'PARTNER';
      readonly items: readonly SummaryMetric<PartnerSummaryMetricKind>[];
    };

/**
 * ホームのブロック。**追加専用**（既存メンバーの意味を変えない）。
 * Phase 2 が満了間近などのケースを足す。
 */
export type HomeBlock = ScanQuarantineHomeBlock | ActionQueueHomeBlock | SummaryHomeBlock;

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
