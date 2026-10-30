import { parseProjectKeywordGroups } from '@ses/domain';
// 2026-10-29: 人間の最新指示で基本検索10項目と詳細検索へ拡張。以下の8項目の説明は旧仕様の履歴。
// apps/web/app/(main)/projects/_search/filters.ts
// `S-010` 自社案件管理の検索エリアの**条件そのもの**（純粋関数だけ。React に依存しない）。
//
// ============================================================================
// 🔴 なぜ型と導出をここに閉じるのか
// ============================================================================
// 改修指示書 §6 は **`draftFilters`（編集中）と `appliedFilters`（一覧に適用済み）を分ける**
// ことと、**条件バーを `draftFilters` から導出し、バッジ専用の別状態で二重管理しない**ことを
// 求めている。導出をコンポーネントの中に書くと、「バッジに出る条件」と「送信される条件」が
// 別々に育ち、**見えている条件と実際の検索結果がずれる**（指示書 §6 が禁じている状態）。
//
// 🔴 **ここは `packages/i18n` を import しない。** 語はすべて引数で受け取る
//    （`*.test.ts` が文言を持たずに導出だけを試せる状態を壊さない）。
//
// ============================================================================
// 🔴 「並行可否」をどう外したか（指示書 §3）
// ============================================================================
// 指示書: 「ラベルと入力欄だけでなく、この画面の**検索状態・送信条件・保存対象**からも除外」
//         「古い URL や保存条件に同項目が含まれていても、読み込み時に正規化して検索に影響させない」
//
// 🔴 **この型（`ProjectSearchDraft`）に `parallelOk` のキーが無いこと**が除外の本体である。
//    フォームが送るのはこの型から組んだ hidden input だけなので、**送信条件に載る経路が無い**。
// 🔴 URL 側は `page.tsx` が `projectListQuerySchema` の結果から `parallelOk` を落とす。
// 🔴 保存条件側は `parseSavedFilters` が未知のキーを**読み捨てる**（下）。
// ⚠️ **DB の列も `packages/db` の述語も消していない**（指示書「DB の列削除や他画面の項目削除は不要」）。

/**
 * 編集中 / 適用済みの検索条件。
 *
 * 🔴 **指示書 §3 の 8 項目ちょうどである**（キーワード / ステータス / カテゴリ / スキル /
 *    稼働形態 / 単価（月額）/ 勤務地 / 開始時期）。**増やさない。**
 * 🔴 **値の形は既存の query に合わせる**（`''` = 未指定、`skills` だけ配列）——
 *    「見た目の都合で円と万円を入れ替えたり、ダミーのマスターデータに置き換えたりしない」
 *    （指示書 §3）。単価は**円**のままである。
 */
export type ProjectSearchDraft = {
  readonly developmentPhases?: readonly string[];
  readonly developmentMethod?: string;
  readonly utilizationBand?: string;
  readonly utilizationMin?: string;
  readonly utilizationMax?: string;
  readonly keywordGroups?: string;
  readonly q: string;
  readonly status: string;
  readonly category: string;
  readonly skills: readonly string[];
  readonly remoteMode: string;
  readonly priceMin: string;
  readonly priceMax: string;
  readonly prefecture: string;
  readonly startWithin: string;
};

/** 🔴 「すべて」「指定なし」は**空文字**である（番兵の値を作らない）。 */
export const EMPTY_PROJECT_SEARCH_DRAFT: ProjectSearchDraft = {
  q: '',
  status: '',
  category: '',
  skills: [],
  remoteMode: '',
  priceMin: '',
  priceMax: '',
  prefecture: '',
  startWithin: '',
};

/** `<form>` が送るキー（`name` 属性）。🔴 **既存の query と 1 文字も違わない。** */
export const PROJECT_SEARCH_FIELD_NAMES = {
  developmentPhases: 'developmentPhases', developmentMethod: 'developmentMethod',
  utilizationBand: 'utilizationBand', utilizationMin: 'utilizationMin', utilizationMax: 'utilizationMax', keywordGroups: 'keywordGroups',
  q: 'q',
  status: 'status',
  category: 'category',
  skills: 'skills',
  remoteMode: 'remoteMode',
  priceMin: 'priceMin',
  priceMax: 'priceMax',
  prefecture: 'prefecture',
  startWithin: 'startWithin',
} as const;

/** 条件バーのバッジ 1 つ。🔴 **語は呼び出し側が渡した選択肢から引く**（ここは文言を持たない）。 */
export type ProjectSearchChip = {
  /** 解除の対象を表す鍵（`skill:<id>` / `status` / `price` …）。 */
  readonly key: string;
  /** バッジに出る語。 */
  readonly label: string;
};

/** バッジの語を組むために要る選択肢（`value` → `label`）。 */
export type ProjectSearchOption = {
  readonly shortLabel?: string;
  readonly value: string;
  readonly label: string;
};

/**
 * バッジの語を組むための語彙。
 *
 * 🔴 **「意味が曖昧になる値には項目名を付ける」**（指示書 §4。`勤務地：東京都` /
 *    `カテゴリ：バックエンド`）。どの項目に接頭辞を付けるかは**この語彙の有無**で決まる。
 */
export type ProjectSearchChipLabels = {
  readonly extraLabels?: Readonly<Record<string, string>>;
  readonly phaseOptions?: readonly ProjectSearchOption[];
  readonly statusOptions: readonly ProjectSearchOption[];
  readonly categoryOptions: readonly ProjectSearchOption[];
  readonly remoteModeOptions: readonly ProjectSearchOption[];
  readonly prefectureOptions: readonly ProjectSearchOption[];
  readonly startWithinOptions: readonly ProjectSearchOption[];
  readonly skillOptions: readonly ProjectSearchOption[];
  /** `カテゴリ` / `勤務地` / `開始時期` / `単価` / `キーワード`。 */
  readonly fieldLabels: {
    readonly q: string;
    readonly category: string;
    readonly prefecture: string;
    readonly startWithin: string;
    readonly price: string;
  };
  /** `カテゴリ：バックエンド` の `：`。 */
  readonly fieldSeparator: string;
  /**
   * 単価のバッジを組む 2 語（`〜` と `円`）。
   * 🔴 **上下限をまとめて 1 バッジ**（指示書 §4）。
   * 🔴🔴 **関数ではなく文字列で持つ** —— 語彙はサーバからクライアントに渡るので、
   *    関数を入れると RSC の境界で落ちる（「Functions cannot be passed directly…」。実測）。
   */
  readonly priceRangeSeparator: string;
  readonly priceUnit: string;
};

function labelOf(options: readonly ProjectSearchOption[], value: string): string | null {
  // 🔴🔴 **空文字は「すべて」であり条件ではない。**
  //    選択肢の先頭には `{ value: '', label: 'すべて' }` が入っているので、
  //    この 1 行が無いと**条件を 1 つも選んでいないのに「すべて」のバッジが 5 つ並ぶ**
  //    （指示書 §4「『すべて』『指定なし』などの初期値はバッジにしません」）。
  if (value === '') return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

/**
 * 条件バーに出すバッジ。
 *
 * 🔴 **初期値（`''`）はバッジにしない**（指示書 §4「『すべて』『指定なし』などの初期値は
 *    バッジにしません」）。
 * 🔴 **選択肢に無い値もバッジにしない** —— URL 直打ちで未知の値を指されても、
 *    語の無いバッジが出ない（`skills` も同じ）。
 * 🔴 **スキルは 1 項目につき 1 バッジ**、**金額範囲は上下限をまとめて 1 バッジ**（指示書 §4）。
 */
export function projectSearchChips(
  draft: ProjectSearchDraft,
  labels: ProjectSearchChipLabels,
): readonly ProjectSearchChip[] {
  const chips: ProjectSearchChip[] = [];
  const prefixed = (field: string, value: string): string =>
    `${field}${labels.fieldSeparator}${value}`;

  if (draft.q !== '') {
    chips.push({ key: 'q', label: prefixed(labels.fieldLabels.q, draft.q) });
  }
  // 🔴 ステータス（`募集中` / `終了`）と稼働形態（`フルリモート可` 等）は語だけで意味が通る。
  const status = labelOf(labels.statusOptions, draft.status);
  if (status !== null) chips.push({ key: 'status', label: status });
  const category = labelOf(labels.categoryOptions, draft.category);
  if (category !== null) {
    chips.push({ key: 'category', label: prefixed(labels.fieldLabels.category, category) });
  }
  for (const skillId of draft.skills) {
    const skill = labelOf(labels.skillOptions, skillId);
    if (skill !== null) chips.push({ key: `skill:${skillId}`, label: skill });
  }
  const remoteMode = labelOf(labels.remoteModeOptions, draft.remoteMode);
  if (remoteMode !== null) chips.push({ key: 'remoteMode', label: remoteMode });
  if (draft.priceMin !== '' || draft.priceMax !== '') {
    // 🔴 単位は**円のまま**（指示書 §3「見た目の都合で円と万円を入れ替えない」）。
    const range = `${draft.priceMin}${labels.priceRangeSeparator}${draft.priceMax}${labels.priceUnit}`;
    chips.push({ key: 'price', label: prefixed(labels.fieldLabels.price, range) });
  }
  const prefecture = labelOf(labels.prefectureOptions, draft.prefecture);
  if (prefecture !== null) {
    chips.push({ key: 'prefecture', label: prefixed(labels.fieldLabels.prefecture, prefecture) });
  }
  const startWithin = labelOf(labels.startWithinOptions, draft.startWithin);
  if (startWithin !== null) {
    chips.push({ key: 'startWithin', label: prefixed(labels.fieldLabels.startWithin, startWithin) });
  }
  for (const phase of draft.developmentPhases ?? []) {
    const label = labelOf(labels.phaseOptions ?? [], phase);
    if (label) chips.push({ key: `phase:${phase}`, label });
  }
  for (const key of ['developmentMethod', 'utilizationBand', 'utilizationMin', 'utilizationMax', 'keywordGroups'] as const) {
    const value = draft[key];
    if (value && labels.extraLabels?.[key]) chips.push({ key, label: prefixed(labels.extraLabels[key], key === 'keywordGroups' ? (parseProjectKeywordGroups(JSON.parse(value)) ?? []).filter(group => group.terms.length).map(group => `(${group.terms.join(` ${group.mode} `)})`).join(' AND ') : labels.extraLabels[value] ?? value) });
  }
  return chips;
}

/**
 * バッジの `×`。🔴 **その条件だけを初期値に戻す**（指示書 §4）。
 * 🔴 **未知の鍵では何も変えない**（黙って別の条件を消さない）。
 */
export function removeProjectSearchChip(
  draft: ProjectSearchDraft,
  key: string,
): ProjectSearchDraft {
  if (key.startsWith('phase:')) return { ...draft, developmentPhases: (draft.developmentPhases ?? []).filter(phase => phase !== key.slice(6)) };
  if (['developmentMethod', 'utilizationBand', 'utilizationMin', 'utilizationMax', 'keywordGroups'].includes(key)) return { ...draft, [key]: '' };
  if (key.startsWith('skill:')) {
    const skillId = key.slice('skill:'.length);
    return { ...draft, skills: draft.skills.filter((id) => id !== skillId) };
  }
  switch (key) {
    case 'q':
      return { ...draft, q: '' };
    case 'status':
      return { ...draft, status: '' };
    case 'category':
      return { ...draft, category: '' };
    case 'remoteMode':
      return { ...draft, remoteMode: '' };
    // 🔴 金額は 1 バッジなので**上下限をまとめて**戻す（§4「上下限をまとめて 1 バッジ」の対）。
    case 'price':
      return { ...draft, priceMin: '', priceMax: '' };
    case 'prefecture':
      return { ...draft, prefecture: '' };
    case 'startWithin':
      return { ...draft, startWithin: '' };
    default:
      return draft;
  }
}

/** 2 つの条件が同じか。🔴 **`未適用` の判定そのもの**（指示書 §6）。 */
export function isSameProjectSearchDraft(a: ProjectSearchDraft, b: ProjectSearchDraft): boolean {
  return (
    [...(a.developmentPhases ?? [])].sort().join(',') === [...(b.developmentPhases ?? [])].sort().join(',') &&
    (a.developmentMethod ?? '') === (b.developmentMethod ?? '') &&
    (a.utilizationBand ?? '') === (b.utilizationBand ?? '') &&
    (a.utilizationMin ?? '') === (b.utilizationMin ?? '') &&
    (a.utilizationMax ?? '') === (b.utilizationMax ?? '') &&
    JSON.stringify(projectDraftKeywordGroups(a).map(group => ({ ...group, terms: [...group.terms].sort() }))) === JSON.stringify(projectDraftKeywordGroups(b).map(group => ({ ...group, terms: [...group.terms].sort() }))) &&
    a.status === b.status &&
    a.category === b.category &&
    a.remoteMode === b.remoteMode &&
    a.priceMin === b.priceMin &&
    a.priceMax === b.priceMax &&
    a.prefecture === b.prefecture &&
    a.startWithin === b.startWithin &&
    // 🔴 **順序も含めて比較しない** —— `skills` は OR であり、並び順に意味が無い。
    a.skills.length === b.skills.length &&
    [...a.skills].sort().join(',') === [...b.skills].sort().join(',')
  );
}

/** 1 つも条件が無いか（条件バーの「条件は指定されていません」。指示書 §4）。 */
export function isEmptyProjectSearchDraft(draft: ProjectSearchDraft): boolean {
  return isSameProjectSearchDraft(draft, EMPTY_PROJECT_SEARCH_DRAFT);
}

/**
 * 単価の下限 > 上限。
 *
 * 🔴 **判定は `@ses/db` の `isUnitPriceRangeInverted` と同じ意味**にする（サーバは
 *    そちらで検索自体を止める）。ここはクライアント側で**検索前に該当欄で示す**ための
 *    同値判定であり（指示書 §6）、**2 つの判定が食い違うと「赤いのに検索が走る」**になる。
 * 🔴 片方だけの指定は正当である（`@ses/db` 側と同じ）。
 */
export function isProjectPriceRangeInverted(draft: ProjectSearchDraft): boolean {
  if (draft.priceMin === '' || draft.priceMax === '') return false;
  const min = Number(draft.priceMin);
  const max = Number(draft.priceMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  return min > max;
}

// ============================================================================
// 🔴 保存条件の読み書き（形式の検証）
// ============================================================================
/**
 * 保存されていた値を `ProjectSearchDraft` に**正規化**する。
 *
 * 🔴 **未知のキーは読み捨てる** —— これが「古い保存条件に `並行可否` が入っていても検索に
 *    影響しない」（指示書 §3 / §8 の完成条件）の本体である。
 * 🔴 **型が違う値も捨てる**（壊れたデータで画面を落とさない。指示書 §5）。
 */
export function parseSavedProjectSearchDraft(value: unknown): ProjectSearchDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: keyof ProjectSearchDraft): string => {
    const found = raw[key];
    return typeof found === 'string' ? found : '';
  };
  const skills = Array.isArray(raw.skills)
    ? raw.skills.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    ...(Array.isArray(raw.developmentPhases) ? { developmentPhases: raw.developmentPhases.filter((value): value is string => typeof value === 'string') } : {}),
    ...(text('developmentMethod') ? { developmentMethod: text('developmentMethod') } : {}),
    ...(text('utilizationBand') ? { utilizationBand: text('utilizationBand') } : {}),
    ...(text('utilizationMin') ? { utilizationMin: text('utilizationMin') } : {}),
    ...(text('utilizationMax') ? { utilizationMax: text('utilizationMax') } : {}),
    ...(validKeywordGroups(text('keywordGroups')) ? { keywordGroups: text('keywordGroups') } : {}),
    q: text('q'),
    status: text('status'),
    category: text('category'),
    skills,
    remoteMode: text('remoteMode'),
    priceMin: text('priceMin'),
    priceMax: text('priceMax'),
    prefecture: text('prefecture'),
    startWithin: text('startWithin'),
  };
}

function validKeywordGroups(value: string): boolean { try { return value.length <= 4000 && parseProjectKeywordGroups(JSON.parse(value)) !== null; } catch { return false; } }

/** 旧フリーワードも、送信時にはグループへ変換して保持する。 */
export function projectDraftKeywordGroups(draft: ProjectSearchDraft) {
  const groups = draft.keywordGroups ? [...(parseProjectKeywordGroups(JSON.parse(draft.keywordGroups)) ?? [])] : [];
  if (draft.q.trim()) groups.unshift({ mode: draft.q.includes('|') ? 'OR' : 'AND', terms: [...new Set(draft.q.split(draft.q.includes('|') ? '|' : /[\s\u3000]+/).map(term => term.trim()).filter(Boolean))] });
  return groups.filter(group => group.terms.length);
}
