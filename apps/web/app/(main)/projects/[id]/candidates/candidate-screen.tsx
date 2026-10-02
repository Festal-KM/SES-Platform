'use client';

// apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx
// `S-016` 候補検索とマッチング候補（案件起点）— 本体（docs/04 §S-016 / `F-009` / `F-017` / docs/05 §6.5 #30）。
// T-08-05。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-016 / `F-017` / `CLAUDE.md` §3.1 経路 4）
// ============================================================================
//   ① 🔴 **匿名候補の行に、実名・所属会社名・社内 ID・営業メモ・スキルシート・経歴・稼働状況を出す欄が無い。**
//      行の型（`AnonymousCandidateRowView`）にそのフィールドが**存在しない**ので、描く枝が書けない。
//      表示名の列は「共有候補」の一語だけ（`messages.kindAnonymous`）。
//   ② 🔴 **スコア・順位・重みに相当する表示項目を持たない**（`F-017 AC-7` / `F-009 AC-2`。Phase 1）。
//      並び順の説明を 1 行で常時出す。**重み設定への導線も置かない**（`F-030 AC-4`。`S-040` は Phase 2）。
//   ③ 🔴 **匿名候補の件数を別に出さない**（`docs/04` §S-016 空状態）。母集団の明示は混在した総件数だけ。
//   ④ 🔴 **匿名候補に単価の交渉・見積・確定単価の入力欄が無い**（`F-017 AC-4` / `BR-58`）。表示はレンジのみ。
//      🔴 T-08-06 で置いた提案依頼フォームの入力も**メッセージと期限の 2 つだけ**であり、単価に関する欄が無い。
//   ⑤ 🔴 **提案依頼の導線（T-08-06）**: 共有候補の右パネルに「提案依頼を送る」を置き、押すと右パネルが
//      フォームに切り替わる（**モーダルにしない** —— 5 項目を見ながら書く。`docs/04` §S-016「操作と結果」）。
//      導線はホストの発行ロール × テナントが実行可のときだけ描く（`VIEWER` / `SUSPENDED` / `CLOSING` には
//      無い。`docs/04` §S-016 権限差分）。⚠️ これは UI の配慮であり、拒否の本体は `#31` の 3 本のガードである。
//      ✅ T-09-01: 自社候補の右パネルに「提案を作成」（`S-020` へ）を置いた（`proposalCreateHref`）。導線は
//      `PROPOSAL_EDITOR_ROLES`（#36 と同じ定数）× テナントが実行可のときだけ描く。
//
// 🔴 **T2（モバイル閲覧可）**（docs/04 §S-016 デバイス別 / `CLAUDE.md` §13.3）。列は間引くが遮断しない。
//    ブレークポイントは Tailwind の既定のみ:
//      - モバイル（< sm） … 種別（ホストのみ）/ スキル（**2 件目まで**）/ 単価レンジ / 稼働可能時期
//      - タブレット（sm 〜 lg） … + 表示名 / 経験年数
//      - デスクトップ（lg 〜） … + 勤務地・リモート / 更新日（8 列）。
//    🔴 5 項目はモバイルでも**右パネルで全部読める**（判断材料を隠さない）。
//
// ============================================================================
// 🔴 デスクトップの列幅配分と右パネル（T-11-12。`docs/04` §S-016「デスクトップの列幅配分」/ §11-14）
// ============================================================================
//   - **`lg` 以上は `table-layout: fixed`**。固定列の幅を `<th>` で先に決め（種別 / 表示名 10rem / 経験年数 /
//     単価レンジ / 稼働可能時期 / 勤務地・リモート / 更新日 = 最長ラベル）、**残りをスキル列だけ**が吸収する
//     （`CANDIDATE_COLUMN_WIDTH`）。🔴 **更新日は最右列だが幅を先に確保する**（Phase 1 の並び順のキー。
//     `T-08-09` のスクリーンショットでは右パネルに押し出されて読めなかった）。列を削らない（8 列は §S-016 の定め）。
//   - **表の最小幅（`CANDIDATE_TABLE_CLASSES`）** = 固定 7 列の和 + スキル列の下限（1 件 + `+N`）= 61.5rem。
//     🔴 **1 列目の grid の下限はこれ + `Table` の器の枠 2px = 61.625rem** である（✅ 2026-10-03。下の JSX の 🔴）。
//     これより狭い器では表が器の内側で横にスクロールする（`Table` の `overflow-x-auto`）。セルは
//     `padding="compact"`（`px-2`）—— `px-3` では 8 列が `lg` の幅に収まらない（実測: T-11-12）。
//     ⚠️ **`T-11-12` 当時の「`lg` 以上ではスクロールしない」は、共通外枠（`T-22-05` のサイドバー 56 / 224px）が
//        入る前の実測である。** 現在の実測は下の JSX の 🔴 の表にある（`T-22-07`）。
//   - **スキル列は 1 行固定**（行の高さを揃える。スキルが 1 件でも 8 件でも行の高さが変わらない = 「経歴の量」を
//     6 つ目の開示項目にしない。§10.3 画面固有）。描く件数は上位 3 + `+N` を上限とし、**幅が足りなければ
//     件数を減らす（下限 1 件 + `+N`）**。件数は `SkillBadges` が実測（`ResizeObserver`）→ `fitSkillBadges`
//     （純粋関数）で決め、`+N` は隠した分を含めて描き直す。
//     🔴 **`T-22-07` で 1 行固定を全ブレークポイントへ広げた**（旧実装は `lg:` だけで、`sm`〜`lg` では
//     折り返して**行の高さが件数で変わっていた**）。詳細は `SkillBadges` の 🔴。
//   - **右パネル**: `xl` 以上は並置（grid の 2 列目。🔴 **競合したら譲るのはパネル** —— 1 列目の下限を表の最小幅に
//     し、パネルの幅は `PAGE_BODY_ASIDE_WIDTH_CLASSES`〔`lg` 360 / `xl` 400 / `2xl` 480px。`docs/04` §7.1 の
//     幅クラス B。`T-22-07` で画面独自の `20rem` / `lg:w-80` から移した〕）。
//     **`lg` 以上 `xl` 未満は並置すると 8 列が成立しない**ので、パネルは
//     テーブルに重なる**ドロワー**（行を選ぶと右端に出る。「閉じる」を明示的に置く。閉じれば 8 列に戻る）。
//     `lg` 未満は従来どおり一覧の下。**列を削ってパネルを並置する形は採らない**（§S-016 デバイス別）。
//     🔴 **このパネルは幅クラス B の副カラムであり `Drawer` プリミティブではない**（`docs/04` §11-25 の
//     **例外 1 件**）。したがって §5-13 の「`Drawer` に実行系のアクションを置かない」の対象外であり、
//     **パネル内で `ProposalRequest` の発行まで完結する**（判断材料が `U-06` の 5 項目で閉じており、
//     その**全量**がパネル内に在るから許される）。🔴 **`Drawer` に置き換えてはならない。**
//
// ============================================================================
// 🔴 SP-22 `T-22-07`（一覧の適用 ②）で変えたもの / 変えていないもの
// ============================================================================
// | 変えたもの | 一次資料 | 変えていないもの |
// |---|---|---|
// | 実色 → semantic トークン / `text-sm`→`--text-body` / `text-base`→`--text-lg`（実寸同じ） | `docs/04` §7.9 / 検査 (a)(g) | 🔴 **8 列の集合・並び・幅・間引きの境界**（`CANDIDATE_COLUMN_WIDTH` / `padding='compact'`） |
// | primary リンク → `PRIMARY_LINK_CLASSES`（画面の `hover:` を撤去） | §7.4 / §7.10 / 検査 (j) | 🔴 **匿名候補の行・パネルに出す項目**（`U-06` の 5 項目。型に無いものは描けない） |
// | 母集団 + 検索の帯 → `Toolbar` / 空状態 → `EmptyState` / ページ送り → `Pagination` | §5-13 / §10.4 | 🔴 **母集団は混在した総件数の 1 行だけ**（共有候補の件数を別に出さない） |
// | パネルの幅 → `PAGE_BODY_ASIDE_WIDTH_CLASSES`（360 / 400 / 480px） | §7.1 の幅クラス B | 🔴 **行の選択で右パネルが切り替わる**（遷移ではない）。**testid** は削除・改名 0 件 |
// | スキル列の 1 行固定を全ブレークポイントへ | §10.3 画面固有 `S-016` | 🔴 **上位 3 + `+N`** の上限と `fitSkillBadges` の算術 |
// | 幅 → `PageBody widthClass="split"`（`page.tsx`。旧 `max-w-[96rem]` を撤去） | §7.1 / `U-23` / 検査 (c)(k) | 🔴 **`xl:overflow-x-auto`（暫定）は残る** —— 理由と実測は下の JSX の 🔴 |
//
// 🔴 **`@ses/ui` の `DataTable` には移していない。** 本画面の行は `role="button"` / `onClick` / `onKeyDown` /
//    `aria-selected` を持つ**選択の対象**であり（行クリックで右パネルが切り替わる）、`docs/05` §2.3.5 の
//    `DataTableProps` には行の**選択**（遷移ではない）を通す口が無い（`rowAttributes` は `className` と
//    `data-*` だけ）。加えて 8 列は `padding='compact'`（`px-2`）+ `lg:table-fixed` + 列ごとの `lg:w-*`
//    という `T-11-12` の実測値に依っており、器の `minWidth` + `grow` へ移すと **1440 で表が器の内側で
//    横スクロールし、E2E の `containerOverflow ≤ 1` が壊れる**。口を開けるのは §2.3.5 の改訂であり
//    実装側で決めない（`CLAUDE.md` §8.7）。完了記録で提起する。
//    ⚠️ 表そのものは `@ses/ui` の `Table` プリミティブであり、ローカルの `<table>` ではない。
//   - 表示名は `docs/04` §10.3 の名称規約（`@ses/ui` の `NameCell`）: 自社候補は `lg` 以上 = 切り詰め + `title` +
//     同じ行に `S-006` への導線、`lg` 未満 = 折り返し。**匿名候補は「共有候補」の一語で、リンクを持たない**
//     （`href={null}`。E2E ③「匿名候補の行にリンクが無い」）。
//    🔴 **提案依頼の送信はモバイルでも可能**（`docs/04` §S-016 デバイス別「時間勝負のため」）。フォームは
//       右パネル（モバイルでは一覧の下）にあり、省略しない。一括依頼は存在しない（1 候補ずつ）。
//
// 🔴 `'use client'` は右パネル（行の選択・依頼フォーム）のためだけである。**`@ses/db` に依存するモジュールから
//    値を import しない**（`tests/static/client-db-boundary.test.ts`）。行の表示値は `lib/candidates/list-rows.ts`
//    がサーバ側で組み立て、ここは型だけを読む。依頼フォームが値 import するのは `lib/proposal-requests/expiry.ts` /
//    `limits.ts`（外部 import を持たない純粋モジュール）だけである。
// 🔴 検索は同期の `<form method="get">`（`S-005` と同じ。実行した検索がそのまま URL になる）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  EmptyState,
  Field,
  Input,
  NameCell,
  PAGE_BODY_ASIDE_WIDTH_CLASSES,
  PRIMARY_LINK_CLASSES,
  Pagination,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toolbar,
  type PaginationLinkProps,
} from '@ses/ui';
import { FILTER_ACTIONS_CLASSES, FILTER_FORM_CLASSES } from '../../../_shared/filter-form-classes';
import type { CandidateRowView } from '../../../../../lib/candidates/list-rows';
import { fitSkillBadges } from '../../../../../lib/candidates/skill-fit';
import type { EngineerActiveFilterView } from '../../../../../lib/engineers/list-rows';
import type { EngineerFilterOption, EngineerListFilterValues } from '../../../engineers/engineer-ledger-screen';
import type { ProjectDetailRow, ProjectRequirementRow } from '../../../../../lib/projects/detail';
import { expiresAtIsoFromJstDate } from '../../../../../lib/proposal-requests/expiry';
import { PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH } from '../../../../../lib/proposal-requests/limits';
import { proposalCreateHref } from '../../../../../lib/proposals/hrefs';

export type CandidateScreenMessages = {
  readonly lead: string;
  readonly sectionProject: string;
  readonly sectionDetail: string;
  readonly projectOpen: string;
  readonly requirementHeadingMust: string;
  readonly requirementHeadingNice: string;
  readonly requirementEmptyMust: string;
  readonly requirementEmptyNice: string;
  readonly requirementColumnRequirement: string;
  readonly requirementColumnYears: string;
  readonly populationLabel: string;
  readonly orderNote: string;
  /** 🔴 共有候補への条件の効き方（ホストだけに出す。取引先には共有候補が無い）。`null` なら出さない。 */
  readonly anonymousFilterNote: string | null;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchSkills: string;
  readonly searchSkillsHint: string;
  readonly searchSkillMode: string;
  readonly searchYearsMin: string;
  readonly searchPriceMin: string;
  readonly searchPriceMax: string;
  readonly searchAvailableBy: string;
  readonly searchPrefecture: string;
  readonly searchRemote: string;
  readonly searchAvailability: string;
  readonly searchOnlyInTime: string;
  readonly searchOnlyCommutable: string;
  readonly searchCheckboxNote: string;
  readonly searchSubmit: string;
  readonly searchReset: string;
  readonly activeFiltersTitle: string;
  readonly removeFilterSuffix: string;
  readonly columnKind: string;
  readonly columnName: string;
  readonly columnSkills: string;
  readonly columnYears: string;
  readonly columnUnitPrice: string;
  readonly columnAvailability: string;
  readonly columnLocation: string;
  readonly columnUpdatedOn: string;
  readonly kindOwn: string;
  readonly kindAnonymous: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  /** 初回空のときだけ `S-007` への導線（絞込 0 件では `null`）。 */
  readonly emptyRegister: string | null;
  readonly emptyCheckboxNotice: string | null;
  readonly detailSelect: string;
  /** ✅ T-11-12: `lg` 以上 `xl` 未満のドロワーを閉じる（他のブレークポイントでは描かない）。 */
  readonly detailClose: string;
  readonly detailOpenEngineer: string;
  /** ✅ T-09-01: 自社候補の「提案を作成」（`S-020` へ）。 */
  readonly detailCreateProposal: string;
  readonly detailAnonymousNote: string;
  /** 提案依頼フォーム（`docs/04` §S-016「匿名候補で『提案依頼を送る』」/ #31）。 */
  readonly requestOpen: string;
  readonly requestTitle: string;
  readonly requestLead: string;
  readonly requestMessageLabel: string;
  readonly requestMessageHint: string;
  readonly requestExpiresAtLabel: string;
  readonly requestExpiresAtHint: string;
  readonly requestSubmit: string;
  readonly requestSubmitting: string;
  readonly requestCancel: string;
  readonly requestSent: string;
  readonly requestOpenList: string;
  readonly requestErrorNotFound: string;
  readonly requestErrorExpiresAt: string;
  readonly requestErrorCommerce: string;
  readonly requestErrorAlreadyExists: string;
  readonly requestErrorGeneric: string;
  readonly fieldSkills: string;
  readonly fieldYears: string;
  readonly fieldPrice: string;
  readonly fieldAvailability: string;
  readonly fieldLocation: string;
  readonly fieldUpdatedOn: string;
  readonly fieldAvailabilityStatus: string;
  readonly valueNone: string;
  readonly nextPage: string;
  readonly firstPage: string;
};

export type CandidateScreenProps = {
  readonly projectId: string;
  readonly projectName: string;
  readonly headlineRows: readonly ProjectDetailRow[];
  readonly conditionRows: readonly ProjectDetailRow[];
  readonly mustRows: readonly ProjectRequirementRow[];
  readonly niceRows: readonly ProjectRequirementRow[];
  readonly rows: readonly CandidateRowView[];
  readonly filters: EngineerListFilterValues;
  readonly skillOptions: readonly EngineerFilterOption[];
  readonly skillModeOptions: readonly EngineerFilterOption[];
  readonly prefectureOptions: readonly EngineerFilterOption[];
  readonly remoteOptions: readonly EngineerFilterOption[];
  readonly availabilityOptions: readonly EngineerFilterOption[];
  readonly activeFilters: readonly EngineerActiveFilterView[];
  /**
   * 🔴 取引先には種別列そのものを出さない（`docs/04` §S-016 権限差分。全件が自社であり、列があると
   *    「共有候補という区分が存在する」ことを匂わせる）。判定の出所は `ctx.partnerCompanyId`。
   */
  readonly showKindColumn: boolean;
  /** 「案件の要件に戻す」（素の URL）。 */
  readonly resetHref: string;
  readonly registerHref: string;
  readonly nextPageHref: string | null;
  readonly firstPageHref: string | null;
  /** 提案依頼の導線（T-08-06）。 */
  readonly request: CandidateRequestProps;
  /** 提案の作成（`S-020`）への導線（T-09-01）。 */
  readonly proposal: CandidateProposalProps;
  readonly messages: CandidateScreenMessages;
};

/**
 * 提案依頼フォームの props（`docs/04` §S-016 権限差分 / `F-004 AC-7` / `F-017 AC-4`）。
 * 🔴 `canRequest` の出所は ctx のロール（`PROPOSAL_REQUEST_ISSUER_ROLES`）× テナントの実行可否であり、
 *    画面は判定を持たない。`false` のときは導線そのものを描かず、`unavailableMessage` があればそれだけ出す。
 */
export type CandidateRequestProps = {
  readonly canRequest: boolean;
  /** 導線が無い理由（`VIEWER` / 停止中）。取引先には出さない（`null`）。 */
  readonly unavailableMessage: string | null;
  /** 返答期限の初期値・下限・上限（JST 暦日 `YYYY-MM-DD`。`lib/proposal-requests/expiry.ts`）。 */
  readonly expiry: { readonly defaultDay: string; readonly minDay: string; readonly maxDay: string };
  /** `S-017` への導線。 */
  readonly listHref: string;
  /** 一覧の上に `S-017` への導線を出すか（ホストのみ。取引先は `S-004` から入る。`docs/04` §S-017 関連画面）。 */
  readonly showListLink: boolean;
};

/** モバイルで間引く列（判断材料は右パネルで全部読める）。 */
const TABLET_UP = 'hidden sm:table-cell';
const DESKTOP_ONLY = 'hidden lg:table-cell';
/** スキル列の 3 件目以降と `+N` はモバイルで隠す（`docs/04` §S-016「モバイル = スキル 2 件」）。 */
const MOBILE_SKILL_LIMIT = 2;

/**
 * 🔴 `lg` 以上の列幅（`table-layout: fixed`。ファイル冒頭「デスクトップの列幅配分」）。値は最長ラベル + `px-2` × 2
 *    （T-11-12 の実測: 「共有候補」56px / 「10 年以上」61px / 「600,000〜750,000 円」129〜142px / 「稼働可能時期」84px /
 *    「鹿児島県・一部リモート可」144〜168px / 「2026-09-15」72〜80px。幅の広い Linux フォントを上限に取る）。
 *    表示名は下限 10rem（`docs/04` §10.3）をそのまま幅にする。**スキル列にだけ幅を書かない**（残りを吸収する）。
 *    🔴 `lg:` 未満では効かない（`table-layout: auto` のまま。列の間引きと折り返しは従来どおり）。
 */
const CANDIDATE_COLUMN_WIDTH = {
  kind: 'lg:w-18',
  name: 'lg:w-40',
  years: 'lg:w-20',
  unitPrice: 'lg:w-40',
  availability: 'lg:w-26',
  location: 'lg:w-46',
  updatedOn: 'lg:w-24',
} as const;
/**
 * 🔴 表の最小幅 = 固定 7 列の和（4.5 + 10 + 5 + 10 + 6.5 + 11.5 + 6 = 53.5rem）+ スキル列の下限（1 件 + `+N` ≈ 8rem）。
 *    `lg`（1024px）の器（992px = 62rem）に収まる。これ未満の器では表が器の内側で横にスクロールする。
 */
const CANDIDATE_TABLE_CLASSES = 'lg:table-fixed lg:min-w-[61.5rem]';
/** `+N` の幅の見込み（まだ描かれていないときの推定値。実測できたら実測値を使う）。 */
const MORE_WIDTH_FALLBACK_PX = 40;

/**
 * スキル列（1 行固定。ファイル冒頭「デスクトップの列幅配分」）。
 * 🔴 描く件数は **CSS が決めた描き方に JS が追随する**形で決める: 器の `flex-wrap` が `nowrap`
 *    （= 1 行固定。`T-22-07` で**どのブレークポイントでもそうなった**）のとき、器の幅とバッジの実測幅から
 *    `fitSkillBadges` で件数を決め、`+N` を隠した分を含めて描き直す。`wrap` のときは全件を描く
 *    （折り返しは CSS が決める）。**ブレークポイントを JS に重複して持たない**（この分岐はそのまま残す ——
 *    器の描き方が変わったら JS が追随する形を崩さない）。
 * 🔴 バッジの幅は**全件が描かれている間に 1 度だけ**測って保持する（隠した後は測れない。スキル名は行ごとに不変）。
 * 🔴 サーバ描画（初期 HTML）は上位 3 件 + `+N` のまま（測れないため）。マウント後に幅が足りなければ減る。
 */
function SkillBadges({
  skills,
  skillCount,
  valueNone,
  rowKey,
}: {
  readonly skills: readonly string[];
  readonly skillCount: number;
  readonly valueNone: string;
  readonly rowKey: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const widthsRef = useRef<{ readonly badges: readonly number[]; more: number | null } | null>(null);
  const [shown, setShown] = useState(skills.length);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null || skills.length === 0 || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const style = getComputedStyle(box);
      if (style.flexWrap !== 'nowrap') {
        setShown(skills.length);
        return;
      }
      const moreElement = box.querySelector<HTMLElement>('[data-skill-more]');
      const moreWidth = moreElement === null ? 0 : moreElement.getBoundingClientRect().width;
      if (widthsRef.current === null) {
        const badges = Array.from(box.querySelectorAll<HTMLElement>('[data-skill-badge]')).map(
          (element) => element.getBoundingClientRect().width,
        );
        // 隠したバッジ（幅 0）が混ざっているなら、この描画では測れない（次の描画で測る）。
        if (badges.length !== skills.length || badges.some((width) => width === 0)) return;
        widthsRef.current = { badges, more: moreWidth > 0 ? moreWidth : null };
      } else if (moreWidth > 0 && widthsRef.current.more === null) {
        widthsRef.current = { ...widthsRef.current, more: moreWidth };
      }
      const fit = fitSkillBadges({
        available: box.clientWidth,
        badgeWidths: widthsRef.current.badges,
        moreWidth: widthsRef.current.more ?? MORE_WIDTH_FALLBACK_PX,
        gap: Number.parseFloat(style.columnGap) || 0,
        total: skillCount,
      });
      setShown(fit.shown);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
    // 🔴 `shown` を依存に入れない —— 減らした後の描画で測り直すと隠したバッジの幅が 0 になる。
  }, [skills.length, skillCount]);

  if (skills.length === 0) return <>{valueNone}</>;
  const hidden = Math.max(skillCount - shown, 0);
  return (
    // ========================================================================
    // 🔴 スキル列は**どのブレークポイントでも 1 行固定**である（`flex-nowrap` + `overflow-hidden`）
    // ========================================================================
    // 🔴 `docs/04` §10.3 画面固有 `S-016`: **「スキルが 1 件だけの候補と 8 件の候補で行の高さが変わらない」。**
    //    行の高さが候補によって変わると、それ自体が「その候補が何をどれだけ持っているか」という
    //    **開示項目の増加**になる（同節の「経験内容は 0 行でも 100 行でも見え方が変わらない」と同じ規律）。
    // ⚠️ **`T-22-07` で `lg:flex-nowrap lg:overflow-hidden` → `flex-nowrap overflow-hidden` にした。**
    //    旧実装は `lg` 以上でだけ 1 行固定で、`sm`〜`lg`（タブレット）ではバッジが折り返して
    //    **行の高さが件数で変わっていた**（条文は幅を限定していない）。`lg` 未満でも同じ不変条件にする。
    // ⚠️ 溢れの扱いは変わらない: `SkillBadges` が器の幅を実測して描く件数を減らし（`fitSkillBadges`）、
    //    隠した分は `+N` に載る。器の祖先（`Table` の `overflow-x-auto`）があるので、
    //    E2E の `unreachable-overflow`（到達できない溢れ）にはならない。
    <span ref={boxRef} className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {skills.map((skill, index) =>
        // 🔴 3 件目以降はモバイルで隠す。`Badge` 自身の `inline-flex` と display を競わせないよう、外側の
        //    `<span>` で包んで隠す（`cn` は単純な連結であり、後勝ちの解決をしない）。
        //    `lg` 以上で幅に収まらない分（`index >= shown`）も同じ外側の `<span>` で隠す。
        <span
          key={skill}
          className={index >= shown ? 'hidden' : index >= MOBILE_SKILL_LIMIT ? 'hidden sm:inline' : undefined}
          data-skill-badge=""
        >
          <Badge variant="outline">{skill}</Badge>
        </span>,
      )}
      {hidden === 0 ? null : (
        <span
          className="hidden shrink-0 px-1 text-xs text-fg-muted sm:inline"
          data-skill-more=""
          data-testid={`candidate-list-more-skills-${rowKey}`}
        >
          {`+${String(hidden)}`}
        </span>
      )}
    </span>
  );
}

/**
 * ページ送りのリンク（`@ses/ui` の `Pagination` に `next/link` を渡す）。
 *
 * 🔴 **凍結済み testid の維持**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④「旧キーの併記」）:
 *    `Pagination` は `candidate-list-pagination-prev` / `…-next` を出すが、2026-09-30 に凍結された値は
 *    **`candidate-list-first`（最初のページに戻る）/ `candidate-list-next`（次のページ）**である。
 *    **同じ 2 本のリンクに、同じ意味のまま**付け直している（改名ではない —— 凍結値を DOM に残す）。
 * ⚠️ 三項で書くのは、静的抽出器（`tests/static/support/testid-extract.ts`）が**枝のリテラル**を
 *    拾って凍結を検査できる形にするためである（`S-005` の `EngineerPagingLink` と同じ作法）。
 */
function CandidatePagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId === undefined || testId.endsWith('-prev') ? 'candidate-list-first' : 'candidate-list-next'}
    >
      {children}
    </Link>
  );
}

function RequirementTable({
  heading,
  empty,
  rows,
  columnRequirement,
  columnYears,
}: {
  readonly heading: string;
  readonly empty: string;
  readonly rows: readonly ProjectRequirementRow[];
  readonly columnRequirement: string;
  readonly columnYears: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-body font-semibold text-fg">{heading}</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-body text-fg-muted">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{columnRequirement}</TableHead>
              <TableHead>{columnYears}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell whitespace="normal">{row.requirement}</TableCell>
                <TableCell>{row.years}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * 右パネルの 1 行。🔴 `data-testid` は識別子で組み立てない（`tests/static/testid-inventory.test.ts` が凍結できない
 * 形を許さない）。行の識別は親の `data-testid`（`candidate-detail-own` / `candidate-detail-anonymous`）と
 * `data-field`（項目名）の組で行う。
 */
function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="w-28 shrink-0 text-fg-muted">{label}</dt>
      <dd className="m-0 text-fg" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

/** 依頼フォームの状態。🔴 **1 度に 1 候補**（一括依頼が存在しないことの表れでもある）。 */
type RequestPhase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'EDITING' }
  | { readonly kind: 'SUBMITTING' }
  | { readonly kind: 'SENT' };

type AnonymousCandidateRow = Extract<CandidateRowView, { readonly kind: 'ANONYMOUS' }>;

/**
 * 共有候補の右パネル（`docs/04` §S-016 セクション 6 / 「匿名候補で『提案依頼を送る』」）。
 * 🔴 5 項目 + 提案依頼の導線**だけ**（詳細画面を持たない。§11-2）。`row` の型に実名・所属会社名・
 *    社内 ID・営業メモ・スキルシート・経歴・稼働状況のフィールドが**無い**ので、描く枝が書けない。
 * 🔴 フォームの入力は**メッセージと期限の 2 つだけ**（`F-017 AC-4` / `BR-58`）。
 * 🔴 送るのは `{ projectId, candidateRef, message, expiresAt }` の 4 項目（#31 の body。`engineer_id` を知らない）。
 * 🔴 状態は行ごとに持つ（親が `key={row.key}` で組み直す）。別の候補を選ぶと下書きは捨てられる。
 * export しているのは `*.render.test.tsx` が右パネル（行の選択後にしか現れない）を直接描くためである。
 */
export function AnonymousDetail({
  row,
  projectId,
  request,
  messages,
}: {
  readonly row: AnonymousCandidateRow;
  readonly projectId: string;
  readonly request: CandidateRequestProps;
  readonly messages: CandidateScreenMessages;
}) {
  const [phase, setPhase] = useState<RequestPhase>({ kind: 'IDLE' });
  const [message, setMessage] = useState('');
  const [expiresDay, setExpiresDay] = useState(request.expiry.defaultDay);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase.kind === 'SUBMITTING' || !request.canRequest) return;
    setError(null);
    let expiresAt: string;
    try {
      expiresAt = expiresAtIsoFromJstDate(expiresDay);
    } catch {
      setError(messages.requestErrorExpiresAt);
      return;
    }
    setPhase({ kind: 'SUBMITTING' });
    try {
      const response = await fetch('/api/proposal-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, candidateRef: row.candidateRef, message, expiresAt }),
      });
      if (response.ok) {
        setPhase({ kind: 'SENT' });
        return;
      }
      // 🔴 応答コードで文言を選ぶ（本文の `messageKey` を UI で解釈しない。`provisioning-form.tsx` と同じ形）。
      //    404 = 共有解除 / 一覧が古い、409 = 既に依頼済み、422 = 商流の記述、400 = 期限の範囲外。
      const status = response.status;
      setError(
        status === 404
          ? messages.requestErrorNotFound
          : status === 409
            ? messages.requestErrorAlreadyExists
            : status === 422
              ? messages.requestErrorCommerce
              : status === 400
                ? messages.requestErrorExpiresAt
                : messages.requestErrorGeneric,
      );
      setPhase({ kind: 'EDITING' });
    } catch {
      setError(messages.requestErrorGeneric);
      setPhase({ kind: 'EDITING' });
    }
  }

  return (
    <div data-testid="candidate-detail-anonymous">
      <p className="mb-2 text-lg font-semibold text-fg" data-testid="candidate-detail-kind">
        {messages.kindAnonymous}
      </p>
      <dl className="mb-3 text-body">
        <DetailRow label={messages.fieldSkills} value={row.allSkills.length === 0 ? messages.valueNone : row.allSkills.join(' / ')} field="skills" />
        <DetailRow label={messages.fieldYears} value={row.years} field="years" />
        <DetailRow label={messages.fieldPrice} value={row.unitPrice} field="price" />
        <DetailRow label={messages.fieldAvailability} value={row.availableFrom} field="availability" />
        <DetailRow label={messages.fieldLocation} value={row.location} field="location" />
        <DetailRow label={messages.fieldUpdatedOn} value={row.updatedOn} field="updated-on" />
      </dl>
      <p className="mb-2 text-xs text-fg-muted" data-testid="candidate-detail-anonymous-note">
        {messages.detailAnonymousNote}
      </p>

      {phase.kind === 'SENT' ? (
        <div className="border border-success-border bg-success-bg px-4 py-3 text-body text-success" data-testid="candidate-request-sent">
          <p role="status" className="mb-2 font-bold">
            {messages.requestSent}
          </p>
          <Link className={SECONDARY_LINK_CLASSES} href={request.listHref} data-testid="candidate-request-open-list">
            {messages.requestOpenList}
          </Link>
        </div>
      ) : !request.canRequest ? (
        request.unavailableMessage === null ? null : (
          <p className="m-0 text-xs text-fg-muted" data-testid="candidate-request-unavailable">
            {request.unavailableMessage}
          </p>
        )
      ) : phase.kind === 'IDLE' ? (
        <Button type="button" onClick={() => setPhase({ kind: 'EDITING' })} data-testid="candidate-request-open">
          {messages.requestOpen}
        </Button>
      ) : (
        // 🔴 右パネルがフォームに切り替わる（モーダルにしない。5 項目を見ながら書く）。
        <form className="border border-border bg-bg-subtle p-3" onSubmit={submit} data-testid="candidate-request-form">
          <p className="mb-1 text-body font-bold text-fg">{messages.requestTitle}</p>
          <p className="mb-3 text-xs text-fg-muted" data-testid="candidate-request-lead">
            {messages.requestLead}
          </p>
          <Field label={messages.requestMessageLabel} description={messages.requestMessageHint} className="mb-3">
            <Textarea
              name="message"
              rows={4}
              required
              maxLength={PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={phase.kind === 'SUBMITTING'}
              data-testid="candidate-request-message"
            />
          </Field>
          <Field label={messages.requestExpiresAtLabel} description={messages.requestExpiresAtHint} className="mb-3">
            <Input
              type="date"
              name="expiresDay"
              required
              min={request.expiry.minDay}
              max={request.expiry.maxDay}
              value={expiresDay}
              onChange={(event) => setExpiresDay(event.target.value)}
              disabled={phase.kind === 'SUBMITTING'}
              data-testid="candidate-request-expires-day"
            />
          </Field>
          {error === null ? null : (
            <p role="alert" className="mb-3 text-body text-danger" data-testid="candidate-request-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={phase.kind === 'SUBMITTING'} data-testid="candidate-request-submit">
              {phase.kind === 'SUBMITTING' ? messages.requestSubmitting : messages.requestSubmit}
            </Button>
            <button
              type="button"
              className={SECONDARY_LINK_CLASSES}
              disabled={phase.kind === 'SUBMITTING'}
              onClick={() => {
                setError(null);
                setPhase({ kind: 'IDLE' });
              }}
              data-testid="candidate-request-cancel"
            >
              {messages.requestCancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * 右パネル（`docs/04` §S-016 セクション 6）。
 * 🔴 自社候補 = 主要情報 + `S-006` への導線。匿名候補 = **5 項目 + 提案依頼の導線だけ**（詳細画面を持たない。§11-2）。
 *    分岐は `row.kind` で、匿名候補の枝では `displayName` / `availabilityStatus` に**型として到達できない**。
 */
function DetailPanel({
  row,
  projectId,
  request,
  proposal,
  messages,
}: {
  readonly row: CandidateRowView | null;
  readonly projectId: string;
  readonly request: CandidateRequestProps;
  readonly proposal: CandidateProposalProps;
  readonly messages: CandidateScreenMessages;
}) {
  if (row === null) {
    return (
      <p className="m-0 text-body text-fg-muted" data-testid="candidate-detail-empty">
        {messages.detailSelect}
      </p>
    );
  }
  if (row.kind === 'OWN') {
    return <OwnDetail row={row} projectId={projectId} proposal={proposal} messages={messages} />;
  }
  // 🔴 `key={row.key}` で候補ごとにフォームの状態を組み直す（別の候補の下書きが残らない）。
  return <AnonymousDetail key={row.key} row={row} projectId={projectId} request={request} messages={messages} />;
}

/**
 * 提案の作成（`S-020`）への導線の props（T-09-01。`docs/04` §S-016「自社候補で『提案を作成』」/ `F-004 AC-7`）。
 * 🔴 `canCreate` の出所は ctx のロール（`PROPOSAL_EDITOR_ROLES`。#36 と同じ定数）× テナントの実行可否であり、
 *    画面は判定を持たない。`false` のときは導線を描かず、`unavailableMessage` があればそれだけ出す。
 */
export type CandidateProposalProps = {
  readonly canCreate: boolean;
  readonly unavailableMessage: string | null;
};

/**
 * 自社候補の右パネル（主要情報 + `S-006` への導線 + 🔴 `S-020` への導線）。
 * ✅ T-09-01: 「提案の作成は後続のリリース」の注記を実物の導線に置き換えた。作成すると**その時点の情報が凍結**される
 *    （`F-019 AC-2`）。凍結の予告は遷移先（`S-020`）が出す。
 */
export function OwnDetail({
  row,
  projectId,
  proposal,
  messages,
}: {
  readonly row: Extract<CandidateRowView, { readonly kind: 'OWN' }>;
  readonly projectId: string;
  readonly proposal: CandidateProposalProps;
  readonly messages: CandidateScreenMessages;
}) {
  return (
    <div data-testid="candidate-detail-own">
      <p className="mb-2 text-lg font-semibold text-fg" data-testid="candidate-detail-name">
        {row.displayName}
      </p>
      <dl className="mb-3 text-body">
        <DetailRow label={messages.fieldSkills} value={row.skills.length === 0 ? messages.valueNone : [...row.skills, ...(row.moreSkills === null ? [] : [row.moreSkills])].join(' / ')} field="skills" />
        <DetailRow label={messages.fieldYears} value={row.years} field="years" />
        <DetailRow label={messages.fieldPrice} value={row.unitPrice} field="price" />
        <DetailRow label={messages.fieldAvailability} value={row.availableFrom} field="availability" />
        <DetailRow label={messages.fieldAvailabilityStatus} value={row.availabilityStatus} field="availability-status" />
        <DetailRow label={messages.fieldLocation} value={row.location} field="location" />
        <DetailRow label={messages.fieldUpdatedOn} value={row.updatedOn} field="updated-on" />
      </dl>
      {/* 🔴 実名を出す読み取り（`S-006`）への導線。閲覧の監査記録は遷移先が書く（`BR-27`）。 */}
      <Link className={SECONDARY_LINK_STACKED_CLASSES} href={`/engineers/${row.id}`} data-testid="candidate-detail-open-engineer">
        {messages.detailOpenEngineer}
      </Link>
      {proposal.canCreate ? (
        // 🔴 primary の見え方は `@ses/ui` の `Button`（primary / default）と同じ語を使う（別の見た目を作らない）。
        <Link
          // 🔴 T-22-07: primary リンクの見た目は `@ses/ui` の `PRIMARY_LINK_CLASSES` の 1 箇所（§7.4 /
          //    §7.10。画面に `hover:` を書かない = 検査 (j)）。配置（`mt-3`）だけが文脈の話である。
          className={cn("mt-3", PRIMARY_LINK_CLASSES)}
          href={proposalCreateHref(projectId, row.id)}
          data-testid="candidate-detail-create-proposal"
        >
          {messages.detailCreateProposal}
        </Link>
      ) : proposal.unavailableMessage === null ? null : (
        <p className="mt-2 mb-0 text-xs text-fg-muted" data-testid="candidate-detail-create-proposal-unavailable">
          {proposal.unavailableMessage}
        </p>
      )}
    </div>
  );
}

export function CandidateScreen({
  projectId,
  projectName,
  headlineRows,
  conditionRows,
  mustRows,
  niceRows,
  rows,
  filters,
  skillOptions,
  skillModeOptions,
  prefectureOptions,
  remoteOptions,
  availabilityOptions,
  activeFilters,
  showKindColumn,
  resetHref,
  registerHref,
  nextPageHref,
  firstPageHref,
  request,
  proposal,
  messages,
}: CandidateScreenProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const formAction = `/projects/${projectId}/candidates`;

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, key: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedKey(key);
    }
  }

  return (
    <div data-testid="candidate-screen">
      <p className="mb-4 text-body text-fg-muted" data-testid="candidate-lead">
        {messages.lead}
      </p>

      {/* セクション 1: 対象案件の要件サマリ（🔴 折りたたまない。docs/04 §S-016） */}
      <section className="mb-6 border border-border bg-bg" data-testid="candidate-project-summary">
        <h2 className="border-b border-border px-4 py-3 text-lg font-bold text-fg">
          {messages.sectionProject}
          <span className="ml-2 font-normal text-fg" data-testid="candidate-project-name">
            {projectName}
          </span>
        </h2>
        <div className="px-4 py-4">
          <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-body">
            {[...headlineRows, ...conditionRows].map((row) => (
              <div key={row.key} className="flex gap-2">
                <dt className="text-fg-muted">{row.label}</dt>
                <dd className="m-0 text-fg" data-testid={`candidate-project-${row.key}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <div data-testid="candidate-project-requirements-must">
            <RequirementTable
              heading={messages.requirementHeadingMust}
              empty={messages.requirementEmptyMust}
              rows={mustRows}
              columnRequirement={messages.requirementColumnRequirement}
              columnYears={messages.requirementColumnYears}
            />
          </div>
          <div data-testid="candidate-project-requirements-nice">
            <RequirementTable
              heading={messages.requirementHeadingNice}
              empty={messages.requirementEmptyNice}
              rows={niceRows}
              columnRequirement={messages.requirementColumnRequirement}
              columnYears={messages.requirementColumnYears}
            />
          </div>
          <Link className={SECONDARY_LINK_CLASSES} href={`/projects/${projectId}`} data-testid="candidate-project-open">
            {messages.projectOpen}
          </Link>
        </div>
      </section>

      {/* 🔴 T-22-07: §5-13 の `Toolbar`: **母集団の 1 行（§3.2-2 の #2）と検索の帯の置き場所をここに固定する。**
          画面ごとに位置が変わると、取引先が「自社分だけか」を毎画面で探すことになる。
          🔴 **母集団は混在した総件数の 1 行だけ**（`docs/04` §S-016。共有候補の件数を別に出さない ——
          出すと取引先の共有状況を推測させる）。`Toolbar` は**2 つ目の母集団を受け取る prop を持たない**。

          ⚠️ **凍結済み testid の併記**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④）:
             `Toolbar` は母集団の 1 行を `candidate-list-toolbar-population` として描くが、
             2026-09-30 に凍結されている値は **`candidate-list-population`** である。**改名は不可**なので、
             母集団の 1 行を含む帯の器にその値を残す（部品の testid は `testIdPrefix` が決め、
             画面から上書きできない）。 */}
      <div data-testid="candidate-list-population">
      <Toolbar
        testIdPrefix="candidate-list-"
        population={messages.populationLabel}
        filters={
            /* セクション 2・3: 検索条件と絞り込みチェックボックス（`S-005` と同じ項目・同じ既定）。
               ⚠️ `mb-0` / `w-full` は帯の中に置いたための余白・幅の調整である（`cn()` の規律 1）。 */
            <form className={cn(FILTER_FORM_CLASSES, 'mb-0 w-full')} method="get" action={formAction} data-testid="candidate-list-filters">
              <fieldset className="contents">
                <legend className="sr-only">{messages.searchLegend}</legend>
                <Field label={messages.searchQ}>
                  <Input type="search" name="q" defaultValue={filters.q} data-testid="candidate-list-filter-q" />
                </Field>
                <Field label={messages.searchSkills}>
                  <Select name="skills" multiple size={5} defaultValue={[...filters.skills]} data-testid="candidate-list-filter-skills">
                    {skillOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-fg-muted">{messages.searchSkillsHint}</span>
                </Field>
                <Field label={messages.searchSkillMode}>
                  <Select name="skillMode" defaultValue={filters.skillMode} data-testid="candidate-list-filter-skill-mode">
                    {skillModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={messages.searchYearsMin}>
                  <Input type="number" name="yearsMin" min={0} step={0.5} defaultValue={filters.yearsMin} data-testid="candidate-list-filter-years-min" />
                </Field>
                <Field label={messages.searchPriceMin}>
                  <Input type="number" name="priceMin" min={0} step={10000} defaultValue={filters.priceMin} data-testid="candidate-list-filter-price-min" />
                </Field>
                <Field label={messages.searchPriceMax}>
                  <Input type="number" name="priceMax" min={0} step={10000} defaultValue={filters.priceMax} data-testid="candidate-list-filter-price-max" />
                </Field>
                <Field label={messages.searchAvailableBy}>
                  <Input type="date" name="availableBy" defaultValue={filters.availableBy} data-testid="candidate-list-filter-available-by" />
                </Field>
                <Field label={messages.searchPrefecture}>
                  <Select name="prefecture" defaultValue={filters.prefecture} data-testid="candidate-list-filter-prefecture">
                    {prefectureOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={messages.searchRemote}>
                  <Select name="remote" defaultValue={filters.remote} data-testid="candidate-list-filter-remote">
                    {remoteOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={messages.searchAvailability}>
                  <Select name="availability" defaultValue={filters.availability} data-testid="candidate-list-filter-availability">
                    {availabilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* 🔴 絞り込みチェックボックス 2 種。**既定オフ**（`F-009 AC-5` / `docs/02` A-03）。 */}
                <Field as="div">
                  <label className="flex items-center gap-2 text-body">
                    <Checkbox name="onlyInTime" value="1" defaultChecked={filters.onlyInTime} data-testid="candidate-list-filter-only-in-time" />
                    <span>{messages.searchOnlyInTime}</span>
                  </label>
                  <label className="flex items-center gap-2 text-body">
                    <Checkbox name="onlyCommutable" value="1" defaultChecked={filters.onlyCommutable} data-testid="candidate-list-filter-only-commutable" />
                    <span>{messages.searchOnlyCommutable}</span>
                  </label>
                  <span className="text-xs text-fg-muted" data-testid="candidate-list-checkbox-note">
                    {messages.searchCheckboxNote}
                  </span>
                </Field>
                <div className={FILTER_ACTIONS_CLASSES}>
                  <Button type="submit" data-testid="candidate-list-search">
                    {messages.searchSubmit}
                  </Button>
                  {/* 🔴 「条件をクリア」ではなく「案件の要件に戻す」（本画面の既定は空ではなく要件。docs/04 §S-016） */}
                  <Link className={SECONDARY_LINK_CLASSES} href={resetHref} data-testid="candidate-list-reset">
                    {messages.searchReset}
                  </Link>
                </div>
              </fieldset>
            </form>
        }
      />
      </div>

      {/* 🔴 共有候補への条件の効き方（`docs/04` §S-016 実装の補足「検索条件の帯の直下に 1 行で書く」）。
          ⚠️ 凍結済み `candidate-list-anonymous-filter-note` を維持するため、`Toolbar` の `scopeNote`
             （`…-toolbar-scope-note` を出す）ではなく帯の直下の 1 行に残す。 */}
      {messages.anonymousFilterNote === null ? null : (
        <p className="mt-1 mb-3 text-xs text-fg-muted" data-testid="candidate-list-anonymous-filter-note">
          {messages.anonymousFilterNote}
        </p>
      )}

      {/* セクション 4 の残り: 並び順の説明（母集団の 1 行は `Toolbar` が持つ） */}
      <p className="mb-3 text-body text-fg-muted" data-testid="candidate-list-order-note">
        {messages.orderNote}
      </p>
      {request.showListLink ? (
        // 🔴 `S-016` → `S-017`（`docs/04` §S-017 関連画面「← `S-016`」）。ホストにだけ置く。
        <p className="mb-3 text-body">
          <Link className={SECONDARY_LINK_CLASSES} href={request.listHref} data-testid="candidate-list-open-requests">
            {messages.requestOpenList}
          </Link>
        </p>
      ) : null}

      {/* ====================================================================
          🔴 `xl` 以上で並置する 2 列（`docs/04` §7.1 の幅クラス B）。`T-22-07` の実測の記録
          ====================================================================
          1 列目（表）の下限は**表の最小幅 61.5rem = 984px**（`T-11-12` の実測。8 列の最長ラベル）
          **+ `Table` の器の枠 2px**（左右 1px ずつ）= **61.625rem = 986px**。
          🔴 ✅ 2026-10-03: `Table` の器が `CARD_SURFACE_CLASSES`（白い面 + 1px の枠）を持つようになり、
          **器の内側の幅が 2px 減った**（`packages/ui/src/components/table.tsx` 冒頭の 🔴）。
          下限を 984 のまま据え置くと器の内幅が 982px になり、`lg:min-w-[61.5rem]`（= 984px）の表が
          **器の内側で 2px だけ横スクロールする** —— 下の 🔴 が「緩めない」と書いた
          `containerOverflow ≤ 1` がちょうど破れる。**枠のぶんを下限に足して内幅 984px を取り戻す**
          （表の最小幅 61.5rem は 1 ピクセルも変えていない。変えるとスキル列の下限が削れる）。
          2 列目（パネル）の幅は `PAGE_BODY_ASIDE_WIDTH_CLASSES`（**`lg` 360 / `xl` 400 / `2xl` 480px**。
          寸法の出所は `@ses/ui` の `page-body.tsx` 1 箇所）であり、grid のトラックは `auto` で
          その幅に従う。`lg`〜`xl` 未満はパネルがドロワー（`fixed`）になり grid の流れから外れるので 1 列。

          🔴 **`xl:overflow-x-auto` は残す（`T-22-07` で落とせなかった）。実測:**
          | 幅 | 本文に残る幅 | 2 列の下限の和 | 判定 |
          |---|---|---|---|
          | `xl` 1280 | 1280 − 224（サイドバー `xl:w-56`）− 48（`px-6`）= **1008** | 986 + 16 + 400 = **1402** | 溢れる |
          | 1440 | 1440 − 224 − 48 = **1168** | 同上 **1402** | 溢れる |
          | `2xl` 1536 | 1536 − 224 − 48 = **1264** | 986 + 16 + 480 = **1482** | 溢れる |
          | 1920 | 1920 − 224 − 48 = **1648** | 同上 **1482** | 収まる |
          🔴 **`PageBody` の副カラム（`aside`）に載せ替えられない**のも同じ算術である —— 載せ替えると
          主カラムは `1168 − 24 − 400 = 744px` になり、**表が器の内側で横スクロールする**。
          `tests/e2e/anonymous-share.spec.ts` は 1440 で「候補テーブルの器が横にスクロールしていない
          （`containerOverflow ≤ 1`）」かつ「更新日セルがビューポート内」かつ「右パネルが同時に見える」ことを
          検証しており（`docs/04` §S-016 の 🔴「競合したら譲るのはパネル」）、**譲らせる相手を逆にすると
          その判定が壊れる**。判定は緩めない。
          🔴 したがって**溢れは器の内側に閉じ込める**（`Table` の `overflow-x-auto` と同じ考え方。判断材料は
          横スクロールで必ず到達できる。`CLAUDE.md` §13.3）。列を削る・パネルを `hidden` にする方向の
          解決は採らない（`docs/04` §S-016「`lg` 以上では列を隠さない」）。
          ⚠️ **根の原因は `docs/04` §7.1 の `xl` の 🔴「`S-016` は 8 列と右パネルが同時に読める」が、
             共通外枠のサイドバー（224px）を織り込んでいないことである**（984 + 24 + 400 + 48 + 224 = 1680px を
             要する）。幅クラス B の「副カラムを可変にしない」との両立は `docs/04` の改訂事項であり、
             完了記録で提起する（`CLAUDE.md` §8.7）。 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(61.625rem,1fr)_auto] xl:overflow-x-auto">
        {/* セクション 5: 候補テーブル */}
        <div>
          {rows.length === 0 ? (
            // 🔴 T-22-07: 空状態は `@ses/ui` の `EmptyState`（§5-13 / §10.4 の「説明 → Primary → Secondary」）。
            //    🔴 **初回空と絞込 0 件は文言も導線も別物**（§10.1。選び分けは `candidateScreenMessages`）。
            //    初回空の Primary は `S-007` への登録導線、絞込 0 件の Primary は
            //    **効いている条件を 1 つずつ外せる導線**（§10.4「Primary は『条件を外す』であって新規作成ではない」）。
            //    ⚠️ 器の `data-testid` は凍結済みの `candidate-list-empty` である（`docs/04` `U-22`）。
            <div data-testid="candidate-list-empty">
              <EmptyState
                testIdPrefix="candidate-list-empty-state-"
                description={`${messages.emptyTitle}${messages.emptyLead}`}
                primary={
                  messages.emptyRegister !== null ? (
                    <Link className={SECONDARY_LINK_CLASSES} href={registerHref} data-testid="candidate-list-register">
                      {messages.emptyRegister}
                    </Link>
                  ) : activeFilters.length === 0 ? undefined : (
                    <div data-testid="candidate-list-active-filters">
                      <p className="mb-1 text-body font-semibold text-fg">{messages.activeFiltersTitle}</p>
                      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                        {activeFilters.map((filter) => (
                          <li key={filter.key}>
                            <Link className={SECONDARY_LINK_CLASSES} href={filter.href} data-testid={`candidate-list-remove-filter-${filter.key}`}>
                              {filter.label} {messages.removeFilterSuffix}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                }
              />
              {/* 🔴 絞り込みチェックボックスがオンで 0 件のときだけの注意（`docs/04` §10.1 `S-016`）。 */}
              {messages.emptyCheckboxNotice === null ? null : (
                <p className="text-body text-fg" data-testid="candidate-list-empty-checkbox-notice">
                  {messages.emptyCheckboxNotice}
                </p>
              )}
            </div>
          ) : (
            <Table className={CANDIDATE_TABLE_CLASSES} data-testid="candidate-list-table">
              <TableHeader>
                <TableRow>
                  {/* 🔴 `lg` 以上の列幅は先頭行（`<th>`）で決まる（`table-layout: fixed`）。スキル列にだけ幅を書かない。 */}
                  {showKindColumn ? (
                    <TableHead padding="compact" className={CANDIDATE_COLUMN_WIDTH.kind}>
                      {messages.columnKind}
                    </TableHead>
                  ) : null}
                  <TableHead padding="compact" className={cn(TABLET_UP, CANDIDATE_COLUMN_WIDTH.name)}>
                    {messages.columnName}
                  </TableHead>
                  <TableHead padding="compact">{messages.columnSkills}</TableHead>
                  <TableHead padding="compact" className={cn(TABLET_UP, CANDIDATE_COLUMN_WIDTH.years)}>
                    {messages.columnYears}
                  </TableHead>
                  <TableHead padding="compact" className={CANDIDATE_COLUMN_WIDTH.unitPrice}>
                    {messages.columnUnitPrice}
                  </TableHead>
                  <TableHead padding="compact" className={CANDIDATE_COLUMN_WIDTH.availability}>
                    {messages.columnAvailability}
                  </TableHead>
                  <TableHead padding="compact" className={cn(DESKTOP_ONLY, CANDIDATE_COLUMN_WIDTH.location)}>
                    {messages.columnLocation}
                  </TableHead>
                  <TableHead padding="compact" className={cn(DESKTOP_ONLY, CANDIDATE_COLUMN_WIDTH.updatedOn)}>
                    {messages.columnUpdatedOn}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  // 🔴 行の選択で右パネルを切り替える（`docs/04` §S-016「行の選択」）。遷移ではない。
                  <TableRow
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    aria-selected={row.key === selectedKey}
                    className="cursor-pointer"
                    data-state={row.key === selectedKey ? 'selected' : undefined}
                    onClick={() => setSelectedKey(row.key)}
                    onKeyDown={(event) => onRowKeyDown(event, row.key)}
                    data-testid={`candidate-list-row-${row.key}`}
                    data-candidate-kind={row.kind}
                  >
                    {showKindColumn ? (
                      <TableCell padding="compact" data-testid={`candidate-list-kind-${row.key}`}>
                        {row.kind === 'OWN' ? messages.kindOwn : messages.kindAnonymous}
                      </TableCell>
                    ) : null}
                    {/* 🔴 表示名は `docs/04` §10.3 の名称規約（`NameCell`）。自社候補だけが `S-006` への導線を持ち、
                        匿名候補の表示名は「共有候補」の一語だけ（氏名・所属会社名・社内 ID を持たず、リンクも無い）。 */}
                    <NameCell
                      name={row.kind === 'OWN' ? row.displayName : messages.kindAnonymous}
                      href={row.kind === 'OWN' ? `/engineers/${row.id}` : null}
                      linkComponent={Link}
                      linkTestId={row.kind === 'OWN' ? `candidate-list-link-${row.key}` : undefined}
                      padding="compact"
                      className={TABLET_UP}
                      data-testid={`candidate-list-name-${row.key}`}
                    />
                    <TableCell padding="compact" whitespace="normal">
                      <SkillBadges skills={row.skills} skillCount={row.skillCount} valueNone={messages.valueNone} rowKey={row.key} />
                    </TableCell>
                    <TableCell padding="compact" className={TABLET_UP}>
                      {row.years}
                    </TableCell>
                    <TableCell padding="compact">{row.unitPrice}</TableCell>
                    <TableCell padding="compact">{row.availableFrom}</TableCell>
                    <TableCell padding="compact" className={DESKTOP_ONLY}>
                      {row.location}
                    </TableCell>
                    {/* 🔴 更新日（Phase 1 の並び順のキー）。E2E が「右パネルを開いた 1440 で読める」ことを掴む。 */}
                    <TableCell padding="compact" className={DESKTOP_ONLY} data-testid={`candidate-list-updated-on-${row.key}`}>
                      {row.updatedOn}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* 🔴 カーソルページング（`@ses/ui` の `Pagination`。§5-13 / §7.1）。
              🔴 **オフセット・総件数・無限スクロールの prop を持たない部品**であり、「全 N ページ中 M ページ目」を
              描く余地が構造的に無い（docs/05 §4.8）。リンクは**検索条件を保った URL** である。
              ⚠️ 1 ページに収まるとき（次も前も無い）は領域ごと描かない。器の `data-testid` は
                 凍結済みの `candidate-list-paging` である（`U-22`）。 */}
          {nextPageHref === null && firstPageHref === null ? null : (
            <div className="mt-4" data-testid="candidate-list-paging">
              <Pagination
                testIdPrefix="candidate-list-"
                nextHref={nextPageHref}
                nextLabel={messages.nextPage}
                // 🔴 `null` = 「前へは在るが今は先頭にいる」（`Pagination` は要素を消さない。§5-13）。
                prevHref={firstPageHref}
                prevLabel={messages.firstPage}
                linkComponent={CandidatePagingLink}
              />
            </div>
          )}
        </div>

        {/* セクション 6: 選択した候補の詳細パネル。`xl` 以上 = 右に並置 / `lg`〜`xl` 未満 = テーブルに重なるドロワー
            （行を選ぶまで描かず、「閉じる」か Escape で 8 列に戻る）/ `lg` 未満 = 一覧の下。
            🔴 ドロワーは `fixed`（長い一覧の下の方の行を選んでも見える）で、環境バナー（`sticky top-0 z-20`）より上
            （`z-30`）に置く —— 下に置くと見出しの「閉じる」がバナーに覆われて押せない（T-11-12 の実測で発見）。
            バナーの文言は中央寄せで、ドロワー（右端。`T-22-07` で `lg` 360 / `xl` 400 / `2xl` 480px = 幅クラス B）に
            覆われずに読める（`F-028 AC-1`。1024px でもパネルの左端は 664px であり、中央〔512px〕を覆わない）。 */}
        <aside
          className={cn(
            'border border-border bg-bg',
            // 🔴 T-22-07: 副カラムの**幅**は `docs/04` §7.1 の幅クラス B（`lg` 360 → `xl` 400 → `2xl` 480px）
            //    であり、その寸法が書かれているのは `@ses/ui` の `page-body.tsx` の 1 箇所だけである
            //    （`docs/05` §2.3.4）。ここは**定数を import して使う** —— 旧 `lg:w-80` / grid の `20rem` は
            //    画面が独自に決めた寸法だった（`T-11-12` の暫定）。
            PAGE_BODY_ASIDE_WIDTH_CLASSES,
            'lg:fixed lg:inset-y-0 lg:right-0 lg:z-30 lg:overflow-y-auto lg:shadow-xl',
            selected === null ? 'lg:hidden xl:block' : null,
            'xl:static xl:z-auto xl:overflow-visible xl:shadow-none',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSelectedKey(null);
          }}
          data-testid="candidate-detail-panel"
        >
          <h2 className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-lg font-bold text-fg">
            <span>{messages.sectionDetail}</span>
            {/* 🔴 `SECONDARY_LINK_CLASSES` は `inline-block` を持ち、`hidden` と競合する（`cn` は解決しない）ので
                見た目の語（`text-sm text-slate-500`）だけを写し、display はブレークポイント別に書く。 */}
            {selected === null ? null : (
              <button
                type="button"
                className="hidden shrink-0 text-body text-fg-muted underline lg:inline-block xl:hidden"
                onClick={() => setSelectedKey(null)}
                data-testid="candidate-detail-close"
              >
                {messages.detailClose}
              </button>
            )}
          </h2>
          <div className="px-4 py-4">
            <DetailPanel row={selected} projectId={projectId} request={request} proposal={proposal} messages={messages} />
          </div>
        </aside>
      </div>
    </div>
  );
}
