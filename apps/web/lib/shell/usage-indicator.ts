// apps/web/lib/shell/usage-indicator.ts
// 共通外枠のヘッダに出す「上限インジケータ」（docs/04 §3.1 のヘッダの表 / §3.4 / `F-027`）。
//
// ============================================================================
// 🔴 出す条件と出し方（docs/04 §3.1）
// ============================================================================
//   - **AI の件数クォータ・メール・ストレージのいずれかが 80% を超えたときだけ**出す。
//     平常時は出さない（常時警告は無視される）。
//   - **表示は件数（通数 / GB）であり、金額は出さない**（`F-027 AC-6` / `BR-24` / Issue #12）。
//   - **AI が 1 日のコスト上限で停止しているときは、残量ではなく「停止中」と理由**を出す
//     （停止は遮断器であってメーターではない。docs/04 §S-038）。
//
// 🔴 判定は `readUsageView` / `readBlockedNotice`（`lib/usage/view.ts`）の**同じ 1 実装**を通る。
//    しきい値（80%）も上限値も `packages/domain` / `resolveTenantQuotas` が決めた結果をそのまま読む ——
//    ここで「80」を書き直すと、画面（`S-038`）とヘッダで違う瞬間に警告が出る。
// 🔴 取引先所属（`partnerCompanyId !== null`）には **#70（停止の事実と理由）だけ**を使う。
//    残量・上限値は `BlockedNoticeView` に型として無く、ヘッダにも出ない（`F-027 AC-1` / 第二境界）。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` / 表示整形のみ）。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { AI_UNIT_METRICS, type UsageLimitLevel } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import { formatThousands } from '../format/number';
import { formatGigabytes } from '../usage/format';
import { AI_UNIT_MESSAGE_KEYS } from '../usage/labels';
// 🔴 T-12-20: 読み取りは**リクエスト内 1 回**に畳んだ経路を通す（`lib/usage/request-scope.ts`）。
//    `/settings/usage` ではヘッダと本文が同じ結果を共有する（同じ `ctx` / 同じ `now` を渡すこと）。
import { readBlockedNoticeOnce, readUsageViewOnce } from '../usage/request-scope';
import { AI_UNIT_KEYS, type UsageView } from '../usage/view';

/** 接近している 1 つの単位（ヘッダは**最も切迫した 1 つ**だけを出す。ヘッダに表を置かない）。 */
export type ShellUsageMetric = {
  /** 単位の表示名（`usage.aiUnit.*` / `usage.section.email` / `usage.section.storage`）。 */
  readonly labelKey: MessageKey;
  /** 残量（3 桁区切り済みの数。🔴 金額ではない）。 */
  readonly remaining: string;
  /** 残量の単位（`usage.unit.count` / `usage.unit.messages` / `usage.unit.gb`）。 */
  readonly unitKey: MessageKey;
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
};

export type ShellUsageIndicator =
  /** 平常時。🔴 ヘッダに何も出さない。 */
  | { readonly kind: 'NONE' }
  /** AI が 1 日のコスト上限で停止中。残量は出さない。 */
  | { readonly kind: 'STOPPED' }
  | { readonly kind: 'NEARING'; readonly metric: ShellUsageMetric };

function nonNegative(value: number): number {
  return value > 0 ? value : 0;
}

/**
 * 🔴 `UsageView.storage.*` は自前の `bigint.toString()` であり、桁以外が入ることは不変条件の破れである。
 *    黙って 0 に丸めない（丸めると「残量たっぷり」に見える）。判定は `lib/usage/format.ts` と同じ形。
 */
function toBytes(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new RangeError(`バイト数の文字列が不正です（${value}）。`);
  return BigInt(value);
}

/**
 * 🔴 純粋な選択（DB を読まない）。`readUsageView` の結果から「ヘッダに出す 1 つ」を決める。
 *
 * 順序は **到達（`REACHED`）> 接近（`NEARING`）**、同じ水準なら
 * **AI の 4 単位（`AI_UNIT_METRICS` の順）→ メール → ストレージ**。
 * 🔴 決定的であること自体が要件である —— 同じ状態で読み直すたびにヘッダの文言が入れ替わると、
 *    利用者は「何がどれだけ残っているか」を読み取れない。
 */
export function selectShellUsageIndicator(view: UsageView): ShellUsageIndicator {
  if (view.aiDailyStop.stopped) return { kind: 'STOPPED' };

  const candidates: ShellUsageMetric[] = [];
  for (const metric of AI_UNIT_METRICS) {
    const key = AI_UNIT_KEYS[metric];
    const unit = view.aiUnits[key];
    if (unit.level === 'BELOW') continue;
    candidates.push({
      labelKey: AI_UNIT_MESSAGE_KEYS[key],
      remaining: formatThousands(unit.remaining),
      unitKey: 'usage.unit.count',
      level: unit.level,
    });
  }
  if (view.email.level !== 'BELOW') {
    candidates.push({
      labelKey: 'usage.section.email',
      remaining: formatThousands(nonNegative(view.email.dailyLimit - view.email.usedToday)),
      unitKey: 'usage.unit.messages',
      level: view.email.level,
    });
  }
  if (view.storage.level !== 'BELOW') {
    const used = toBytes(view.storage.usedBytes);
    const limit = toBytes(view.storage.limitBytes);
    candidates.push({
      labelKey: 'usage.section.storage',
      remaining: formatGigabytes(limit > used ? limit - used : 0n),
      unitKey: 'usage.unit.gb',
      level: view.storage.level,
    });
  }

  const reached = candidates.find((candidate) => candidate.level === 'REACHED');
  const metric = reached ?? candidates[0];
  return metric === undefined ? { kind: 'NONE' } : { kind: 'NEARING', metric };
}

/**
 * ヘッダ 1 回ぶんの読み取り。
 *
 * 🔴 ホスト所属は `#69`（残量つき）、取引先所属は `#70`（停止の事実と理由だけ）。
 *    所属で経路を変えるのは `S-038` と同じ判断であり、ロール名ではなく**所属**で決める
 *    （`memberships` の CHECK と 1 対 1）。
 */
export async function readShellUsageIndicator(
  ctx: AuthenticatedTenantCtx,
  now: Date,
): Promise<ShellUsageIndicator> {
  if (ctx.partnerCompanyId !== null) {
    const notice = await readBlockedNoticeOnce(ctx, now);
    return notice.blocked ? { kind: 'STOPPED' } : { kind: 'NONE' };
  }
  return selectShellUsageIndicator(await readUsageViewOnce(ctx, now));
}
