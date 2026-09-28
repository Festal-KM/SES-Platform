// apps/web/lib/shell/nav.ts
// 主平面のグローバルナビの**項目表**（docs/04 §3.1 のサイドバーの表 / §3.4 のボトムタブ）。
//
// 🔴 **純粋な組み立てだけを置く**（React / DB / i18n の値に依存しない）。文言は `MessageKey` で
//    持ち、解決は描画側（`app-shell.tsx`）が `packages/i18n` で行う（CLAUDE.md §3.5 / BR-32）。
//    こうしておくと「ホストと取引先で項目集合が違う」ことを、描画せずに単体テストで固定できる。
//
// 🔴 **並びは `CLAUDE.md` §1.3 の業務ループ ①〜⑥ の順**であり、ステージ番号を接頭辞に持つ
//    （docs/04 §3.1「ナビの並びがループの順序と一致していること自体が、利用者にループを教える」）。
//    **順序を入れ替えない。**
//
// 🔴 **404 を作らない。** 遷移先は次の 3 つのいずれかに分類し、`LINK` 以外は**リンクにしない**:
//      - `LINK`        … `apps/web/app/(main)/**/page.tsx` が実在する画面
//      - `UNAVAILABLE` … 未実装（Phase 2 / 3）、または単独の URL を持たない画面（案件・提案から開く）
//      - `GROUP`       … 子項目の見出し（それ自体は遷移先を持たない。`設定`）
//    実在判定は推測ではなく、着手時に `app/(main)/**/page.tsx` を走査して決めた（下表のコメント）。
//
// 🔴 **ロールで到達できない画面は項目ごと出さない**（グレーアウトで見せない。docs/04 §8.1 / §A-002 と同じ原則）。
//    押した先でホームへ黙って戻される導線を作らないため。拒否の本体は各画面の redirect と API の
//    `requireRole` であり、ここは UI の配慮にすぎない。
import type { TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import { isEngineerShareRole } from '../engineer-shares/policy';

/** ホスト（契約 SES 企業）所属か、取引先（パートナー）所属か。母集団と項目名が変わる唯一の軸。 */
export type NavAudience = 'HOST' | 'PARTNER';

/** 遷移先の分類（上の 🔴）。 */
export type NavReach =
  | { readonly kind: 'LINK'; readonly href: string }
  | { readonly kind: 'UNAVAILABLE'; readonly noteKey: MessageKey }
  | { readonly kind: 'GROUP' };

export type NavItem = {
  /** `data-testid` の接尾辞（kebab-case）。E2E と render テストが掴む。 */
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly reach: NavReach;
  /** 子項目（`設定` だけが持つ）。 */
  readonly children: readonly NavItem[];
  /**
   * 項目に添えるバッジの文字列（`③ 提案依頼` の期限バッジだけが持つ。docs/04 §3.1 取引先列）。
   *
   * 🔴 **件数を入れない。** 入れてよいのは「最も近い返答期限」の残り時間だけである
   *    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
   *    文字列の組み立ては `lib/proposal-requests/remaining.ts` の `formatRemaining` が 1 実装で行い、
   *    ここにはその結果を渡す（このモジュールは現在時刻も i18n の値も読まない）。
   */
  readonly badge: NavBadge | null;
};

/** バッジ（語 + 値）。語は読み上げのための見出しであり、値は残り時間である。 */
export type NavBadge = {
  readonly labelKey: MessageKey;
  readonly text: string;
};

export type NavContext = {
  readonly audience: NavAudience;
  readonly role: TenantRole;
  /**
   * `③ 提案依頼`（`S-017`）の期限バッジに出す残り時間（例: `残り 2 日`）。`null` ならバッジを描かない。
   *
   * 🔴 docs/04 §3.1 は**取引先列**にだけバッジを書いている。値を読むのはレイアウト側であり、
   *    ここは「渡されたときに取り付ける」だけを決める（渡すかどうかの判定を 2 箇所に置かない）。
   */
  readonly proposalRequestDueText?: string | null;
};

function link(id: string, labelKey: MessageKey, href: string, badge: NavBadge | null = null): NavItem {
  return { id, labelKey, reach: { kind: 'LINK', href }, children: [], badge };
}

function unavailable(id: string, labelKey: MessageKey, noteKey: MessageKey): NavItem {
  return { id, labelKey, reach: { kind: 'UNAVAILABLE', noteKey }, children: [], badge: null };
}

function group(id: string, labelKey: MessageKey, children: readonly NavItem[]): NavItem {
  return { id, labelKey, reach: { kind: 'GROUP' }, children, badge: null };
}

/** ホスト所属で `OWNER` / `ADMIN` にだけ到達できる設定画面（各 `page.tsx` の redirect と同じ条件）。 */
function isTenantAdminRole(role: TenantRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * `設定` の子項目。
 *
 * 🔴 docs/04 §3.1 の表はここを `設定` の 1 行にまとめているが、**§4.8 の設定画面 7 つのうち
 *    2 つ（`S-041` 監査ログ / `S-009` スキル辞書）はリポジトリ内に到達経路が 1 本も無い**
 *    （着手時に `href` を全走査して確認した）。ナビが唯一の入口であるため、子項目として出す。
 *    増やしたのは**実在する画面への到達手段だけ**であり、新しい画面も新しい機能も足していない。
 */
function settingsChildren(context: NavContext): readonly NavItem[] {
  // 🔴 4 画面（`S-035` / `S-036` / `S-042` / `S-041`）は**ホスト所属の `OWNER` / `ADMIN` だけ**が
  //    到達する（各 `page.tsx` の redirect と同じ条件）。1 つの述語にまとめて、画面ごとに
  //    条件が食い違わないようにする。
  //    ⚠️ パートナー所属が `OWNER` / `ADMIN` になることは DB の CHECK（`memberships`）で
  //    起こりえないが、条件に所属を明示しておく（判定の根拠をロール名の知識に委ねない）。
  const isTenantAdmin = context.audience === 'HOST' && isTenantAdminRole(context.role);
  const items: NavItem[] = [];
  if (isTenantAdmin) {
    // S-035 組織設定とメンバー管理。
    items.push(link('settings-organization', 'orgSettings.title', '/settings/organization'));
  }
  // S-014 取引先企業の一覧・詳細と招待。取引先所属では自社 1 社だけが見える（RLS C5）。
  items.push(link('settings-partner-companies', 'partnerCompanies.title', '/settings/partner-companies'));
  if (isTenantAdmin) {
    // S-036 送信ドメインの設定と検証。
    items.push(link('settings-sending-domains', 'settings.sendingDomain.title', '/settings/sending-domains'));
  }
  if (context.audience === 'HOST') {
    // 🔴 S-038 利用量と上限。**導線はホスト側にしか置かない**（`docs/04` §S-038「取引先には
    //    操作の場所で示す」/ `F-027 AC-1`「パートナーには停止の事実と理由だけ」）。
    //    取引先が URL を直接開いた場合の受け皿は画面側に在る（`settings/usage/page.tsx`）。
    items.push(link('settings-usage', 'usage.title', '/settings/usage'));
  }
  if (isTenantAdmin) {
    // S-042 データの返却と保持期間（`DATA_EXPORT_ROLES` = OWNER / ADMIN）。
    items.push(link('settings-retention', 'retention.summary.heading', '/settings/retention'));
    // S-041 監査ログ（自テナント）。
    items.push(link('settings-audit-logs', 'auditLogs.title', '/audit-logs'));
  }
  // S-009 スキル辞書・別名・新語候補。取引先は起票のみだが閲覧はできる（F-010 AC-1）。
  items.push(link('settings-skills', 'skillDictionary.title', '/skills'));
  return items;
}

/**
 * サイドバー（グローバルナビ）の項目。🔴 **アイコンを付けない**（docs/04 §7.5）ため、
 * この表は「語」と「遷移先」だけを持つ。
 */
export function buildMainNav(context: NavContext): readonly NavItem[] {
  const proposalRequestDue = context.proposalRequestDueText ?? null;
  const items: NavItem[] = [link('home', 'shell.nav.home', '/')];

  if (context.audience === 'HOST') {
    items.push(
      link('engineers', 'shell.nav.host.engineers', '/engineers'), // S-005
      link('projects', 'shell.nav.host.projects', '/projects'), // S-010
      // S-016 は案件起点（`/projects/{id}/candidates`）であり、単独の URL を持たない。
      unavailable('candidates', 'shell.nav.host.candidates', 'shell.nav.note.fromProject'),
    );
  } else {
    items.push(
      link('engineers', 'shell.nav.partner.engineers', '/engineers'),
      link('projects', 'shell.nav.partner.projects', '/projects'),
      unavailable('candidates', 'shell.nav.partner.candidates', 'shell.nav.note.fromProject'),
    );
  }

  items.push(
    link('proposals', 'shell.nav.proposals', '/proposals'), // S-019
    // 🔴 S-017。取引先にだけ期限バッジを添える（docs/04 §3.1 の取引先列。
    //    🔴 **件数でなく期限**。件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1）。
    //    ホストに出さないのは docs/04 の表が取引先列にしか書いていないからである
    //    （ホスト側の期限の見張りは `S-003` の要対応キューが持つ）。
    link(
      'proposal-requests',
      'shell.nav.proposalRequests',
      '/proposal-requests',
      proposalRequestDue === null || context.audience !== 'PARTNER'
        ? null
        : { labelKey: 'shell.nav.proposalRequests.due.label', text: proposalRequestDue },
    ), // S-017
    // S-024（面談日程の調整と結果記録）は `S-023` 経由（`/proposals/{id}/interview`）。
    unavailable('interviews', 'shell.nav.interviews', 'shell.nav.note.fromProposal'),
  );

  if (context.audience === 'HOST') {
    items.push(
      unavailable('contracts', 'shell.nav.host.contracts', 'shell.nav.note.phase3'), // S-025
      unavailable('assignments', 'shell.nav.host.assignments', 'shell.nav.note.phase2'), // S-029
    );
  } else {
    // 🔴 経路 5（Issue #8）: 取引先にも ⑤ ⑥ を出す。遷移先は専用画面（S-045 / S-044）であり未実装。
    items.push(
      unavailable('contracts', 'shell.nav.partner.contracts', 'shell.nav.note.phase3'), // S-045
      unavailable('assignments', 'shell.nav.partner.assignments', 'shell.nav.note.phase2'), // S-044
    );
    if (isEngineerShareRole(context.role)) {
      items.push(link('engineer-shares', 'shell.nav.partner.shares', '/engineer-shares')); // S-015
    }
  }

  items.push(
    unavailable('chat', 'shell.nav.chat', 'shell.nav.note.phase2'), // S-031
    unavailable('tasks', 'shell.nav.tasks', 'shell.nav.note.phase2'), // S-033
    context.audience === 'HOST'
      ? unavailable('reports', 'shell.nav.host.reports', 'shell.nav.note.phase3') // S-034
      : unavailable('reports', 'shell.nav.partner.reports', 'shell.nav.note.phase3'),
    group(
      'settings',
      context.audience === 'HOST' ? 'shell.nav.host.settings' : 'shell.nav.partner.settings',
      settingsChildren(context),
    ),
  );

  return items;
}

/**
 * モバイルのボトムタブ（docs/04 §3.4「ホーム / 提案 / 候補 / チャット / その他」）。
 *
 * 🔴 **「その他」から全項目に到達でき、業務ループの順序を保つ**（`buildMainNav` をそのまま出す）。
 *    ここが返すのは手前の 4 つだけで、5 つ目（その他）は描画側が `<details>` として持つ。
 * 🔴 ホストと取引先で同じ 4 つである（docs/04 §3.4 は 1 つの表しか持たない）。**所属で出し分けない** ——
 *    出し分けるべき差（母集団と語）はサイドバー側（`buildMainNav`）が持っており、
 *    タブの 4 つはどちらの所属でも同じ画面を指す。
 */
export function buildBottomTabs(): readonly NavItem[] {
  return [
    link('home', 'shell.tab.home', '/'),
    link('proposals', 'shell.tab.proposals', '/proposals'),
    unavailable('candidates', 'shell.tab.candidates', 'shell.nav.note.fromProject'),
    unavailable('chat', 'shell.tab.chat', 'shell.nav.note.phase2'),
  ];
}

/** ナビの中で実際にリンクになっている遷移先（テストと走査のため）。 */
export function navHrefs(items: readonly NavItem[]): readonly string[] {
  return items.flatMap((item) => [
    ...(item.reach.kind === 'LINK' ? [item.reach.href] : []),
    ...navHrefs(item.children),
  ]);
}
