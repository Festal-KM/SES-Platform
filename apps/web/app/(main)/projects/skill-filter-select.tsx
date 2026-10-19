'use client';

// apps/web/app/(main)/projects/skill-filter-select.tsx
// `S-010` 自社案件管理の検索条件「スキル」（複数選択 / OR）。
//
// ============================================================================
// ✅✅ 2026-10-19 の人間の明示指示（受領モック付き）
// ============================================================================
// ① 「スキル選択部分は添付のようなデザインにして、選択したスキルはバッチ風の表示にする」
// ② 「スキル選択の横幅をもっと長くする。幅以上に選択されたとしても行間が高くなることが
//     ないようにする」
//
// ============================================================================
// 🔴 なぜこの画面に初めて `'use client'` の島を作ったのか
// ============================================================================
// 受領モックのポップアップには **「スキルを検索…」の欄**が在る。**語で候補を絞るのは
// CSS だけでは書けない**（入力の値で兄弟要素を選ぶセレクタが存在しない）。2026-10-18 までは
// 「押しても何も起きない欄を作らない」という理由でこの欄を置いていなかったが、
// **同じモックで 2 度目の指示が来た**ため、欄を置く側に倒した（`CLAUDE.md` の規律ではなく、
// 私の判断だったもの）。
//
// 🔴 **JS が無くても絞り込みは死なない。** 開閉は素の `<details>` が持ち、選択肢は素の
//    `<input type="checkbox" name="skills">` であり、送信は親の `<form method="get">` である。
//    水和しなくても「開く → 選ぶ → 検索」は成立する（効かなくなるのは**検索欄と
//    バッジの即時反映だけ**）。島を作ったことで操作そのものを JS に依存させていない。
// 🔴 **DB も API も 1 文字も変えていない。** 送る形は従来どおり `skills=A&skills=B` である。
//
// ============================================================================
// 🔴 バッジが表すのは「これから送る条件」である（2026-10-19 に変えた）
// ============================================================================
// 旧実装のバッジは **URL（いま効いている条件）**を表し、ポップアップのチェックは
// **これから送る条件**で、`検索` を押すまで両者は一致しなかった。受領モックは
// **チェックした 5 件がそのままバッジになっている**ため、**バッジ = チェック**に揃えた。
// 🔴 これに伴い `×` は**リンクから button に変わった**（押した瞬間に遷移せず、チェックが外れる）。
//    ⚠️ 外した条件が一覧に効くのは `検索` を押したときである —— チェックを外す操作と
//       `×` の操作で挙動が割れないことのほうが、1 クリックの近道より大事だと判断した。
import { useEffect, useId, useRef, useState } from 'react';
import {
  Badge,
  Checkbox,
  FOCUS_RING_CLASSES,
  Icon,
  Input,
  MULTI_SELECT_BADGE_REMOVE_CLASSES,
  MULTI_SELECT_BADGE_ROW_CLASSES,
  MULTI_SELECT_EMPTY_CLASSES,
  MULTI_SELECT_LIST_CLASSES,
  MULTI_SELECT_OPTION_CLASSES,
  MULTI_SELECT_OPTION_SELECTED_CLASSES,
  MULTI_SELECT_PANEL_CLASSES,
  MULTI_SELECT_SEARCH_CLASSES,
  MULTI_SELECT_TRIGGER_CLASSES,
  cn,
} from '@ses/ui';

/** 🔴 語は**スキル辞書の `name`** であり `packages/i18n` に無い（辞書はデータである）。 */
export type SkillFilterOption = {
  readonly value: string;
  readonly label: string;
};

export type SkillFilterSelectMessages = {
  /** 1 つも選んでいないときの引き金の語。🔴 空の引き金を置かない（壊れて見える）。 */
  readonly all: string;
  /** `×` の読み上げの語（`${label}${remove}` で組む）。 */
  readonly remove: string;
  /** ポップアップの中の検索欄のプレースホルダ。 */
  readonly searchPlaceholder: string;
  /** 検索欄の読み上げの語（見えるラベルを持たないため必須）。 */
  readonly searchLabel: string;
  /** 語に 1 件も当たらなかったときの 1 行。 */
  readonly noMatch: string;
};

/**
 * スキル条件の複数選択。
 *
 * 🔴 **`name` は呼び出し側が渡さない。** この部品は `S-010` の `skills` 専用であり、
 *    汎用の複数選択にしていない —— 汎用にすると query の名前が呼び出し側に散り、
 *    「どの画面がどの条件を送るか」をコードから読めなくなる。
 */
export function SkillFilterSelect({
  options,
  defaultValues,
  messages,
}: {
  readonly options: readonly SkillFilterOption[];
  readonly defaultValues: readonly string[];
  readonly messages: SkillFilterSelectMessages;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  // 🔴 **初期値はサーバが描いた「いま効いている条件」**（URL）である。水和の前後で
  //    バッジの中身が変わらないので、ちらつかない。
  const [values, setValues] = useState<readonly string[]>(defaultValues);
  const [keyword, setKeyword] = useState('');

  // 🔴 **外側を押したら閉じる / `Escape` で閉じる。** `<details>` の素の挙動はどちらも
  //    持たず、開きっぱなしのポップアップが下の条件を覆う。**島を作った以上はここを直す。**
  // ⚠️ `open` を React の状態にしない —— 素の `<details>` に任せたまま DOM を直接閉じる。
  //    状態にすると JS が無いときに開かなくなる（上の 🔴「JS が無くても死なない」が壊れる）。
  useEffect(() => {
    const close = (event: Event): void => {
      const details = detailsRef.current;
      if (details === null || !details.open) return;
      if (event.target instanceof Node && details.contains(event.target)) return;
      details.open = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const details = detailsRef.current;
      if (details === null || !details.open) return;
      details.open = false;
      // 🔴 閉じたら引き金に焦点を戻す（キーボードの利用者が迷子にならない）。
      // 🔴 **`preventScroll`** —— 焦点を移すと既定で可視位置までスクロールする。
      //    引き金はいま開いていたポップアップの真上にあり**すでに見えている**ので、
      //    ここで画面が動くのは「閉じただけなのにページが飛んだ」になる。
      details.querySelector('summary')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const normalized = keyword.trim().toLowerCase();
  // 🔴 **選んだものは「選んだ順」ではなく辞書の順で並べる** —— 押すたびにバッジが
  //    並べ替わると、どれを外すのか目で追えない。
  const selected = options.filter((option) => values.includes(option.value));
  const matched = new Set(
    options
      .filter((option) => normalized === '' || option.label.toLowerCase().includes(normalized))
      .map((option) => option.value),
  );

  return (
    <details
      ref={detailsRef}
      className="group/skills relative"
      onToggle={(event) => {
        // 🔴 開いたら検索欄に焦点を置く（モックの欄はそのために在る）。
        // 🔴🔴 **`preventScroll`** —— 検索欄はポップアップの中（＝ 開いた瞬間に生える要素）に
        //    あり、既定の `focus()` はそこまで**ページをスクロールする**。絞り込みの帯は
        //    画面の上端にあるので、開いただけで一覧が上へ飛ぶ。実測で Playwright が
        //    「要素が安定しない」と判定するほど動いていた。
        if (event.currentTarget.open) {
          searchRef.current?.focus({ preventScroll: true });
          return;
        }
        // 🔴 閉じたら語を捨てる —— 次に開いたときに「前回の絞り込みが効いたまま」だと、
        //    選択肢が減っているのを壊れたと読み違える。
        setKeyword('');
      }}
    >
      <summary
        className={cn(MULTI_SELECT_TRIGGER_CLASSES, FOCUS_RING_CLASSES)}
        aria-controls={panelId}
        data-testid="project-list-filter-skills"
      >
        {/* 🔴 **折り返さない帯**（`MULTI_SELECT_BADGE_ROW_CLASSES`）。いくつ選んでも
            欄の高さは 36px のままで、同じ行の `単価` も下の行も動かない。 */}
        <span className={MULTI_SELECT_BADGE_ROW_CLASSES}>
          {selected.length === 0 ? (
            <span className="text-fg-placeholder">{messages.all}</span>
          ) : (
            selected.map((option) => (
              // 🔴 受領モックのバッジは**淡い藍の面に藍の文字**である（`variant="brand"`）。
              //    状態の色（`StatusBadge`）とは別物なので、意味のある色を割り当てない。
              <Badge key={option.value} variant="brand" className="gap-1">
                {option.label}
                <button
                  type="button"
                  className={MULTI_SELECT_BADGE_REMOVE_CLASSES}
                  aria-label={`${option.label}${messages.remove}`}
                  data-testid={`project-list-filter-skill-remove-${option.value}`}
                  onClick={(event) => {
                    // 🔴 **`<summary>` の中の button である。** 既定の動作（開閉）を止めないと、
                    //    `×` を押すたびにポップアップが開いたり閉じたりする。
                    event.preventDefault();
                    event.stopPropagation();
                    setValues((current) => current.filter((value) => value !== option.value));
                  }}
                >
                  <Icon name="x" size="sm" />
                </button>
              </Badge>
            ))
          )}
        </span>
        {/* 🔴 印であって意味ではない（開閉は `<details>` が持つ）。 */}
        <Icon
          name="chevron-down"
          className="shrink-0 text-fg-muted transition-transform group-open/skills:rotate-180"
        />
      </summary>
      <div id={panelId} className={MULTI_SELECT_PANEL_CLASSES} data-testid="project-list-filter-skills-panel">
        {/* ✅✅ **2026-10-19: 受領モックの「スキルを検索…」**（上の 🔴 参照）。
            🔴 **`name` を持たせない** —— 持たせると絞り込みの語が URL に乗り、
               API に無い条件を送ることになる（`<form>` は name のある欄だけを送る）。
            🔴 **`Enter` で送信させない** —— 語を打って `Enter` を押すのは「絞る」意図であり、
               そこで検索が走ると**選ぶ前に画面が変わる**。 */}
        <div className={MULTI_SELECT_SEARCH_CLASSES}>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
          />
          <Input
            ref={searchRef}
            type="search"
            className="pl-8"
            value={keyword}
            aria-label={messages.searchLabel}
            placeholder={messages.searchPlaceholder}
            data-testid="project-list-filter-skills-search"
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </div>
        <div className={MULTI_SELECT_LIST_CLASSES}>
          {options.map((option) => {
            const checked = values.includes(option.value);
            // 🔴 **当たらなかった選択肢も描いたまま隠す**（`hidden`）—— 外すと
            //    **チェック済みの `<input>` が DOM から消えて送信に載らない**。
            //    語で絞った結果、選んでいた条件が静かに落ちる、という壊れ方になる。
            const hidden = !matched.has(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  MULTI_SELECT_OPTION_CLASSES,
                  checked ? MULTI_SELECT_OPTION_SELECTED_CLASSES : null,
                  hidden ? 'hidden' : null,
                )}
              >
                <Checkbox
                  name="skills"
                  value={option.value}
                  checked={checked}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setValues((current) =>
                      next
                        ? [...current, option.value]
                        : current.filter((value) => value !== option.value),
                    );
                  }}
                />
                {option.label}
              </label>
            );
          })}
          {/* 🔴 空のパネルを出さない（絞り込んだ結果が 0 件なのか壊れたのか分からない）。 */}
          {matched.size === 0 ? (
            <p className={MULTI_SELECT_EMPTY_CLASSES} data-testid="project-list-filter-skills-no-match">
              {messages.noMatch}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
