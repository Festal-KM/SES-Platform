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
  /**
   * 🔴 **この群の上に罫線を引く**（✅ 2026-10-13。人間の指示「区切り線を入れる」）。
   * ⚠️ 既定（未指定）は `false` ＝ 従来どおり**余白だけ**で区切る。線を引く群を
   *    **ここで明示する**ことで、群が増えるたびに線が増えるのを止めている。
   */
  readonly divided?: boolean;
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

/**
 * 🔴 未実装（Phase 2 / 3）。印は**無彩色の `Phase N` Badge**（注記テキストを置き換えたもの）。
 *
 * ✅ **2026-10-13: 呼び手が戻った**（`その他` 群の `お知らせ` = `F-039` / `S-032`。Phase 2）。
 *    ⚠️ 2026-10-05 からこの日までは呼び手が 0 だったが**消さずに置いていた** —— 消していたら、
 *    `お知らせ` を足すときに **`href` を持った `Phase 2` の項目**（押せたのに無い）を
 *    作ってしまえた。「未実装の項目はリンクにしない」を**型で守る**のがこの関数の役目である。
 */
export function pendingNavItem(id: string, labelKey: MessageKey, icon: IconName, phaseKey: MessageKey): NavItem {
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

/**
 * `チャット`（`S-031`。越境経路 3）の入口。
 * ✅ **2026-10-05: `Phase 2` の印つきの非リンクから、到達可能なリンクに変えた**（画面と API を実装した）。
 * 🔴 **件数バッジは依然として出さない**（`messages` に既読の列が無く、未読の実体が無い。
 *    ファイル冒頭の 🔴 はそのまま効いている）。
 */
const CHAT_SECTION_PATH = '/chat';

/** `自社人材管理` の入口（サイドバーの項目と第 2 階層の 1 つ目が指す同じ URL）。 */
const ENGINEER_SECTION_PATH = '/engineers';
/** `自社案件管理` の入口（同上）。 */
const PROJECT_SECTION_PATH = '/projects';

/**
 * ✅ **2026-10-14（人間の明示指示「チャットの下にカレンダーも入れる」）: `カレンダー`。**
 *
 * 🔴 **中身は準備中である**（人間の指示「タブ内のコンテンツについては準備中という表記でよいです」）。
 *    画面は実在するので `pendingNavItem`（押せない `Phase N`）**ではなく** `link` にする ——
 *    押せて、開いて、「準備中」と書いてある画面である。**この 2 つを混ぜない**（冒頭の 🔴）。
 * 🔴 **第 2 階層を持たせない**（面の切り替えになる遷移先がまだ 1 つも無い）。
 */
const CALENDAR_SECTION_PATH = '/calendar';

/**
 * ✅ **2026-10-14（人間の明示指示）: `パートナー連携` 群の 3 画面。**
 *
 * 🔴 **いずれも準備中である**（上の `CALENDAR_SECTION_PATH` と同じ扱い）。
 *
 * 🔴🔴 **3 本は兄弟の URL である（`/partners/...` と入れ子にしない）。** ✅ 2026-10-15 の修正。
 *    人間の報告「`案件一覧`『人材一覧』を選択すると `パートナー一覧` もハイライトされてしまう」が
 *    これである。現在地の判定は **完全一致 または `${href}/` の前方一致**（`@ses/ui` の
 *    `isCurrentNavPath`）なので、**ある項目の遷移先が別の項目の遷移先の祖先になっていると
 *    2 項目とも現在地になる** —— 当初の `/partners` + `/partners/projects` +
 *    `/partners/engineers` がまさにその形だった。
 *    🔴 **判定の側を増やして直さない。** あの前方一致は詳細画面（`/projects/{id}` /
 *    `/engineers/{id}`）で親の項目を光らせるために要る規則であり、ここで例外を足すと
 *    「現在地の判定が 2 つ」になる（`packages/ui/src/lib/current-nav-path.ts` 冒頭の 🔴）。
 *    🔴 直し方は **サイドバーの兄弟を URL でも兄弟にする**ことである —— 畳み込みの時点から
 *    `/engineers` と `/engineer-shares`、`/proposals` と `/proposal-requests`、`/audit-logs` /
 *    `/skills` が同じ形であり、ここもそれに揃えた。**入れ子にしてよいのは 1 つの項目が射程に
 *    持つ配下だけ**（`設定` と `/settings/*`）である。
 *    ⚠️ 副産物として、将来 `パートナー一覧` に詳細画面（`/partners/{id}`）を足したときも
 *    前方一致がそのまま効く（配下に別の項目が居ないため）。
 *    🔴 この不変条件（**どのパスでも光る項目は 1 つ以下**）は `nav.test.ts` が全ロール ×
 *    主平面の全ルートで機械的に固定する。入れ子を作った瞬間に落ちる。
 *
 * 🔴 **`/settings/partner-companies`（`S-014` 取引先企業）には寄せていない。** あちらは実在する
 *    画面であり、`設定` の索引からの到達手段を持つ。ここで同じ URL を指すと、**サイドバーの
 *    `パートナー一覧` と `設定` の 2 項目が同時に光る**（`settings` の `sectionPaths` が索引の
 *    7 項目を射程に持つため）。統合するかは人間の判断事項（Issue #102 の既定 = A「分けたまま」）。
 */
const PARTNER_COMPANIES_SECTION_PATH = '/partners';
const PARTNER_PROJECTS_SECTION_PATH = '/partner-projects';
const PARTNER_ENGINEERS_SECTION_PATH = '/partner-engineers';

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
 * 🔴 **`共有の設定` は取引先所属かつ `isEngineerShareRole` のときだけ**（経路 4 の opt-in を
 *    動かせるのは自社の人材を持つ側だけであり、ホストは他社の共有設定に触れない。docs/04 §3.2）。
 * ⚠️ `候補`（`S-016`）/ `面談・結果`（`S-024`）/ `契約` / `稼働` をタブにしていない ——
 *    前 2 つは単独の URL を持たず（案件・提案から開く）、後 2 つは Phase 2 / 3 で画面が無い。
 *    **タブは「別の URL へ遷移するもの」だけが載る**（押せないタブは `docs/04` §10.3 の
 *    「タブは同一対象の面の切替」にも反する）。
 *
 * ============================================================================
 * 🔴🔴 **2026-10-15（人間の明示指示「案件一覧、提案、提案依頼のタブは不要です」）**
 * ============================================================================
 * `案件管理` の第 2 階層を **`案件一覧` の 1 枚だけ**にした。タブが 1 枚の帯は
 * `navSectionsWithTabs` が外すので、**案件管理の上のタブの帯はどのロールでも描かれなくなる**。
 *
 * 🔴 **`提案`（`S-019`）/ `提案依頼`（`S-017`）はサイドバーへ移した**（`buildMainNav`）——
 *    **消していない。** この 2 画面はこの帯が唯一の入口であり、ただ外すと
 *    **画面は在るのに誰も開けない**（`tests/static/nav-reach.test.ts` 冒頭の「最悪の壊れ方」）。
 *    とくに `提案依頼` は取引先（1 日 4〜5 時間の主利用者。`CLAUDE.md` §1.2）の返答期限の
 *    入口であり、ここが消えると**期限に気づけない**。
 * 🔴 **到達集合・ロール条件は 1 つも変えていない**（置き場所だけが帯 → サイドバーに移った。
 *    `nav-reach.test.ts` ① が機械的に固定する）。
 * ⚠️ 置き場所は**人間の判断事項**として [Issue #114] に既定つきで起票した（既定 = サイドバー）。
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
      // 🔴 1 枚だけ（上の 🔴）。`navSectionsWithTabs` がこのセクションを帯から外す。
      items: [
        link('projects', 'shell.section.projects.list', 'briefcase', PROJECT_SECTION_PATH), // S-010
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
// サイドバー（上段 4 項目 + `その他` 2 項目。2026-10-03 は 6 項目のフラットだった）
// ============================================================================

/**
 * サイドバー（グローバルナビ）の項目。
 *
 * ✅ **2026-10-13（人間の指示 + モックアップ）: 2 群になった。**
 *    上段（群名なし）: ホーム → チャット → 人材管理 → 案件管理
 *    下段（`その他`。上に罫線）: お知らせ（Phase 2）→ 設定
 *
 * ✅ **2026-10-14（人間の明示指示）: 3 群になり、`自社` と `パートナー` を語で分けた。**
 *
 * | 群 | 項目 | 所属 |
 * |---|---|---|
 * | 上段（群名なし） | ホーム → チャット → **カレンダー** → **自社案件管理** → **自社人材管理** | 両方 |
 * | **`パートナー連携`**（罫線） | パートナー一覧 / 案件一覧 / 人材一覧 | 🔴 **ホストだけ** |
 * | `その他`（罫線） | お知らせ（Phase 2）→ 設定 | 両方 |
 *
 * 🔴 **`カレンダー` と `パートナー連携` の 3 画面は準備中**（押せて、開いて、「準備中」と書いてある）。
 *    **`Phase N` の押せない項目とは別物である**（ファイル冒頭の 🔴）。
 * 🔴 **取引先には `パートナー連携` 群を出さない**（下の 🔴。§3.1 のパートナー相互参照の禁止）。
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
  const settings = link(
    'settings',
    context.audience === 'HOST' ? 'shell.nav.host.settings' : 'shell.nav.partner.settings',
    'settings',
    SETTINGS_INDEX_PATH,
    null,
    // 🔴 索引の 7 項目のうち `/audit-logs` / `/skills` は `/settings` 配下に無い URL である
    //    （前方一致では光らない）。索引の表から引いて射程に入れる。
    navHrefs(buildSettingsIndex(context)),
  );
  return [
    {
      id: 'primary',
      labelKey: null,
      items: [
        link('home', 'shell.nav.home', 'home', '/'),
        // S-031 チャット。🔴 件数バッジを出さない（未読の実体が無い。ファイル冒頭の 🔴）。
        //    ✅ 2026-10-05: 画面（`app/(main)/chat/page.tsx`）と API（`/api/threads`）が実装されたので
        //    `pending` → `link` にした。🔴 **第 2 階層を持たせない**（スレッドの選択は `?thread=` の
        //    クエリであり、別の URL への遷移ではない = タブにできる遷移先が無い）。
        link('chat', 'shell.nav.chat', 'message-square', CHAT_SECTION_PATH),
        // ✅ 2026-10-14（人間の指示「チャットの下にカレンダーも入れる」）。準備中の画面である
        //    （上の `CALENDAR_SECTION_PATH` の 🔴）。所属で出し分けない —— 予定（面談 / 契約満了 /
        //    稼働開始）はどちらの側にも在る面であり、**見える中身を決めるのは RLS** である。
        link('calendar', 'shell.nav.calendar', 'calendar-clock', CALENDAR_SECTION_PATH),
        link(
          'projects',
          context.audience === 'HOST' ? 'shell.nav.host.projects' : 'shell.nav.partner.projects',
          'briefcase',
          PROJECT_SECTION_PATH,
          null,
          sectionPathsOf('projects'),
        ),
        // ✅ **2026-10-15（人間の明示指示「案件一覧、提案、提案依頼のタブは不要です」）: 第 2 階層の
        //    タブから、サイドバーの項目に戻した 2 つ**（`buildNavSections` の 🔴🔴）。
        // 🔴 **到達集合もロール条件も 1 つも変わっていない。** 畳み込み（2026-10-03）以前も
        //    この 2 つはサイドバーの項目であり、置き場所が 2 往復しただけである。
        // 🔴 **並びは業務ループ（`CLAUDE.md` §1.3）のまま**: 案件 → 提案 → 提案依頼。
        link('proposals', 'shell.nav.proposals', 'send', '/proposals'), // S-019
        link(
          'proposal-requests',
          'shell.nav.proposalRequests',
          'inbox',
          '/proposal-requests', // S-017
          // 🔴 S-017 の返答期限（docs/04 §3.1 の取引先列）。**期限はその画面の項目が持つ**
          //    （タブへ畳んでいた間だけ、親の `案件管理` が預かっていた。`NavContext` の 🔴）。
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
        ),
        // ✅ **2026-10-14（人間の指示「案件管理は人材管理の上に配置する」）: `案件` が `人材` の上。**
        // 🔴 **到達集合も射程も 1 つも変わっていない**（並び替えただけである）。
        // ⚠️ 畳み込み以降ここは `人材` → `案件` だった（`docs/04` §3.1 の表の順）。人間の明示指示が
        //    表の順より優先する判断であり、設計書の追随は別途行う（`CLAUDE.md` §8.7）。
        link(
          'engineers',
          context.audience === 'HOST' ? 'shell.nav.host.engineers' : 'shell.nav.partner.engineers',
          'users',
          ENGINEER_SECTION_PATH,
          null,
          sectionPathsOf('engineers'),
        ),
        // 🔴 S-034 レポート（Phase 3）は**サイドバーに出さない**（2026-10-04。人間の指示
        //    「サイドメニューのレポートは非表示にして」）。実体が Phase 3 まで無く、押しても
        //    何も無い項目を常設しない —— `chat` と違い、`レポート` は**その語だけでは何が
        //    できるようになるのかが利用者に伝わらない**（`docs/04` §4.7 の `S-034` は
        //    「提案 → 面談 → 決定の転換率」であり、ナビの 1 語からは読み取れない）。
        //    🔴 **文言キー（`shell.nav.host.reports` / `shell.nav.partner.reports`）は
        //    消していない**（`U-22` の凍結。Phase 3 で戻すときに同じ語を使う）。
        //    予告の置き場所は `Q-04-8`（既定 = `S-047` 設定の索引）。
      ],
    },
    // ✅ **2026-10-13（人間の指示 + モックアップ）: `お知らせ` と `設定` を下段の `その他` 群に
    //    分け、上に罫線を引く。**
    // 🔴 **上段（`primary`）は「毎日使うもの」だけ**になった —— ホーム / チャット / 人材管理 /
    //    案件管理。設定とお知らせは**頻度が違う**ので、同じ列に混ぜると走査のたびに読み飛ばす
    //    対象が増える。
    // 🔴 **`お知らせ` はリンクにしない。** `Notification`（`F-039` / `S-032`）は **Phase 2** で
    //    あり画面が無い（`pendingNavItem` = `<span>` + 無彩色の `Phase 2` Badge）。
    //    🔴 **未読の件数バッジ（モックアップの赤い `3`）は出さない** —— `Message` にも
    //    `Notification` にも**既読の列が無く、未読という状態が存在しない**。架空の数を描くと
    //    「見たのに消えない」になる（`docs/04` §3.1 の ③ / `app-shell.tsx` 冒頭の 🔴 と同じ判断）。
    // ⚠️ **モックアップの `ヘルプ` は置いていない** —— 中身（「この画面でできること / できない
    //    こと」）の出所が 1 つも無く、押して何も出ない項目は §3.1 の ③ が禁じた「動かない検索窓」
    //    と同じものになる（46 画面ぶんの説明が要るので別タスク）。
    // ========================================================================
    // ✅ 2026-10-14（人間の明示指示）: `パートナー連携` 群（`その他` と同じ位置づけ = 罫線つき）
    // ========================================================================
    // 🔴 **ホスト所属にだけ出す。** 取引先所属に出すと、`パートナー一覧` は**他社の一覧**、
    //    `人材一覧` は**他社のエンジニアの一覧**になる ——
    //    `CLAUDE.md` §3.1「🔴 パートナー同士が相互に参照できる経路を 1 つも作らない。同一案件に
    //    複数社が提案していても、他社の提案の存在・件数・単価・エンジニア名を知れてはならない」
    //    の正面からの違反である。**中身が準備中であることは理由にならない** —— 項目を置いた
    //    時点で「他社の一覧が在る」こと自体を示してしまう（存在・件数の示唆。§3.1 / `F-004 AC-4`）。
    // 🔴 **出し分けの軸は所属（`audience`）であってロール名ではない**（`memberships` の CHECK と
    //    1 対 1。このファイルの他の判定と同じ）。
    // 🔴 **3 画面はまだ中身を持たない。** 実装に入るときは、何を出すかが情報境界そのものである:
    //      - `パートナー一覧` … `S-014`（取引先企業）と同じ母集団。統合は Issue #102（既定 = A）
    //      - `案件一覧` … 🔴 **取引先が持ち込んだ案件**を指すなら、越境 5 経路のどれでもない
    //        （経路 1 は「ホストの案件を取引先に見せる」向きである）。**新しい経路を作ることに
    //        なるため人間の承認事項**（`CLAUDE.md` §8.6）。Issue #102 の既定 = B（経路 2 の
    //        `Proposal` に紐づく案件だけを出す = 既存の経路の中に収める）
    //      - `人材一覧` … 🔴 **経路 4（匿名共有）そのもの**である。出してよいのは匿名 5 項目だけで、
    //        実名・所属会社名・スキルシートは `Proposal` の作成まで出ない。**項目を増やすのは
    //        人間の承認事項**（§8.6）
    //    ⚠️ ここに置いてあるのは**到達手段だけ**であり、読み取り経路は 1 本も足していない。
    // 🔴 **群ごと出さない**（空の群を置かない）。見出しと罫線だけが残ると、取引先の画面に
    //    「中身が見えないパートナー連携という領域が在る」ことを示してしまう（§3.1 の示唆の禁止）。
    ...(context.audience === 'HOST'
      ? [
          {
            id: 'partners',
            labelKey: 'shell.nav.group.partners' as const,
            divided: true,
            items: [
              link(
                'partners-companies',
                'shell.nav.partners.companies',
                'building-2',
                PARTNER_COMPANIES_SECTION_PATH,
              ),
              link(
                'partners-projects',
                'shell.nav.partners.projects',
                'handshake',
                PARTNER_PROJECTS_SECTION_PATH,
              ),
              link(
                'partners-engineers',
                'shell.nav.partners.engineers',
                'user-search',
                PARTNER_ENGINEERS_SECTION_PATH,
              ),
            ],
          },
        ]
      : []),
    {
      id: 'other',
      labelKey: 'shell.nav.group.other',
      divided: true,
      items: [
        pendingNavItem('notifications', 'shell.nav.notifications', 'bell', 'shell.nav.note.phase2'),
        settings,
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
    // ✅ **2026-10-14: サイドバーと同じ順にした**（`案件` が `人材` の上 = 手前）。
    // 🔴 **同じ項目がデバイスで別の順に並ぶと、迷ったときにデスクトップの記憶が使えない**
    //    （このブロックの 🔴「同じアイコンを使う」と同じ理由）。
    link('projects', 'shell.tab.projects', 'briefcase', PROJECT_SECTION_PATH),
    link('engineers', 'shell.tab.engineers', 'users', ENGINEER_SECTION_PATH),
    link('chat', 'shell.tab.chat', 'message-square', CHAT_SECTION_PATH),
    // ⚠️ **`カレンダー` と `パートナー連携` の 3 項目はボトムタブに出さない。** 手前に出せるのは
    //    4 つまでであり（5 つ目は「その他」）、**到達性は落ちない** —— 「その他」は
    //    `buildMainNav` の項目をそのまま並べるので、そこから開ける。
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
