// apps/web/lib/proposals/schemas.ts
// docs/05 §6.5 #39 / #40（`POST` / `GET /api/proposals/{id}/gate`）の境界検証。T-07-08。
//
// 🔴 **#39 は body を持たない**（docs/05 §6.5 #39 の request 欄は空）。持たせないことが
//    `F-020 AC-2`（ゲート FAIL を無視して送信する経路を作らない）の一部である ——
//    `force` / `skipLayers` / `reason` のような「呼び出し側が挙動を変える入力」を
//    1 つでも受け取ると、そこがゲートを緩める入口になる。
// 🔴 **query も持たない**（`?force=true` は Zod のスキーマが無い以上ハンドラに 1 バイトも届かない）。
import { PROPOSAL_MANUAL_TRANSITION_TARGET_STATES } from '@ses/domain';
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * `#39` / `#40` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が
 *    決め、境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
 */
export const proposalParamsSchema = z.object({ id: z.uuid() });

export type ProposalParams = z.infer<typeof proposalParamsSchema>;

export type ProposalParamsIsolationGuard = AssertNoIsolationKeys<ProposalParams>;

assertNoIsolationKeys(Object.keys(proposalParamsSchema.shape), 'proposalParamsSchema');

// ============================================================================
// T-09-01: #36 `POST /api/proposals` / #37 `PATCH /api/proposals/{id}`（docs/05 §6.5「T-09-01 の決着」）
// ============================================================================
//
// 🔴 **分離キーを持たない**（`CLAUDE.md` §3.1 / `BR-03`）。作成した会社（`ownerPartnerCompanyId`）は
//    `createProposalDraft()` が **ctx** から書き、`proposals` の RLS（C5 の `WITH CHECK`）が別の値を DB でも拒む。
// 🔴 **`proposalRequestId` を受け取らない。** 経路 4 由来の作成は #33（応諾。T-08-07）が担い、ここに置くと
//    同じ依頼から 2 件目の `Proposal` を作る経路になる（docs/05 §6.5「T-09-01 の決着」）。
// 🔴 `.refine()` をトップレベルに使わない（`withApiRoute` の `assertBoundarySchema` が `.shape` を読む）。

/** 提案先の会社名（`recipient_company_name`）。DB は TEXT。 */
const RECIPIENT_COMPANY_NAME_MAX_LENGTH = 200;
const RECIPIENT_EMAIL_MAX_LENGTH = 254;
/** 提示単価（月額・円）。`Decimal(12,2)` の範囲。 */
const OFFERED_UNIT_PRICE_MAX = 99_999_999;
const WORK_STYLE_MAX_LENGTH = 100;
const SUBJECT_MAX_LENGTH = 200;
/** 送信本文（外部共有物）。 */
const BODY_MAX_LENGTH = 20_000;

/**
 * 🔴 項目の定義は 1 か所にまとめ、POST（必須あり）と PATCH（すべて任意）で**同じ制約**を使う
 *    （`projects/schemas.ts` と同じ理由）。
 */
const proposalFields = {
  /**
   * 🔴 提案先の 2 列は**空にできない**（`min(1)`。`null` も受けない）。経路 4 由来の `DRAFT` の空文字は
   *    「まだ設定していない」であり、ここを通った値は常に「設定した」である。
   */
  recipientCompanyName: z.string().trim().min(1).max(RECIPIENT_COMPANY_NAME_MAX_LENGTH),
  recipientEmail: z.string().trim().toLowerCase().min(1).max(RECIPIENT_EMAIL_MAX_LENGTH).email(),
  offeredUnitPrice: z.number().int().min(0).max(OFFERED_UNIT_PRICE_MAX).nullable(),
  /** `@db.Date`。`YYYY-MM-DD`。 */
  offeredStartDate: z.iso.date().nullable(),
  workStyle: z.string().trim().min(1).max(WORK_STYLE_MAX_LENGTH).nullable(),
  subject: z.string().trim().min(1).max(SUBJECT_MAX_LENGTH).nullable(),
  body: z.string().trim().min(1).max(BODY_MAX_LENGTH).nullable(),
  /**
   * 添付する版（`EngineerSnapshot.skillSheetId`）。`null` = 添付なし。
   * 🔴 これは**操作対象の選択**であって実行者のスコープではない。`withTenant` の内側で
   *    「この提案のエンジニアの版か」「`CLEAN` か」を照合してから使う（`F-019 AC-3`）。
   */
  skillSheetId: z.uuid().nullable(),
} as const;

/** `POST /api/proposals`（#36）の body。🔴 案件・エンジニア・提案先が必須。 */
export const createProposalBodySchema = z.object({
  projectId: z.uuid(),
  engineerId: z.uuid(),
  recipientCompanyName: proposalFields.recipientCompanyName,
  recipientEmail: proposalFields.recipientEmail,
  offeredUnitPrice: proposalFields.offeredUnitPrice.default(null),
  offeredStartDate: proposalFields.offeredStartDate.default(null),
  workStyle: proposalFields.workStyle.default(null),
  subject: proposalFields.subject.default(null),
  body: proposalFields.body.default(null),
});

export type CreateProposalBody = z.infer<typeof createProposalBodySchema>;

export type CreateProposalBodyIsolationGuard = AssertNoIsolationKeys<CreateProposalBody>;

assertNoIsolationKeys(Object.keys(createProposalBodySchema.shape), 'createProposalBodySchema');

/**
 * `PATCH /api/proposals/{id}`（#37）の body。
 * 🔴 **未指定 = 変更しない**（`null` 指定 = 値を消す、と区別する。提案先の 2 列は `null` を受けない）。
 */
export const updateProposalBodySchema = z.object({
  recipientCompanyName: proposalFields.recipientCompanyName.optional(),
  recipientEmail: proposalFields.recipientEmail.optional(),
  offeredUnitPrice: proposalFields.offeredUnitPrice.optional(),
  offeredStartDate: proposalFields.offeredStartDate.optional(),
  workStyle: proposalFields.workStyle.optional(),
  subject: proposalFields.subject.optional(),
  body: proposalFields.body.optional(),
  skillSheetId: proposalFields.skillSheetId.optional(),
});

export type UpdateProposalBody = z.infer<typeof updateProposalBodySchema>;

export type UpdateProposalBodyIsolationGuard = AssertNoIsolationKeys<UpdateProposalBody>;

assertNoIsolationKeys(Object.keys(updateProposalBodySchema.shape), 'updateProposalBodySchema');

/** #37 で更新できる列名（監査の `summary.fields` / `ProposalEvent.note` に載せるキー名の出所）。 */
export const UPDATE_PROPOSAL_FIELDS = Object.keys(updateProposalBodySchema.shape) as readonly (keyof UpdateProposalBody)[];

/**
 * `S-020` の新規作成画面（`/proposals/new`）の query。🔴 案件とエンジニアの**指定**であり、実行者のスコープ
 * ではない（母集団は `projects` の C4 / `engineers` の C3 が決め、見えなければ 404）。
 */
export const newProposalQuerySchema = z.object({
  projectId: z.uuid(),
  engineerId: z.uuid(),
});

export type NewProposalQuery = z.infer<typeof newProposalQuerySchema>;

export type NewProposalQueryIsolationGuard = AssertNoIsolationKeys<NewProposalQuery>;

assertNoIsolationKeys(Object.keys(newProposalQuerySchema.shape), 'newProposalQuerySchema');

// ============================================================================
// T-09-02: #48 `POST /api/proposals/{id}/transition`（docs/05 §6.5「#48 の実装の決着」）
// ============================================================================
//
// 🔴 **`to` は `ProposalState` 全体ではなく、手動遷移（所有者 `MANUAL`）の遷移先 7 値だけ**を取る
//    （`PROPOSAL_MANUAL_TRANSITION_TARGET_STATES`。出所は `@ses/domain`）。`APPROVED` / `SUBMITTING` /
//    `SUBMITTED` / `SUBMIT_FAILED` / `GATE_RUNNING` / `APPROVAL_PENDING` / `GATE_FAILED` は**入力面に存在しない**
//    （400）—— #39 が body を持たないのと同じ「呼び出し側が挙動を変える入力を受け取らない」整理であり、
//    承認・送信・ゲート結果を汎用 API で書ける置き場所を作らない（`CLAUDE.md` §3.3 / §3.4）。
//    列挙を通り抜ける専有の組（`APPROVAL_PENDING → DRAFT`）は `transitionProposal` の第 2 層が 422 で止める。
// 🔴 `note` は `ProposalEvent.note` に書く任意のメモ（`F-025` 入力）。監査の `summary` には載せない（自由入力）。
// 🔴 分離キーを持たない（`assertNoIsolationKeys`）。

/** メモ（`ProposalEvent.note`）。DB は TEXT。 */
const TRANSITION_NOTE_MAX_LENGTH = 2_000;

export const transitionProposalBodySchema = z.object({
  to: z.enum(PROPOSAL_MANUAL_TRANSITION_TARGET_STATES),
  note: z.string().trim().min(1).max(TRANSITION_NOTE_MAX_LENGTH).optional(),
});

export type TransitionProposalBody = z.infer<typeof transitionProposalBodySchema>;

export type TransitionProposalBodyIsolationGuard = AssertNoIsolationKeys<TransitionProposalBody>;

assertNoIsolationKeys(Object.keys(transitionProposalBodySchema.shape), 'transitionProposalBodySchema');
