// apps/web/lib/projects/detail.ts
// `S-011` 案件詳細の表示値の組み立て（docs/04 §S-011）。T-06-02。
//
// 🔴 画面（`app/(main)/projects/[id]/**`）ではなくここに置く理由は `lib/engineers/detail.ts` と
//    同じである: `app/**` はユニットテストの対象外（`vitest.config.ts` の注記）であり、
//    「未設定は `—`」「片側だけの単価レンジを畳まない」「区分ごとに要件を分ける」を
//    テストで固定できる場所が要る。ここは **I/O を持たない純粋関数だけ**である。
//
// 🔴 **商流情報の行を作る関数は `HostProjectDetailView` しか受け取らない**（型で縛る）。
//    「引数の中身を見て出し分ける」形にすると、取引先の view を渡せてしまい、
//    `undefined` が空欄として描かれる（＝ 型で分けた意味が画面の手前で消える）。
//
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
import { t } from '@ses/i18n';
import type { RequirementKind } from '@ses/db';
import { formatThousands, formatUnitPriceRange } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import {
  PROJECT_REMOTE_MODE_MESSAGE_KEYS,
  PROJECT_STATUS_MESSAGE_KEYS,
} from './labels';
import type {
  HostProjectDetailView,
  ProjectDetailView,
  ProjectRequirementView,
  ProjectVisibilityView,
} from './service';

/** 定義リストの 1 行（`docs/04` §11「1 件の属性の羅列は定義リスト」）。 */
export type ProjectDetailRow = {
  /** `data-testid` と React の `key`。文言ではない。 */
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

/** 要件表の 1 行（`docs/04` §S-011 セクション 2）。 */
export type ProjectRequirementRow = {
  /** 画面内の一意キー（DB の id は画面に出さない）。 */
  readonly key: string;
  /** スキル名、無ければ自由記述。 */
  readonly requirement: string;
  readonly years: string;
};

/** 公開先テーブルの 1 行（🔴 ホストのみ。`docs/04` §S-011 セクション 5）。 */
export type ProjectVisibilityRow = {
  readonly key: string;
  readonly partnerCompanyName: string;
  readonly publishedOn: string;
};

/** 未設定（`docs/04` の定義リストは空欄にせず記号を置く）。 */
function none(): string {
  return t('projects.detail.valueNone');
}

/**
 * 単価レンジ（月額・円）— **案件（`S-011`）の語彙で束ねたもの**。
 * 🔴 書式は `lib/format/number.ts` にあり、ここが渡すのは語だけである。人材（`engineers.*`）と
 *    キーを共有しない（`lib/projects/labels.ts` 冒頭と同じ理由）。
 * 🔴 **片側だけのレンジを `—` に畳まない**（「60 万円以上」は取引先の判断に使える情報である）。
 */
export function formatProjectUnitPriceRange(min: number | null, max: number | null): string {
  return formatUnitPriceRange(min, max, {
    unit: t('projects.unitPrice.unit'),
    orMore: t('projects.detail.unitPrice.orMore'),
    orLess: t('projects.detail.unitPrice.orLess'),
    none: none(),
  });
}

/**
 * `docs/04` §S-011 セクション 1「見出し」。
 * 🔴 **T2（モバイル閲覧可）。この 3 値は折りたたみの外に置く**（`CLAUDE.md` §13.3。
 *    移動中に「いつから何人必要な案件か」を見ずに判断させない）。
 * 🔴 ホストと取引先で**同じ**（`docs/04` §S-011 のセクション 1 は両者共通）。
 */
export function projectHeadlineRows(view: ProjectDetailView): readonly ProjectDetailRow[] {
  return [
    {
      key: 'status',
      label: t('projects.status.label'),
      value: t(PROJECT_STATUS_MESSAGE_KEYS[view.status]),
    },
    {
      key: 'headcount',
      label: t('projects.headcount.label'),
      value: `${formatThousands(view.headcount)} ${t('projects.headcount.unit')}`,
    },
    {
      key: 'startDate',
      label: t('projects.startDate.label'),
      value: view.startDate ?? none(),
    },
  ];
}

/**
 * `docs/04` §S-011 セクション 3「条件」。
 * 🔴 取引先にも**そのまま**出す。ここに出るのは単価レンジ（**外部公開用**）・勤務地・リモート可否で
 *    あり、内部限定の 2 列（エンド企業名・自社単価）は `ProjectDetailShared` に存在しない。
 */
export function projectConditionRows(view: ProjectDetailView): readonly ProjectDetailRow[] {
  return [
    {
      key: 'unitPrice',
      label: t('projects.unitPrice.label'),
      value: formatProjectUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    },
    {
      key: 'prefecture',
      label: t('projects.prefecture.label'),
      value: view.prefecture === null ? none() : t(PREFECTURE_MESSAGE_KEYS[view.prefecture]),
    },
    {
      key: 'remoteMode',
      label: t('projects.remoteMode.label'),
      value: view.remoteMode === null ? none() : t(PROJECT_REMOTE_MODE_MESSAGE_KEYS[view.remoteMode]),
    },
  ];
}

/**
 * `docs/04` §S-011 セクション 4「商流情報」（🔴 **ホストのみ**）。
 * 🔴 引数の型が `HostProjectDetailView` である ＝ 取引先の view を渡す実装は**コンパイルできない**。
 *    これが「取得時の射影」を画面の手前まで通す最後の 1 枚である。
 */
export function projectCommerceRows(view: HostProjectDetailView): readonly ProjectDetailRow[] {
  return [
    {
      key: 'endClientName',
      label: t('projects.endClientName.label'),
      value: view.endClientName ?? none(),
    },
    {
      key: 'internalUnitPrice',
      label: t('projects.internalUnitPrice.label'),
      value:
        view.internalUnitPrice === null
          ? none()
          : `${formatThousands(view.internalUnitPrice)} ${t('projects.unitPrice.unit')}`,
    },
  ];
}

/**
 * `docs/04` §S-011 セクション 2「要件」を**区分ごとに**取り出す（`F-013 AC-1`）。
 *
 * 🔴 区分の根拠は `kind` の 1 列だけである（配列の順序・見出しの並びに意味を持たせない。
 *    docs/05 §6.4「#26 の実装の決着」）。
 * 🔴 **必須要件が多くても折りたたまない**（`docs/04` §11「要件は判断材料であり折りたたまない」）。
 *    件数で表示を切り替える分岐をここに置かない。
 */
export function projectRequirementRows(
  requirements: readonly ProjectRequirementView[],
  kind: RequirementKind,
): readonly ProjectRequirementRow[] {
  return requirements
    .filter((requirement) => requirement.kind === kind)
    .map((requirement, index) => ({
      key: `${kind}-${String(index)}`,
      // 🔴 辞書名を優先し、無ければ自由記述（どちらも無い要件は保存できない。`service.ts`）。
      requirement: requirement.skillName ?? requirement.freeText ?? none(),
      years:
        requirement.requiredYears === null
          ? none()
          : `${requirement.requiredYears} ${t('projects.requirements.years.unit')}`,
    }));
}

/**
 * `docs/04` §S-011 セクション 5「公開範囲」（🔴 **ホストのみ**）。
 * 🔴 取引先には**この行が 1 つも存在しない**（`PartnerProjectDetailView` に `visibilities` が無い）。
 *    `F-014 AC-4` / `BR-07`: 公開先の社数・社名を取引先が知る手段を作らない。
 */
export function projectVisibilityRows(
  visibilities: readonly ProjectVisibilityView[],
): readonly ProjectVisibilityRow[] {
  return visibilities.map((visibility) => ({
    key: visibility.partnerCompanyId,
    partnerCompanyName: visibility.partnerCompanyName,
    publishedOn: visibility.publishedOn,
  }));
}
