// apps/web/lib/shell/nav.ts
// 主平面のグローバルナビの**項目表**（docs/04 §3.1 のサイドバーの表 / §3.4 のボトムタブ）。
//
// 🔴 **純粋な組み立てだけを置く**（React / DB / i18n の値に依存しない）。文言は `MessageKey` で
//    持ち、解決は `./nav-view.ts` が `packages/i18n` で行う（CLAUDE.md §3.5 / BR-32）。
//    こうしておくと「ホストと取引先で項目集合が違う」ことを、描画せずに単体テストで固定できる。
//
// ============================================================================
// 🔴 SP-22 `T-22-05`（docs/04 改訂 16）で変えた 3 点と、変えていない 1 点
// ============================================================================
// | # | 変更 | 根拠 |
// |---|---|---|
// | 1 | **ステージ番号の接頭辞（`① 人材` …）を外した** | docs/04 §3.1 / §11-21（人間の決定 2026-09-29）。**番号は順序を読ませる手段の 1 つであって順序そのものではない。** 丸数字は日本語の本文中で 1 文字ぶんの重さを持ち、**8 項目のラベルの先頭 2 文字を毎回潰していた**（外したのは `packages/i18n` の**値**であり、キーは 1 つも動かしていない = `U-22`） |
// | 2 | **日本語 4 群（`営業` / `連絡` / `分析` / `設定`）で構造化した** | docs/04 §3.1 の表（`U-20`）。群の見出しと余白が、番号と同じ「まとまりと順序」をラベルの文字を奪わずに表す |
// | 3 | **全項目に Lucide アイコンを付けた** | docs/04 §7.5 ③（禁止の解除。人間の決定）。**根拠は走査性の 1 点**であり装飾の許可ではない（§11-22）。写像は `@ses/ui` の `icons.ts` 1 本で、**表に無い名前は型エラー**になる |
// | — | 🔴 **並びの順序は 1 つも動かしていない** | docs/04 §11-21 の 🔴（人材 → 案件 → 候補を探す → 提案 → 提案依頼 → 面談・結果 → 契約 → 稼働）。`営業` 群の中の並びが `CLAUDE.md` §1.3 の業務ループそのものである |
//
// 🔴 **`共有の設定`（`S-015`）は `自社の人材` の直下に置く**（docs/04 §3.1 の 🔴）。理由は条文に
//    書かれている: この画面は「**今ホストに何を見せているか**」を毎日動かす画面であり、
//    **稼働が決まった人材の共有解除は時間勝負**である（§11-13）。母集団が `自社の人材` と同じ
//    台帳なので、その直下に置く。⚠️ `T-12-20` は改訂 16 より前の実装で**末尾（`稼働` の後）**に
//    置いていた。**項目集合は変わっていない**（位置だけが表に合った）。
//
// 🔴 **404 を作らない。** 遷移先は次の 2 つのいずれかで、`LINK` 以外は**リンクにしない**:
//      - `LINK`        … `apps/web/app/(main)/**/page.tsx` が実在する画面
//      - `UNAVAILABLE` … 未実装（Phase 2 / 3。印は無彩色の `Phase N` Badge）、または
//                        単独の URL を持たない画面（案件・提案から開く。印は注記）
//    🔴 **`Phase N`（まだ無い）と注記（別の入口から開く）を混ぜない** —— 利用者が取るべき行動が違う。
//    実在判定は推測ではなく `nav.test.ts` が `app/(main)/**/page.tsx` を走査して突き合わせる。
//
// 🔴 **ロールで到達できない画面は項目ごと出さない**（グレーアウトで見せない。docs/04 §8.1 と同じ原則）。
//    押した先でホームへ黙って戻される導線を作らないため。拒否の本体は各画面の redirect と API の
//    `requireRole` であり、ここは UI の配慮にすぎない。
import type { TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import type { IconName } from '@ses/ui';
import { isEngineerShareRole } from '../engineer-shares/policy';

/** ホスト（契約 SES 企業）所属か、取引先（パートナー）所属か。母集団と項目名が変わる唯一の軸。 */
export type NavAudience = 'HOST' | 'PARTNER';

/** 遷移先の分類（上の 🔴）。 */
export type NavReach =
  | { readonly kind: 'LINK'; readonly href: string }
  | { readonly kind: 'UNAVAILABLE' };

export type NavItem = {
  /** `data-testid` の接尾辞（kebab-case）。E2E と render テストが掴む。 */
  readonly id: string;
  readonly labelKey: MessageKey;
  /** 🔴 docs/04 §3.1 の表のアイコン名（`@ses/ui` の写像に無い名前は**型エラー**）。 */
  readonly icon: IconName;
  readonly reach: NavReach;
  /**
   * 🔴 未実装（Phase 2 / 3）の印。**無彩色の Badge** で描く（docs/04 §3.1 の 🔴）。
   * 値は `shell.nav.note.phase2` / `phase3`（**キーは `T-12-20` から動かしていない**）。
   */
  readonly phaseKey: MessageKey | null;
  /** 実在するが単独の URL を持たない項目の注記（`案件から開きます`）。🔴 `Phase N` とは別物。 */
  readonly noteKey: MessageKey | null;
  /**
   * 項目に添えるバッジ（`提案依頼` の返答期限だけが持つ。docs/04 §3.1 取引先列）。
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
  /**
   * 🔴 アイコンのみの形態でバッジの代わりに出る**点（dot）**に添える読み上げの語
   *    （`packages/ui` の `SidebarBadge.dotLabel`。T-22-05 のレビュー指摘 11）。
   * 🔴 **件数も期限の文字も持たない語である**（`CLAUDE.md` §3.1 / `F-004 AC-4`）。
   */
  readonly dotLabelKey: MessageKey;
};

/**
 * 群（docs/04 §3.1 の 4 群 + 群名なしの最上段）。
 * 🔴 **ホームは群に属さず最上段**（`labelKey: null`）。
 */
export type NavGroup = {
  /** `data-testid` の接尾辞（群名の要素に付く）。 */
  readonly id: string;
  readonly labelKey: MessageKey | null;
  readonly items: readonly NavItem[];
};

export type NavContext = {
  readonly audience: NavAudience;
  readonly role: TenantRole;
  /**
   * `提案依頼`（`S-017`）の期限バッジに出す残り時間（例: `残り 2 日`）。`null` ならバッジを描かない。
   *
   * 🔴 docs/04 §3.1 は**取引先列**にだけバッジを書いている。値を読むのはレイアウト側であり、
   *    ここは「渡されたときに取り付ける」だけを決める（渡すかどうかの判定を 2 箇所に置かない）。
   */
  readonly proposalRequestDueText?: string | null;
};

function link(
  id: string,
  labelKey: MessageKey,
  icon: IconName,
  href: string,
  badge: NavBadge | null = null,
): NavItem {
  return { id, labelKey, icon, reach: { kind: 'LINK', href }, phaseKey: null, noteKey: null, badge };
}

/** 🔴 未実装（Phase 2 / 3）。印は**無彩色の `Phase N` Badge**（注記テキストを置き換えたもの）。 */
function pending(id: string, labelKey: MessageKey, icon: IconName, phaseKey: MessageKey): NavItem {
  return { id, labelKey, icon, reach: { kind: 'UNAVAILABLE' }, phaseKey, noteKey: null, badge: null };
}

/** 🔴 実在するが単独の URL を持たない（案件・提案から開く）。印は注記であって `Phase N` ではない。 */
function elsewhere(id: string, labelKey: MessageKey, icon: IconName, noteKey: MessageKey): NavItem {
  return { id, labelKey, icon, reach: { kind: 'UNAVAILABLE' }, phaseKey: null, noteKey, badge: null };
}

/** ホスト所属で `OWNER` / `ADMIN` にだけ到達できる設定画面（各 `page.tsx` の redirect と同じ条件）。 */
function isTenantAdminRole(role: TenantRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * `設定` 群の項目。
 *
 * 🔴 docs/04 §3.1 の表は `設定` の中身を **4 項目**（取引先企業 / 利用量と上限 / スキル辞書 /
 *    組織設定）しか列挙していないが、**§4.8 の設定画面のうち 3 つ（`S-036` 送信ドメイン /
 *    `S-041` 監査ログ / `S-042` データの返却と保持期間）はリポジトリ内に到達経路が 1 本も無い**
 *    （`T-12-20` の着手時に `href` を全走査して確認した）。ナビが唯一の入口であるため項目として出す。
 *    **増やしたのは実在する画面への到達手段だけ**であり、新しい画面も新しい機能も足していない。
 * 🔴 `T-22-05` の受け入れ基準 1（**ロール別の項目集合が 1 つも変わっていない**）により、この 3 つを
 *    減らすこともできない。アイコンの根拠は `@ses/ui` の `icons.ts` の (2) に記録した。
 */
function settingsItems(context: NavContext): readonly NavItem[] {
  // 🔴 4 画面（`S-035` / `S-036` / `S-042` / `S-041`）は**ホスト所属の `OWNER` / `ADMIN` だけ**が
  //    到達する（各 `page.tsx` の redirect と同じ条件）。1 つの述語にまとめて、画面ごとに
  //    条件が食い違わないようにする。
  //    ⚠️ パートナー所属が `OWNER` / `ADMIN` になることは DB の CHECK（`memberships`）で
  //    起こりえないが、条件に所属を明示しておく（判定の根拠をロール名の知識に委ねない）。
  const isTenantAdmin = context.audience === 'HOST' && isTenantAdminRole(context.role);
  const items: NavItem[] = [];
  if (isTenantAdmin) {
    // S-035 組織設定とメンバー管理。
    items.push(link('settings-organization', 'orgSettings.title', 'settings', '/settings/organization'));
  }
  // S-014 取引先企業の一覧・詳細と招待。取引先所属では自社 1 社だけが見える（RLS C5）。
  items.push(
    link('settings-partner-companies', 'partnerCompanies.title', 'building-2', '/settings/partner-companies'),
  );
  if (isTenantAdmin) {
    // S-036 送信ドメインの設定と検証。
    items.push(link('settings-sending-domains', 'settings.sendingDomain.title', 'mail', '/settings/sending-domains'));
  }
  if (context.audience === 'HOST') {
    // 🔴 S-038 利用量と上限。**導線はホスト側にしか置かない**（`docs/04` §S-038「取引先には
    //    操作の場所で示す」/ `F-027 AC-1`「パートナーには停止の事実と理由だけ」）。
    //    取引先が URL を直接開いた場合の受け皿は画面側に在る（`settings/usage/page.tsx`）。
    items.push(link('settings-usage', 'usage.title', 'gauge', '/settings/usage'));
  }
  if (isTenantAdmin) {
    // S-042 データの返却と保持期間（`DATA_EXPORT_ROLES` = OWNER / ADMIN）。
    items.push(link('settings-retention', 'retention.summary.heading', 'archive', '/settings/retention'));
    // S-041 監査ログ（自テナント）。
    items.push(link('settings-audit-logs', 'auditLogs.title', 'scroll-text', '/audit-logs'));
  }
  // S-009 スキル辞書・別名・新語候補。取引先は起票のみだが閲覧はできる（F-010 AC-1）。
  items.push(link('settings-skills', 'skillDictionary.title', 'book-open', '/skills'));
  return items;
}

/**
 * `営業` 群の項目（🔴 **並びは `CLAUDE.md` §1.3 の業務ループそのもの**。入れ替えない）。
 */
function salesItems(context: NavContext): readonly NavItem[] {
  const proposalRequestDue = context.proposalRequestDueText ?? null;
  const items: NavItem[] = [];

  if (context.audience === 'HOST') {
    items.push(link('engineers', 'shell.nav.host.engineers', 'users', '/engineers')); // S-005
  } else {
    items.push(link('engineers', 'shell.nav.partner.engineers', 'users', '/engineers'));
    // 🔴 S-015（経路 4 の共有設定）は**取引先にだけ**在り、`自社の人材` の直下に置く（上の 🔴）。
    //    🔴 ホスト側に `共有の設定` は存在しない（ホストは他社の共有設定に触れない。docs/04 §3.2）。
    if (isEngineerShareRole(context.role)) {
      items.push(link('engineer-shares', 'shell.nav.partner.shares', 'share-2', '/engineer-shares'));
    }
  }

  items.push(
    context.audience === 'HOST'
      ? link('projects', 'shell.nav.host.projects', 'briefcase', '/projects') // S-010
      : link('projects', 'shell.nav.partner.projects', 'briefcase', '/projects'),
    // S-016 は案件起点（`/projects/{id}/candidates`）であり、単独の URL を持たない。
    context.audience === 'HOST'
      ? elsewhere('candidates', 'shell.nav.host.candidates', 'user-search', 'shell.nav.note.fromProject')
      : elsewhere('candidates', 'shell.nav.partner.candidates', 'user-search', 'shell.nav.note.fromProject'),
    link('proposals', 'shell.nav.proposals', 'send', '/proposals'), // S-019
    // 🔴 S-017。取引先にだけ期限バッジを添える（docs/04 §3.1 の取引先列。
    //    🔴 **件数でなく期限**。件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1）。
    //    ホストに出さないのは docs/04 の表が取引先列にしか書いていないからである
    //    （ホスト側の期限の見張りは `S-003` の要対応キューが持つ）。
    link(
      'proposal-requests',
      'shell.nav.proposalRequests',
      'inbox',
      '/proposal-requests',
      proposalRequestDue === null || context.audience !== 'PARTNER'
        ? null
        : {
            labelKey: 'shell.nav.proposalRequests.due.label',
            text: proposalRequestDue,
            // 🔴 アイコンのみの形態で点に添える語（期限も件数も含まない。上の `NavBadge` の 🔴）。
            dotLabelKey: 'shell.nav.proposalRequests.due.dot',
          },
    ), // S-017
    // S-024（面談日程の調整と結果記録）は `S-023` 経由（`/proposals/{id}/interview`）。
    elsewhere('interviews', 'shell.nav.interviews', 'handshake', 'shell.nav.note.fromProposal'),
  );

  if (context.audience === 'HOST') {
    items.push(
      pending('contracts', 'shell.nav.host.contracts', 'file-signature', 'shell.nav.note.phase3'), // S-025
      pending('assignments', 'shell.nav.host.assignments', 'calendar-clock', 'shell.nav.note.phase2'), // S-029
    );
  } else {
    // 🔴 経路 5（Issue #8）: 取引先にも ⑤ ⑥ を出す。遷移先は専用画面（S-045 / S-044）であり未実装。
    items.push(
      pending('contracts', 'shell.nav.partner.contracts', 'file-signature', 'shell.nav.note.phase3'), // S-045
      pending('assignments', 'shell.nav.partner.assignments', 'calendar-clock', 'shell.nav.note.phase2'), // S-044
    );
  }
  return items;
}

/**
 * サイドバー（グローバルナビ）の群と項目。
 *
 * 🔴 **群は docs/04 §3.1 の表のとおり 4 つ**（`営業` / `連絡` / `分析` / `設定`）+ 群名なしの最上段。
 *    🔴 **`分析` を `実績` にしない**（群名と項目名は別物である）。
 */
export function buildMainNav(context: NavContext): readonly NavGroup[] {
  return [
    // 🔴 ホームは群に属さず最上段（docs/04 §3.1 の表の 1 行目）。
    { id: 'primary', labelKey: null, items: [link('home', 'shell.nav.home', 'home', '/')] },
    { id: 'sales', labelKey: 'shell.nav.group.sales', items: salesItems(context) },
    {
      id: 'comms',
      labelKey: 'shell.nav.group.comms',
      items: [
        pending('chat', 'shell.nav.chat', 'message-square', 'shell.nav.note.phase2'), // S-031
        pending('tasks', 'shell.nav.tasks', 'list-checks', 'shell.nav.note.phase2'), // S-033
      ],
    },
    {
      id: 'analytics',
      labelKey: 'shell.nav.group.analytics',
      items: [
        context.audience === 'HOST'
          ? pending('reports', 'shell.nav.host.reports', 'bar-chart-3', 'shell.nav.note.phase3') // S-034
          : pending('reports', 'shell.nav.partner.reports', 'bar-chart-3', 'shell.nav.note.phase3'),
      ],
    },
    {
      id: 'settings',
      labelKey: context.audience === 'HOST' ? 'shell.nav.host.settings' : 'shell.nav.partner.settings',
      items: settingsItems(context),
    },
  ];
}

/**
 * モバイルのボトムタブ（docs/04 §3.4「ホーム / 提案 / 候補 / チャット / その他」）。
 *
 * 🔴 **「その他」から全項目に到達でき、業務ループの順序を保つ**（`buildMainNav` をそのまま出す）。
 *    ここが返すのは手前の 4 つだけで、5 つ目（その他）は描画側が `<details>` として持つ。
 * 🔴 **ボトムタブの 5 つにはアイコンを付ける**（docs/04 §3.4。既にラベルが 2〜3 文字に切り詰まって
 *    おり、アイコンが弁別の主役になる）。**サイドバーと同じアイコンを使う** —— 同じ項目が端末で
 *    別の見え方をすると、迷ったときにデスクトップの記憶が使えない。
 * 🔴 ホストと取引先で同じ 4 つである（docs/04 §3.4 は 1 つの表しか持たない）。**所属で出し分けない** ——
 *    出し分けるべき差（母集団と語）はサイドバー側（`buildMainNav`）が持っており、
 *    タブの 4 つはどちらの所属でも同じ画面を指す。
 */
export function buildBottomTabs(): readonly NavItem[] {
  return [
    link('home', 'shell.tab.home', 'home', '/'),
    link('proposals', 'shell.tab.proposals', 'send', '/proposals'),
    elsewhere('candidates', 'shell.tab.candidates', 'user-search', 'shell.nav.note.fromProject'),
    pending('chat', 'shell.tab.chat', 'message-square', 'shell.nav.note.phase2'),
  ];
}

/** 群をまたいだ項目の並び（テストと走査のため。🔴 表の順序を保つ）。 */
export function navItems(groups: readonly NavGroup[]): readonly NavItem[] {
  return groups.flatMap((group) => group.items);
}

/** ナビの中で実際にリンクになっている遷移先（テストと走査のため）。 */
export function navHrefs(items: readonly NavItem[]): readonly string[] {
  return items.flatMap((item) => (item.reach.kind === 'LINK' ? [item.reach.href] : []));
}
