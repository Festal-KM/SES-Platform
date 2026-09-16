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
import { isSendHoldReasonKey, proposalMachine, type ProposalState, type SendHoldReasonKey } from '@ses/domain';
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

function toSnapshotSkills(value: unknown): readonly ProposalSnapshotSkillView[] {
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
