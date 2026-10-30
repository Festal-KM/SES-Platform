'use client';

// 2026-10-29: 最新指示は検索ボタンで適用。以下の自動検索の説明は旧挙動の履歴。
// apps/web/app/(main)/projects/_search/search-panel.tsx
// `S-010` 自社案件管理の**検索エリア**（改修指示書の全体。§2 の A / B / C の 3 層）。
//
// ============================================================================
// 🔴 3 層の構造（指示書 §2）
// ============================================================================
//   A. 常時表示するヘッダー … タブ（検索条件 / 保存した条件 N）+ 条件を保存 + 折りたたむ
//   B. 折りたためる本文     … 検索項目 / 保存条件の一覧（タブで入れ替わる）
//   C. 常時表示する条件バー … 選択中の条件 + ＋N / 未適用 / クリア / 検索
//
// 🔴 **本文を閉じても A と C は残る**（指示書 §2 / §4）。
//
// ============================================================================
// 🔴🔴 検索は「素の GET フォーム」のまま。ただし**画面は再読み込みしない**
// ============================================================================
// ✅✅ **2026-10-19 の人間の指示「検索するたびにページリロードが発生するので、発生しない
//    ような方式にして。選択条件を部分的に削除した場合もすぐに適用されるようにして。」**
//
// 以前はこの `<form method="get">` を**ブラウザに素で送信させていた**ため、検索のたびに
// 文書ごと読み込み直していた（白い瞬間が出る / スクロール位置が飛ぶ / 開いていた
// ポップオーバーもタブの選択も消える）。
//
// 🔴 **いまは `onSubmit` で `preventDefault()` して `router.push()` に載せ替える。**
//    App Router のクライアント遷移なので、**文書は読み込み直さず RSC の差分だけが届く**。
//    この島の `useState`（タブ・開閉・保存条件）は遷移をまたいで**生き残る**。
//
// 🔴🔴 **送る URL は `new FormData(form)` から組む。** `draft` から組み直さない ——
//    組み直すと「ブラウザが送る内容」と「JS が送る内容」が**静かに食い違う**
//    （折りたたみ中の `<fieldset disabled>` と hidden の出し分けを 2 か所で再現する羽目になる）。
//    FormData なら**ブラウザ自身の答え**がそのまま手に入る。
// 🔴 **空の値も落とさない**（素の送信と 1 バイトも変えない）。`?hide=` のように
//    **空文字それ自体が意味を持つ**値がある（`hiddenColumnsParamValue`:
//    既定と同じなら `null` = 付けない / 全列表示なら `''` = 空で付ける）。
//
// 🔴 **`method="get" action="/projects"` は残す**（`tests/static/form-method-required.test.ts`）。
//    水和前の送信は従来どおりブラウザが処理する。
//
// ============================================================================
// 🔴🔴 条件を入れた端から絞り込む（検索ボタンを押さなくてよい）
// ============================================================================
// ✅✅ **2026-10-19 の人間の指示「検索ボタン押さなくても条件を入れていくと
//    どんどんフィルタリングかかっていった方が使いやすいよね」**
//
// 🔴 **待ち時間は 2 段である**（`AUTO_APPLY_*_DELAY_MS`）。1 つにまとめると必ずどちらかが壊れる:
//    ・**選ぶ欄**（ステータス / カテゴリ / 稼働形態 / 勤務地 / 開始時期）は **1 回の操作で
//      確定する**ので待たない。待つと「選んだのに効かない」と感じる。
//    ・**打つ欄とスキル**（キーワード / 単価 / スキルの複数選択）は**連続して変わる**ので待つ。
//      待たないと `基`→`基幹`→`基幹シ`… と 1 文字ごとに検索が走る。
//
// 🔴🔴 **日本語変換の最中は絶対に検索しない。**
//    Chrome は変換中も `input` を飛ばすので、待ち時間だけでは防げない ——
//    「かんｋ」のような未確定の綴りで検索が走る。`compositionstart` / `compositionend` を
//    見て、変換が終わるまで止める（`search-filter-form.tsx` の `onComposition*`）。
//
// 🔴 **単価の下限 > 上限のときは出さない。** 打っている途中は必ず一度は逆転する
//    （`800000` の上限を消して打ち直す間など）。`isProjectPriceRangeInverted` で止める。
//
// ⚠️ **`検索` ボタンは残す。** ①水和前（JS 無し）の唯一の送信経路であり、
//    ②`project-list-search` は `tests/static/testid-inventory.test.ts` の凍結対象であり、
//    ③変換の確定直後など「いま効かせたい」ときの明示の手段として要る。
//
// 🔴 **`draftFilters` と `appliedFilters` の分離**（指示書 §6）:
//    - `appliedFilters` = **URL**（サーバが解釈した、いま一覧に効いている条件）→ props で届く
//    - `draftFilters`   = **この島の `useState`**（編集中）
//    - `未適用`          = 2 つが違うこと
//    - `検索`            = 遷移（終わると `applied` が変わり、2 つが一致して印が消える）
//    🔴 **古い応答が新しい結果を上書きする余地が無い** —— 遷移の直列化は
//       App Router の router が行う（自前で競合を解く仕掛けを足さない）。
//
// 🔴 **戻る / 進むで `applied` が変わったら `draft` も合わせる**（下の `lastApplied`）。
//    再読み込みが無くなった＝**この島はもう作り直されない**ので、合わせないと
//    「一覧は戻ったのに検索欄は戻っていない」状態が残る。
//
// 🔴 **入力欄の `name` は付いたままである**（`search-filter-form.tsx` の 🔴🔴）。
//    本文を折りたたむと `<fieldset disabled>` で送信対象から外れるので、
//    **そのときだけ** hidden input が補う（指示書 §4）。

import { useEffect, useId, useRef, useState, useTransition } from 'react';
// 🔴 **クライアント遷移の入口**（ファイル冒頭の 🔴🔴）。`next/navigation` の router は
//    App Router のクライアント側であり、文書を読み込み直さず RSC の差分だけを取りに行く。
import { t } from '@ses/i18n';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  DIALOG_PANEL_NARROW_CLASSES,
  FILTER_BODY_CLASSES,
  FILTER_BODY_COLLAPSE_CLASSES,
  FILTER_BODY_COLLAPSE_CLOSED_CLASSES,
  FILTER_BODY_COLLAPSE_OPEN_CLASSES,
  Field,
  FieldError,
  Icon,
  IconButton,
  Input,
  Select,
  cn,
} from '@ses/ui';
// 🔴 overlay 部品（Radix）は `@ses/ui/client` に分かれている。
//    🔴 **import する側が `'use client'` を宣言している**
//       （`tests/static/ui-dependency-single-path.test.ts` (i)⑤。このファイルの 1 行目）。
import { Dialog, Tabs, Tooltip } from '@ses/ui/client';
import { ActiveFilterBar, type ActiveFilterBarMessages } from './active-filter-bar';
import {
  projectDraftKeywordGroups,
  EMPTY_PROJECT_SEARCH_DRAFT,
  PROJECT_SEARCH_FIELD_NAMES,
  isProjectPriceRangeInverted,
  isSameProjectSearchDraft,
  projectSearchChips,
  removeProjectSearchChip,
  type ProjectSearchChipLabels,
  type ProjectSearchDraft,
} from './filters';
import {
  SavedSearchList,
  type SavedSearchListMessages,
} from './saved-search-list';
import {
  SAVED_SEARCH_MAX,
  isValidSavedSearchName,
  searchExpandedCookieName,
  newSavedSearchId,
  readSavedSearches,
  readSavedSearchSelection,
  writeSavedSearchSelection,
  savedSearchStorageKey,
  writeSavedSearches,
  type SavedSearch,
} from './saved-searches';
import {
  SearchFilterForm,
  filterColumnCount,
  type SearchFilterFormMessages,
  type SearchFilterFormOptions,
} from './search-filter-form';
import { useElementWidth } from './use-element-width';

type PanelTab = 'SEARCH' | 'SAVED';

/**
 * 遷移を履歴に積むか、いまの 1 件を置き換えるか。
 *
 * 🔴 **`検索` と `保存条件の適用` は `PUSH`**（利用者が意図して行った移動であり、
 *    `戻る` で前の結果に帰れるべきである）。
 * 🔴 **バッジの `×` と `クリア` は `REPLACE`** —— これらは**押すたびに即座に適用される**ので、
 *    `PUSH` にすると条件を 3 つ外しただけで履歴が 3 件積まれ、`戻る` が使い物にならなくなる。
 */
type SubmitMode = 'PUSH' | 'REPLACE';

/**
 * 🔴 **打つ欄とスキルの待ち時間**（ファイル冒頭の 🔴🔴）。
 * ⚠️ 短くすると 1 文字ごとに検索が走り、長くすると「打ったのに効かない」と感じる。
 *    400ms は「次の文字を打つ間隔より長く、手が止まったと分かる最短」である。
 */
/** 🔴 **選ぶ欄は待たない**（1 回の操作で確定するため）。 */

/** どのダイアログが開いているか。🔴 **同時に 2 枚開かない**（`Dialog` の 🔴）。 */
type DialogState =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'SAVE' }
  | { readonly kind: 'RENAME'; readonly target: SavedSearch }
  | { readonly kind: 'OVERWRITE'; readonly target: SavedSearch }
  | { readonly kind: 'REMOVE'; readonly target: SavedSearch };

export type SearchPanelMessages = {
  readonly tabsLabel: string;
  readonly selectedSavedLabel: string;
  readonly selectedSavedModified: string;
  readonly tabSearch: string;
  readonly tabSaved: string;
  readonly save: string;
  readonly collapse: string;
  readonly expand: string;
  readonly saveDialogTitle: string;
  readonly saveDialogNameLabel: string;
  readonly saveDialogNamePlaceholder: string;
  readonly saveDialogConfirm: string;
  readonly renameDialogTitle: string;
  readonly overwriteDialogTitle: string;
  /** ✅ 2026-10-19 の人間の指示「検索条件を摘要してる場合は『条件を上書きする』ボタンを配置して」。 */
  readonly overwriteCurrent: string;
  readonly overwriteDialogConfirm: string;
  readonly removeDialogTitle: string;
  readonly removeDialogConfirm: string;
  readonly cancel: string;
  readonly nameError: string;
  readonly limitError: string;
  readonly writeError: string;
  readonly saved: string;
  readonly renamed: string;
  readonly overwritten: string;
  readonly removed: string;
  readonly summaryJoiner: string;
  /**
   * `「{name}」を…` の確認文を組むための部品。
   * 🔴🔴 **関数ではなく文字列で持つ** —— 語彙はサーバ（`list-props.ts`）から
   *    このクライアントの島に渡るので、関数を入れると RSC の境界で落ちる。
   */
  readonly quoteOpen: string;
  readonly overwriteDialogBodySuffix: string;
  readonly removeDialogBodySuffix: string;
  readonly saveDialogBodyPrefix: string;
  readonly saveDialogBodyEmpty: string;
  readonly form: SearchFilterFormMessages;
  readonly bar: ActiveFilterBarMessages;
  readonly savedList: SavedSearchListMessages;
  readonly chipLabels: ProjectSearchChipLabels;
};

export function SearchPanel({
  applied,
  options,
  passThroughParams,
  storageTenantId,
  storageUserId,
  defaultExpanded,
  messages,
}: {
  /** 🔴 **いま一覧に効いている条件**（URL をサーバが解釈したもの）。 */
  readonly applied: ProjectSearchDraft;
  readonly options: SearchFilterFormOptions;
  /**
   * 🔴 **画面に欄を持たないが URL には在る値**（`sourceKind` / `recruitingOnly` / `startFrom` と、
   *    表示の状態 `hide` / `selected` / `panelTab`）。
   *
   * 🔴 **素通しする理由**: 共有された URL を壊さないためである。送信に載せないと、
   *    検索を 1 回押しただけで**開いていた行も隠していた列も黙って消える**。
   * ⚠️ **`parallelOk` はここに入らない**（指示書 §3 で除外した。`page.tsx` が落とす）。
   */
  readonly passThroughParams: readonly { readonly name: string; readonly value: string }[];
  readonly storageTenantId: string;
  readonly storageUserId: string;
  readonly defaultExpanded: boolean;
  readonly messages: SearchPanelMessages;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [panelRef, panelWidth] = useElementWidth<HTMLFormElement>();
  const bodyId = useId();
  const router = useRouter();
  // 🔴 遷移の最中を知るため（`aria-busy`）。`startTransition` の中で `push` すると、
  //    新しい結果が届くまで**古い一覧を出したまま**待てる（空白を挟まない）。
  const [navigating, startNavigation] = useTransition();

  const [draft, setDraft] = useState<ProjectSearchDraft>(applied);
  const [tab, setTab] = useState<PanelTab>('SEARCH');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [animating, setAnimating] = useState(false);
  const [items, setItems] = useState<readonly SavedSearch[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const initialAppliedRef = useRef(applied);
  initialAppliedRef.current = applied;
  const [broken, setBroken] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'NONE' });
  const [name, setName] = useState('');
  const [detailsRequest, setDetailsRequest] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 🔴 **状態を書き換えた直後に送信する**ための旗（`null` = 送信待ちなし）。
  const [pendingSubmit, setPendingSubmit] = useState<SubmitMode | null>(null);
  // 🔴 送信の種類は `requestSubmit()` では運べない（`submit` 事件に載らない）ので ref で渡す。
  const submitModeRef = useRef<SubmitMode>('PUSH');
  // 🔴🔴 **自分が要求した条件**。これと一致する `applied` が届いたら「自分の遷移が着いた」、
  //    一致しなければ「外から来た遷移（戻る / 進む / 別のリンク）」である。
  const requestedRef = useRef<ProjectSearchDraft | null>(null);
  // 🔴🔴 **日本語変換の最中か**（ファイル冒頭の 🔴🔴）。`true` の間は自動の検索を止める。
  const [composing, setComposing] = useState(false);

  // 🔴🔴 **戻る / 進むで `applied` が変わったら `draft` も合わせる**（ファイル冒頭の 🔴）。
  //    ⚠️ **描画中に state を直すのは React の推奨する形である**（`useEffect` で追うと
  //       1 フレーム古い条件が見えてしまう）。
  //    🔴 **自分が要求した遷移では `draft` に触らない** —— 遷移を待っている間に利用者が
  //       次の条件を打っていることがあり、そこで `applied` に巻き戻すと**入力が消える**。
  const [lastApplied, setLastApplied] = useState<ProjectSearchDraft>(applied);
  if (!isSameProjectSearchDraft(lastApplied, applied)) {
    setLastApplied(applied);
    const requested = requestedRef.current;
    const mine = requested !== null && isSameProjectSearchDraft(requested, applied);
    if (!mine) setDraft(applied);
  }

  const storageKey = savedSearchStorageKey(storageTenantId, storageUserId);

  // 🔴 `localStorage` はサーバに無い。水和の後に読む（タブの件数は 1 フレーム遅れて出る）。
  useEffect(() => {
    const store = readSavedSearches(storageKey);
    setItems(store.items);
    setBroken(store.broken);
    const recorded = readSavedSearchSelection(storageKey);
    const initialId = recorded === undefined
      ? store.items.find((item) => isSameProjectSearchDraft(item.filters, initialAppliedRef.current))?.id ?? null
      : recorded;
    const restoredId = store.items.some((item) => item.id === initialId) ? initialId : null;
    setSelectedSavedId(restoredId);
    writeSavedSearchSelection(storageKey, restoredId);
  }, [storageKey]);

  // 🔴 **状態を書き換えた直後に送信する**ための 1 本道（`クリア` / `適用` / バッジの `×` が使う）。
  //    `setDraft` と同じ更新でこの旗を立てると、**入力欄と hidden input が新しい値になった後**に
  //    この効果が走る（旧い条件で送ってしまう事故が起きない）。
  // 🔴 `requestSubmit()` を通すのは、**送信の経路を 1 本に保つ**ためである ——
  //    URL を組むのは `onSubmit` の 1 か所だけにしたい（冒頭の 🔴🔴）。
  useEffect(() => {
    if (pendingSubmit === null) return;
    submitModeRef.current = pendingSubmit;
    setPendingSubmit(null);
    formRef.current?.requestSubmit();
  }, [pendingSubmit]);

  // 2026-10-29: 編集中の条件は、検索ボタンまたは送信操作で適用する。

  // 🔴 遷移が終わるまでだけ `overflow-hidden` にする（開いた後はプルダウンを切らない）。
  useEffect(() => {
    if (!animating) return;
    const timer = window.setTimeout(() => {
      setAnimating(false);
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animating]);

  const priceInverted = isProjectPriceRangeInverted(draft);
  const chips = projectSearchChips(draft, messages.chipLabels);
  const pending = !isSameProjectSearchDraft(draft, applied);
  // 適用元のIDは条件の一致判定から切り離す。編集・自動検索では選択を解除しない。
  const activeItem = items.find((item) => item.id === selectedSavedId) ?? null;
  const activeId = activeItem?.id ?? null;
  const overwriteTarget = activeItem;
  const savedModified = activeItem !== null && !isSameProjectSearchDraft(activeItem.filters, draft);
  const selectSaved = (id: string | null): void => {
    setSelectedSavedId(id);
    writeSavedSearchSelection(storageKey, id);
  };

  const summaryOf = (filters: ProjectSearchDraft): string =>
    projectSearchChips(filters, messages.chipLabels)
      .map((chip) => chip.label)
      .join(messages.summaryJoiner);
  // 🔴 語の連結は**ここ（クライアント側）**で行う（上の 🔴🔴）。
  const quoted = (name: string, suffix: string): string => `${messages.quoteOpen}${name}${suffix}`;
  const saveBody = (summary: string): string =>
    summary === '' ? messages.saveDialogBodyEmpty : `${messages.saveDialogBodyPrefix}${summary}`;

  const patch = (next: Partial<ProjectSearchDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const persist = (next: readonly SavedSearch[]): boolean => {
    const ok = writeSavedSearches(storageKey, next);
    // 🔴 **失敗しているのに「保存しました」を出さない**（指示書 §5）。
    if (!ok) {
      setError(messages.writeError);
      return false;
    }
    setItems(next);
    setBroken(false);
    setError(null);
    return true;
  };

  const toggleExpanded = (): void => {
    setAnimating(true);
    setExpanded((current) => {
      const next = !current;
      // 🔴 **開閉で検索 API を呼ばない**（指示書 §4）。残すのは cookie の 1 行だけである。
      document.cookie = `${searchExpandedCookieName(storageUserId)}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  const closeDialog = (): void => {
    setDialog({ kind: 'NONE' });
    setName('');
    setError(null);
  };

  // 🔴 ダイアログを開くときは**前回の通知を消す**（成功の語が残り続けない）。
  const openDialog = (next: DialogState, initialName = ''): void => {
    setNotice(null);
    setError(null);
    setName(initialName);
    setDialog(next);
  };

  // 🔴🔴 **失敗はダイアログの中に出す。**
  //    `Dialog` は画面全体を覆う背景（`z-40`）とパネル（`z-50`）であり、
  //    カードの中の通知行は**開いたままのダイアログの裏**に出る ——
    //    利用者には「保存を押しても何も起きない」になる（指示書 §5）。
  const dialogError = dialog.kind === 'NONE' ? null : error;

  const columns = filterColumnCount(panelWidth);

  // 🔴🔴 **①の素の入力欄（キーワード / 単価）が送信に使えるか**（下の「送信に載せる値」の①）。
  //    ・折りたたみ中 … 欄は DOM にあるが `<fieldset disabled>` なので送られない
  //    ・「保存した条件」タブ … 欄そのものが DOM に無い（Radix が外す）
  // 🔴 **両方を同時に出さない**（出すと同じキーが 2 つ載り、`optionalFilter` が壊れる）。
  // ⚠️ **②の自前の引き金には関係しない**（あちらは常に hidden で送る）。
  const formFieldsSubmit = expanded && tab === 'SEARCH';

  const body =
    tab === 'SEARCH' ? (
      <SearchFilterForm
        draft={draft}
        openDetailsRequest={detailsRequest}
        onChange={patch}
        // 🔴🔴 変換中は自動の検索を止める（ファイル冒頭の 🔴🔴）。
        onComposingChange={setComposing}
        columns={columns}
        options={options}
        priceInverted={priceInverted}
        messages={messages.form}
        testIdPrefix="project-list-filter-"
      />
    ) : (
      <SavedSearchList
        items={items}
        activeId={activeId}
        broken={broken}
        maxChips={panelWidth !== null && panelWidth < 640 ? 1 : 3}
        chipsOf={(item) => projectSearchChips(item.filters, messages.chipLabels).map((chip) => ({
          ...chip,
          // 一覧では列見出しが文脈を担うので、バッジは条件の値を優先する。
          label: ['q', 'category', 'price', 'prefecture', 'startWithin'].includes(chip.key)
            ? chip.label.slice(chip.label.indexOf(messages.chipLabels.fieldSeparator) + messages.chipLabels.fieldSeparator.length)
            : chip.label,
        }))}
        onApply={(item) => {
          // 🔴 **置き換える**（以前の条件とのマージはしない。指示書 §5）。
          setDraft(item.filters);
          selectSaved(item.id);
          persist(items.map((saved) => saved.id === item.id ? { ...saved, lastUsedAt: new Date().toISOString() } : saved));
          setPendingSubmit('PUSH');
        }}
        onRename={(item) => {
          openDialog({ kind: 'RENAME', target: item }, item.name);
        }}
        onOverwrite={(item) => {
          openDialog({ kind: 'OVERWRITE', target: item });
        }}
        onRemove={(item) => {
          openDialog({ kind: 'REMOVE', target: item });
        }}
        onSaveCurrent={() => {
          openDialog({ kind: 'SAVE' });
        }}
        messages={messages.savedList}
        testIdPrefix="project-list-"
      />
    );

  // 🔴 本文は**どちらのタブでも同じ器**に入る（指示書 §5「同じ本文領域に」）。
  const collapsible = (
    <div
      className={cn(
        FILTER_BODY_COLLAPSE_CLASSES,
        'min-w-0 grid-cols-1',
        expanded ? FILTER_BODY_COLLAPSE_OPEN_CLASSES : FILTER_BODY_COLLAPSE_CLOSED_CLASSES,
      )}
    >
      <div
        id={bodyId}
        // 🔴 **閉じた本文に Tab の焦点が入らない**（指示書 §4 / §8 の完成条件）。
        //    `inert` は中身を丸ごと操作対象から外す（`hidden` と違い遷移できる）。
        inert={!expanded}
        className={cn('min-h-0 min-w-0', expanded && !animating ? null : 'overflow-hidden')}
      >
          {/* 🔴🔴 **`<fieldset disabled>`**。`inert` は焦点を止めるが**送信は止めない**ので、
            折りたたみ中に `name` 付きの欄が残っていると hidden と**二重に送られる**。
            ⚠️ 無効な欄は**ネイティブ検証の対象外**にもなる —— 折りたたんだまま
               `min={0}` に引っかかって「検索が無反応」になる穴も同時に閉じる。
            🔴 `contents` なのでレイアウトには 1px も影響しない。 */}
        <fieldset className="contents" disabled={!expanded}>
          <div className={FILTER_BODY_CLASSES}>{body}</div>
        </fieldset>
      </div>
    </div>
  );

  const nameValid = isValidSavedSearchName(name);
  // 🔴 エラーの優先順：書き込みの失敗 > 名前の形式（前者を見えなくしない）。
  const saveFieldError = dialogError ?? (name !== '' && !nameValid ? messages.nameError : undefined);

  return (
    <Card className="w-full" data-testid="project-list-search-panel">
      {/* 🔴 **素の GET フォーム**（ファイル冒頭の 🔴🔴）。 */}
      <form
        // 🔴 **幅を測るのはこの要素である**（= 検索エリア自身の幅。指示書 §2）。
        //    `Card` は `ref` を受け取らないので、同じ幅を持つこの `<form>` で代用する。
        ref={(node) => {
          formRef.current = node;
          panelRef.current = node;
        }}
        method="get"
        action="/projects"
        data-testid="project-list-filters"
        // 🔴 遷移の最中であることを支援技術に伝える（見た目は変えない ——
        //    App Router は新しい結果が届くまで古い一覧を出したまま待つ）。
        aria-busy={navigating}
        onSubmit={(event) => {
          // 🔴 **種類を先に取り出して既定へ戻す。** 次の送信（利用者が `検索` を押す）は
          //    必ず `PUSH` であり、前回の `REPLACE` を引きずらせない。
          const mode = submitModeRef.current;
          submitModeRef.current = 'PUSH';

          // 🔴 **不正な入力は検索前に止める**（指示書 §6）。該当欄に赤が出ている。
          if (composing || navigating || isProjectPriceRangeInverted(draft)) {
            event.preventDefault();
            return;
          }

          const form = event.currentTarget;
          // 🔴🔴 **ここから先はブラウザに送らせない**（冒頭の 🔴🔴）。
          event.preventDefault();

          // 🔴 **ブラウザが送るはずだった内容をそのまま URL にする。**
          //    `FormData` は `<fieldset disabled>` の欄を既に除いてくれている ——
          //    折りたたみ / タブの出し分けをここで再現しなくてよい。
          const params = new URLSearchParams();
          for (const [key, value] of new FormData(form).entries()) {
            // ⚠️ この `<form>` にファイル欄は無い。型のための番人である。
            if (typeof value !== 'string') continue;
            // 🔴 **空も落とさない**（素の送信と 1 バイトも変えない。冒頭の 🔴）。
            params.append(key, value);
          }
          const query = params.toString();
          const href = query === '' ? '/projects' : `/projects?${query}`;

          // 🔴 **届いた `applied` が自分のものか判る**ようにしておく（`lastApplied` の 🔴🔴）。
          requestedRef.current = formFieldsSubmit ? { ...draft, q: '', keywordGroups: projectDraftKeywordGroups(draft).length ? JSON.stringify(projectDraftKeywordGroups(draft)) : '' } : draft;
          startNavigation(() => {
            // 🔴 **`scroll: false`** —— 条件を 1 つ外すたびに先頭へ飛ばされると、
            //    一覧を見ながら絞り込む操作が成り立たない。
            if (mode === 'REPLACE') router.replace(href, { scroll: false });
            else router.push(href, { scroll: false });
          });
        }}
      >
        <Tabs
          className="gap-0 [&_[role=tablist]]:flex-1 [&_[role=tablist]]:justify-between [&_[role=tab]]:text-cell [&_[role=tab][data-state=active]]:text-fg [&_[role=tab][data-state=active]]:border-transparent [&_[role=tab]:first-child]:text-lg [&_[role=tab]:first-child]:font-semibold"
          label={messages.tabsLabel}
          value={tab}
          onValueChange={(value) => {
            setTab(value === 'SAVED' ? 'SAVED' : 'SEARCH');
            // 🔴 **閉じた状態でタブを選んだら、そのタブの本文を開く**（指示書 §4）。
            if (!expanded) toggleExpanded();
          }}
          headerRight={
            <>
              <div className="min-w-0" data-testid={activeItem ? `project-list-search-selected-name` : undefined}><Select className="w-44" aria-label={t('projects.search.saved')} value={activeId ?? ''} data-testid="project-list-search-saved-select" onChange={event => {
                const item = items.find(item => item.id === event.currentTarget.value);
                if (!item) return;
                setDraft(item.filters); selectSaved(item.id); setTab('SEARCH');
                persist(items.map(saved => saved.id === item.id ? { ...saved, lastUsedAt: new Date().toISOString() } : saved));
              }}>
                <option value="">{t('projects.search.saved')}</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select></div>
              {activeItem === null ? null : (
                <div className="flex min-w-0 items-center gap-2 text-xs" data-testid="project-list-search-selected">
                  <span className="sr-only">{messages.selectedSavedLabel}</span>
                  <strong className="sr-only" title={activeItem.name}>{activeItem.name}</strong>
                  {savedModified ? <Badge data-testid="project-list-search-selected-modified">{messages.selectedSavedModified}</Badge> : null}
                </div>
              )}
              {overwriteTarget === null ? null : (
                <Tooltip content={messages.overwriteCurrent}>
                  <IconButton type="button" variant="ghost" size="sm"
                    aria-label={messages.overwriteCurrent} icon={<Icon name="save-all" />}
                    data-testid="project-list-search-overwrite-current"
                    onClick={() => { openDialog({ kind: 'OVERWRITE', target: overwriteTarget }); }} />
                </Tooltip>
              )}
              <Tooltip content={messages.save}>
                <IconButton type="button" variant="ghost" size="sm"
                  aria-label={messages.save}
                  icon={<Icon name="list-plus" />}
                  data-testid="project-list-search-save"
                  onClick={() => { openDialog({ kind: 'SAVE' }); }} />
              </Tooltip>
              <Tooltip content={expanded ? messages.collapse : messages.expand}>
                <IconButton type="button" variant="ghost" size="sm"
                  aria-label={expanded ? messages.collapse : messages.expand}
                  aria-expanded={expanded} aria-controls={bodyId}
                  icon={<Icon name="chevron-down" className={cn('transition-transform', expanded ? 'rotate-180' : null)} />}
                  data-testid="project-list-search-toggle" onClick={toggleExpanded} />
              </Tooltip>
            </>
          }
          items={[
            { value: 'SEARCH', label: t('projects.search.title'), icon: 'search', content: collapsible },
            {
              value: 'SAVED',
              // 🔴 **件数はタブの語に入れる**（指示書 §2「保存した条件 N」）。
              label: messages.tabSaved,
              count: items.length,
              content: collapsible,
            },
          ]}
        />

        {/* ====================================================================
            🔴🔴 送信に載せる値（ここが欠けると**エラーも出ずに前の条件で検索される**）
            ====================================================================
            欄は 2 種類あり、**hidden を出す条件が違う**。混ぜると壊れる。

            ① **素の入力欄**（キーワード / 単価の下限・上限）—— `name` を持つので
               **本文が見えていれば欄そのものが送る**（水合前に打った語もそのまま届く。
               `search-filter-form.tsx` の `name` の 🔴🔴）。
               折りたたみ中は `<fieldset disabled>` で送信対象から外れ、
               「保存した条件」タブでは欄が DOM から消える —— **そのときだけ** hidden が補う。
               🔴 **両方を同時に出さない**（同じキーが 2 つ載り `optionalFilter` が壊れる）。

            ② **自前の引き金**（ステータス / カテゴリ / スキル / 稼働形態 / 勤務地 / 開始時期）
               —— ✅✅ 2026-10-19 に `<select>` から `role="combobox"` の `<div>` に替えた
               （人間の指示「プルダウンの UI が要素によって異なるから、スキルのプルダウンと
               同じ UI にして」。`filter-select.tsx`）。
               🔴🔴 **`<div>` はネイティブのフォーム値を持たない。** したがって
               **常に hidden で送る** —— ①と同じ出し分けにすると、
               **本文を開いている間だけステータスが送られない**という最悪の壊れ方になる
               （画面には選んだ語が出ているのに検索に効かない）。 */}

        {/* ① 素の入力欄の控え */}
        {formFieldsSubmit || draft.q === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.q} value={draft.q} />
        )}
        {formFieldsSubmit || draft.priceMin === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.priceMin} value={draft.priceMin} />
        )}
        {formFieldsSubmit || draft.priceMax === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.priceMax} value={draft.priceMax} />
        )}

        {/* ② 自前の引き金の値（🔴 **常に出す**。上の 🔴🔴） */}
        {(draft.developmentPhases ?? []).map(phase => <input key={phase} type="hidden" name="developmentPhases" value={phase} />)}
        {(['developmentMethod', 'utilizationBand', 'utilizationMin', 'utilizationMax'] as const).map(key => draft[key] ? <input key={key} type="hidden" name={key} value={draft[key]} /> : null)}
        {formFieldsSubmit && projectDraftKeywordGroups(draft).length ? <input type="hidden" name="keywordGroups" value={JSON.stringify(projectDraftKeywordGroups(draft))} /> : !formFieldsSubmit && draft.keywordGroups ? <input type="hidden" name="keywordGroups" value={draft.keywordGroups} /> : null}
        {draft.status === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.status} value={draft.status} />
        )}
        {draft.category === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.category} value={draft.category} />
        )}
        {draft.remoteMode === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.remoteMode} value={draft.remoteMode} />
        )}
        {draft.prefecture === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.prefecture} value={draft.prefecture} />
        )}
        {draft.startWithin === '' ? null : (
          <input type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.startWithin} value={draft.startWithin} />
        )}
        {/* 🔴 スキルは**選んだぶんだけ同じ名前で並べる**（`skills=A&skills=B`。既存の形）。
            ⚠️ これも②である（`<div>` の引き金なので常に出す）。 */}
        {draft.skills.map((skillId) => (
          <input key={skillId} type="hidden" name={PROJECT_SEARCH_FIELD_NAMES.skills} value={skillId} />
        ))}
        {/* 🔴 画面に欄が無い条件と表示の状態（共有された URL を壊さない）。 */}
        {passThroughParams.map((param) => (
          <input key={`${param.name}:${param.value}`} type="hidden" name={param.name} value={param.value} />
        ))}

        {/* 旧案内のIDを、実装済みの検索条件を示す帯に引き継ぐ。文言を「準備中」には戻さない。 */}
        <div data-testid="project-list-search-coming-soon">
        <ActiveFilterBar
          chips={chips}
          pending={pending}
          submitting={navigating}
          compact={!expanded}
          keywordGroupCount={projectDraftKeywordGroups(draft).length}
          onOpenDetails={() => { setTab('SEARCH'); if (!expanded) toggleExpanded(); setDetailsRequest(value => value + 1); }}
          onCancel={() => setDraft(applied)}
          onRemove={(key) => {
            // ✅✅ **2026-10-19 の人間の指示「選択条件を部分的に削除した場合も
            //    すぐに適用されるようにして」** —— 外した時点で一覧に効く。
            // 🔴 **履歴は積まない**（`REPLACE`。`SubmitMode` の 🔴）。
            setDraft((current) => removeProjectSearchChip(current, key));

          }}
          onClear={() => {
            // 🔴 **全条件を初期値に戻して再検索**（保存した条件は消さない。指示書 §4）。
            selectSaved(null);
            setDraft(EMPTY_PROJECT_SEARCH_DRAFT);

          }}
          messages={messages.bar}
          testIdPrefix="project-list-"
        />
        </div>
      </form>

      {/* 🔴 **完了・失敗はその場で 1 行**（`role="status"`）。`Toast` は「対象への遷移」を
          必須に持つ部品であり、保存の完了には当たらない（`packages/ui` の `ToastSubject`）。 */}
      {notice === null && error === null ? null : (
        <p
          role="status"
          className={cn('m-0 px-4 pb-3 text-xs', error === null ? 'text-fg-muted' : 'text-danger')}
          data-testid="project-list-search-notice"
        >
          {error ?? notice}
        </p>
      )}

      {/* ====================================================================
          🔴 4 つの確認（保存 / 名前を変更 / 上書き / 削除）
          🔴 **`@ses/ui` の `Dialog` を使う**（`role="dialog"` を画面側に書かない）。
          ==================================================================== */}
      <Dialog
        open={dialog.kind === 'SAVE' || dialog.kind === 'RENAME'}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={dialog.kind === 'RENAME' ? messages.renameDialogTitle : messages.saveDialogTitle}
        body={saveBody(summaryOf(draft))}
        panelClassName={DIALOG_PANEL_NARROW_CLASSES}
        field={
          // 🔴 **`as="div"`**。既定の `<label>` のまま `error` を渡すと、
          //    `<label>` の中に `<p>` が入り（内容モデル違反）、エラー文が
          //    入力欄のアクセシブル名に畳み込まれる（`packages/ui/src/components/field.tsx` の 🔴）。
          <Field as="div" label={messages.saveDialogNameLabel} error={saveFieldError}>
            <Input
              value={name}
              placeholder={messages.saveDialogNamePlaceholder}
              maxLength={80}
              data-testid="project-list-search-save-name"
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </Field>
        }
        cancelLabel={messages.cancel}
        confirm={
          <Button
            type="button"
            // 🔴 **空欄では保存できない**（指示書 §5）。
            disabled={!nameValid}
            data-testid="project-list-search-save-confirm"
            onClick={() => {
              if (!nameValid) return;
              if (dialog.kind === 'RENAME') {
                const next = items.map((item) =>
                  item.id === dialog.target.id
                    ? { ...item, name: name.trim(), updatedAt: new Date().toISOString() }
                    : item,
                );
                if (persist(next)) {
                  setNotice(messages.renamed);
                  closeDialog();
                }
                return;
              }
              if (items.length >= SAVED_SEARCH_MAX) {
                setError(messages.limitError);
                return;
              }
              // 🔴 **保存しても検索は走らない**（指示書 §5「保存時に検索を自動実行せず、
              //    未適用の条件は未適用のままにします」）。
              const next = [
                ...items,
                {
                  id: newSavedSearchId(),
                  name: name.trim(),
                  filters: draft,
                  updatedAt: new Date().toISOString(),
                },
              ];
              if (persist(next)) {
                setNotice(messages.saved);
                closeDialog();
              }
              // 🔴 失敗したら**入力を保持したまま**開いておく（指示書 §5）。
            }}
          >
            {messages.saveDialogConfirm}
          </Button>
        }
      />

      <Dialog
        open={dialog.kind === 'OVERWRITE'}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={messages.overwriteDialogTitle}
        // 🔴 **対象名が分かる確認**（指示書 §5）。
        body={dialog.kind === 'OVERWRITE' ? quoted(dialog.target.name, messages.overwriteDialogBodySuffix) : ''}
        panelClassName={DIALOG_PANEL_NARROW_CLASSES}
        // 🔴 **失敗をダイアログの中に出す**（カードの通知行はパネルの裏になる）。
        field={dialogError === null ? undefined : <FieldError>{dialogError}</FieldError>}
        cancelLabel={messages.cancel}
        confirm={
          <Button
            type="button"
            data-testid="project-list-search-overwrite-confirm"
            onClick={() => {
              if (dialog.kind !== 'OVERWRITE') return;
              const next = items.map((item) =>
                item.id === dialog.target.id
                  ? { ...item, filters: draft, updatedAt: new Date().toISOString() }
                  : item,
              );
              if (persist(next)) {
                setNotice(messages.overwritten);
                closeDialog();
              }
            }}
          >
            {messages.overwriteDialogConfirm}
          </Button>
        }
      />

      <Dialog
        open={dialog.kind === 'REMOVE'}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={messages.removeDialogTitle}
        body={dialog.kind === 'REMOVE' ? quoted(dialog.target.name, messages.removeDialogBodySuffix) : ''}
        panelClassName={DIALOG_PANEL_NARROW_CLASSES}
        // 🔴 **失敗をダイアログの中に出す**（カードの通知行はパネルの裏になる）。
        field={dialogError === null ? undefined : <FieldError>{dialogError}</FieldError>}
        cancelLabel={messages.cancel}
        confirm={
          <Button
            type="button"
            data-testid="project-list-search-remove-confirm"
            onClick={() => {
              if (dialog.kind !== 'REMOVE') return;
              const next = items.filter((item) => item.id !== dialog.target.id);
              if (persist(next)) {
                if (dialog.target.id === selectedSavedId) selectSaved(null);
                setNotice(messages.removed);
                closeDialog();
              }
            }}
          >
            {messages.removeDialogConfirm}
          </Button>
        }
      />
    </Card>
  );
}
