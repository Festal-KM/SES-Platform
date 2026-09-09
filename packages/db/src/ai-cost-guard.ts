// packages/db/src/ai-cost-guard.ts
// 🔴 テナントの「1 日の AI コスト上限」を**呼び出しの前に予約し、後で実コストに補正する**
//    唯一の経路（docs/05 §7.6 / §7.9 ④ / §7.12 / docs/03 §4.5 / `F-027`）。T-07-04。
//
// ============================================================================
// 🔴 なぜ「予約 → 補正」なのか（docs/03 §4.5 の競合状態）
// ============================================================================
// 「判定 → 呼び出し → 記録」の順に書くと、判定と記録の間に別のジョブが同じテナントで
// 呼び出したとき、**両方が「まだ余裕がある」と判断して両方が呼ぶ**。LLM の 1 回は 1〜10 秒
// かかるため、この窓は現実に開く。したがって
//   ① 呼び出しの**前**に見積り額を `reserved_value` へ**原子的に**加算し（予約）、
//   ② 予約できなければ**呼ばない**（`LIMIT_REACHED`）、
//   ③ 呼び出しの**後**に実コストで `value` を増やし、予約分を戻す（補正）
// という順序にする。①は `INSERT ... ON CONFLICT DO UPDATE ... WHERE` の 1 文で決まるため、
// 何並列で走っても上限を越えた予約は成立しない。
//
// ============================================================================
// 🔴 予約の TTL と清掃（docs/05 §7.12。Fable レビューの申し送りへの回答）
// ============================================================================
// `settle` は `runRole` の手順 7 で呼ばれるが、**記録（`AiUsage`）の失敗や想定外の例外が
// 伝播した場合には走らない**。そのとき予約は残る。本実装はそれを次の意味で扱う:
//
//   1. 🔴 **予約の寿命は「その予約が載っている暦日（Asia/Tokyo）」である。** 判定が読むのは
//      常に当日の行であり、日が変われば新しい行（`reserved_value = 0`）になる。したがって
//      残留予約は **JST 翌 0 時に必ず消える**（清掃ジョブを必要としない）。これが TTL である。
//   2. 🔴 **当日中に残留予約を解放しない。** 予約が残るのは「記録に失敗した」「バグで落ちた」
//      ときであり、そのとき**実際に使った金額はどこにも残っていない**（`ai_usage` にも
//      `value` にも入らない）。ここで予約だけ戻すと、使った分が上限判定から完全に消え、
//      上限が緩む。残す方が保守的であり、遮断器としての目的に合う。
//   3. 🔴 したがって残留は**常に「上限に対して厳しい側」**にしか働かない。上限を越えて
//      外部を呼ぶ事故にはならない（`CLAUDE.md` §7 の 0 件はこちら側で守られる）。
//   4. 前日以前の行の `reserved_value` は判定に使われないため**掃除しない**（事実の記録として
//      残す。`usage.daily-rollup`（§9.8）は `value` だけを突き合わせ、`reserved_value` に
//      触れない）。
//
// ============================================================================
// 🔴 なぜ `packages/ai` ではなくここに実装があるのか
// ============================================================================
// `packages/ai` に置いてよいのは**ポートだけ**である（docs/05 §7.9 ④）。金額を持つのは
// 1 箇所（`packages/domain` の単価表）であり、それを引いて USD を組み立てるのは記録側 =
// `packages/db` に限る（`tests/static/ai-usage-cost-single-path.test.ts` が固定している）。
// ポートとの接続は `apps/worker/src/ai/cost-guard.ts` が行う（束ねるのは `apps/*`。§2.1）。
import { Prisma } from '@prisma/client';
import {
  decideAiDailyCost,
  estimateAiCostUsd,
  formatUsdMicros,
  parseUsdMicros,
  usagePeriodKey,
  type AiTokenCounts,
} from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { usagePeriodResetAt } from './usage-period.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/** 🔴 本モジュールが触る唯一の metric と期間（docs/05 §3.8 / §7.6。日次の遮断器）。 */
const AI_COST_METRIC = 'AI_COST_USD';
/**
 * 🔴 T-07-08: `review-gate.ts` の `gateHoldTimestamps`（#40 の `resetAt`）も**この 1 つ**を読む。
 *    上限の集計期間と、利用者に見せる再開時刻の暦が別々に決まると、
 *    「表示された時刻を過ぎても再開しない」という追跡不能なずれになる。
 */
export const AI_COST_PERIOD_KIND = 'DAY';

/** 予約証（`AiCostReservation.handle`）の書式。版を前置してあり、後から形を変えられる。 */
const HANDLE_VERSION = 'v1';

type CounterRow = { readonly value: string; readonly reserved_value: string };

/**
 * 予約の結果。
 *
 * 🔴 **例外ではなく値で返す。** `AiCostLimitExceededError` は `packages/ai` の型であり、
 *    `packages/db` はそれを import できない（`CLAUDE.md` §2.1）。写像は
 *    `apps/worker/src/ai/cost-guard.ts` が行う（ポートの契約は「throw する」である）。
 */
export type AiCostReservationOutcome =
  | {
      readonly kind: 'RESERVED';
      /** 🔴 `settle` に返す証。中身の解釈は本モジュールだけが行う（`packages/ai` は運ぶだけ）。 */
      readonly handle: string;
      /** 予約した見積り額（USD）。 */
      readonly reservedUsd: string;
      readonly periodKey: string;
    }
  | {
      readonly kind: 'LIMIT_REACHED';
      readonly limitUsd: string;
      /** 予約前の残り枠（`max(0, limit − value − reserved)`）。🔴 運営平面（`A-004`）向け。 */
      readonly headroomUsd: string;
      /** 🔴 上限がリセットされる時刻（JST の翌 0 時）。利用者に見せてよい値（`F-027 AC-6`）。 */
      readonly resetAt: Date;
      readonly periodKey: string;
    };

export type AiCostReserveInput = {
  /** 🔴 応答ではなく**要求**のモデル ID（予約は呼び出しの前に行う）。 */
  readonly modelId: string;
  /** `packages/ai` の保守的な近似（文字数 ÷ 3）。多めに倒す（docs/05 §7.9 ④）。 */
  readonly estimatedInputTokens: number;
  /** 出力は上限まで出る前提で見積もる（少なく見ると上限を越えてから気づく）。 */
  readonly maxOutputTokens: number;
  /** テナントの 1 日上限（`Plan.aiDailyCostLimitUsd` / `AI_DAILY_COST_LIMIT_USD_DEFAULT`）。 */
  readonly limitUsd: string;
  readonly now: Date;
};

export type AiCostSettleInput = {
  /** `reserveAiCost` が返した証。 */
  readonly handle: string;
  /** 🔴 **失敗した試行も含む**全試行の実績（原価は発生している。docs/05 §7.4）。 */
  readonly attempts: readonly { readonly modelId: string; readonly tokens: AiTokenCounts }[];
  readonly now: Date;
};

export type AiCostSettlement = {
  /** 実コストの合計（`value` に積んだ額）。 */
  readonly actualUsd: string;
  /** 補正後の `usage_counters.value`。 */
  readonly valueUsd: string;
  /** 補正後の `usage_counters.reserved_value`。 */
  readonly reservedUsd: string;
  readonly periodKey: string;
};

/** その日の AI コスト（読み取り専用。停止表示（`F-027`）と `gate.hold-release` が使う）。 */
export type AiDailyCost = {
  readonly periodKey: string;
  readonly usedUsd: string;
  readonly reservedUsd: string;
  /** 🔴 この日の枠がリセットされる時刻（JST の翌 0 時）。停止表示に出す唯一の時刻。 */
  readonly resetAt: Date;
};

/**
 * 予約証の組み立て（`v1:{periodKey}:{micro-USD}`）。
 *
 * 🔴 **予約した「日」と「額」を証に載せる。** `settle` は現在時刻ではなく**予約の日**の行を
 *    補正する —— 呼び出しが JST の 0 時をまたいだとき（23:59 に予約して 00:00 に完了）、
 *    今日の行を補正すると**昨日の予約が永久に残り、今日の枠が実コストで削られる**。
 *    予約と補正は必ず同じ行で対になる。
 * @internal `ai-cost-guard.test.ts` からのみ直接使う（`index.ts` から export しない）。
 */
export function encodeAiCostReservationHandle(periodKey: string, reservedUsd: string): string {
  return `${HANDLE_VERSION}:${periodKey}:${parseUsdMicros(reservedUsd).toString()}`;
}

/** @internal 上記の逆変換。壊れた証は**握り潰さず** `RangeError` にする。 */
export function decodeAiCostReservationHandle(handle: string): {
  readonly periodKey: string;
  readonly reservedUsd: string;
} {
  const parts = handle.split(':');
  const [version, periodKey, micros] = parts;
  if (
    parts.length !== 3 ||
    version !== HANDLE_VERSION ||
    periodKey === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodKey) ||
    micros === undefined ||
    !/^\d{1,26}$/.test(micros)
  ) {
    throw new RangeError(
      `AI コスト予約の証が不正です（${handle}）。予約を補正できないため処理を続けません（docs/05 §7.6）。`,
    );
  }
  return { periodKey, reservedUsd: formatUsdMicros(BigInt(micros)) };
}

/** 全試行の実コストを合算する（`estimateAiCostUsd` は 1 試行ぶんの純粋関数）。 */
function totalActualUsd(attempts: AiCostSettleInput['attempts']): string {
  let micros = 0n;
  for (const attempt of attempts) {
    micros += parseUsdMicros(
      estimateAiCostUsd({ modelId: attempt.modelId, tokens: attempt.tokens }),
    );
  }
  return formatUsdMicros(micros);
}

/**
 * 🔴 呼び出しの**前**に見積り額を予約する（docs/05 §7.6 手順 3）。
 *
 * 🔴 予約できなければ `LIMIT_REACHED` を返し、呼び出し側は **LLM を 1 回も呼ばない**。
 *    上限の対象は 6 ロールすべて（`gate-inspector` を含む）であり、「上限到達時に
 *    `gate-inspector` をスキップして `ReviewGate` を PASS にする」分岐は存在しない
 *    （docs/03 §7.6.1 末尾 / docs/05 §7.6）。
 *
 * 🔴 **単価が引けないモデルはここで落ちる**（`UnknownAiModelPriceError`）。呼び出しの前に
 *    落ちるため「原価だけが出て記録できない」状態にならない（docs/05 §7.11 ⑤）。
 *
 * 🔴 上限を超える見積り（1 回で枠を使い切る要求）は**行が無くても**予約できない ——
 *    `INSERT ... SELECT ... WHERE` を使うのはそのためである。素の `INSERT ... ON CONFLICT`
 *    では、その日の最初の 1 回だけ上限を無視して通ってしまう（`DO UPDATE ... WHERE` は
 *    衝突したときにしか効かない）。
 */
export async function reserveAiCost(
  ctx: HostTenantCtx,
  input: AiCostReserveInput,
): Promise<AiCostReservationOutcome> {
  const estimateUsd = estimateAiCostUsd({
    modelId: input.modelId,
    tokens: {
      inputTokens: input.estimatedInputTokens,
      outputTokens: input.maxOutputTokens,
      // 🔴 キャッシュは見積りに入れない（読み出しは単価が 1/10、書込は当たるとは限らない）。
      //    どちらも「多めに倒す」向きに反しない。
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
  const limitMicros = parseUsdMicros(input.limitUsd);
  if (limitMicros <= 0n) {
    throw new RangeError(
      `AI の 1 日コスト上限は 0 より大きい必要があります（受け取った値: ${input.limitUsd}）。`,
    );
  }
  const periodKey = usagePeriodKey(AI_COST_PERIOD_KIND, input.now);
  const id = uuidV7(input.now);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<AiCostReservationOutcome> => {
      const reserved = await tx.$queryRaw<CounterRow[]>(Prisma.sql`
        INSERT INTO usage_counters
          (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
        SELECT ${id}::uuid, ${ctx.tenantId}::uuid, ${AI_COST_PERIOD_KIND}, ${periodKey},
               ${AI_COST_METRIC}, 0, ${estimateUsd}::numeric, ${input.now}::timestamptz
         WHERE ${estimateUsd}::numeric <= ${input.limitUsd}::numeric
        ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
          SET reserved_value = usage_counters.reserved_value + ${estimateUsd}::numeric,
              observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
          WHERE usage_counters.value + usage_counters.reserved_value + ${estimateUsd}::numeric
                <= ${input.limitUsd}::numeric
        RETURNING value::text AS value, reserved_value::text AS reserved_value`);

      if (reserved[0] !== undefined) {
        return {
          kind: 'RESERVED',
          handle: encodeAiCostReservationHandle(periodKey, estimateUsd),
          reservedUsd: estimateUsd,
          periodKey,
        };
      }

      // 🔴 0 行 ＝ 上限到達。**現在値を読み直して**停止の理由を組み立てる（表示と監視の根拠）。
      //    残量（headroom）の式は `decideAiDailyCost`（domain）が唯一の実装であり、予約の可否
      //    （この SQL）と表示（`A-004` / `S-038`）・`gate.hold-release` の再判定で食い違わない。
      //    リセット時刻は `usagePeriodResetAt`（同じ暦の 1 実装。`usage-period.ts`）が出す。
      const current = await tx.$queryRaw<CounterRow[]>(Prisma.sql`
        SELECT value::text AS value, reserved_value::text AS reserved_value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = ${AI_COST_PERIOD_KIND}
           AND period_key = ${periodKey}
           AND metric = ${AI_COST_METRIC}`);
      const decision = decideAiDailyCost({
        limitUsd: input.limitUsd,
        usedUsd: current[0]?.value ?? '0',
        reservedUsd: current[0]?.reserved_value ?? '0',
        requestedUsd: estimateUsd,
      });
      return {
        kind: 'LIMIT_REACHED',
        limitUsd: input.limitUsd,
        // 🔴 `decision` が `ALLOW` に見えるのは、SQL が 0 行を返した後・読み直しの前に別の実行が
        //    `settle` した場合だけである。それでも**この呼び出しは呼ばない**（予約できていない
        //    事実は変わらない）。次の呼び出しが改めて予約するので、静かに枠が余ることはない。
        headroomUsd: decision.headroomUsd,
        resetAt: usagePeriodResetAt(AI_COST_PERIOD_KIND, input.now),
        periodKey,
      };
    },
  );
}

/**
 * 上限に「あと何回ぶんの余地があるか」（`gate.hold-release` の再判定。docs/05 §9.3 / `F-027 AC-5`）。
 *
 * 🔴 **件数で答える**（`send.hold-release` の `headroom` と同じ形）。金額（USD）を返さない ——
 *    復帰の配分に要るのは「何件戻してよいか」であり、金額は運営平面（`A-004`）の指標である
 *    （`F-027 AC-6`）。
 */
export type AiCostHeadroom =
  | { readonly kind: 'ALLOW'; readonly capacity: number }
  | { readonly kind: 'BLOCK' };

/**
 * 🔴 予約と**同じ判定式**で、1 回ぶんの見積りが通るかを調べる（**書き込まない**）。T-07-10。
 *
 * `gate.hold-release`（毎 10 分）が「上限に余地があるか」を確かめるために使う。
 *
 * 🔴 **予約しない。** ここで予約すると、再 enqueue した `gate.run` が自分の予約に阻まれる
 *    （枠を二重に取る）。実際の確保は `reserveAiCost` が呼び出しの直前に行う。
 * 🔴 **見積りも判定式も `reserveAiCost` と同じ 1 実装**（`estimateAiCostUsd` / `decideAiDailyCost`）を
 *    通す。別式にすると「復帰させたのに毎回また保留になる」「余地があるのに戻さない」が起きる。
 * 🔴 **時刻で判定しない。** 日次の枠は暦（JST）でリセットされるが、判定は常に
 *    「そのときのカウンタ」を読む（`send.hold-release` と同じ規律）。
 *
 * @returns `ALLOW` の `capacity` は「この見積りが何回ぶん入るか」（1 以上）。
 */
export async function probeAiCostHeadroom(
  ctx: HostTenantCtx,
  input: AiCostReserveInput,
): Promise<AiCostHeadroom> {
  const estimateUsd = estimateAiCostUsd({
    modelId: input.modelId,
    tokens: {
      inputTokens: input.estimatedInputTokens,
      outputTokens: input.maxOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
  const estimateMicros = parseUsdMicros(estimateUsd);
  if (estimateMicros <= 0n) {
    // 🔴 0 円の見積りは「何回でも入る」を意味してしまう（上限が実質無効になる）。握り潰さない。
    throw new RangeError(
      `AI 呼び出しの見積りが 0 です（modelId=${input.modelId}）。上限の余地を判定できません（docs/05 §7.6）。`,
    );
  }

  const current = await readAiDailyCost(ctx, input.now);
  const decision = decideAiDailyCost({
    limitUsd: input.limitUsd,
    usedUsd: current.usedUsd,
    reservedUsd: current.reservedUsd,
    requestedUsd: estimateUsd,
  });
  if (decision.kind === 'BLOCK') return { kind: 'BLOCK' };
  return { kind: 'ALLOW', capacity: Number(parseUsdMicros(decision.headroomUsd) / estimateMicros) };
}

/**
 * 🔴 呼び出しの**後**に、予約を実コストへ補正する（docs/05 §7.6 手順 7）。
 *
 * 1 文で「予約分を戻す」と「実コストを積む」を同時に行う。分けると、片方だけ成功した状態
 * （枠は空いたのに原価が積まれていない ＝ 上限が実質無効）が生まれる。
 *
 * 🔴 `GREATEST(..., 0)` で `reserved_value` の下限を 0 に留める。二重に呼ばれても予約残高が
 *    負にならない（負の残高は以後の呼び出しに実体の無い枠を与える）。
 * 🔴 **冪等ではない。** `value` は呼ばれた回数だけ積まれる。呼び出し元は `runRole` の
 *    手順 7 の 1 箇所だけである（`AiCostGuard.settle` を他から呼ばない）。
 * 🔴 0 件更新は**成功として返さない**（`incrementUsageCounter` と同じ規律。`F-026 AC-4`）。
 *    予約したときに行は必ず存在するため、0 件は分離の破れか行の消失を意味する。
 */
export async function settleAiCost(
  ctx: HostTenantCtx,
  input: AiCostSettleInput,
): Promise<AiCostSettlement> {
  const { periodKey, reservedUsd } = decodeAiCostReservationHandle(input.handle);
  const actualUsd = totalActualUsd(input.attempts);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<AiCostSettlement> => {
      const rows = await tx.$queryRaw<CounterRow[]>(Prisma.sql`
        UPDATE usage_counters
           SET reserved_value = GREATEST(reserved_value - ${reservedUsd}::numeric, 0),
               value = value + ${actualUsd}::numeric,
               observed_at = GREATEST(observed_at, ${input.now}::timestamptz)
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = ${AI_COST_PERIOD_KIND}
           AND period_key = ${periodKey}
           AND metric = ${AI_COST_METRIC}
        RETURNING value::text AS value, reserved_value::text AS reserved_value`);

      const row = rows[0];
      if (row === undefined) {
        throw new Error(
          `AI コストの予約を補正できませんでした（periodKey=${periodKey}）。` +
            '予約した行が見つかりません（docs/05 §7.6）。',
        );
      }
      return {
        actualUsd,
        valueUsd: row.value,
        reservedUsd: row.reserved_value,
        periodKey,
      };
    },
  );
}

/**
 * 🔴 その日の AI コストの実績と予約残高を読む（読み取りのみ）。
 *
 * 使う側: `gate.hold-release`（上限が空いたかの再判定。§9.3）と、停止表示
 * （`F-027`。🔴 **利用者に見せるのは停止の事実・理由・リセット時刻だけであり、金額を
 * そのまま画面へ流さない**。`F-027 AC-6`）。判定そのものは `decideAiDailyCost` が行う。
 *
 * 🔴 行が無ければ 0（まだ 1 回も呼んでいない日）。**例外にしない** —— 実際に 0 であり、
 *    それは欠測ではない（`readStorageBytesUsed` と同じ判断）。
 */
export async function readAiDailyCost(ctx: HostTenantCtx, at: Date): Promise<AiDailyCost> {
  const periodKey = usagePeriodKey(AI_COST_PERIOD_KIND, at);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<AiDailyCost> => {
      const rows = await tx.$queryRaw<CounterRow[]>(Prisma.sql`
        SELECT value::text AS value, reserved_value::text AS reserved_value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = ${AI_COST_PERIOD_KIND}
           AND period_key = ${periodKey}
           AND metric = ${AI_COST_METRIC}`);
      const row = rows[0];
      // 🔴 行の有無で書式が変わらないようにする（`'0'` と `'0.000000'` が混ざると、
      //    呼び出し側が文字列比較で分岐を書き始める）。
      return {
        periodKey,
        usedUsd: formatUsdMicros(parseUsdMicros(row?.value ?? '0')),
        reservedUsd: formatUsdMicros(parseUsdMicros(row?.reserved_value ?? '0')),
        resetAt: usagePeriodResetAt(AI_COST_PERIOD_KIND, at),
      };
    },
  );
}
