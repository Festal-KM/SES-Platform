// packages/domain/src/ai/roles.ts
// 🔴 AI ロールの値集合の唯一の出所（CLAUDE.md §12.2 / docs/05 §7.1 / §3.8）。T-07-01。
//
// 🔴 なぜ `packages/domain` に置くか（CLAUDE.md §2.1）:
//    ロールを実行する側（`packages/ai`）と、`ai_usage` / `tenant_role_models` /
//    `tenant_role_approval_modes` の CHECK と突き合わせる側（`packages/db`）の**両方**が
//    同じ値集合を必要とする。両者は相互に依存できない（`packages/ai` → `@ses/db` は
//    ESLint で禁止）ため、共有点は domain しか無い。
//    `RecipientClass`（T-04-02）/ `ScanStatus`（T-05-05）と同じ整理であり、
//    `packages/db/src/schema-value-sets.ts` の「🔴 `packages/ai` が実装されたときに解消すること」
//    という申し送り（T-02-01）を、ここへ移すことで解消した。
//
// 🔴 値そのものは `packages/db/prisma/migrations/**` の CHECK と一致していなければならない。
//    突合は `tests/static/schema-enum-drift.test.ts` が機械的に行う（本ファイルを直しても
//    migration.sql を直さなければ落ちる。逆も同じ）。

/** docs/05 §3.8 `AiUsage.role` / `TenantRoleModel.role`（TEXT + CHECK）。CLAUDE.md §12.2 の 6 ロール。 */
export const AI_ROLES = [
  'sheet-parser',
  'skill-normalizer',
  'match-explainer',
  'gate-inspector',
  'proposal-drafter',
  'renewal-advisor',
] as const;

export type AiRole = (typeof AI_ROLES)[number];

export function isAiRole(value: string): value is AiRole {
  return (AI_ROLES as readonly string[]).includes(value);
}

/**
 * docs/05 §3.10 `TenantRoleApprovalMode.role`（TEXT + CHECK。5 値）。
 * 🔴 CLAUDE.md §12.4「`gate-inspector` に承認モードは存在しない。設定項目自体を作ってはならない」
 *    により `AI_ROLES` から `gate-inspector` を除いた集合。**列挙し直さず `AI_ROLES` から引く**
 *    （ロールが増えたときに片方だけ古くなる状態を作らない）。
 */
export const APPROVAL_MODE_CONFIGURABLE_ROLES = AI_ROLES.filter(
  (role): role is Exclude<AiRole, 'gate-inspector'> => role !== 'gate-inspector',
);

export type ApprovalModeConfigurableRole = (typeof APPROVAL_MODE_CONFIGURABLE_ROLES)[number];

/**
 * 🔴 docs/05 §3.8 `AiUsage.purpose`（TEXT + CHECK）。6 ロールと 1:1 対応する
 *    （値集合の確定経緯は T-02-01 の完了報告。`ai_usage_purpose_check` が正）。
 */
export const AI_USAGE_PURPOSES = [
  'sheet_parse',
  'skill_normalize',
  'match_rationale',
  'gate',
  'proposal_draft',
  'renewal_summary',
] as const;

export type AiUsagePurpose = (typeof AI_USAGE_PURPOSES)[number];

/**
 * 🔴 ロール → 用途（`AiUsage.purpose`）の対応表。T-07-01。
 *
 * `RoleSpec`（docs/05 §7.1）は `purpose` を持つが、その値は**この表から引く**こと。
 * ロールごとに手書きすると、`ai_usage_purpose_check` を通らない値や、ロールと食い違う値が
 * 混ざり、`F-063`（ロール別原価）の分解が静かに崩れる。
 */
export const ROLE_PURPOSE: Readonly<Record<AiRole, AiUsagePurpose>> = {
  'sheet-parser': 'sheet_parse',
  'skill-normalizer': 'skill_normalize',
  'match-explainer': 'match_rationale',
  'gate-inspector': 'gate',
  'proposal-drafter': 'proposal_draft',
  'renewal-advisor': 'renewal_summary',
};

/**
 * docs/05 §3.8 `AiUsage.failureKind`（TEXT + CHECK。nullable）。
 *
 * 🔴 5 値の意味を混ぜない（`CLAUDE.md` §4.2「失敗と保留を混同しない」と同じ規律）:
 *   - `SCHEMA`     … 応答が出力スキーマに適合しなかった（受信後の `safeParse` 失敗）
 *   - `TIMEOUT`    … タイムアウト / 5xx（一時障害）
 *   - `RATE`       … 429（`retry-after` あり）。組織単位のレート上限
 *   - `SPEND_CAP`  … 429 かつ `enforced_spend_limit_reached`（Anthropic 側の月間支出上限）。
 *                    🔴 **テナント別の 1 日コスト上限（`AiCostLimitExceededError`）とは別物**であり、
 *                    こちらは「呼んだが弾かれた」＝ 失敗、あちらは「呼ばずに保留」＝ HELD である
 *                    （docs/05 §7.4 / §7.6 / `F-027 AC-5`）
 *   - `API`        … 400 / 401 など、再試行しても直らない恒久的な失敗
 */
export const AI_USAGE_FAILURE_KINDS = ['SCHEMA', 'TIMEOUT', 'RATE', 'SPEND_CAP', 'API'] as const;

export type AiUsageFailureKind = (typeof AI_USAGE_FAILURE_KINDS)[number];
