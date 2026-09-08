// packages/db/src/ai-usage.ts
// 🔴 `AiUsage` を書き、利用者向けの件数（`UsageCounter(MONTH,'AI_UNIT_*')`）を加算する
//    **唯一の経路**（docs/05 §7.3 手順 6 / 6b / §7.11 / `F-026 AC-1` `AC-2` `AC-6`）。T-07-03。
//
// ============================================================================
// 🔴 この 2 関数が `packages/ai` の `AiUsageRecorder`（ポート）の実装本体である
// ============================================================================
// `packages/ai` は `@ses/db` に依存できない（CLAUDE.md §2.1）ため、ポートの**形**は
// `packages/ai/src/usage.ts` にあり、**実体**はここにある。両者を繋ぐ数行のアダプタは
// `apps/worker/src/ai/usage-recorder.ts`（束ねるのは `apps/*` の層。§2.1）であり、
// そこで `AiUsageRecorder` へ代入されることが「形が合っている」ことのコンパイル時の証明になる。
//
// ============================================================================
// 🔴 記録できない呼び出しを成功にしない（docs/05 §7.3 の実行時ガード 3）
// ============================================================================
// 本モジュールは失敗を握り潰さない。INSERT が RLS で弾かれても、単価が引けなくても、
// 件数が数えられなくても**例外にする**。`runRole` はそれを `AiUsageNotRecordedError` に包んで
// throw し、呼び出し（と成果物）を成立させない。**0 件を成功として返さない**のは
// `incrementUsageCounter` / `applyStorageDelta` と同じ規律である（`F-026 AC-4`）。
//
// ============================================================================
// 🔴 なぜ `create()` を使えるのか（`audit_logs` との違い）
// ============================================================================
// `ai_usage` は INSERT も SELECT も C2 HOST_ONLY（20260903050000 §5）であり、書き手は必ず
// ホスト文脈（`systemTenantCtx`）である。したがって `create()` の `RETURNING` に適用される
// SELECT ポリシーも通る（`audit_logs` は INSERT が C1 / SELECT が C2 なので `createMany` が要る）。
// 🔴 `id` を返す必要があるため、ここは `create()` でなければならない
//    （`Provenance.aiUsageIds` と、生成物側の `ai_usage_id` NOT NULL 制約がこの値を要る）。
import { estimateAiCostUsd, resolveAiUnitCount, type AiRole, type AiTokenCounts, type AiUsageFailureKind, type AiUsagePurpose } from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { incrementUsageCounter, type UsageCounterValue } from './usage-counters.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * `mask()`（`packages/ai`）が返す 1 種別の要約。
 *
 * 🔴 **一致した文字列を持たない**（docs/05 §7.10 ⑤）。原文を持たせると、マスキングの記録自体が
 *    PII の再出現経路になる。
 * 🔴 `category` / `method` を `string` で受けるのは、`packages/db` が `@ses/ai` の
 *    `MaskCategory` / `MaskMethod` を import できないためである（構造的に代入できる）。
 */
export type AiUsageMaskHit = {
  readonly category: string;
  readonly method: string;
  readonly count: number;
};

/**
 * `ai_usage` の 1 行（🔴 **試行 1 回につき 1 行**。成功・失敗を問わない。docs/05 §7.4）。
 *
 * 🔴 `tenantId` を持たない。分離キーは `ctx`（認証・ジョブ文脈）から取る（CLAUDE.md §3.1）。
 * 🔴 `estimatedCostUsd` も持たない。金額はトークン数とモデル ID から機械的に決まるため、
 *    **記録側が算出する**（docs/05 §7.9 ④。呼び出し側に金額を組み立てさせない）。
 */
export type AiUsageRecordValues = {
  readonly role: AiRole;
  readonly purpose: AiUsagePurpose;
  readonly modelId: string;
  readonly promptVersion: string;
  /** 対象エンティティ（`'PROPOSAL'` / `'SKILL_SHEET'` など）。`F-026` の記録項目。 */
  readonly targetType?: string | undefined;
  /** 🔴 UUID であること（`ai_usage.target_id` は `uuid` 列）。 */
  readonly targetId?: string | undefined;
  readonly tokens: AiTokenCounts;
  /** 🔴 再試行は `attemptNo` を増やして別の行にする（件数には入らないが金額には計上する）。 */
  readonly attemptNo: number;
  readonly succeeded: boolean;
  /** 成功時は undefined。失敗時は必ず入る（`ai_usage_failure_kind_check` の 5 値）。 */
  readonly failureKind?: AiUsageFailureKind | undefined;
  /** 🔴 パターン検出による追加マスキングの要約（docs/03 §4.2 / docs/05 §7.10 ⑤）。 */
  readonly maskHits?: readonly AiUsageMaskHit[] | undefined;
  readonly startedAt: Date;
  readonly finishedAt: Date;
};

/** 🔴 `mask()` の `method` のうち、`AiUsage` に記録するもの（docs/03 §4.2 は「パターン検出」だけを求める）。 */
const RECORDED_MASK_METHOD = 'PATTERN';

/**
 * 🔴 パターン検出（補助）の要約を `{ 種別: 件数 }` に畳む（docs/03 §4.2）。
 *
 * **なぜ `PATTERN` だけを残すか**: `KNOWN_VALUE`（台帳の値による置換）は主たる経路であり、
 * 起きて当然の出来事である。記録して意味があるのは**補助が拾ってしまった**ことのほうで、
 * それは「台帳に無い個人情報が本文に混じっていた」という台帳側の欠落の兆候である
 * （`A-005` / `F-059` がここを見る）。両方を混ぜると、その兆候が主経路の件数に埋もれる。
 *
 * 🔴 同じ種別が複数回現れたら合算する（`mask()` は種別 × 方式で 1 件に畳んで返すが、
 *    呼び出し側が複数回の `mask()` の結果を連結して渡すことがありうる）。
 * @internal `recordAiUsage` からのみ使う（`index.ts` から export しない）。
 */
export function summarizePatternMaskHits(
  hits: readonly AiUsageMaskHit[] | undefined,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const hit of hits ?? []) {
    if (hit.method !== RECORDED_MASK_METHOD) continue;
    if (hit.count <= 0) continue;
    summary[hit.category] = (summary[hit.category] ?? 0) + hit.count;
  }
  return summary;
}

/**
 * 🔴 `AiUsage` を 1 行 INSERT する（docs/05 §7.3 手順 6 / `F-026 AC-1` `AC-2`）。
 *
 * 記録項目は `F-026` の入力そのもの: テナント / **ロール識別子** / モデル / 用途 /
 * 入出力トークン / 推定コスト / 対象エンティティ。
 *
 * 🔴 **ロール識別子は NOT NULL であり、DB の CHECK が 6 値に閉じている**（20260903040000）。
 *    欠損・誤記が入らないことが `F-063`（ロール別原価の分解）の前提である。
 * 🔴 推定コストはここで算出する（`estimateAiCostUsd`）。単価が引けないモデルは
 *    `UnknownAiModelPriceError` になり、**行は 1 つも書かれない**（0 円で記録しない）。
 *
 * @returns 書き込んだ `AiUsage.id`（`Provenance.aiUsageIds` と生成物の `ai_usage_id` が使う）。
 */
export async function recordAiUsage(
  ctx: HostTenantCtx,
  values: AiUsageRecordValues,
): Promise<string> {
  if (!Number.isInteger(values.attemptNo) || values.attemptNo < 1) {
    throw new RangeError(
      `attemptNo は 1 以上の整数である必要があります（受け取った値: ${values.attemptNo}）。`,
    );
  }
  // 🔴 成否と失敗種別を食い違わせない（`CLAUDE.md` §4.2「失敗と保留を混同しない」と同じ規律）。
  //    DB の CHECK は値集合しか見ないため、「成功なのに `failureKind` がある」行は入ってしまう。
  //    そのまま積むと `A-005` の失敗率と `F-063` の原価分解の両方が汚れる。
  if (values.succeeded !== (values.failureKind === undefined)) {
    throw new RangeError(
      `succeeded と failureKind が矛盾しています（succeeded=${values.succeeded} / failureKind=${String(values.failureKind)}）。` +
        '成功した試行に失敗種別は付かず、失敗した試行には必ず付きます（docs/05 §7.4）。',
    );
  }
  // 🔴 単価の解決を **INSERT の前**に行う。後に置くと、単価未登録のモデルで
  //    「行は書けたが金額が入っていない」中途半端な記録が残りうる。
  const estimatedCostUsd = estimateAiCostUsd({
    modelId: values.modelId,
    tokens: values.tokens,
  });

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      // 🔴 `tenantId` の出所は **ctx だけ**である（`AiUsageRecordValues` に `tenantId` は無い）。
      //    Prisma 拡張（第 2 防御）が同じ値を注入・突合し、食い違えば `CrossTenantWriteError` に
      //    なる（`assertTenantKeyNotMoved`）。`ai_usage.tenant_id` は NOT NULL なので
      //    `audit_logs` と違い型としても省略できず、ここで明示するのが唯一の書き方である。
      const row = await tx.aiUsage.create({
        data: {
          tenantId: ctx.tenantId,
          role: values.role,
          purpose: values.purpose,
          modelId: values.modelId,
          promptVersion: values.promptVersion,
          targetType: values.targetType ?? null,
          targetId: values.targetId ?? null,
          inputTokens: values.tokens.inputTokens,
          outputTokens: values.tokens.outputTokens,
          cacheReadTokens: values.tokens.cacheReadTokens,
          cacheWriteTokens: values.tokens.cacheWriteTokens,
          estimatedCostUsd,
          attemptNo: values.attemptNo,
          succeeded: values.succeeded,
          failureKind: values.failureKind ?? null,
          maskPatternHits: summarizePatternMaskHits(values.maskHits),
          startedAt: values.startedAt,
          finishedAt: values.finishedAt,
        },
        select: { id: true },
      });
      return row.id;
    },
  );
}

/** 件数の加算対象（🔴 成功した `runRole` 1 回につき 1 度だけ渡される。docs/05 §7.6）。 */
export type AiUnitCountValues = {
  readonly role: AiRole;
  /** 🔴 検証済みの出力。`match-explainer` は 1 リクエストで N 件を数えるため出力そのものを見る。 */
  readonly output: unknown;
  readonly occurredAt: Date;
};

/**
 * 🔴 利用者に見せる件数を `UsageCounter(MONTH,'AI_UNIT_*')` に加算する
 *    （docs/05 §7.3 手順 6b / §7.6 / `P-A-18`）。
 *
 * 🔴 **`AiUsage` の行数から数え直さない**（docs/03 申し送り 30）。数え直すと再試行・
 *    `skill-normalizer`・`gate-inspector` が混入する。ここは「成功 1 回」から**独立に**加算する。
 * 🔴 **金額から割り戻さない**（`F-026 AC-6`）。加算量は `resolveAiUnitCount`（単価を参照しない
 *    純粋関数）だけで決まるため、1 件あたり標準原価を後から見直しても過去の件数は変わらない。
 *
 * @returns 加算後のカウンタ値。🔴 **数えないロール（`skill-normalizer` / `gate-inspector`）と
 *   件数 0 のときは `null`**（行を作らない）。呼び出し側はこれをエラーとして扱わない。
 */
export async function countAiUnit(
  ctx: HostTenantCtx,
  values: AiUnitCountValues,
): Promise<UsageCounterValue | null> {
  const unit = resolveAiUnitCount(values.role, values.output);
  if (unit === null || unit.quantity <= 0) return null;

  return incrementUsageCounter(ctx, {
    // 🔴 利用者向けの件数クォータは**月次**である（docs/03 §7.6.2。日次は金額側の遮断器）。
    periodKind: 'MONTH',
    metric: unit.metric,
    amount: String(unit.quantity),
    observedAt: values.occurredAt,
  });
}
