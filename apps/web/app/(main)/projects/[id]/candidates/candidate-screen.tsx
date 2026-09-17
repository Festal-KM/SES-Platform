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
//   - **表の最小幅（`CANDIDATE_TABLE_MIN_WIDTH_CLASS`）** = 固定 7 列の和 + スキル列の下限（1 件 + `+N`）。
//     これより狭い器では表が器の内側で横にスクロールする（`Table` の `overflow-x-auto`）が、`lg`（1024px −
//     `px-4` × 2 = 992px）以上ではスクロールしない値に置く。セルは `padding="compact"`（`px-2`）—— `px-3` では
//     8 列が `lg` の幅に収まらない（実測: T-11-12）。
//   - **スキル列は 1 行固定**（行の高さを揃える。スキルが 1 件でも 8 件でも行の高さが変わらない = 「経歴の量」を
//     6 つ目の開示項目にしない。§10.3 画面固有）。描く件数は上位 3 + `+N` を上限とし、**幅が足りなければ
//     件数を減らす（下限 1 件 + `+N`）**。件数は `SkillBadges` が実測（`ResizeObserver`）→ `fitSkillBadges`
//     （純粋関数）で決め、`+N` は隠した分を含めて描き直す。**`lg` 未満は従来どおり折り返し**（CSS が決め、JS は追随する）。
//   - **右パネル**: `xl` 以上は並置（grid の 2 列目。🔴 **競合したら譲るのはパネル** —— 1 列目の下限を表の最小幅に
//     し、パネルは `minmax(15rem, 20rem)`）。**`lg` 以上 `xl` 未満は並置すると 8 列が成立しない**ので、パネルは
//     テーブルに重なる**ドロワー**（行を選ぶと右端に出る。「閉じる」を明示的に置く。閉じれば 8 列に戻る）。
//     `lg` 未満は従来どおり一覧の下。**列を削ってパネルを並置する形は採らない**（§S-016 デバイス別）。
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
  Field,
  Input,
  NameCell,
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
 * 🔴 描く件数は **CSS が決めた描き方に JS が追随する**形で決める: 器の `flex-wrap` が `nowrap`（= `lg` 以上の
 *    1 行固定）のときだけ、器の幅とバッジの実測幅から `fitSkillBadges` で件数を決め、`+N` を隠した分を含めて
 *    描き直す。`wrap`（`lg` 未満）なら全件を描く（折り返しは CSS）。ブレークポイントを JS に重複して持たない。
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
    // 🔴 `lg` 以上: 1 行固定（`flex-nowrap` + `overflow-hidden`）。`lg` 未満: 折り返し（従来どおり）。
    <span ref={boxRef} className="flex flex-wrap items-center gap-1 lg:flex-nowrap lg:overflow-hidden">
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
          className="hidden shrink-0 px-1.5 py-0.5 text-xs text-slate-500 sm:inline"
          data-skill-more=""
          data-testid={`candidate-list-more-skills-${rowKey}`}
        >
          {`+${String(hidden)}`}
        </span>
      )}
    </span>
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
      <h3 className="mb-1 text-sm font-semibold text-slate-900">{heading}</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">{empty}</p>
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
    <div className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 text-slate-900" data-field={field}>
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
      <p className="mb-2 text-base font-semibold text-slate-900" data-testid="candidate-detail-kind">
        {messages.kindAnonymous}
      </p>
      <dl className="mb-3 text-sm">
        <DetailRow label={messages.fieldSkills} value={row.allSkills.length === 0 ? messages.valueNone : row.allSkills.join(' / ')} field="skills" />
        <DetailRow label={messages.fieldYears} value={row.years} field="years" />
        <DetailRow label={messages.fieldPrice} value={row.unitPrice} field="price" />
        <DetailRow label={messages.fieldAvailability} value={row.availableFrom} field="availability" />
        <DetailRow label={messages.fieldLocation} value={row.location} field="location" />
        <DetailRow label={messages.fieldUpdatedOn} value={row.updatedOn} field="updated-on" />
      </dl>
      <p className="mb-2 text-xs text-slate-600" data-testid="candidate-detail-anonymous-note">
        {messages.detailAnonymousNote}
      </p>

      {phase.kind === 'SENT' ? (
        <div className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="candidate-request-sent">
          <p role="status" className="mb-2 font-bold">
            {messages.requestSent}
          </p>
          <Link className={SECONDARY_LINK_CLASSES} href={request.listHref} data-testid="candidate-request-open-list">
            {messages.requestOpenList}
          </Link>
        </div>
      ) : !request.canRequest ? (
        request.unavailableMessage === null ? null : (
          <p className="m-0 text-xs text-slate-500" data-testid="candidate-request-unavailable">
            {request.unavailableMessage}
          </p>
        )
      ) : phase.kind === 'IDLE' ? (
        <Button type="button" onClick={() => setPhase({ kind: 'EDITING' })} data-testid="candidate-request-open">
          {messages.requestOpen}
        </Button>
      ) : (
        // 🔴 右パネルがフォームに切り替わる（モーダルにしない。5 項目を見ながら書く）。
        <form className="border border-slate-200 bg-slate-50 p-3" onSubmit={submit} data-testid="candidate-request-form">
          <p className="mb-1 text-sm font-bold text-slate-900">{messages.requestTitle}</p>
          <p className="mb-3 text-xs text-slate-600" data-testid="candidate-request-lead">
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
            <p role="alert" className="mb-3 text-sm text-red-700" data-testid="candidate-request-error">
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
      <p className="m-0 text-sm text-slate-600" data-testid="candidate-detail-empty">
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
      <p className="mb-2 text-base font-semibold text-slate-900" data-testid="candidate-detail-name">
        {row.displayName}
      </p>
      <dl className="mb-3 text-sm">
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
          className="mt-3 inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          href={proposalCreateHref(projectId, row.id)}
          data-testid="candidate-detail-create-proposal"
        >
          {messages.detailCreateProposal}
        </Link>
      ) : proposal.unavailableMessage === null ? null : (
        <p className="mt-2 mb-0 text-xs text-slate-500" data-testid="candidate-detail-create-proposal-unavailable">
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
      <p className="mb-4 text-sm text-slate-600" data-testid="candidate-lead">
        {messages.lead}
      </p>

      {/* セクション 1: 対象案件の要件サマリ（🔴 折りたたまない。docs/04 §S-016） */}
      <section className="mb-6 border border-slate-200 bg-white" data-testid="candidate-project-summary">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
          {messages.sectionProject}
          <span className="ml-2 font-normal text-slate-700" data-testid="candidate-project-name">
            {projectName}
          </span>
        </h2>
        <div className="px-4 py-4">
          <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {[...headlineRows, ...conditionRows].map((row) => (
              <div key={row.key} className="flex gap-2">
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="m-0 text-slate-900" data-testid={`candidate-project-${row.key}`}>
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

      {/* セクション 2・3: 検索条件と絞り込みチェックボックス（`S-005` と同じ項目・同じ既定） */}
      <form className={FILTER_FORM_CLASSES} method="get" action={formAction} data-testid="candidate-list-filters">
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
            <span className="text-xs text-slate-500">{messages.searchSkillsHint}</span>
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="onlyInTime" value="1" defaultChecked={filters.onlyInTime} data-testid="candidate-list-filter-only-in-time" />
              <span>{messages.searchOnlyInTime}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="onlyCommutable" value="1" defaultChecked={filters.onlyCommutable} data-testid="candidate-list-filter-only-commutable" />
              <span>{messages.searchOnlyCommutable}</span>
            </label>
            <span className="text-xs text-slate-500" data-testid="candidate-list-checkbox-note">
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

      {messages.anonymousFilterNote === null ? null : (
        <p className="mb-3 text-xs text-slate-500" data-testid="candidate-list-anonymous-filter-note">
          {messages.anonymousFilterNote}
        </p>
      )}

      {/* セクション 4: 母集団の明示（🔴 混在した総件数だけ）と並び順の説明 */}
      <p className="mb-1 text-sm font-semibold text-slate-900" data-testid="candidate-list-population">
        {messages.populationLabel}
      </p>
      <p className="mb-3 text-sm text-slate-600" data-testid="candidate-list-order-note">
        {messages.orderNote}
      </p>
      {request.showListLink ? (
        // 🔴 `S-016` → `S-017`（`docs/04` §S-017 関連画面「← `S-016`」）。ホストにだけ置く。
        <p className="mb-3 text-sm">
          <Link className={SECONDARY_LINK_CLASSES} href={request.listHref} data-testid="candidate-list-open-requests">
            {messages.requestOpenList}
          </Link>
        </p>
      ) : null}

      {/* 🔴 `xl` 以上で並置。1 列目（表）の下限を表の最小幅に揃え、パネル（2 列目）は `minmax(15rem, 20rem)` ——
          競合したら譲るのはパネル（ファイル冒頭「デスクトップの列幅配分と右パネル」）。`lg`〜`xl` 未満はパネルが
          ドロワー（`fixed`）になり grid の流れから外れるので 1 列。 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(61.5rem,1fr)_minmax(15rem,20rem)]">
        {/* セクション 5: 候補テーブル */}
        <div>
          {rows.length === 0 ? (
            <div className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" data-testid="candidate-list-empty">
              <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
              <p className="m-0">{messages.emptyLead}</p>
              {messages.emptyRegister === null ? null : (
                <Link className={cn(SECONDARY_LINK_CLASSES, 'mt-2 inline-block')} href={registerHref} data-testid="candidate-list-register">
                  {messages.emptyRegister}
                </Link>
              )}
              {messages.emptyCheckboxNotice === null ? null : (
                <p className="mt-2 mb-0" data-testid="candidate-list-empty-checkbox-notice">
                  {messages.emptyCheckboxNotice}
                </p>
              )}
              {activeFilters.length === 0 ? null : (
                <div className="mt-3" data-testid="candidate-list-active-filters">
                  <p className="mb-1 font-semibold">{messages.activeFiltersTitle}</p>
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

          {/* 🔴 カーソルページング。「全 N ページ中 M ページ目」を出さない（docs/05 §4.8）。 */}
          {nextPageHref === null && firstPageHref === null ? null : (
            <nav className="mt-4 flex flex-wrap gap-4" data-testid="candidate-list-paging">
              {firstPageHref === null ? null : (
                <Link className={SECONDARY_LINK_CLASSES} href={firstPageHref} data-testid="candidate-list-first">
                  {messages.firstPage}
                </Link>
              )}
              {nextPageHref === null ? null : (
                <Link className={SECONDARY_LINK_CLASSES} href={nextPageHref} data-testid="candidate-list-next">
                  {messages.nextPage}
                </Link>
              )}
            </nav>
          )}
        </div>

        {/* セクション 6: 選択した候補の詳細パネル。`xl` 以上 = 右に並置 / `lg`〜`xl` 未満 = テーブルに重なるドロワー
            （行を選ぶまで描かず、「閉じる」か Escape で 8 列に戻る）/ `lg` 未満 = 一覧の下。
            🔴 ドロワーは `fixed`（長い一覧の下の方の行を選んでも見える）で、環境バナー（`sticky top-0 z-20`）より上
            （`z-30`）に置く —— 下に置くと見出しの「閉じる」がバナーに覆われて押せない（T-11-12 の実測で発見）。
            バナーの文言は中央寄せで、ドロワー（右端 20rem）に覆われずに読める（`F-028 AC-1`）。 */}
        <aside
          className={cn(
            'border border-slate-200 bg-white',
            'lg:fixed lg:inset-y-0 lg:right-0 lg:z-30 lg:w-80 lg:overflow-y-auto lg:shadow-xl',
            selected === null ? 'lg:hidden xl:block' : null,
            'xl:static xl:z-auto xl:w-auto xl:overflow-visible xl:shadow-none',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSelectedKey(null);
          }}
          data-testid="candidate-detail-panel"
        >
          <h2 className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
            <span>{messages.sectionDetail}</span>
            {/* 🔴 `SECONDARY_LINK_CLASSES` は `inline-block` を持ち、`hidden` と競合する（`cn` は解決しない）ので
                見た目の語（`text-sm text-slate-500`）だけを写し、display はブレークポイント別に書く。 */}
            {selected === null ? null : (
              <button
                type="button"
                className="hidden shrink-0 text-sm text-slate-500 underline lg:inline-block xl:hidden"
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
