// apps/web/lib/proposals/views.ts
// 提案 1 件の応答型（docs/05 §4.8 / §6.5「T-09-01 の決着」/ `F-019 AC-1` `AC-4` / `S-020`）。T-09-01。
//
// ============================================================================
// 🔴 ホスト向けと取引先向けで**型が違う**（`undefined` ではなく、フィールドが存在しない）
// ============================================================================
// docs/05 §4.8「見えない ＝ 存在しない」の型の分離を `Proposal` に適用する（`HostProposalRequestView` /
// `PartnerProposalRequestView` と同じ整理）。**シリアライザは列を選んで写す**（`row` を spread しない）ので、
// `proposals` に列が増えても応答には現れない。
//
//   - 🔴 `HostProposalView` に**無い**もの: `engineerId` と台帳の現在値（`engineers` / `engineer_skills` /
//     `engineer_careers`）。ホストが読むエンジニアの情報は **`snapshot`（凍結側）だけ**である（`F-019 AC-1` /
//     `BR-06`。越境経路 2）。パートナー所属エンジニアの台帳は RLS（C3）でそもそも読めないが、**型として持たない**
//     ことで「自社所有のときだけ現在値を混ぜる」実装のうっかりも封じる（`docs/04` §S-023「凍結側だけを描く」）。
//   - 🔴 `PartnerProposalView` に**無い**もの: `owner`（自社の行しか見えないので意味が無い）/ `duplicateFindings`
//     （`F-037 AC-1`）/ 他社の提案に関する一切（存在・件数・順位。`F-019 AC-4` / `BR-07`）/ ホストの上流
//     （`endClientName` / `internalUnitPrice`。商流情報）。**`project` は `id` / `name` だけ**である。
//
// 🔴 **提案先（`recipient`）は未設定なら `null`**。経路 4 の応諾（#33）が作る `DRAFT` は提案先の 2 列が空文字で
//    あり（docs/05 §6.5「T-08-07 の決着」）、`S-020` は「提案先が未設定です」を明示しなければならない
//    （`docs/04` §S-020 改訂 10）。空文字をそのまま返すと画面は無言で空欄を描く。判定は `hasProposalRecipient`。
//
// 🔴 本ファイルは I/O を持たない（`@ses/db` に依存しない）。型テスト（`views.types.test.ts`）と画面が
//    `@ses/db` を読み込まずに参照できるようにするため（`proposal-requests/views.ts` と同じ規律）。
//    `Decimal` は `toString()` だけを要求する構造的な型で受ける（`lib/format/db-values.ts` と同じ理由）。
import {
  isSendHoldReasonKey,
  proposalMachine,
  type ProposalRequestState,
  type ProposalState,
  type SendHoldReasonKey,
} from '@ses/domain';
import { hasProposalRecipient } from './recipient';

/**
 * 🔴 T-09-06: 送信の保留（docs/05 §10.4。状態ではなく属性）。`APPROVED` のまま `sendHoldReasonKey` が立っている間だけ非 `null`。
 *    **ホストが読む view にだけ持たせる** —— 理由（ドメイン未検証 / テナントの上限 / 環境の枠 / 停止 / 遅延）はすべて
 *    ホスト側の事情であり、取引先に見せる意味が無い（§4.8「見えない ＝ 存在しない」の型の分離）。
 */
export type ProposalSendHoldView = {
  readonly reasonKey: SendHoldReasonKey;
  /** ISO 8601（UTC）。 */
  readonly since: string;
};

/** 案件の参照。🔴 `id` / `name` だけ（商流情報を持たない）。取引先で公開が解除された案件は `null`。 */
export type ProposalProjectRef = {
  readonly id: string;
  readonly name: string;
};

/** 提案の出所。`PROPOSAL_REQUEST` = 経路 4 の応諾で作られた（提案先が後から埋まる）。 */
export type ProposalOrigin = 'OWN' | 'PROPOSAL_REQUEST';

/** 提案先（テナント外の企業）。🔴 未設定は型の外（`null`）で表す。 */
export type ProposalRecipientView = {
  readonly companyName: string;
  readonly email: string;
};

export type ProposalTermsView = {
  readonly offeredUnitPrice: number | null;
  /** `YYYY-MM-DD` または `null`。 */
  readonly offeredStartDate: string | null;
  readonly workStyle: string | null;
};

/**
 * 本文の由来（`docs/04` §S-020「AI 生成物の由来を本文ブロックの直上に文字で示す」）。
 * 🔴 Phase 1 は `MANUAL` の 1 値。`proposal-drafter`（`F-034`。Phase 2）が `AI_DRAFT` / `AI_EDITED` を足す。
 */
export type ProposalBodyOrigin = 'MANUAL';

export type ProposalContentView = {
  readonly subject: string | null;
  readonly body: string | null;
  readonly bodyOrigin: ProposalBodyOrigin;
};

/** `EngineerSnapshot.skills` の 1 件（docs/05 §3.6 `[{ skillId, name, years, level }]`）。 */
export type ProposalSnapshotSkillView = {
  readonly skillId: string;
  readonly name: string;
  readonly years: number;
  readonly level: number | null;
};

/**
 * 🔴 凍結情報（`EngineerSnapshot`）。**台帳の現在値ではない**（`F-019 AC-2`）。
 *    経歴は行数だけ（`careerCount`）。行そのもの（`FrozenCareer[]`）は #46（`S-023`。T-09-09）が凍結側として返す。
 */
export type ProposalSnapshotView = {
  /** ISO 8601（UTC）。 */
  readonly frozenAt: string;
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly skills: readonly ProposalSnapshotSkillView[];
  readonly careerCount: number;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
  readonly availableFrom: string | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
};

/** 添付（凍結時点、または #37 で差し替えた版）。🔴 `CLEAN` の版だけがここに入る（`F-019 AC-3`）。 */
export type ProposalAttachmentView = {
  readonly skillSheetId: string | null;
};

type ProposalViewShared = {
  readonly id: string;
  readonly state: ProposalState;
  readonly origin: ProposalOrigin;
  readonly project: ProposalProjectRef | null;
  readonly recipient: ProposalRecipientView | null;
  readonly terms: ProposalTermsView;
  readonly content: ProposalContentView;
  readonly snapshot: ProposalSnapshotView;
  readonly attachment: ProposalAttachmentView;
  /** 🔴 **現在の内容**のハッシュ（§11.5。`computeProposalContentHash` の再計算値）。 */
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** 作成した会社（ホストが読む。取引先の社名は `Proposal` の作成で開示済み。経路 2）。 */
export type HostProposalOwnerView =
  | { readonly kind: 'HOST' }
  | { readonly kind: 'PARTNER'; readonly partnerCompanyName: string };

/** ホストが読む 1 件。🔴 `engineerId` / 台帳の現在値を持たない（ファイル冒頭）。 */
export type HostProposalView = ProposalViewShared & {
  readonly audience: 'HOST';
  readonly owner: HostProposalOwnerView;
  /** 🔴 T-09-06: 送信の保留。`null` = 保留していない。 */
  readonly sendHold: ProposalSendHoldView | null;
};

/** 取引先が読む 1 件（自社が作成した行だけ。母集団は C5）。🔴 `owner` / 他社に関する一切を持たない。 */
export type PartnerProposalView = ProposalViewShared & {
  readonly audience: 'PARTNER';
};

export type ProposalView = HostProposalView | PartnerProposalView;

/** 🔴 `HostProposalView` のキー集合（実応答の深さ走査と型の突合に使う）。型を変えたらここも変える。 */
export const HOST_PROPOSAL_VIEW_KEYS = [
  'audience',
  'owner',
  'sendHold',
  'id',
  'state',
  'origin',
  'project',
  'recipient',
  'terms',
  'content',
  'snapshot',
  'attachment',
  'contentHash',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof HostProposalView)[];

/** 🔴 `PartnerProposalView` のキー集合。`owner` が**無い**。 */
export const PARTNER_PROPOSAL_VIEW_KEYS = [
  'audience',
  'id',
  'state',
  'origin',
  'project',
  'recipient',
  'terms',
  'content',
  'snapshot',
  'attachment',
  'contentHash',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof PartnerProposalView)[];

/** `Decimal` を要求する最小の形（`@prisma/client` を import しない）。 */
type DecimalLike = { toString(): string };

/**
 * `proposals` の行のうち view が読む列。🔴 `engineerId` / `createdBy` / `approvedBy` / `draft*` を**含まない**
 * （`select` に書かない —— 型がこの集合を固定する）。
 */
export type ProposalViewRow = {
  readonly id: string;
  readonly state: string;
  readonly proposalRequestId: string | null;
  /** T-09-06: 保留列（docs/05 §10.4）。🔴 ホスト向けの写像だけが読む。 */
  readonly sendHoldReasonKey: string | null;
  readonly sendHoldSince: Date | null;
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  readonly offeredUnitPrice: DecimalLike | null;
  readonly offeredStartDate: Date | null;
  readonly workStyle: string | null;
  readonly subject: string | null;
  readonly body: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** `engineer_snapshots` の行のうち view が読む列。 */
export type ProposalSnapshotRow = {
  readonly frozenAt: Date;
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly skills: unknown;
  readonly careers: unknown;
  readonly unitPriceMin: DecimalLike | null;
  readonly unitPriceMax: DecimalLike | null;
  readonly availableFrom: Date | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly skillSheetId: string | null;
};

/** 写像に要る、行の外から来る値。 */
export type ProposalViewDeps = {
  readonly project: ProposalProjectRef | null;
  readonly snapshot: ProposalSnapshotRow;
  readonly contentHash: string;
};

/**
 * 🔴 凍結コピー（JSON）の形が壊れていたら**握り潰さない**（`gate-content-hash.ts` の `toHashSkills` と同じ規律）。
 *    黙って読み飛ばすと、画面は「スキルが無いエンジニア」を凍結情報として描く。
 */
export class ProposalSnapshotShapeError extends Error {
  constructor(detail: string) {
    super(`engineer_snapshots の形が不正です（${detail}）。`);
    this.name = 'ProposalSnapshotShapeError';
  }
}

function decimalToNumber(value: DecimalLike | null): number | null {
  return value === null ? null : Number(value.toString());
}

/** `@db.Date`（UTC 深夜で入る）を `YYYY-MM-DD` にする（`lib/format/db-values.ts` の `toIsoDay` と同じ切り出し）。 */
function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * 凍結コピーの `skills`（JSON）を view の形に写す。
 * ✅ T-12-16 で `export` にした: #46b（`snapshot-diff.ts`）の凍結側が**同じ直列化**を通る（docs/05 §6.5「#46b の境界と記録の確定」
 *    「値の直列化は #46 の `snapshot` と同じ（2 つの直列化を作らない）」）。
 */
export function toSnapshotSkills(value: unknown): readonly ProposalSnapshotSkillView[] {
  if (!Array.isArray(value)) throw new ProposalSnapshotShapeError('skills が配列ではない');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ProposalSnapshotShapeError('skills の要素がオブジェクトではない');
    }
    const row = entry as { skillId?: unknown; name?: unknown; years?: unknown; level?: unknown };
    if (typeof row.skillId !== 'string' || typeof row.name !== 'string' || typeof row.years !== 'number') {
      throw new ProposalSnapshotShapeError('skills の要素の形が不正');
    }
    return {
      skillId: row.skillId,
      name: row.name,
      years: row.years,
      level: typeof row.level === 'number' ? row.level : null,
    };
  });
}

function careerCountOf(value: unknown): number {
  // 🔴 0 行は `[]` で保存される（docs/05 §3.6）。`null` は「凍結し忘れ」であり、正常な行には現れない。
  if (!Array.isArray(value)) throw new ProposalSnapshotShapeError('careers が配列ではない');
  return value.length;
}

function requireState(value: string): ProposalState {
  // DB の CHECK が保証しているので到達しない。握り潰さず落とす（不変条件違反）。
  if (!proposalMachine.isState(value)) {
    throw new RangeError('proposals.state が未知の値です（docs/05 §3.6）。');
  }
  return value;
}

function toShared(row: ProposalViewRow, deps: ProposalViewDeps): ProposalViewShared {
  const recipientColumns = {
    recipientCompanyName: row.recipientCompanyName,
    recipientEmail: row.recipientEmail,
  };
  return {
    id: row.id,
    state: requireState(row.state),
    origin: row.proposalRequestId === null ? 'OWN' : 'PROPOSAL_REQUEST',
    project: deps.project,
    // 🔴 空文字を無言で出さない（ファイル冒頭）。
    recipient: hasProposalRecipient(recipientColumns)
      ? { companyName: row.recipientCompanyName, email: row.recipientEmail }
      : null,
    terms: {
      offeredUnitPrice: decimalToNumber(row.offeredUnitPrice),
      offeredStartDate: dateOnly(row.offeredStartDate),
      workStyle: row.workStyle,
    },
    content: { subject: row.subject, body: row.body, bodyOrigin: 'MANUAL' },
    snapshot: {
      frozenAt: deps.snapshot.frozenAt.toISOString(),
      displayName: deps.snapshot.displayName,
      affiliationLabel: deps.snapshot.affiliationLabel,
      skills: toSnapshotSkills(deps.snapshot.skills),
      careerCount: careerCountOf(deps.snapshot.careers),
      unitPriceMin: decimalToNumber(deps.snapshot.unitPriceMin),
      unitPriceMax: decimalToNumber(deps.snapshot.unitPriceMax),
      availableFrom: dateOnly(deps.snapshot.availableFrom),
      prefecture: deps.snapshot.prefecture,
      remoteMode: deps.snapshot.remoteMode,
    },
    attachment: { skillSheetId: deps.snapshot.skillSheetId },
    contentHash: deps.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * ホスト向けの写像。🔴 列を選んで写す（`row` に `engineerId` / `createdBy` があっても**型として受け取れない**）。
 * @param owner 作成した会社（`ownerPartnerCompanyId` が `null` なら `HOST`。社名は `partner_companies` から）。
 */
export function toHostProposalView(
  row: ProposalViewRow,
  deps: ProposalViewDeps,
  owner: HostProposalOwnerView,
): HostProposalView {
  return { audience: 'HOST', owner, sendHold: toSendHold(row), ...toShared(row, deps) };
}

/** 🔴 保留列の写像（ホストだけ）。理由と時刻は CHECK（`proposals_send_hold_pair_check`）で同時に立つ。片方だけなら不変条件違反。 */
function toSendHold(row: Pick<ProposalViewRow, 'sendHoldReasonKey' | 'sendHoldSince'>): ProposalSendHoldView | null {
  if (row.sendHoldReasonKey === null && row.sendHoldSince === null) return null;
  if (row.sendHoldReasonKey === null || row.sendHoldSince === null || !isSendHoldReasonKey(row.sendHoldReasonKey)) {
    throw new RangeError('proposals.send_hold_reason_key / send_hold_since の組が不正です（docs/05 §10.4）。');
  }
  return { reasonKey: row.sendHoldReasonKey, since: row.sendHoldSince.toISOString() };
}

/** 取引先向けの写像（自社の行だけが渡ってくる。母集団は C5）。 */
export function toPartnerProposalView(row: ProposalViewRow, deps: ProposalViewDeps): PartnerProposalView {
  return { audience: 'PARTNER', ...toShared(row, deps) };
}

// ============================================================================
// T-09-09: 一覧（#45）・詳細（#46）・履歴の応答型（docs/05 §6.5「#45 / #46 / #47 の実装の決着」/ `F-024` / `F-037 AC-1` /
// `S-019` / `S-023`）
// ============================================================================
//
// 🔴 一覧の行は `HostProposalView` の**部分集合ではなく別の型**である（`HostProposalListItem` / `PartnerProposalListItem`）。
//    `S-019` の 8 列（提案先 / エンジニア / 案件 / 状態 / 単価 / 作成者 / 最終更新 / 経過時間）に本文・凍結のスキル・
//    `contentHash` は要らず、50 行ぶんの `computeProposalContentHash` を毎回計算しない。**列を選んで写す**規律は同じ。
// 🔴 詳細は `HostProposalView` / `PartnerProposalView` を**拡張**する（`HostProposalDetailView` / `PartnerProposalDetailView`）。
//    - 🔴 `PartnerProposalDetailView` に**無い**もの: `owner` / `sendHold` / `approval`（承認記録・承認者）/ `sendAttempts`（送信試行）/
//      `lastFailureReason` / **`duplicateFindings`**（`F-037 AC-1`。検知自体は Phase 2 だが**型の分離は今**行う —— 後から足すと漏れる）。
//    - `snapshot.careers`（`FrozenCareer[]`）は**凍結側だけ**（docs/05 §6.5「#36 / #46 / #46b の経験内容の凍結」）。台帳の現在値は
//      #46b（`snapshot-diff`。別エンドポイント）であり、ここに混ぜない。
// 🔴 履歴（`ProposalEventView`）は `ProposalEvent` の `note` を**書き手の接頭辞で分類済み**の形で返す（`entry`）。分類は
//    `lib/proposals/events.ts` の 1 実装（接頭辞は書き手の定数を import する。文字列を書き写さない）。取引先向けには
//    送信試行の詳細（`RESEND` の理由 / `SEND_FAILURE` の種別）を**伏せる**（ホスト側の送信基盤の事情。§4.8）。

/** 凍結された経歴 1 行（`FrozenCareer`。🔴 台帳の行 ID を持たない。docs/05 §3.6）。 */
export type FrozenCareerView = {
  /** `YYYY-MM` */
  readonly periodFrom: string;
  /** `YYYY-MM` または `null`（継続中）。 */
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

/** 詳細（#46）の凍結情報 = 基底の凍結情報 + 凍結された経歴の行。 */
export type ProposalDetailSnapshotView = ProposalSnapshotView & {
  readonly careers: readonly FrozenCareerView[];
};

/**
 * 送信試行 1 件の要約（`SendAttempt`。C2 HOST_ONLY）。`S-022` の行と `S-023` の「送信試行」が使う。
 * 🔴 ホスト向けの型だけが持つ（取引先の文脈では `send_attempts` は 0 行になるが、型として持たせない）。
 */
export type ProposalSendAttemptView = {
  readonly attemptSeq: number;
  /** `RESERVED` / `SUCCEEDED` / `FAILED` / `UNKNOWN`（`SEND_ATTEMPT_STATUSES`）。 */
  readonly status: string;
  readonly failureKind: string | null;
  /** ISO 8601（UTC）。 */
  readonly startedAt: string;
  /** ISO 8601（UTC）。未確定なら `null`。 */
  readonly settledAt: string | null;
  /** 送信基盤側の ID（`SUCCEEDED` のときだけ持つ。PII を含まない）。 */
  readonly externalId: string | null;
};

/**
 * 承認記録（docs/05 §3.6 `approvedBy` / `approvedBySystem` / `approvedAt`。`F-021 AC-5`「承認者が `system` として記録される」）。
 * T-09-03 は `approval.ts` に置いていたが、#46 の型（I/O を持たない本ファイル）が参照するためここへ移した（`approval.ts` は re-export）。
 * - `NONE` … まだ承認されていない
 * - `USER` … 人間が承認した。`approverName` はホストの利用者名（C8 DIRECTORY）。読めなければ `null`
 * - `SYSTEM` … 全層 PASS のため自動承認された（`approved_by_system = true`）
 */
export type ProposalApprovalRecordView =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'USER'; readonly approverName: string | null; readonly approvedAt: string }
  | { readonly kind: 'SYSTEM'; readonly approvedAt: string };

/** 履歴の主体（`ProposalEvent.actorUserId`。`null` = システム）。表示名は `users`（C8 DIRECTORY）から。 */
export type ProposalEventActorView =
  | { readonly kind: 'USER'; readonly displayName: string | null }
  | { readonly kind: 'SYSTEM' };

/**
 * 🔴 `ProposalEvent.note` の分類（`S-023` の履歴が `kind` ごとに描き分ける 6 種 + その他）。
 * - `TRANSITION` … 状態遷移（`STATE`）。`note` は人間の自由入力（却下の理由 / #48 のメモ）か `null`
 * - `APPROVAL` … 承認（`STATE` + `REVIEW_GATE:<id>`）。「検査 #…」
 * - `RESEND` … 人手再送（`STATE` + `RESEND:<理由>`）。「再送（理由）」。🔴 取引先には理由を出さない（`null`）
 * - `SEND_FAILURE` … 送信失敗の確定（`STATE` + `SEND_FAILURE:<failureKind>`）。「送信失敗（種別）」。🔴 取引先には種別を出さない
 * - `DRAFT_UPDATED` … 下書きの更新（`NOTE` + `DRAFT_UPDATED:<keys>`）。「下書きを更新（項目名）」
 * - `NOTE` … 人手のメモ（#47。`NOTE` に接頭辞なし）
 * - `OTHER` … `ATTACHMENT` や未知の形（握り潰さず、そのまま描く）
 */
export type ProposalEventEntryView =
  | { readonly kind: 'TRANSITION'; readonly note: string | null }
  | { readonly kind: 'APPROVAL'; readonly reviewGateId: string }
  | { readonly kind: 'RESEND'; readonly reason: string | null }
  | { readonly kind: 'SEND_FAILURE'; readonly failureKind: string | null }
  | { readonly kind: 'DRAFT_UPDATED'; readonly fields: readonly string[] }
  | { readonly kind: 'NOTE'; readonly note: string }
  | { readonly kind: 'OTHER'; readonly note: string | null };

export type ProposalEventView = {
  readonly id: string;
  /** ISO 8601（UTC）。 */
  readonly occurredAt: string;
  readonly actor: ProposalEventActorView;
  /** `STATE` / `NOTE` / `ATTACHMENT`（DB の CHECK）。 */
  readonly kind: string;
  readonly fromState: ProposalState | null;
  readonly toState: ProposalState | null;
  readonly entry: ProposalEventEntryView;
  /** 添付（`skill_sheets.id`）。無ければ `null`。 */
  readonly attachmentKey: string | null;
};

type ProposalDetailShared = {
  readonly snapshot: ProposalDetailSnapshotView;
  /** 🔴 古い順（`occurredAt` 昇順 → `id` 昇順）。作成時に必ず 1 件書かれるので空にならない。 */
  readonly events: readonly ProposalEventView[];
  /** 作成者の表示名（C8 DIRECTORY）。読めなければ `null`。 */
  readonly createdByName: string | null;
  /** 送信の確定時刻（`SUBMITTED` 以降）。ISO 8601 / `null`。 */
  readonly submittedAt: string | null;
};

/** ホストが読む詳細（#46）。 */
export type HostProposalDetailView = HostProposalView &
  ProposalDetailShared & {
    readonly approval: ProposalApprovalRecordView;
    /** 送信試行（`attempt_seq` 昇順）。C2 HOST_ONLY。 */
    readonly sendAttempts: readonly ProposalSendAttemptView[];
    /** `proposals.last_failure_reason`（確定時の `failureKind`。`SUBMIT_FAILED` の間だけ意味を持つ）。 */
    readonly lastFailureReason: string | null;
  };

/** 🔴 取引先が読む詳細（#46）。`owner` / `sendHold` / `approval` / `sendAttempts` / `duplicateFindings` を型として持たない。 */
export type PartnerProposalDetailView = PartnerProposalView & ProposalDetailShared;

export type ProposalDetailView = HostProposalDetailView | PartnerProposalDetailView;

export const HOST_PROPOSAL_DETAIL_VIEW_KEYS = [
  ...HOST_PROPOSAL_VIEW_KEYS,
  'events',
  'createdByName',
  'submittedAt',
  'approval',
  'sendAttempts',
  'lastFailureReason',
] as const satisfies readonly (keyof HostProposalDetailView)[];

/** 🔴 `PartnerProposalDetailView` のキー集合。`owner` / `sendHold` / `approval` / `sendAttempts` / `lastFailureReason` が**無い**。 */
export const PARTNER_PROPOSAL_DETAIL_VIEW_KEYS = [
  ...PARTNER_PROPOSAL_VIEW_KEYS,
  'events',
  'createdByName',
  'submittedAt',
] as const satisfies readonly (keyof PartnerProposalDetailView)[];

/**
 * 凍結コピーの `careers`（JSON）を行単位の view に写す（🔴 台帳の行 ID は無い）。
 * ✅ T-12-16 で `export` にした: #46b の `careers.frozen` が #46 の `snapshot.careers` と**同じ直列化**を通る。
 */
export function toFrozenCareers(value: unknown): readonly FrozenCareerView[] {
  if (!Array.isArray(value)) throw new ProposalSnapshotShapeError('careers が配列ではない');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ProposalSnapshotShapeError('careers の要素がオブジェクトではない');
    }
    const row = entry as { periodFrom?: unknown; periodTo?: unknown; role?: unknown; description?: unknown; technologies?: unknown };
    if (
      typeof row.periodFrom !== 'string' ||
      !(row.periodTo === null || typeof row.periodTo === 'string') ||
      typeof row.role !== 'string' ||
      typeof row.description !== 'string' ||
      typeof row.technologies !== 'string'
    ) {
      throw new ProposalSnapshotShapeError('careers の要素の形が不正');
    }
    return { periodFrom: row.periodFrom, periodTo: row.periodTo, role: row.role, description: row.description, technologies: row.technologies };
  });
}

/** 詳細の写像に要る、基底の view の外から来る値。 */
export type ProposalDetailDeps = {
  /** 凍結コピーの `careers`（JSON）。行単位で写す。 */
  readonly careers: unknown;
  readonly events: readonly ProposalEventView[];
  readonly createdByName: string | null;
  readonly submittedAt: Date | null;
};

export type HostProposalDetailDeps = ProposalDetailDeps & {
  readonly approval: ProposalApprovalRecordView;
  readonly sendAttempts: readonly ProposalSendAttemptView[];
  readonly lastFailureReason: string | null;
};

/** ホスト向けの詳細の写像（基底の view + 詳細だけが持つ値）。 */
export function toHostProposalDetailView(view: HostProposalView, deps: HostProposalDetailDeps): HostProposalDetailView {
  return {
    ...view,
    snapshot: { ...view.snapshot, careers: toFrozenCareers(deps.careers) },
    events: deps.events,
    createdByName: deps.createdByName,
    submittedAt: deps.submittedAt?.toISOString() ?? null,
    approval: deps.approval,
    sendAttempts: deps.sendAttempts,
    lastFailureReason: deps.lastFailureReason,
  };
}

/** 🔴 取引先向けの詳細の写像。承認記録・送信試行・保留・作成会社は**引数の型にすら無い**。 */
export function toPartnerProposalDetailView(view: PartnerProposalView, deps: ProposalDetailDeps): PartnerProposalDetailView {
  return {
    ...view,
    snapshot: { ...view.snapshot, careers: toFrozenCareers(deps.careers) },
    events: deps.events,
    createdByName: deps.createdByName,
    submittedAt: deps.submittedAt?.toISOString() ?? null,
  };
}

// ----------------------------------------------------------------------------
// 一覧（#45）
// ----------------------------------------------------------------------------

type ProposalListItemShared = {
  readonly id: string;
  readonly state: ProposalState;
  readonly origin: ProposalOrigin;
  readonly project: ProposalProjectRef | null;
  readonly recipient: ProposalRecipientView | null;
  /** 🔴 凍結側（`EngineerSnapshot.displayName`）。台帳の現在値ではない。凍結が無ければ `null`。 */
  readonly engineerDisplayName: string | null;
  readonly offeredUnitPrice: number | null;
  /** 作成者の表示名（C8 DIRECTORY）。読めなければ `null`。 */
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** ホストが読む一覧の 1 行。 */
export type HostProposalListItem = ProposalListItemShared & {
  readonly audience: 'HOST';
  readonly owner: HostProposalOwnerView;
  /** 🔴 保留（`APPROVED` + `sendHoldReasonKey`）。`SUBMIT_FAILED` とは**別の表示**にする材料（docs/05 §10.4）。 */
  readonly sendHold: ProposalSendHoldView | null;
  readonly lastFailureReason: string | null;
  /** 送信試行（`attempt_seq` 昇順）。`S-022` の行が使う。 */
  readonly sendAttempts: readonly ProposalSendAttemptView[];
};

/** 🔴 取引先が読む一覧の 1 行（自社が作成した行だけ。母集団は C5）。`owner` / `sendHold` / 送信試行を持たない。 */
export type PartnerProposalListItem = ProposalListItemShared & {
  readonly audience: 'PARTNER';
};

export type ProposalListItem = HostProposalListItem | PartnerProposalListItem;

export const HOST_PROPOSAL_LIST_ITEM_KEYS = [
  'audience',
  'owner',
  'sendHold',
  'lastFailureReason',
  'sendAttempts',
  'id',
  'state',
  'origin',
  'project',
  'recipient',
  'engineerDisplayName',
  'offeredUnitPrice',
  'createdByName',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof HostProposalListItem)[];

export const PARTNER_PROPOSAL_LIST_ITEM_KEYS = [
  'audience',
  'id',
  'state',
  'origin',
  'project',
  'recipient',
  'engineerDisplayName',
  'offeredUnitPrice',
  'createdByName',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof PartnerProposalListItem)[];

/**
 * 🔴 `byState`（`Proposal` の 14 状態）。**すべてのキーを必ず持つ**（0 件も `0`）—— `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` /
 *    `WITHDRAWN` が**別のキー**であることを型が固定する（`F-024 AC-2`）。母集団は境界適用後（docs/05 §4.8）。
 */
export type ProposalCountByState = Readonly<Record<ProposalState, number>>;

/**
 * 🔴 `ProposalRequest` の 5 状態の件数。**`byState` と別のブロック**（`DECLINED` は提案依頼の状態であり `Proposal` の状態ではない。
 *    `docs/04` §S-019「14 状態 + 提案依頼の 5 状態」/ `F-024` 処理③）。値を 1 つの `Record` に混ぜない。
 */
export type ProposalRequestCountByState = Readonly<Record<ProposalRequestState, number>>;

/** 一覧の行が読む `proposals` の列（`ProposalViewRow` の部分 + 一覧だけが要る列）。 */
export type ProposalListRow = {
  readonly id: string;
  readonly state: string;
  readonly proposalRequestId: string | null;
  readonly sendHoldReasonKey: string | null;
  readonly sendHoldSince: Date | null;
  readonly recipientCompanyName: string;
  readonly recipientEmail: string;
  readonly offeredUnitPrice: DecimalLike | null;
  readonly lastFailureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ProposalListItemDeps = {
  readonly project: ProposalProjectRef | null;
  readonly engineerDisplayName: string | null;
  readonly createdByName: string | null;
};

function toListShared(row: ProposalListRow, deps: ProposalListItemDeps): ProposalListItemShared {
  return {
    id: row.id,
    state: requireState(row.state),
    origin: row.proposalRequestId === null ? 'OWN' : 'PROPOSAL_REQUEST',
    project: deps.project,
    recipient: hasProposalRecipient({ recipientCompanyName: row.recipientCompanyName, recipientEmail: row.recipientEmail })
      ? { companyName: row.recipientCompanyName, email: row.recipientEmail }
      : null,
    engineerDisplayName: deps.engineerDisplayName,
    offeredUnitPrice: decimalToNumber(row.offeredUnitPrice),
    createdByName: deps.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** ホスト向けの一覧行の写像。 */
export function toHostProposalListItem(
  row: ProposalListRow,
  deps: ProposalListItemDeps,
  host: { readonly owner: HostProposalOwnerView; readonly sendAttempts: readonly ProposalSendAttemptView[] },
): HostProposalListItem {
  return {
    audience: 'HOST',
    owner: host.owner,
    sendHold: toSendHold(row),
    lastFailureReason: row.lastFailureReason,
    sendAttempts: host.sendAttempts,
    ...toListShared(row, deps),
  };
}

/** 取引先向けの一覧行の写像（保留列・失敗理由が行にあっても写らない）。 */
export function toPartnerProposalListItem(row: ProposalListRow, deps: ProposalListItemDeps): PartnerProposalListItem {
  return { audience: 'PARTNER', ...toListShared(row, deps) };
}
