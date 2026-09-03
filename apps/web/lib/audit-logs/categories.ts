// apps/web/lib/audit-logs/categories.ts
// `S-041` の「操作種別」フィルタ（docs/04 §S-041 / docs/05 §16.1 / `BR-27`）。
//
// 🔴 選択肢は BR-27 の記録対象を過不足なく網羅する（docs/04 §S-041「選択肢に無い種別は
//    『記録されていない』と読まれる」）。Phase 0 でまだ 1 件も発生しない種別
//    （エンジニア詳細・スキルシートの閲覧/DL、案件詳細の閲覧、提案の送信、承認・却下、
//    権限変更、公開範囲の変更）も選択肢としては存在させ、対応する `action` は
//    各機能のスプリント（F-012 は SP-05、公開範囲は SP-06、送信・承認は SP-09）で追加される
//    （docs/sprints/SP-03 T-03-05）。それまでは該当カテゴリで検索すると 0 件になるだけであり、
//    それ自体は正しい挙動である。
//
// 🔴 「運営者の全操作」は本カテゴリに含めない。`GET /api/audit-logs`（#10）はテナント管理者が
//    自テナント分を見る経路（`A-006` とは別画面）であり、運営者の横断操作一覧はここの対象外。
//    ただし運営者が**このテナントを対象に**行った代理閲覧（`impersonation.*`）は、対象テナントの
//    `AuditLog` にも記録される（`AuditLog.tenantId` が対象テナントを指すため）ので IMPERSONATION
//    カテゴリとして残す。

export const AUDIT_LOG_CATEGORY_KEYS = [
  'LOGIN_LOGOUT',
  'ENGINEER_SKILL_SHEET_ACCESS',
  'PROJECT_VIEW',
  'CREATE_UPDATE_DELETE',
  'PROPOSAL_SUBMIT',
  'APPROVAL',
  'PERMISSION_CHANGE',
  'VISIBILITY_CHANGE',
  'IMPERSONATION',
] as const;

export type AuditLogCategoryKey = (typeof AUDIT_LOG_CATEGORY_KEYS)[number];

type CategoryMatcher =
  | { readonly actions: readonly string[] }
  | { readonly actionSuffixes: readonly string[] };

/**
 * カテゴリ → `action` 列の一致条件（docs/05 §16.1 の表そのもの）。
 * 🔴 `Record<AuditLogCategoryKey, …>` にすることで、カテゴリを 1 つ足すと
 *    このマップの更新をコンパイラが強制する（列挙漏れを作れない）。
 */
const AUDIT_LOG_CATEGORY_MATCHERS: Readonly<Record<AuditLogCategoryKey, CategoryMatcher>> = {
  LOGIN_LOGOUT: { actions: ['auth.login', 'auth.logout', 'auth.login_failed'] },
  ENGINEER_SKILL_SHEET_ACCESS: {
    actions: ['engineer.view', 'skill_sheet.view', 'skill_sheet.download'],
  },
  PROJECT_VIEW: { actions: ['project.view'] },
  // 🔴 docs/05 §16.1「*.create / *.update / *.delete」。エンティティ名を列挙しないため
  //    新しい `*.create` アクションが増えてもここを更新する必要が無い。
  CREATE_UPDATE_DELETE: { actionSuffixes: ['.create', '.update', '.delete'] },
  PROPOSAL_SUBMIT: { actions: ['proposal.submit', 'proposal.resend'] },
  APPROVAL: { actions: ['proposal.approve', 'proposal.reject'] },
  PERMISSION_CHANGE: { actions: ['membership.role_change', 'membership.revoke'] },
  VISIBILITY_CHANGE: { actions: ['project.visibility_change'] },
  IMPERSONATION: { actions: ['impersonation.start', 'impersonation.end'] },
};

/**
 * `db.auditLog.findMany` の `where` に渡せる形（`action` 列だけの条件）。
 * 🔴 Prisma の生成型（`AuditLogWhereInput`）は `in` / 配列を可変（非 `readonly`）で要求するため、
 *    ここも可変配列にする（呼び出し側の `where` オブジェクトへ展開するだけで、上書きしない）。
 */
export type AuditLogCategoryWhere =
  | { readonly action: { readonly in: string[] } }
  | { readonly OR: { readonly action: { readonly endsWith: string } }[] };

export function auditLogCategoryWhere(key: AuditLogCategoryKey): AuditLogCategoryWhere {
  const matcher = AUDIT_LOG_CATEGORY_MATCHERS[key];
  if ('actionSuffixes' in matcher) {
    return { OR: matcher.actionSuffixes.map((suffix) => ({ action: { endsWith: suffix } })) };
  }
  return { action: { in: [...matcher.actions] } };
}
