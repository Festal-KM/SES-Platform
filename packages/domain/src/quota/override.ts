// packages/domain/src/quota/override.ts
// 🔴 テナント個別のクォータ上書き（docs/02 `F-057` 処理③〜⑤ / `AC-2`〜`AC-4` / docs/05 §5.8 / §6.9 API-A6 /
//    docs/03 §7.6.3-2 / `CLAUDE.md` §10.5「クォータ」）。T-11-02。
//
// ============================================================================
// 🔴 このモジュールが答えるのは 3 つである
// ============================================================================
//   ① どの計測を上書きできるか（`QUOTA_OVERRIDE_METRICS`。**AI の月次件数 4 単位（`AI_UNIT_METRICS`）+ メール日次通数
//      （`EMAIL_COUNT`）+ ストレージ（`STORAGE_BYTES`）の 6 計測**）。金額（`AI_COST_USD`）は運営者の内部指標であり、
//      テナントに件数で約束する上限ではない（SP-20 の `Subscription.quotaOverrideUsd` が持つ）。
//      🔴 `EMAIL_COUNT` / `STORAGE_BYTES` は T-11-02 NG-1 で一度外し、**T-12-12 で執行点（`email-send.ts` / `send-proposal.ts` /
//      `send-hold-release.ts` / `issueSkillSheetUploadUrl`）が `resolveTenantQuotas` を読むように配線してから戻した**
//      （表示だけ差し替えて執行が変わらない事故を作らない、という条件が満たされた）。分次上限（`EMAIL_MINUTE_LIMIT_PER_TENANT`）は
//      対象外のまま（`packages/config` の値。docs/05 §5.8.1 ⑧）
//   ② ある日にどの上書き行が効いているか（`selectEffectiveQuotaOverride`。**適用日 ≤ その日**のうち適用日が最も遅く、
//      同日なら最後に作られた行。無ければ既定値）。ワーカーの判定・主平面の表示・運営者の一覧が**同じ 1 実装**で解く
//   ③ 🔴 引き下げか引き上げか（`decideQuotaChange`。`F-057 AC-3`）—— **引き下げは翌日以降の適用日と通知が必須**であり、
//      即時反映のみの操作は型として返らない（`LOWER` は `effectiveFrom > today` かつ `notifyTenantAdmins === true` の
//      ときだけ返る。それ以外は `QuotaChangeRejectedError`）。引き上げは当日から適用できる
//
// 🔴 `Date` を生成しない（`tests/static/domain-purity.test.ts`）。暦日は `YYYY-MM-DD` のキー（`usagePeriodKey('DAY', now)` が
//    `Asia/Tokyo` で作ったもの）で受け、比較は `compareDayKeys`（`day-keys.ts`）で行う。
// 🔴 金額を扱わない（件数・通数・バイト数の `bigint` だけ。docs/03 §7.6.3-1「件数は金額から割り戻さない」）。
import { AI_UNIT_METRICS } from '../ai/units.js';
import { compareDayKeys } from '../usage/day-keys.js';

/**
 * 🔴 上書きできる計測（`tenant_quota_overrides.metric` の CHECK 値集合。migration 20260924000000 → 20260928000000 で再定義）。
 *    `AI_UNIT_METRICS`（AI の月次件数 4 単位）+ `EMAIL_COUNT` + `STORAGE_BYTES` の 6 計測。AI の 4 単位は列挙し直さず
 *    `AI_UNIT_METRICS` から引く（単位が増えたときに片方だけ古くなる状態を作らない。`tests/static/schema-enum-drift.test.ts` が突合）。
 *    🔴 `AI_COST_USD`（金額）と分次上限は含めない。
 */
export const QUOTA_OVERRIDE_METRICS = [...AI_UNIT_METRICS, 'EMAIL_COUNT', 'STORAGE_BYTES'] as const;

export type QuotaOverrideMetric = (typeof QUOTA_OVERRIDE_METRICS)[number];

/** 件数・通数として `number` で判定する計測（ストレージだけは `bigint` のまま判定する）。 */
export type QuotaOverrideCountMetric = Exclude<QuotaOverrideMetric, 'STORAGE_BYTES'>;

export function isQuotaOverrideMetric(value: string): value is QuotaOverrideMetric {
  return (QUOTA_OVERRIDE_METRICS as readonly string[]).includes(value);
}

/**
 * 上書き行（`tenant_quota_overrides` の 1 行のうち、選択に要る列だけ）。
 * 🔴 `limit` は `bigint`（ストレージのバイト数は `Number` の安全整数を超えうる。件数・通数も同じ型に揃える）。
 */
export type QuotaOverrideRow = {
  readonly id: string;
  readonly metric: QuotaOverrideMetric;
  readonly limit: bigint;
  /** 適用日（`YYYY-MM-DD`。`Asia/Tokyo` の暦日）。この日の 0 時からこの上限になる。 */
  readonly effectiveFrom: string;
  /** 行を作った時刻（同じ適用日の行が複数あるときの優先順位。新しいほうが勝つ）。 */
  readonly createdAt: Date;
};

/** 同じ計測の行を「効く順」に並べる比較器: 適用日が遅い → 作成が新しい → ID が大きい。 */
function byPrecedence(a: QuotaOverrideRow, b: QuotaOverrideRow): number {
  const byDate = compareDayKeys(b.effectiveFrom, a.effectiveFrom);
  if (byDate !== 0) return byDate;
  const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

/**
 * ② `onDate`（`YYYY-MM-DD`）に効いている上書き行（無ければ `null`）。
 *
 * 🔴 「適用日 ≤ その日」の行のうち、適用日が最も遅いもの。同じ適用日なら最後に作られたもの。
 *    将来の行（適用日 > その日）は効かない。**行は消さない前提**（履歴は残り、選択で決まる）。
 */
export function selectEffectiveQuotaOverride(
  rows: readonly QuotaOverrideRow[],
  metric: QuotaOverrideMetric,
  onDate: string,
): QuotaOverrideRow | null {
  const candidates = rows
    .filter((row) => row.metric === metric && compareDayKeys(row.effectiveFrom, onDate) <= 0)
    .sort(byPrecedence);
  return candidates[0] ?? null;
}

/**
 * ② 予定されている上書き（適用日 > `today`）のうち**最も早く効く 1 行**（無ければ `null`）。`A-004` の「予定」列。
 *    同じ適用日に複数あれば、その日に効くことになる行（作成が新しいもの）を返す。
 */
export function selectPendingQuotaOverride(
  rows: readonly QuotaOverrideRow[],
  metric: QuotaOverrideMetric,
  today: string,
): QuotaOverrideRow | null {
  const future = rows.filter((row) => row.metric === metric && compareDayKeys(row.effectiveFrom, today) > 0);
  if (future.length === 0) return null;
  const earliest = future.reduce((best, row) => (compareDayKeys(row.effectiveFrom, best.effectiveFrom) < 0 ? row : best));
  return (
    future
      .filter((row) => row.effectiveFrom === earliest.effectiveFrom)
      .sort(byPrecedence)[0] ?? null
  );
}

/**
 * ② 既定値と上書き行から「効いている上限」を解く（`F-057` 入力「プランのクォータ、テナント個別のクォータ上書き値」）。
 * 🔴 ワーカー（`usage.limit-check`）・主平面（`GET /api/usage`）・運営者（`GET /api/admin/usage`）が同じ関数を通る。
 */
export function resolveQuotaLimit(input: {
  readonly rows: readonly QuotaOverrideRow[];
  readonly metric: QuotaOverrideMetric;
  readonly onDate: string;
  readonly defaultLimit: bigint;
}): { readonly limit: bigint; readonly source: 'DEFAULT' | 'OVERRIDE'; readonly override: QuotaOverrideRow | null } {
  if (input.defaultLimit <= 0n) {
    throw new RangeError(`defaultLimit は 1 以上である必要があります（${input.metric}: ${input.defaultLimit}）。`);
  }
  const override = selectEffectiveQuotaOverride(input.rows, input.metric, input.onDate);
  if (override === null) return { limit: input.defaultLimit, source: 'DEFAULT', override: null };
  return { limit: override.limit, source: 'OVERRIDE', override };
}

// ---------------------------------------------------------------------------
// ③ 引き下げ / 引き上げの判定（`F-057 AC-3`）
// ---------------------------------------------------------------------------

/**
 * 🔴 拒否の理由（列挙。API は 400 に写像し、画面はこの値で次の行動を示す）。
 *
 * - `LIMIT_OUT_OF_RANGE` … 上限は 1 以上の整数（0 にすると `decideAiUnitQuota` / `decideLimitLevel` が成立しない）
 * - `EFFECTIVE_FROM_PAST` … 適用日が過去（遡って上限を変えない。過去の判定・監査を書き換えることになる）
 * - `LOWERING_NOT_DEFERRED` … 🔴 引き下げなのに適用日が当日（**即時反映のみの操作は存在しない**）
 * - `LOWERING_NOTICE_REQUIRED` … 🔴 引き下げなのに通知の確認が無い（対象テナントへの通知が必須）
 */
export const QUOTA_CHANGE_REJECTIONS = [
  'LIMIT_OUT_OF_RANGE',
  'EFFECTIVE_FROM_PAST',
  'LOWERING_NOT_DEFERRED',
  'LOWERING_NOTICE_REQUIRED',
] as const;

export type QuotaChangeRejection = (typeof QUOTA_CHANGE_REJECTIONS)[number];

export class QuotaChangeRejectedError extends Error {
  constructor(readonly reason: QuotaChangeRejection) {
    super(`クォータの変更を受け付けられません（${reason}。docs/02 F-057 AC-3）。`);
    this.name = 'QuotaChangeRejectedError';
  }
}

export type QuotaChangeInput = {
  readonly metric: QuotaOverrideMetric;
  /** その適用日に（この変更が無ければ）効いているはずの上限（`resolveQuotaLimit(..., onDate = effectiveFrom)`）。 */
  readonly currentLimit: bigint;
  readonly nextLimit: bigint;
  /** 適用日（`YYYY-MM-DD`）。 */
  readonly effectiveFrom: string;
  /** 今日（`YYYY-MM-DD`。`Asia/Tokyo`）。 */
  readonly today: string;
  /** 🔴 「対象テナントの管理者へ通知する」ことを操作者が確認したか。引き下げでは必須。 */
  readonly notifyTenantAdmins: boolean;
};

/**
 * 変更の種別。
 * - `RAISE` … 引き上げ。当日から適用してよい（`F-057 AC-3` の制約は引き下げにだけかかる）
 * - `LOWER` … 🔴 引き下げ。**適用日は翌日以降**で、**通知の確認済み**のときだけこの値が返る
 * - `UNCHANGED` … 同じ値（監査には残る。効いている上限は変わらない）
 */
export type QuotaChangeKind = 'RAISE' | 'LOWER' | 'UNCHANGED';

export type QuotaChangeDecision = {
  readonly kind: QuotaChangeKind;
  readonly metric: QuotaOverrideMetric;
  readonly from: bigint;
  readonly to: bigint;
  readonly effectiveFrom: string;
  /** 🔴 テナント管理者へ通知するか。`LOWER` は常に `true`（通知しない引き下げは返らない）。 */
  readonly notifyTenantAdmins: boolean;
};

/**
 * ③ 🔴 引き下げ / 引き上げの判定（純粋関数。`F-057 AC-3`「引き下げには適用日の指定と対象テナントへの通知が必須であり、
 *    即時反映のみの操作が存在しない」）。
 *
 * 受け付けない入力は `QuotaChangeRejectedError` で止める（黙って引き上げ扱いにしない）。
 */
export function decideQuotaChange(input: QuotaChangeInput): QuotaChangeDecision {
  if (input.nextLimit <= 0n) throw new QuotaChangeRejectedError('LIMIT_OUT_OF_RANGE');
  if (input.currentLimit <= 0n) {
    throw new RangeError(`currentLimit は 1 以上である必要があります（${input.metric}: ${input.currentLimit}）。`);
  }
  const daysAhead = compareDayKeys(input.effectiveFrom, input.today);
  if (daysAhead < 0) throw new QuotaChangeRejectedError('EFFECTIVE_FROM_PAST');

  const kind: QuotaChangeKind =
    input.nextLimit < input.currentLimit ? 'LOWER' : input.nextLimit > input.currentLimit ? 'RAISE' : 'UNCHANGED';

  if (kind === 'LOWER') {
    // 🔴 既存顧客の上限を予告なく引き下げない（`F-057` 処理⑤）。当日適用は受け付けない。
    if (daysAhead === 0) throw new QuotaChangeRejectedError('LOWERING_NOT_DEFERRED');
    if (!input.notifyTenantAdmins) throw new QuotaChangeRejectedError('LOWERING_NOTICE_REQUIRED');
  }

  return {
    kind,
    metric: input.metric,
    from: input.currentLimit,
    to: input.nextLimit,
    effectiveFrom: input.effectiveFrom,
    notifyTenantAdmins: kind === 'LOWER',
  };
}

// ---------------------------------------------------------------------------
// `A-004` の抽出（`F-057 AC-1`「消化率が常に低い / 上限に張り付く」）
// ---------------------------------------------------------------------------

/**
 * 🔴 「消化率が常に低い」の閾値（%）。docs/04 §A-004「プラン過大 = 更新時の値下げ・解約要因」を拾うための運用値であり、
 *    事業判断ではないため定数として持つ（80% 側は `QUOTA_WARNING_THRESHOLD_PERCENT` = 到達・接近の閾値と同じ値を使う）。
 */
export const QUOTA_LOW_CONSUMPTION_PERCENT = 20;

/** 抽出の帯。`LOW` = 全計測が低閾値未満 / `HIGH` = いずれかが警告閾値以上 / `MID` = それ以外。 */
export type ConsumptionBand = 'LOW' | 'MID' | 'HIGH';

export const CONSUMPTION_BANDS = ['LOW', 'MID', 'HIGH'] as const satisfies readonly ConsumptionBand[];

/**
 * 消化率（%。整数。切り捨て）。`limit <= 0` は例外（0 割りを 0% にしない）。
 * 🔴 整数演算（`decideLimitLevel` と同じ規律。浮動小数点の比率で帯を決めない）。
 */
export function consumptionPercent(used: bigint, limit: bigint): number {
  if (limit <= 0n) throw new RangeError(`limit は 1 以上である必要があります（受け取った値: ${limit}）。`);
  if (used < 0n) throw new RangeError(`used は 0 以上である必要があります（受け取った値: ${used}）。`);
  return Number((used * 100n) / limit);
}

/**
 * 🔴 テナントの帯を決める（`F-057 AC-1`）。入力は各計測の消化率（%。`consumptionPercent`）。
 *
 * - `HIGH`: 最大値が `highPercent` 以上（上限に張り付いている。プラン過小 = 業務が止まる）
 * - `LOW`: 最大値が `lowPercent` 未満（すべて低い。プラン過大）
 * - `MID`: それ以外
 * 計測が 1 つも無ければ `LOW`（何も使っていない）。
 */
export function classifyConsumptionBand(input: {
  readonly percents: readonly number[];
  readonly lowPercent: number;
  readonly highPercent: number;
}): ConsumptionBand {
  if (!Number.isInteger(input.lowPercent) || input.lowPercent < 1 || input.lowPercent >= input.highPercent) {
    throw new RangeError(`lowPercent は 1 以上かつ highPercent 未満である必要があります（${input.lowPercent} / ${input.highPercent}）。`);
  }
  if (!Number.isInteger(input.highPercent) || input.highPercent > 100) {
    throw new RangeError(`highPercent は 100 以下の整数である必要があります（${input.highPercent}）。`);
  }
  const peak = input.percents.reduce((max, value) => (value > max ? value : max), 0);
  if (peak >= input.highPercent) return 'HIGH';
  if (peak < input.lowPercent) return 'LOW';
  return 'MID';
}
