// packages/ai/src/roles/types.ts
// 🔴 ロールは自律エージェントではない。**入出力スキーマが定義されたパイプライン工程**である
//    （CLAUDE.md §12.3 / docs/05 §7.1）。「次に何をするか」をモデルに決めさせる実装をしない。

import type { z } from 'zod';
import type { AiRole, AiUsageFailureKind, AiUsagePurpose } from '@ses/domain';
import type { MaskedText, MaskHit } from '../mask.js';

// 🔴 値集合の唯一の出所は `packages/domain`（T-07-01。`packages/db` の CHECK と同じ 1 表を見る）。
//    ここは `@ses/ai` の利用者が追加の import 無しにロールを扱えるようにするための re-export である。
export {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  isAiRole,
  ROLE_PURPOSE,
} from '@ses/domain';
export type {
  AiRole,
  AiUsageFailureKind,
  AiUsagePurpose,
  ApprovalModeConfigurableRole,
} from '@ses/domain';

/**
 * ロールが既定で使うモデルの**段**（docs/05 §7.1 の `defaultModel`）。
 *
 * 🔴 モデル ID を直書きしない（CLAUDE.md §12.3）。実際の ID は起動時に
 *    `packages/config` の `ANTHROPIC_MODEL_DEFAULT` / `ANTHROPIC_MODEL_CHEAP` から渡され、
 *    テナント別の上書き（`TenantRoleModel`）が優先される（`../models.js`）。
 */
export type ModelTier = 'DEFAULT' | 'CHEAP';

/** ロールが組み立てたプロンプト。🔴 `MaskedText` しか返せない（マスキングの迂回経路を作らない）。 */
export type RolePrompt = {
  readonly system: MaskedText;
  readonly user: MaskedText;
};

/**
 * ロールの定義（docs/05 §7.1）。
 *
 * 🔴 `purpose` は必ず `ROLE_PURPOSE[role]` から取る（手書きしない）。`ai_usage_purpose_check` を
 *    通らない値や、ロールと食い違う値が入ると `F-063` のロール別原価が静かに壊れる。
 * 🔴 `outputSchema` に再帰スキーマ・`minItems > 1`・外部 `$ref` を使わない（docs/03 §3.3.3 の非対応）。
 *    ⚠️ 登録時の静的チェック（docs/05 §7.4「ビルド時に落とす」）は、ロール実体が入る
 *    **T-07-05** で `prompts/roles/index.ts` の登録表と併せて入れる（現時点ではロールが 0 件）。
 * 🔴 `promptVersion` は生成物に保存し、後から再現できるようにする（`BR-13`）。
 *    形式は `{role}.v{n}`（docs/05 §7.7）。
 */
export type RoleSpec<I, O> = {
  readonly role: AiRole;
  readonly purpose: AiUsagePurpose;
  /** 🔴 前工程の出力を受け取る境界。**自由文ではなく構造化データ**であることをここで保証する。 */
  readonly inputSchema: z.ZodType<I>;
  /** 🔴 `zodOutputFormat` に渡され、受信後に `safeParse` で再検証される（docs/03 §4.1）。 */
  readonly outputSchema: z.ZodType<O>;
  readonly promptVersion: string;
  readonly buildPrompt: (input: I) => RolePrompt;
  readonly defaultModel: ModelTier;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
};

/**
 * 1 回の実行の文脈（docs/05 §7.2）。
 *
 * 🔴 `tenantId` は**認証コンテキスト（`ctx`）から渡す**。リクエスト入力から受け取らない
 *    （CLAUDE.md §3.1）。`AiUsage` / `UsageCounter` の分離キーそのものである。
 * ⚠️ docs/05 §7.2 は `now` とだけ書いているが、`AiUsage.startedAt` / `finishedAt` を
 *    **試行ごとに**記録するため関数で受け取る（固定の `Date` だと所要時間が常に 0 になる）。
 *    システム時刻を直接読まないという規律（docs/05 §17.6）は保たれる。
 */
export type AiCallContext = {
  readonly tenantId: string;
  /** `AiUsage.targetType`（`'PROPOSAL'` / `'SKILL_SHEET'` など）。 */
  readonly targetType?: string;
  readonly targetId?: string;
  /**
   * 🔴 この呼び出しの入力に対して `mask()` が伏せた要約（T-07-03。docs/05 §7.10 ⑤ の申し送り）。
   *
   * **なぜ `ctx` に置くか**: `mask()` を呼ぶのは入力を用意する側（ロールジョブ）であり、
   * `buildPrompt` は `MaskedText` を受け取って**組み立てるだけ**である（`RolePrompt` は
   * `MaskedText` しか返さない）。要約を `runRole` まで運ぶ口が他に無い。
   *
   * 🔴 一致した文字列を持たない型である（`MaskHit`）。原文を運ばせない。
   * 🔴 **省略できる**（渡さなければ「検出なし」として記録される）。必須にしないのは、
   *    マスキングを経ない入力があってよいという意味ではない ——
   *    マスキングの強制は `MaskedText` の型が担っており（§7.10 ①）、こちらは**観測の記録**である。
   */
  readonly maskHits?: readonly MaskHit[];
  readonly now: () => Date;
};

/**
 * 生成物に必ず添える出所（docs/05 §7.3 の記録の強制手段 ①）。
 *
 * 🔴 永続化関数が `Provenance` を必須引数に取るため、`output` だけを取り出して保存する実装が
 *    書けない。**失敗しても返る**（記録は失敗時にも行われるため）。
 */
export type Provenance = {
  readonly role: AiRole;
  readonly promptVersion: string;
  readonly modelId: string;
  /** 🔴 再試行を含む全件（試行 1 回につき `AiUsage` 1 行）。 */
  readonly aiUsageIds: readonly string[];
};

/** ロールの失敗（docs/05 §7.4）。🔴 フォールバックの選択はロールごとに呼び出し側が決める。 */
export type AiFailure = {
  readonly kind: AiUsageFailureKind;
  /** 実際に行った試行回数（1〜`MAX_LLM_ATTEMPTS`）。 */
  readonly attempts: number;
  /** 🔴 応答本文・プロンプトを入れない（PII / 商流情報が混ざりうる。docs/05 §16.2）。 */
  readonly message: string;
};

export type RoleResult<O> =
  | { readonly ok: true; readonly output: O; readonly provenance: Provenance }
  | { readonly ok: false; readonly failure: AiFailure; readonly provenance: Provenance };
