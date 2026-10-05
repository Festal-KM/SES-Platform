// apps/web/lib/shell/nav.ts
// 主平面のグローバルナビの**項目表**（サイドバー / セクション内の第 2 階層 / `設定` の索引 /
// モバイルのボトムタブ）。
//
// 🔴 **純粋な組み立てだけを置く**（React / DB / i18n の値に依存しない）。文言は `MessageKey` で
//    持ち、解決は `./nav-view.ts` が `packages/i18n` で行う（CLAUDE.md §3.5 / BR-32）。
//    こうしておくと「ホストと取引先で項目集合が違う」ことを、描画せずに単体テストで固定できる。
//
// ============================================================================
// 🔴 2026-10-03（人間の明示指示 + モックアップ 5 枚）: サイドバーを **6 項目のフラット**に畳んだ
// ============================================================================
// 指示は「サイドバーの内容が違うので、画像の内容と同じにして」であり、画像は
// **群の見出しを持たない 6 項目**（`ホーム` / `チャット` / `人材管理` / `案件管理` / `レポート` /
// `設定`）である。畳む前は **群 4 つ（`営業` / `連絡` / `分析` / `設定`）+ 16 項目**だった。
//
// ✅ **2026-10-04（人間の明示指示「サイドメニューのレポートは非表示にして」）: `レポート` を外し、
//    5 項目になった**（下の `buildMainNav` の 🔴）。🔴 **到達集合は 1 件も減っていない** ——
//    `レポート` は畳む前も `LINK` ではなく（Phase 3 で画面が無い）、`tests/static/nav-reach.test.ts` の
//    凍結表に現れない項目だった。🔴 **文言キーは消していない**（`U-22` の凍結）。
//
// | 畳む前 | 畳んだ先 |
// |---|---|
// | ホーム | **ホーム**（`/`） |
// | チャット（Phase 2）/ タスク（Phase 2） | **チャット**（Phase 2 のまま） |
// | 自社の人材 `/engineers` / 共有の設定 `/engineer-shares` | **人材管理** + 第 2 階層のタブ |
// | 案件 / 候補 / 提案 / 提案依頼 / 面談 / 契約 / 稼働 | **案件管理** + 第 2 階層のタブ |
// | 実績（Phase 3） | **レポート**（Phase 3 のまま） |
// | 組織設定 / 取引先企業 / 送信ドメイン / 利用量と上限 / データの返却 / 監査ログ / スキル辞書 | **設定**（`/settings` の索引） |
//
// 🔴 **到達性を 1 画面も落としていない。** 畳んだだけでは `S-036`（送信ドメイン）/ `S-041`
//    （監査ログ）/ `S-042`（データの返却）/ `S-015`（共有の設定）が**到達不能になり、機能が
//    消える**（この 4 画面はナビが唯一の入口である。下の `buildSettingsIndex` の 🔴）。そこで
//    第 2 階層を 2 つ置いた:
//
//      - `buildNavSections` … `人材管理` / `案件管理` の**タブ**（別の URL への遷移）
//      - `buildSettingsIndex` … `設定` の**索引ページ**（`/settings`）が並べる 7 項目
//
//    🔴 **ロール別の出し分けの条件は 1 つも変えていない**（`isTenantAdmin` / `audience` /
//       `isEngineerShareRole` の判定をそのまま移しただけである）。🔴 **2 つ目のロール表を
//       作らない** —— 条件はこのファイルの中に 1 箇所ずつしか無く、索引ページ・タブ・
//       ヘッダの「自分」メニューはいずれもここが返した配列を描くだけである。
//    🔴 到達集合（ロール別）が畳む前と一致することは `tests/static/nav-reach.test.ts` が
//       機械的に証明する（`/settings` の索引だけが増えた 1 件である）。
//
// 🔴 **`docs/04` §3.1 は依然として「群 4 つ + 16 項目」を定めている**（本ファイルの実装が
//    先行する）。設計書の追随はオーケストレーターが行う（`CLAUDE.md` §8.7。本タスクは
//    `docs/**` を触らない）。同様に §3.4 のボトムタブの表（`ホーム / 提案 / 候補 / チャット`）も
//    サイドバーの項目に合わせて見直した（下の `buildBottomTabs`）。
//
// 🔴 **チャットに件数バッジ（モックアップの `3`）を出さない。** `Notification` / 未読の実体は
//    Phase 2 で存在せず、架空の数は「見たのに消えない」を作る（`T-22-05` でヘッダのベルを
//    置かなかったのと同じ判断）。**Phase 2 の印はそのまま残す。**
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
  /** 🔴 アイコン名（`@ses/ui` の写像に無い名前は**型エラー**）。 */
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
   * 🔴 **その項目が「現在地」になる追加のパス**（第 2 階層 / 索引の遷移先）。
   *
   * 🔴 **これが無いと、畳み込みで「どこに居るか」が消える。** `提案`（`/proposals`）/
   *    `提案依頼`（`/proposal-requests`）/ `共有の設定`（`/engineer-shares`）/ `監査ログ`
   *    （`/audit-logs`）/ `スキル辞書`（`/skills`）は**親の項目と別のパス**であり、
   *    `reach.href` の前方一致だけではサイドバーの項目が 1 つも光らない
   *    （`docs/04` §3.1「現在地 = 背景 + 文字色 + 左端 2px」が成立しなくなる）。
   * 🔴 **出所は第 2 階層の表と索引の表である**（`buildMainNav` が `buildNavSections` /
   *    `buildSettingsIndex` から引く）。**パスを書き写さない。**
   */
  readonly sectionPaths: readonly string[];
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
 * 群。
 * 🔴 **2026-10-03 以降、群は 1 つだけ**（`primary` / 群名なし）である —— モックアップは
 *    群の見出しを持たない 6 項目のフラットなナビであり、`labelKey: null` がそれを表す。
 *    **型と `SidebarNavList` の形は変えていない**（群の配列を受ける器のまま）。
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
   * `提案依頼`（`S-017`）の返答期限に出す残り時間（例: `残り 2 日`）。`null` ならバッジを描かない。
   *
   * 🔴 **畳んだ後は `案件管理` の行が持つ**（`提案依頼` は第 2 階層のタブへ移った）。サイドバーは
   *    どの画面でも見えている唯一の面であり、ここから期限が消えると
   *    **取引先（1 日 4〜5 時間の主利用者。`CLAUDE.md` §1.2）が返答期限に気づけない**。
   *    🔴 **出すのは期限であって件数ではない**（件数は他社情報の示唆になりうる）。
   */
  readonly proposalRequestDueText?: string | null;
};

function link(
  id: string,
  labelKey: MessageKey,
  icon: IconName,
  href: string,
  badge: NavBadge | null = null,
  sectionPaths: readonly string[] = [],
): NavItem {
  return {
    id,
    labelKey,
    icon,
    reach: { kind: 'LINK', href },
    phaseKey: null,
    noteKey: null,
    badge,
    sectionPaths,
  };
}

/** 🔴 未実装（Phase 2 / 3）。印は**無彩色の `Phase N` Badge**（注記テキストを置き換えたもの）。 */
function pending(id: string, labelKey: MessageKey, icon: IconName, phaseKey: MessageKey): NavItem {
  return {
    id,
    labelKey,
    icon,
    reach: { kind: 'UNAVAILABLE' },
    phaseKey,
    noteKey: null,
    badge: null,
    sectionPaths: [],
  };
}

/** ホスト所属で `OWNER` / `ADMIN` にだけ到達できる設定画面（各 `page.tsx` の redirect と同じ条件）。 */
function isTenantAdminRole(role: TenantRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** `設定` の索引（`/settings`）の URL。🔴 **この 1 箇所が出所である。** */
export const SETTINGS_INDEX_PATH = '/settings';

/** `人材管理` の入口（サイドバーの項目と第 2 階層の 1 つ目が指す同じ URL）。 */
const ENGINEER_SECTION_PATH = '/engineers';
/** `案件管理` の入口（同上）。 */
const PROJECT_SECTION_PATH = '/projects';

/**
 * `設定` の索引（`/settings`）が並べる項目。**畳む前の `設定` 群と 1 対 1 である。**
 *
 * 🔴 docs/04 §3.1 の表は `設定` の中身を **4 項目**（取引先企業 / 利用量と上限 / スキル辞書 /
 *    組織設定）しか列挙していないが、**§4.8 の設定画面のうち 3 つ（`S-036` 送信ドメイン /
 *    `S-041` 監査ログ / `S-042` データの返却と保持期間）はリポジトリ内に他の到達経路が 1 本も無い**
 *    （`T-12-20` の着手時に `href` を全走査して確認した）。ナビが唯一の入口であるため項目として出す。
 *    **増やしたのは実在する画面への到達手段だけ**であり、新しい画面も新しい機能も足していない。
 * 🔴 **この 7 項目とロール条件は 2026-10-03 の畳み込みで 1 つも変えていない。** 置き場所が
 *    サイドバーの群から索引ページへ移っただけである（到達集合が一致することは
 *    `tests/static/nav-reach.test.ts` が証明する）。
 */
export function buildSettingsIndex(context: NavContext): readonly NavItem[] {
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

// ============================================================================
// 第 2 階層（セクション内のタブ）
// ============================================================================

/** 第 2 階層を持つセクション（🔴 サイドバーの項目のうちこの 2 つだけ）。 */
export type NavSectionId = 'engineers' | 'projects';

export type NavSection = {
  readonly id: NavSectionId;
  /**
   * セクションの語。🔴 **サイドバーの同じ項目と同じ `MessageKey` を使う**
   *    （所属で語が変わる判定を 2 箇所に持たない）。
   */
  readonly labelKey: MessageKey;
  readonly items: readonly NavItem[];
};

/**
 * `人材管理` / `案件管理` の第 2 階層（タブ）。
 *
 * 🔴 **ここが畳み込みで消えた項目の到達手段である。** `共有の設定`（`S-015`）/ `提案`（`S-019`）/
 *    `提案依頼`（`S-017`）はサイドバーから消えたが、**同じロール条件のまま**ここに在る。
 * 🔴 **`共有の設定` は取引先所属かつ `isEngineerShareRole` のときだけ**（経路 4 の opt-in を
 *    動かせるのは自社の人材を持つ側だけであり、ホストは他社の共有設定に触れない。docs/04 §3.2）。
 * 🔴 **並びは業務ループ（`CLAUDE.md` §1.3）のまま**: 案件 → 提案 → 提案依頼。
 * ⚠️ `候補`（`S-016`）/ `面談・結果`（`S-024`）/ `契約` / `稼働` をタブにしていない ——
 *    前 2 つは単独の URL を持たず（案件・提案から開く）、後 2 つは Phase 2 / 3 で画面が無い。
 *    **タブは「別の URL へ遷移するもの」だけが載る**（押せないタブは `docs/04` §10.3 の
 *    「タブは同一対象の面の切替」にも反する）。
 */
export function buildNavSections(context: NavContext): readonly NavSection[] {
  const engineers: NavItem[] = [
    link('engineers', 'shell.section.engineers.list', 'users', ENGINEER_SECTION_PATH),
  ];
  // 🔴 ホスト側に `共有の設定` は存在しない（ホストは他社の共有設定に触れない）。
  if (context.audience === 'PARTNER' && isEngineerShareRole(context.role)) {
    engineers.push(link('engineer-shares', 'shell.nav.partner.shares', 'share-2', '/engineer-shares'));
  }
  return [
    {
      id: 'engineers',
      labelKey:
        context.audience === 'HOST' ? 'shell.nav.host.engineers' : 'shell.nav.partner.engineers',
      items: engineers,
    },
    {
      id: 'projects',
      labelKey: context.audience === 'HOST' ? 'shell.nav.host.projects' : 'shell.nav.partner.projects',
      items: [
        link('projects', 'shell.section.projects.list', 'briefcase', PROJECT_SECTION_PATH), // S-010
        link('proposals', 'shell.nav.proposals', 'send', '/proposals'), // S-019
        link('proposal-requests', 'shell.nav.proposalRequests', 'inbox', '/proposal-requests'), // S-017
      ],
    },
  ];
}

/**
 * 第 2 階層の帯を描きうるセクション（**タブが 2 つ以上あるものだけ**）。
 *
 * 🔴 **タブが 1 つしか無いセクションを外す**（タブが 1 枚だけの帯は選択肢を示していない）。
 *    外してもサイドバーの項目がその URL を指しているので、到達性は落ちない
 *    （ホストの `人材管理` が実際にこれに当たる）。
 *
 * 🔴 ✅ **2026-10-04: ここから「いまどのセクションに居るか」の判定を外した。**
 *    App Router のレイアウトはソフトナビゲーションで再描画されないため、サーバで 1 本選んで
 *    渡す形では **`/settings` へ移動しても案件管理のタブが残り続けた**（実測。
 *    `packages/ui/src/lib/current-nav-path.ts` 冒頭）。現在地に依存する判定は
 *    **`@ses/ui` の `currentNavSectionIndex` の 1 実装**に移り、サーバ（初回描画）と
 *    クライアントの島（`app/(main)/_shell/nav-current.tsx`）の両方がそれを呼ぶ。
 *    🔴 **この関数に現在地を渡さないのは意図である** —— 「タブが 2 つ以上あるか」は
 *    パスに依存しない判断であり、サーバ側に 1 箇所だけ置けばよい。
 */
export function navSectionsWithTabs(
  sections: readonly NavSection[],
): readonly NavSection[] {
  return sections.filter((section) => section.items.length >= 2);
}

// ============================================================================
// サイドバー（5 項目。2026-10-03 は 6 項目だった）
// ============================================================================

/**
 * サイドバー（グローバルナビ）の項目。
 *
 * 🔴 **モックアップどおりフラット**（群の見出しを持たない）。並びも画像のままである:
 *    ホーム → チャット → 人材管理 → 案件管理 → 設定
 *    （✅ 2026-10-04: 画像の `レポート` は人間の明示指示で外した。下の 🔴）。
 * ⚠️ この並びは `CLAUDE.md` §1.3 の業務ループ（① 集める → ② マッチング → ③ 提案 → …）の順では
 *    ない（`チャット` が ① の手前に来る）。**ループの順序は第 2 階層（`案件管理` のタブ =
 *    案件 → 提案 → 提案依頼）が保つ。** 人間の明示指示（2026-10-03「画像の内容と同じにして」）が
 *    docs/04 §3.1 / §11-21 の並びより優先する判断であり、設計書の追随は別途行う。
 */
export function buildMainNav(context: NavContext): readonly NavGroup[] {
  const proposalRequestDue = context.proposalRequestDueText ?? null;
  // 🔴 現在地の射程（`NavItem.sectionPaths`）は**第 2 階層と索引の表から引く**（書き写さない）。
  const sections = buildNavSections(context);
  const sectionPathsOf = (id: NavSectionId): readonly string[] =>
    navHrefs(sections.find((section) => section.id === id)?.items ?? []);
  return [
    {
      id: 'primary',
      labelKey: null,
      items: [
        link('home', 'shell.nav.home', 'home', '/'),
        // S-031 チャット。🔴 件数バッジを出さない（未読の実体が無い。ファイル冒頭の 🔴）。
        pending('chat', 'shell.nav.chat', 'message-square', 'shell.nav.note.phase2'),
        link(
          'engineers',
          context.audience === 'HOST' ? 'shell.nav.host.engineers' : 'shell.nav.partner.engineers',
          'users',
          ENGINEER_SECTION_PATH,
          null,
          sectionPathsOf('engineers'),
        ),
        link(
          'projects',
          context.audience === 'HOST' ? 'shell.nav.host.projects' : 'shell.nav.partner.projects',
          'briefcase',
          PROJECT_SECTION_PATH,
          // 🔴 S-017 の返答期限（docs/04 §3.1 の取引先列）。畳み込みで `提案依頼` が第 2 階層へ
          //    移ったので、**その親である `案件管理` の行**が期限を預かる（`NavContext` の 🔴）。
          //    ホストに出さないのは docs/04 の表が取引先列にしか書いていないからである
          //    （ホスト側の期限の見張りは `S-003` の要対応キューが持つ）。
          proposalRequestDue === null || context.audience !== 'PARTNER'
            ? null
            : {
                labelKey: 'shell.nav.proposalRequests.due.label',
                text: proposalRequestDue,
                // 🔴 アイコンのみの形態で点に添える語（期限も件数も含まない。`NavBadge` の 🔴）。
                dotLabelKey: 'shell.nav.proposalRequests.due.dot',
              },
          sectionPathsOf('projects'),
        ),
        // 🔴 S-034 レポート（Phase 3）は**サイドバーに出さない**（2026-10-04。人間の指示
        //    「サイドメニューのレポートは非表示にして」）。実体が Phase 3 まで無く、押しても
        //    何も無い項目を常設しない —— `chat` と違い、`レポート` は**その語だけでは何が
        //    できるようになるのかが利用者に伝わらない**（`docs/04` §4.7 の `S-034` は
        //    「提案 → 面談 → 決定の転換率」であり、ナビの 1 語からは読み取れない）。
        //    🔴 **文言キー（`shell.nav.host.reports` / `shell.nav.partner.reports`）は
        //    消していない**（`U-22` の凍結。Phase 3 で戻すときに同じ語を使う）。
        //    予告の置き場所は `Q-04-8`（既定 = `S-047` 設定の索引）。
        link(
          'settings',
          context.audience === 'HOST' ? 'shell.nav.host.settings' : 'shell.nav.partner.settings',
          'settings',
          SETTINGS_INDEX_PATH,
          null,
          // 🔴 索引の 7 項目のうち `/audit-logs` / `/skills` は `/settings` 配下に無い URL である
          //    （前方一致では光らない）。索引の表から引いて射程に入れる。
          navHrefs(buildSettingsIndex(context)),
        ),
      ],
    },
  ];
}

/**
 * モバイルのボトムタブ（docs/04 §3.4）。
 *
 * 🔴 **サイドバーの項目に合わせて見直した**（2026-10-03）: `ホーム` / `人材管理` / `案件管理` /
 *    `チャット` + 「その他」。旧版は `ホーム` / `提案` / `候補` の 3 つを手前に出していたが、
 *    **`提案` は第 2 階層へ移り、`候補` は単独の URL を持たない**ため、手前の 4 つを
 *    「サイドバーのうち押せる上位 3 つ + チャット」に揃えた。
 * 🔴 **「その他」から全項目に到達できる性質を壊していない**（描画側が `buildMainNav` の
 *    項目をそのまま出す）。第 2 階層（タブ）と `設定` の索引は、その先の画面で同じ形で現れる。
 * ⚠️ **ボトムタブと「その他」は現在地の表現を持たない**（柱と二重に示さない。`packages/ui` の
 *    `navMatchPaths` が `variant !== 'sidebar'` で空を返す）。**2026-10-04 の現在地の不具合は
 *    ここには無かった** —— 光る対象が 1 つも無いためである。
 * 🔴 **ボトムタブの 5 つにはアイコンを付ける**（docs/04 §3.4。ラベルが 2〜3 文字に切り詰まって
 *    おり、アイコンが弁別の主役になる）。**サイドバーと同じアイコンを使う** —— 同じ項目が端末で
 *    別の見え方をすると、迷ったときにデスクトップの記憶が使えない。
 * 🔴 ホストと取引先で同じ 4 つである（docs/04 §3.4 は 1 つの表しか持たない）。**所属で出し分けない** ——
 *    出し分けるべき差（母集団と語）はサイドバー側（`buildMainNav`）が持っており、
 *    タブの 4 つはどちらの所属でも同じ画面を指す。
 */
export function buildBottomTabs(): readonly NavItem[] {
  return [
    link('home', 'shell.tab.home', 'home', '/'),
    link('engineers', 'shell.tab.engineers', 'users', ENGINEER_SECTION_PATH),
    link('projects', 'shell.tab.projects', 'briefcase', PROJECT_SECTION_PATH),
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

/**
 * 🔴 **そのロールがナビ・タブ・索引から到達できる遷移先の全体**（重複を畳む / 並びは問わない）。
 *
 * 🔴 **到達性の証明の入力はこの 1 関数である**（`tests/static/nav-reach.test.ts`）。
 *    サイドバーだけを見ると、畳み込みで第 2 階層へ移った画面が「消えた」と誤判定する。
 *    ボトムタブを含めるのは、モバイルでも同じ集合に到達できることを同時に見るためである。
 */
export function navReachableHrefs(context: NavContext): readonly string[] {
  const sections = buildNavSections(context);
  return [
    ...new Set([
      ...navHrefs(navItems(buildMainNav(context))),
      ...navHrefs(sections.flatMap((section) => [...section.items])),
      ...navHrefs(buildSettingsIndex(context)),
      ...navHrefs(buildBottomTabs()),
    ]),
  ];
}
