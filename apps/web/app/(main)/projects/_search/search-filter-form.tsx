'use client';

// 2026-10-29: 人間の最新指示で基本検索10項目と詳細検索へ拡張。以下の8項目の説明は旧仕様の履歴。
// apps/web/app/(main)/projects/_search/search-filter-form.tsx
// `S-010` の検索エリアの**本文**（改修指示書 §2 の B 層 / §3）。
//
// ============================================================================
// 🔴 検索項目は 8 つちょうどである（指示書 §3）
// ============================================================================
// キーワード / ステータス / カテゴリ / スキル / 稼働形態 / 単価（月額）/ 勤務地 / 開始時期。
//
// 🔴 **「並行可否」は無い**（指示書 §3。ラベルも入力欄も、`./filters.ts` の型にも無い）。
// 🔴 **選択肢・初期値・ID・単価の入力単位は既存実装のまま**（指示書 §3「見た目の都合で円と
//    万円を入れ替えたり、ダミーのマスターデータに置き換えたりしないでください」）——
//    選択肢は `list-props.ts` が `@ses/i18n` と `@ses/domain` から組んだものを受け取るだけである。
//
// ============================================================================
// 🔴 段組みは「器の幅」で決まる（指示書 §2）
// ============================================================================
// 768px 以上 → 3 列 / 520〜767px → 2 列 / 520px 未満 → 1 列。
// 🔴 **ビューポート幅ではない**（`./use-element-width.ts` の 🔴）。列数は親が測って渡す。
// 2026-10-23: 右の常設パネルを確保するため、最大3列、全項目を同じ幅で並べる。
//
// ============================================================================
// ✅✅ 🔴 2026-10-19: 単一選択の 5 欄を素の `<select>` から `FilterSelect` にした
// ============================================================================
// 人間の明示指示: 「プルダウンの UI が要素によって異なるから、スキルのプルダウンと同じ
// UI にして」。ステータス / カテゴリ / 稼働形態 / 勤務地 / 開始時期が OS 既定の
// ドロップダウンで、**スキルだけが独自のポップオーバー**という混在を解消したものである
// （`./filter-select.tsx` が `./skill-multi-select.tsx` の単一選択版）。
//
// 🔴 **選択肢・値・並び順・「すべて」= 空文字の扱いは 1 つも変えていない。** 変えたのは
//    開き方と見た目だけであり、`options` は今までどおり props で受け取るだけである。
// 🔴 **キーワードと単価は素の入力欄のまま**（`<input type="search">` / `<input type="number">`）。
//    置き換える理由が無く、ネイティブのフォーム値を手放す理由も無い。
// 🔴🔴 **5 欄は `name` を持たない。** `role="combobox"` の `<div>` にネイティブのフォーム値は
//    無いので、送信は `./search-panel.tsx` の hidden input が担う（**スキルと同じ扱い**で
//    あり、折りたたみ中かどうかに依らず常に hidden が要る）。ここに `name` を戻すと
//    同じキーが 2 つ載って壊れる。

import { KeywordGroups } from './keyword-groups';
import { t } from '@ses/i18n';
import { PROJECT_DEVELOPMENT_PHASES, PROJECT_DEVELOPMENT_METHODS, PROJECT_UTILIZATION_BANDS } from '@ses/domain';
import {
  FILTER_GRID_CLASSES,
  FILTER_GRID_SPAN_2_CLASSES,
  FILTER_GRID_COLUMN_CLASSES,
  Field,
  SegmentedControl,
  Input,
  cn,
} from '@ses/ui';
import { FilterSelect, type FilterSelectMessages } from './filter-select';
import { PROJECT_SEARCH_FIELD_NAMES, type ProjectSearchDraft, type ProjectSearchOption } from './filters';
import { SkillMultiSelect, type SkillMultiSelectMessages } from './skill-multi-select';

/** 指示書 §2 の 3 段。🔴 **これ以外の段を作らない。** */
export type FilterColumnCount = 1 | 2 | 3 | 4;

/** 器の幅から段を決める。🔴 **純粋関数**（ユニットテストで固定する）。 */
export function filterColumnCount(width: number | null): FilterColumnCount {
  // 🔴 測る前は 4 列（サーバ描画と同じ段に留める。`./use-element-width.ts` の 🔴）。
  if (width === null) return 3;
  if (width >= 960) return 4;
  if (width >= 768) return 3;
  if (width >= 520) return 2;
  return 1;
}

export type SearchFilterFormMessages = {
  readonly q: string;
  readonly qPlaceholder: string;
  readonly status: string;
  readonly category: string;
  readonly skill: string;
  readonly remoteMode: string;
  readonly price: string;
  readonly priceMin: string;
  readonly priceMax: string;
  readonly priceMinPlaceholder: string;
  readonly priceMaxPlaceholder: string;
  readonly priceSeparator: string;
  readonly priceUnit: string;
  readonly priceInverted: string;
  readonly prefecture: string;
  readonly startWithin: string;
  readonly skillMessages: SkillMultiSelectMessages;
  /**
   * 🔴 **単一選択の 5 欄で共通の語**（絞り込み欄のラベル / プレースホルダ / 該当なし）。
   *    欄ごとに別の語を持たせない —— 同じ造りの欄で語だけ違うと、同じ操作に見えなくなる。
   */
  readonly selectMessages: FilterSelectMessages;
};

// 🔴 語彙を組むのは `../list-props.ts`（サーバ側）である。型をそこから引けるように
//    ここから再輸出する（部品の置き場所を知らずに props を組めるようにするため）。
export type { FilterSelectMessages };

export type SearchFilterFormOptions = {
  readonly statusOptions: readonly ProjectSearchOption[];
  readonly categoryOptions: readonly ProjectSearchOption[];
  readonly remoteModeOptions: readonly ProjectSearchOption[];
  readonly prefectureOptions: readonly ProjectSearchOption[];
  readonly startWithinOptions: readonly ProjectSearchOption[];
  readonly skillOptions: readonly ProjectSearchOption[];
};

export function SearchFilterForm({
  draft,
  openDetailsRequest,
  onChange,
  onComposingChange,
  columns,
  options,
  priceInverted,
  messages,
  testIdPrefix,
}: {
  readonly draft: ProjectSearchDraft;
  readonly openDetailsRequest?: number;
  readonly onChange: (patch: Partial<ProjectSearchDraft>) => void;
  /**
   * 🔴🔴 **日本語変換の開始 / 終了**（`search-panel.tsx` 冒頭の 🔴🔴）。
   *    変換の最中は「条件を入れた端から絞り込む」を止めるために要る ——
   *    Chrome は**変換中も `input` を飛ばす**ので、待ち時間だけでは
   *    「かんｋ」のような未確定の綴りで検索が走るのを防げない。
   */
  readonly onComposingChange: (composing: boolean) => void;
  readonly columns: FilterColumnCount;
  readonly options: SearchFilterFormOptions;
  readonly priceInverted: boolean;
  readonly messages: SearchFilterFormMessages;
  readonly testIdPrefix: string;
}) {
  // 🔴 2 列・1 列のときは単価も 1 列ぶん（2 列のときに 2 列分を取ると行が単価だけになる）。

  return (
    <div className="flex min-w-0 flex-col gap-3">
    <p className="m-0 bg-bg-subtle px-3 py-3 text-body font-semibold text-fg">{t('projects.search.basic')}</p>
    <div className={cn(FILTER_GRID_CLASSES, FILTER_GRID_COLUMN_CLASSES[columns])}>
      {/* 🔴 `as="div"` —— 引き金は `role="combobox"` の `<div>` であり、`<label>` では結べない
          （`Field` の既定は `<label>`。スキル欄と同じ扱いである）。読み上げ名は
          `aria-label` として `FilterSelect` に渡す。 */}
      <Field as="div" labelClassName="text-xs text-fg-muted" label={messages.status}>
        <FilterSelect
          options={options.statusOptions}
          value={draft.status}
          label={messages.status}
          messages={messages.selectMessages}
          testId={`${testIdPrefix}status`}
          onChange={(status) => {
            onChange({ status });
          }}
        />
      </Field>

      <Field as="div" labelClassName="text-xs text-fg-muted" label={messages.category}>
        <FilterSelect
          options={options.categoryOptions}
          value={draft.category}
          label={messages.category}
          messages={messages.selectMessages}
          testId={`${testIdPrefix}category`}
          onChange={(category) => {
            // 🔴 **カテゴリを変えてもスキルを消さない**（指示書 §3「カテゴリ変更でも、
            //    既存の明示的な制約がない限りスキルを勝手に消さないでください」）。
            onChange({ category });
          }}
        />
      </Field>

      <Field as="div" labelClassName="text-xs text-fg-muted" label={<span className="flex items-center gap-2" title={t('projects.search.skillTarget')}>{messages.skill}<span className="text-micro font-normal text-fg-muted">{t('projects.search.multiOR')}</span></span>}>
        <SkillMultiSelect
          options={options.skillOptions}
          values={draft.skills}
          onChange={(skills) => {
            onChange({ skills });
          }}
          messages={messages.skillMessages}
          testIdPrefix={testIdPrefix}
        />
      </Field>

      <Field as="div" labelClassName="text-xs text-fg-muted" label={<span className="flex items-center gap-2">{t('projects.search.phase')}<span className="text-micro font-normal text-fg-muted">{t('projects.search.multiOR')}</span></span>}>
        <SkillMultiSelect options={PROJECT_DEVELOPMENT_PHASES.map(value => ({ value, label: t(`projects.search.phase.${value}`), shortLabel: t(`projects.search.phaseShort.${value}`) }))}
          values={draft.developmentPhases ?? []} onChange={developmentPhases => onChange({ developmentPhases })}
          messages={{ ...messages.skillMessages, placeholder: t('projects.search.phasePlaceholder'), triggerLabel: t('projects.search.phase'), searchLabel: t('projects.search.phase'), searchPlaceholder: t('projects.search.phasePlaceholder') }}
          testIdPrefix={`${testIdPrefix}phases-`} checklist topHint={t('projects.search.multiOR')} />
      </Field>
      <Field as="div" labelClassName="text-xs text-fg-muted" label={t('projects.search.method')}>
        <SegmentedControl compact={columns === 1} options={[{ value: '', label: t('projects.search.all') }, ...PROJECT_DEVELOPMENT_METHODS.map(value => ({ value, label: t(`projects.search.method.${value}`) }))]}
          value={draft.developmentMethod ?? ''} label={t('projects.search.method')} testIdPrefix={`${testIdPrefix}development-method-`}
          onChange={developmentMethod => onChange({ developmentMethod })} />
      </Field>
      <Field as="div" labelClassName="text-xs text-fg-muted" label={messages.remoteMode}>
        <FilterSelect
          options={options.remoteModeOptions}
          value={draft.remoteMode}
          label={messages.remoteMode}
          messages={messages.selectMessages}
          testId={`${testIdPrefix}remote-mode`}
          onChange={(remoteMode) => {
            onChange({ remoteMode });
          }}
        />
      </Field>

      {/* 🔴 単価は**円**のまま（指示書 §3）。下限 > 上限は**検索前にこの欄で示す**（§6）。 */}
      <Field
        as="div"
        label={messages.price}
        labelClassName="text-xs text-fg-muted"
        error={priceInverted ? messages.priceInverted : undefined}
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            name={PROJECT_SEARCH_FIELD_NAMES.priceMin}
            min={0}
            step={10000}
            value={draft.priceMin}
            placeholder={messages.priceMinPlaceholder}
            aria-label={messages.priceMin}
            aria-invalid={priceInverted ? true : undefined}
            data-testid={`${testIdPrefix}price-min`}
            onChange={(event) => {
              onChange({ priceMin: event.currentTarget.value });
            }}
          />
          <span aria-hidden="true" className="shrink-0 text-body text-fg-muted">
            {messages.priceSeparator}
          </span>
          <Input
            type="number"
            name={PROJECT_SEARCH_FIELD_NAMES.priceMax}
            min={0}
            step={10000}
            value={draft.priceMax}
            placeholder={messages.priceMaxPlaceholder}
            aria-label={messages.priceMax}
            aria-invalid={priceInverted ? true : undefined}
            data-testid={`${testIdPrefix}price-max`}
            onChange={(event) => {
              onChange({ priceMax: event.currentTarget.value });
            }}
          />
          <span className="shrink-0 text-body text-fg-muted">{messages.priceUnit}</span>
        </div>
      </Field>

      {/* 🔴 勤務地は 48 件あるので、ここだけポップオーバーに絞り込み欄が出る
          （`./filter-select.tsx` の `FILTER_SELECT_SEARCH_THRESHOLD`）。 */}
      <Field as="div" labelClassName="text-xs text-fg-muted" label={messages.prefecture}>
        <FilterSelect
          options={options.prefectureOptions}
          value={draft.prefecture}
          label={messages.prefecture}
          messages={messages.selectMessages}
          testId={`${testIdPrefix}prefecture`}
          onChange={(prefecture) => {
            onChange({ prefecture });
          }}
        />
      </Field>

      <Field as="div" labelClassName="text-xs text-fg-muted" label={messages.startWithin}>
        <FilterSelect
          options={options.startWithinOptions}
          value={draft.startWithin}
          label={messages.startWithin}
          messages={messages.selectMessages}
          testId={`${testIdPrefix}start-within`}
          onChange={(startWithin) => {
            onChange({ startWithin });
          }}
        />
      </Field>
      <Field as="div" className={columns > 1 ? FILTER_GRID_SPAN_2_CLASSES : undefined} labelClassName="text-xs text-fg-muted" label={t('projects.search.utilization')}>
        <SegmentedControl compact={columns === 1} options={[{ value: '', label: t('projects.search.all') }, ...PROJECT_UTILIZATION_BANDS.map(value => ({ value, label: t(`projects.search.band.${value}`) }))]}
          value={draft.utilizationBand ?? ''} label={t('projects.search.utilization')} testIdPrefix={`${testIdPrefix}utilization-`}
          onChange={utilizationBand => onChange({ utilizationBand, utilizationMin: '', utilizationMax: '' })} />
        {!draft.utilizationBand && (draft.utilizationMin || draft.utilizationMax) ? <p className="m-0 text-xs text-fg-muted">{t('projects.search.legacyUtilization')}</p> : null}
      </Field>
    </div>
    <KeywordGroups openRequest={openDetailsRequest} draft={draft} onChange={onChange} onComposingChange={onComposingChange} testIdPrefix={testIdPrefix} />
    </div>
  );
}
