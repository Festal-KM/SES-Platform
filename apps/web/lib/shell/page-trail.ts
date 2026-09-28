// apps/web/lib/shell/page-trail.ts
// 主平面の**帯**（docs/04 §3.1 のレイアウト図「パンくず / 画面タイトル / primary アクション（1 つ）」）の
// パンくず表と、primary アクションの型。T-12-21。
//
// ============================================================================
// 🔴 この表が守るもの
// ============================================================================
// 1. **パンくずの祖先は必ずリンクである** —— docs/04 §S-005 / §S-006 の関連画面の「←」は
//    「パンくずの『人材』/ 保存・キャンセル・404 の戻り先」と明記されている。文字だけのパンくずは
//    戻り先を示していない（ブラウザの戻るに依存させない）。
// 2. 🔴 **404 を作らない** —— `href` に書けるのは `apps/web/app/(main)/**/page.tsx` が実在する
//    画面だけである（`nav.ts` と同じ規律。`page-trail.test.ts` が走査して固定する）。
//    Phase 2 / 3 の画面（`S-025` 〜 `S-034` / `S-037` / `S-039` / `S-040` / `S-043` 〜 `S-045`）へは
//    1 本もリンクを張らない。
// 3. 🔴 **`設定` は遷移先を持たない**（`href: null`）—— `S-035`（組織設定）はホスト所属の
//    `OWNER` / `ADMIN` だけが到達できる画面であり、パートナー所属や `SALES` が押すと戻される。
//    ナビ（`nav.ts`）も `設定` を `GROUP`（リンクなし）として扱っており、それと食い違わせない。
// 4. **文言は `MessageKey` で持つ**（解決は描画側 = `_shell/page-heading.tsx`）。
//    パンくずの語は**画面群ごとのキー**を使う（`packages/i18n/src/index.ts` の
//    「パンくずの語は画面群ごとに持つ」の作法をそのまま踏襲し、既存の表示文字列を変えない）。
// 5. **I/O を持たない**（`app/**` はユニットテストの対象外であるため、ここに置いて単体で固定する。
//    `lib/engineers/list-rows.ts` 冒頭と同じ判断）。
import type { TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import { ENGINEER_LIST_PATH } from '../engineers/list-rows';
import { PROJECT_LIST_PATH } from '../projects/list-rows';
import { PROPOSAL_REQUESTS_PATH } from '../proposal-requests/list-rows';
import { PROPOSALS_PATH, proposalDetailHref } from '../proposals/hrefs';

/** パンくずの 1 項目。`href === null` は「現在地」または「遷移先を持たない見出し（`設定`）」。 */
export type PageCrumb = {
  readonly labelKey: MessageKey;
  readonly href: string | null;
};

// 🔴 **この表は `data-testid` を持たない。** 既存の testid（`engineer-detail-list-link` /
//    `usage-breadcrumb-home` / `retention-breadcrumb-settings`）は、`PageHeading` の `linkTestId`
//    プロパティに**画面側が文字列リテラルで書く**（`tests/static/testid-inventory.test.ts` は
//    `testId` / `linkTestId` の属性値を走査して凍結するため、データとして持つと値が凍結できず、
//    削除・改名の検知が効かなくなる。`@ses/ui` の `NameCell` と同じ作法）。

/**
 * 帯の primary アクション（docs/04 §7.6「1 画面の primary は原則 1 つ」）。
 *
 * 🔴 `kind` は**ロールで隠すかどうか**を決める:
 *   - `ACTION`     … 作成・承認・送信・ダウンロードに向かう導線。`VIEWER` / `PARTNER_VIEWER` には出さない
 *                     （`CLAUDE.md` §10.1）。
 *   - `NAVIGATION` … 閲覧に向かう導線。**ロールで隠さない**（例: `S-011` の「候補を探す」は
 *                     docs/04 §S-011 が「ホスト・取引先とも」「ロールで隠さない」と明記している。
 *                     `VIEWER` も候補一覧を閲覧してよく、絞り込みは RLS が決める）。
 */
export type PagePrimaryActionKind = 'ACTION' | 'NAVIGATION';

export type PagePrimaryAction = {
  readonly labelKey: MessageKey;
  readonly href: string;
  readonly kind: PagePrimaryActionKind;
};

// 🔴 primary の `data-testid` も同じ理由で**画面側が `testId` に文字列リテラルで書く**
//    （上のコメント。`project-detail-candidates` は帯へ移す前から凍結されている値である）。

/**
 * 🔴 帯の `ACTION` を出せるロール（`CLAUDE.md` §10.1）。
 *
 * `VIEWER` は「承認・送信・ダウンロードは一切不可」、`PARTNER_VIEWER` は加えて「提案の作成・
 * チャットの投稿も不可」である。**名前で判定する**のは意図で、`PARTNER_VIEWER` が
 * `TENANT_ROLES`（`packages/db`）に加わる `T-16-12` の時点で**追記なしに閉じる**ようにしてある
 * （閲覧専用ロールを足したのに帯だけ作成導線を出し続ける、という取りこぼしを構造で防ぐ）。
 * 対照は `page-trail.test.ts` が `TENANT_ROLES` の全値で固定する。
 */
export function isPageActionRole(role: TenantRole): boolean {
  return !role.endsWith('VIEWER');
}

// ============================================================================
// ① 人材（`S-005` 〜 `S-009`）
// ============================================================================
const ENGINEERS_HOME: PageCrumb = { labelKey: 'engineers.breadcrumb.home', href: '/' };
const ENGINEERS_LIST_LINK: PageCrumb = { labelKey: 'engineers.breadcrumb.list', href: ENGINEER_LIST_PATH };

/** `S-005` エンジニア台帳。 */
export const ENGINEER_LIST_TRAIL: readonly PageCrumb[] = [
  ENGINEERS_HOME,
  { labelKey: 'engineers.breadcrumb.list', href: null },
];

/** `S-007` エンジニアの登録。 */
export const ENGINEER_NEW_TRAIL: readonly PageCrumb[] = [
  ENGINEERS_HOME,
  ENGINEERS_LIST_LINK,
  { labelKey: 'engineers.breadcrumb.new', href: null },
];

/**
 * `S-006` エンジニア詳細。**現在地の項目を持たない** —— 画面タイトルが氏名であり、
 * 帯の下に `engineer-detail-name` の `h1` が在る（タイトルを二重に描かない）。
 */
export const ENGINEER_DETAIL_TRAIL: readonly PageCrumb[] = [ENGINEERS_HOME, ENGINEERS_LIST_LINK];

/** `S-007` エンジニアの編集。 */
export const ENGINEER_EDIT_TRAIL: readonly PageCrumb[] = [
  ENGINEERS_HOME,
  ENGINEERS_LIST_LINK,
  { labelKey: 'engineers.breadcrumb.edit', href: null },
];

/** `S-008` スキルシートの取込と版管理（`S-006` への戻りは画面本体の導線が持つ）。 */
export const SKILL_SHEET_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'skillSheets.breadcrumb.home', href: '/' },
  { labelKey: 'skillSheets.breadcrumb.engineers', href: ENGINEER_LIST_PATH },
  { labelKey: 'skillSheets.breadcrumb.current', href: null },
];

/** `S-009` スキル辞書。 */
export const SKILL_DICTIONARY_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'skillDictionary.breadcrumb.home', href: '/' },
  { labelKey: 'skillDictionary.breadcrumb.current', href: null },
];

// ============================================================================
// ① 案件（`S-010` 〜 `S-013`）/ ② 候補（`S-016`）
// ============================================================================
const PROJECTS_HOME: PageCrumb = { labelKey: 'projects.breadcrumb.home', href: '/' };
const PROJECTS_LIST_LINK: PageCrumb = { labelKey: 'projects.breadcrumb.list', href: PROJECT_LIST_PATH };

/** `S-010` 案件一覧。 */
export const PROJECT_LIST_TRAIL: readonly PageCrumb[] = [
  PROJECTS_HOME,
  { labelKey: 'projects.breadcrumb.list', href: null },
];

/** `S-012` 案件の登録。 */
export const PROJECT_NEW_TRAIL: readonly PageCrumb[] = [
  PROJECTS_HOME,
  PROJECTS_LIST_LINK,
  { labelKey: 'projects.breadcrumb.new', href: null },
];

/** `S-011` 案件詳細（タイトルは案件名。`project-detail-name` が持つ）。 */
export const PROJECT_DETAIL_TRAIL: readonly PageCrumb[] = [PROJECTS_HOME, PROJECTS_LIST_LINK];

/** `S-012` 案件の編集。 */
export const PROJECT_EDIT_TRAIL: readonly PageCrumb[] = [
  PROJECTS_HOME,
  PROJECTS_LIST_LINK,
  { labelKey: 'projects.breadcrumb.edit', href: null },
];

/** `S-013` 公開範囲設定（`S-011` / `S-012` への導線は画面本体が持つ）。 */
export const PROJECT_VISIBILITY_TRAIL: readonly PageCrumb[] = [
  PROJECTS_HOME,
  PROJECTS_LIST_LINK,
  { labelKey: 'projects.visibilitySettings.breadcrumb', href: null },
];

/** `S-016` 候補検索（案件起点。`S-011` への導線は画面本体が持つ）。 */
export const CANDIDATE_TRAIL: readonly PageCrumb[] = [
  PROJECTS_HOME,
  PROJECTS_LIST_LINK,
  { labelKey: 'candidates.breadcrumb.current', href: null },
];

// ============================================================================
// ③ 提案 / 提案依頼（`S-017` 〜 `S-023`）・④ 面談（`S-024`）
// ============================================================================
const PROPOSALS_LIST_LINK: PageCrumb = { labelKey: 'proposals.detail.breadcrumb.list', href: PROPOSALS_PATH };

/** `S-019` 提案一覧。 */
export const PROPOSAL_LIST_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposals.list.breadcrumb.home', href: '/' },
  { labelKey: 'proposals.list.breadcrumb.current', href: null },
];

/** `S-020` 提案の作成（← `S-019`。docs/04 §S-020 関連画面）。 */
export const PROPOSAL_NEW_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposals.editor.breadcrumb.home', href: '/' },
  PROPOSALS_LIST_LINK,
  { labelKey: 'proposals.editor.breadcrumb.new', href: null },
];

/** `S-020` 提案の編集。 */
export const PROPOSAL_EDIT_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposals.editor.breadcrumb.home', href: '/' },
  PROPOSALS_LIST_LINK,
  { labelKey: 'proposals.editor.breadcrumb.edit', href: null },
];

/** `S-023` 提案詳細と履歴。 */
export const PROPOSAL_DETAIL_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposals.detail.breadcrumb.home', href: '/' },
  PROPOSALS_LIST_LINK,
  { labelKey: 'proposals.detail.breadcrumb.current', href: null },
];

/**
 * `S-021` 提案の承認。🔴 **`S-023`（提案詳細）を祖先に置く** —— docs/04 §S-021 関連画面の
 * 「→ `S-023`」であり、承認画面から提案の履歴へ戻る経路がこれしかない。
 */
export function proposalApproveTrail(proposalId: string): readonly PageCrumb[] {
  return [
    { labelKey: 'proposals.approval.breadcrumb.home', href: '/' },
    PROPOSALS_LIST_LINK,
    { labelKey: 'proposals.interview.breadcrumb.detail', href: proposalDetailHref(proposalId) },
    { labelKey: 'proposals.approval.breadcrumb.current', href: null },
  ];
}

/** `S-024` 面談日程の調整と結果記録（← `S-023`）。 */
export function proposalInterviewTrail(proposalId: string): readonly PageCrumb[] {
  return [
    { labelKey: 'proposals.interview.breadcrumb.home', href: '/' },
    { labelKey: 'proposals.interview.breadcrumb.list', href: PROPOSALS_PATH },
    { labelKey: 'proposals.interview.breadcrumb.detail', href: proposalDetailHref(proposalId) },
    { labelKey: 'proposals.interview.breadcrumb.current', href: null },
  ];
}

/** `S-022` 送信失敗一覧と再送（← `S-019`。docs/04 §S-022 関連画面）。 */
export const SEND_FAILURE_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'sendFailures.breadcrumb.home', href: '/' },
  PROPOSALS_LIST_LINK,
  { labelKey: 'sendFailures.breadcrumb.current', href: null },
];

/** `S-017` 提案依頼の一覧。 */
export const PROPOSAL_REQUEST_LIST_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposalRequests.breadcrumb.home', href: '/' },
  { labelKey: 'proposalRequests.breadcrumb.current', href: null },
];

/** `S-018` 提案依頼の詳細と応諾・辞退（← `S-017`）。 */
export const PROPOSAL_REQUEST_RESPOND_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'proposalRequests.breadcrumb.home', href: '/' },
  { labelKey: 'proposalRequests.respond.breadcrumb.list', href: PROPOSAL_REQUESTS_PATH },
];

// ============================================================================
// ② 共有の設定（`S-015`）
// ============================================================================
/** `S-015` 匿名共有の設定（取引先）。 */
export const ENGINEER_SHARE_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'engineerShares.breadcrumb.home', href: '/' },
  { labelKey: 'engineerShares.breadcrumb.current', href: null },
];

// ============================================================================
// 設定（`S-014` / `S-035` / `S-036` / `S-038` / `S-041` / `S-042`）
// ============================================================================
// 🔴 `設定` の項目は原則 `href: null` である（上の 3.）。**例外は `S-036` / `S-041` / `S-042`** ——
//    到達条件が `S-035`（ホスト所属の `OWNER` / `ADMIN`）と同一なので、`設定` を `S-035` への
//    リンクにしても「押せない相手に配る」ことにならない（`docs/04` の各節「関連画面: ← `S-035`」）。
// 🔴 **`S-014`（パートナーも到達できる）/ `S-038`（ホストの他ロールも到達できる。§S-038 権限差分）は
//    到達条件が `S-035` と異なるため `href: null` のまま** —— リンクにすると押せない相手に配ることになる
//    （押せる相手が変わっていないことは `page-trail.test.ts` ③ が固定する）。
const ORG_SETTINGS_PATH = '/settings/organization';

/** `S-035` 組織設定とメンバー管理。 */
export const ORG_SETTINGS_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'orgSettings.breadcrumb.home', href: '/' },
  { labelKey: 'orgSettings.title', href: null },
];

/** `S-014` 取引先企業の一覧・詳細と招待。 */
export const PARTNER_COMPANIES_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'partnerCompanies.breadcrumb.home', href: '/' },
  { labelKey: 'partnerCompanies.breadcrumb.settings', href: null },
  { labelKey: 'partnerCompanies.title', href: null },
];

/** `S-036` 送信ドメインの設定と検証。 */
export const SENDING_DOMAIN_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'settings.sendingDomain.breadcrumb.home', href: '/' },
  { labelKey: 'settings.sendingDomain.breadcrumb.settings', href: ORG_SETTINGS_PATH },
  { labelKey: 'settings.sendingDomain.title', href: null },
];

/** `S-038` 利用量と上限。 */
export const USAGE_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'usage.breadcrumb.home', href: '/' },
  { labelKey: 'usage.breadcrumb.settings', href: null },
  { labelKey: 'usage.title', href: null },
];

/** `S-042` データの返却と保持期間。 */
export const RETENTION_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'retention.breadcrumb.home', href: '/' },
  { labelKey: 'retention.breadcrumb.settings', href: ORG_SETTINGS_PATH },
  { labelKey: 'retention.title', href: null },
];

/** `S-041` 監査ログ（自テナント）。 */
export const AUDIT_LOG_TRAIL: readonly PageCrumb[] = [
  { labelKey: 'auditLogs.breadcrumb.home', href: '/' },
  { labelKey: 'auditLogs.breadcrumb.settings', href: ORG_SETTINGS_PATH },
  { labelKey: 'auditLogs.title', href: null },
];

// ============================================================================
// ホーム（`S-003` / `S-004`）
// ============================================================================
/** 🔴 ホームは祖先を持たない（現在地 1 項目）。`/` 自身へのリンクを作らない。 */
export const HOME_TRAIL: readonly PageCrumb[] = [{ labelKey: 'shell.nav.home', href: null }];

// ============================================================================
// 走査用（`page-trail.test.ts`）
// ============================================================================
/** 動的セグメントを含む `href` の組み立てに使う見本の ID（テストが `[id]` に読み替える）。 */
export const SAMPLE_TRAIL_ID = '00000000-0000-7000-8000-000000000000';

/**
 * 🔴 **本ファイルが公開するパンくず表の全体**（`page-trail.test.ts` が走査して
 *    「`href` が実在する画面だけを指す」ことを固定する）。**新しい表を足したらここにも足す** ——
 *    足し忘れは「走査の対象外の表」を生み、404 の検査が静かに素通りする。
 */
export const ALL_PAGE_TRAILS: readonly (readonly PageCrumb[])[] = [
  HOME_TRAIL,
  ENGINEER_LIST_TRAIL,
  ENGINEER_NEW_TRAIL,
  ENGINEER_DETAIL_TRAIL,
  ENGINEER_EDIT_TRAIL,
  SKILL_SHEET_TRAIL,
  SKILL_DICTIONARY_TRAIL,
  PROJECT_LIST_TRAIL,
  PROJECT_NEW_TRAIL,
  PROJECT_DETAIL_TRAIL,
  PROJECT_EDIT_TRAIL,
  PROJECT_VISIBILITY_TRAIL,
  CANDIDATE_TRAIL,
  PROPOSAL_LIST_TRAIL,
  PROPOSAL_NEW_TRAIL,
  PROPOSAL_EDIT_TRAIL,
  PROPOSAL_DETAIL_TRAIL,
  proposalApproveTrail(SAMPLE_TRAIL_ID),
  proposalInterviewTrail(SAMPLE_TRAIL_ID),
  SEND_FAILURE_TRAIL,
  PROPOSAL_REQUEST_LIST_TRAIL,
  PROPOSAL_REQUEST_RESPOND_TRAIL,
  ENGINEER_SHARE_TRAIL,
  ORG_SETTINGS_TRAIL,
  PARTNER_COMPANIES_TRAIL,
  SENDING_DOMAIN_TRAIL,
  USAGE_TRAIL,
  RETENTION_TRAIL,
  AUDIT_LOG_TRAIL,
];

/** `ALL_PAGE_TRAILS` に現れる遷移先（重複を畳まない。テストと走査のため）。 */
export function pageTrailHrefs(trails: readonly (readonly PageCrumb[])[]): readonly string[] {
  return trails.flatMap((trail) => trail.flatMap((crumb) => (crumb.href === null ? [] : [crumb.href])));
}
