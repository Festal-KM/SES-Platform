// apps/web/lib/skills/policy.ts
// 新語候補の採否（`F-010 AC-1` / `AC-2`。docs/05 §6.4 #24）を決める**純粋関数**。T-05-03。
//
// 🔴 なぜ判定を関数として切り出すか（`lib/members/policy.ts` と同じ理由）:
//    「採用してよいか」の条件は 4 つ（ロール / 行の scope / 行の状態 / 正規化先の有無）あり、
//    ハンドラに散らすと必ず片方だけが緩む。ここを唯一の判定にし、ユニットテストで
//    全組み合わせを固定する。
//
// 🔴 **本モジュールは「見える範囲」を広げない。** 判定は必ず 3 層目である:
//      ① RLS（`skill_aliases` の `UPDATE` は `tenant_id = app_tenant_id()`。
//         グローバル行〔`tenant_id IS NULL`〕は 0 件更新になる）
//      ② Prisma 拡張（`COLUMN_WITH_GLOBAL_ROWS` の緩和は**読み取りだけ**。書込は `= ctx`）
//      ③ 本モジュール（誰が、どの行に、何をしてよいか）
//    ①②だけでも「グローバル辞書をテナントから書き換える」は 0 件更新になるが、
//    それでは**利用者に理由が伝わらない**（404 と区別できない）。③は理由を返すためにある。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 採否を行えるロール（docs/05 §6.4 #24 の認可 / `F-010 AC-1` / `docs/02` §F-010 関連ロール /
 *    `docs/04` §S-009 権限差分）。
 *
 * 🔴 **パートナーロール（`PARTNER_ADMIN` / `PARTNER_SALES`）は含まない**（「起票のみ」）。
 *    採用されたテナント別名はテナント全体の検索に効くため、他社が持ち込んだ表記の扱いを
 *    1 社が決められる状態にしない。
 * 🔴 `VIEWER` も含まない（`BR-31`）。API 側では `requireRole` と `requireNotViewer` の
 *    両方で落ちる（片方だけにしない。`POST /api/engineers` と同じ規律）。
 *
 * ⚠️ **`OWNER` は 2026-09-06（T-06-01）に追加した。暫定である**
 *    （[Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36) の既定 A。
 *    `docs/dev-plan.md` §9 / `docs/sprints/SP-06` T-06-01）。
 *    T-05-03 の時点では `docs/05` §6.4 #24 と `docs/02` `F-010` 関連ロールがどちらも
 *    `ADMIN` / `SALES` と書いていたため 2 ロールに絞っていたが、**`docs/02` 章 4.2 の
 *    権限マトリクスは `F-010` の `OW` を `●`** としており、記述が食い違っていた。
 *    Issue #36 の回答が SP-05 完了確認までに得られなかったため、既定 A（マトリクス側に寄せる）で
 *    実装する。🔴 **順序は `docs/02` → `docs/04` → `docs/05` → 実装とテスト**（`CLAUDE.md` §8.7）で
 *    行い、3 ドキュメントとも「暫定。Issue #36 で確認中」を付した。回答が来たら 4 箇所を同時に戻す。
 *
 * 🔴 **並び順は `TENANT_ROLES`（`@ses/db`）と同じにする。** `policy.test.ts` の
 *    「全ロールのうち判定が true になるのは宣言したロールだけ」が `filter` の結果と
 *    直接比較しており、順序がずれると意味の無い赤になる。
 */
export const SKILL_ALIAS_DECIDER_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
] as const satisfies readonly TenantRole[];

export function isSkillAliasDeciderRole(role: TenantRole): boolean {
  return (SKILL_ALIAS_DECIDER_ROLES as readonly TenantRole[]).includes(role);
}

/** docs/05 §6.4 #24 の `decision`。 */
export const SKILL_ALIAS_DECISIONS = ['ACCEPT', 'REJECT'] as const;

export type SkillAliasDecision = (typeof SKILL_ALIAS_DECISIONS)[number];

/** 別名の帰属（`skill_aliases.tenant_id` の有無を 1 語に畳んだ表示上の値）。 */
export const SKILL_ALIAS_SCOPES = ['GLOBAL', 'TENANT'] as const;

export type SkillAliasScope = (typeof SKILL_ALIAS_SCOPES)[number];

export const SKILL_ALIAS_DENIAL_REASONS = [
  /** 実行者のロールに採否の権限が無い（`VIEWER` / パートナーロール）。 */
  'ACTOR_ROLE_NOT_ALLOWED',
  /**
   * 🔴 グローバル辞書の別名である（`F-010 AC-2` / `BR-02`）。**テナントから編集できない。**
   *    読めるが書けない（RLS の `SELECT` だけが `OR tenant_id IS NULL` を許す）。
   */
  'GLOBAL_ROW',
  /** すでに採否が決まっている（`ACCEPTED` / `REJECTED`）。二重に決めない。 */
  'ALREADY_DECIDED',
  /** 🔴 `ACCEPT` なのに正規化先が指定されていない（どのスキルに寄せるかが決まらない）。 */
  'SKILL_REQUIRED',
  /** `REJECT` なのに正規化先が指定されている（却下した表記に正規化先を残さない）。 */
  'SKILL_NOT_ALLOWED',
] as const;

export type SkillAliasDenialReason = (typeof SKILL_ALIAS_DENIAL_REASONS)[number];

export type SkillAliasVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: SkillAliasDenialReason };

const ALLOWED: SkillAliasVerdict = { allowed: true };

function deny(reason: SkillAliasDenialReason): SkillAliasVerdict {
  return { allowed: false, reason };
}

/** 操作の対象（🔴 すべて `withTenant` の内側で読んだ `skill_aliases` の行由来）。 */
export type SkillAliasTarget = {
  readonly scope: SkillAliasScope;
  /** `PROPOSED` 以外は決着済みである（値集合の出所は `@ses/db` の `SKILL_ALIAS_STATUSES`）。 */
  readonly status: string;
};

/** 要求の内容（境界の Zod を通った値）。 */
export type SkillAliasDecisionInput = {
  readonly decision: SkillAliasDecision;
  /** 採用時の正規化先（グローバル辞書の ID）。`null` = 指定なし。 */
  readonly skillId: string | null;
};

/**
 * 採否を実行してよいか（`F-010 AC-1` / `AC-2`）。
 *
 * 🔴 順序に意味がある。権限の無い実行者に「その候補が採否可能な状態か」を教えない
 *    （`decideMemberRoleChange` と同じ考え方）。
 */
export function decideSkillAliasDecision(
  actorRole: TenantRole,
  target: SkillAliasTarget,
  input: SkillAliasDecisionInput,
): SkillAliasVerdict {
  if (!isSkillAliasDeciderRole(actorRole)) return deny('ACTOR_ROLE_NOT_ALLOWED');

  // 🔴 グローバル行はテナントの持ち物ではない（`F-010 AC-2`）。読めても書けない。
  if (target.scope === 'GLOBAL') return deny('GLOBAL_ROW');

  // 🔴 `PROPOSED` 以外は決着済み。二重に決めない（`docs/04` §S-009「すでに採用されました」）。
  if (target.status !== 'PROPOSED') return deny('ALREADY_DECIDED');

  if (input.decision === 'ACCEPT') {
    if (input.skillId === null) return deny('SKILL_REQUIRED');
    return ALLOWED;
  }

  // 🔴 却下に正規化先は無い。指定されていたら黙って捨てず、要求として不正だと伝える
  //    （捨てると「採用したつもりが却下されていた」ことに気づけない）。
  if (input.skillId !== null) return deny('SKILL_NOT_ALLOWED');
  return ALLOWED;
}
