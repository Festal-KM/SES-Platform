// packages/ui/src/lib/state-classes.ts
// 🔴 `docs/04` §7.10「インタラクションの 8 状態」を**プリミティブ間で 1 箇所に**持つ（SP-22 T-22-01）。
//
// なぜ 1 箇所なのか（§7.10 / §7.2）: **画面ごとに hover の見え方が違うと、「押せるのかどうか」を
// 毎回試すことになる。** 一貫性の定義は「同じ役割の要素が同じ見え方をすること」であり、
// 特に `focus-visible` は**全プリミティブで同一**でなければキーボード操作で位置を失う。
//
// | 状態 | 共通の表し方（§7.10） | ここでの実装 |
// |---|---|---|
// | default | semantic トークンのまま | 各プリミティブの `variant` |
// | hover | 背景を 1 段暗く（`--color-bg` → `--color-bg-subtle`、primary は `--color-brand` → `--color-brand-hover`）。**文字色は変えない** | 各プリミティブの `variant`（面の色は部品ごとに違うため） |
// | active | 背景をもう 1 段暗く。**1px も動かさない** | 同上（`--color-bg-inset`。⚠️ brand の 3 段目は下の 🔴） |
// | selected | 背景 `--color-brand-bg` + 文字 `--color-brand` + 左端 2px | `SELECTED_CLASSES` |
// | focus-visible | **2px のリング + 2px のオフセット。全プリミティブで同一** | `FOCUS_RING_CLASSES` |
// | disabled | 文字 `--color-fg-placeholder` + 背景 `--color-bg-inset` + `cursor: not-allowed` | `DISABLED_CLASSES` |
// | loading | ボタン = ラベルを進行表示に置換して押下を封じる / 領域 = `Skeleton` | `components/button.tsx` の `loading`（領域は Phase 3b の `Skeleton`） |
// | error | 入力欄 = border `--color-danger-border` + 下にメッセージ（`--color-danger`） | `lib/control-classes.ts` の `aria-invalid:*` と `components/field.tsx` の `FieldError` |
//
// 🔴 **状態の組み合わせの優先順**（§7.10）: `disabled` > `loading` > `error` > `selected` >
//    `active` > `hover` > `default`。**`focus-visible` は常に重ねて描く**（他の状態と排他にしない
//    —— 選択中の行にフォーカスが当たっていることが読めないと、キーボードで位置を失う）。
//    実装上は「`disabled:` が `hover:` より後に生成される」ことに依存する（Tailwind の
//    バリアント順。実測で確認済み）。**`hover:` を `disabled:` より後に書いても変わらない** ——
//    順序を決めるのは生成 CSS であって `class` 属性の並びではない（`./cn.ts` の経緯）。
//
// 🔴 **`disabled` で「権限が無い」「代理閲覧中」「ロールで実行できない」を表さない**
//    （`docs/04` `U-10` / §7.10 / §5-8）。**描画せず、その位置に理由テキストを置く。**
//    `disabled` を使ってよいのは**一時的で自明な不能**（送信中 / 必須未入力 / 提案先が空の
//    `DRAFT`）のみである。押せるように見える要素を残さないことと、CSS で隠すだけにしないことは
//    同じ規律の表裏であり、**権限の判定結果はサーバ側で DOM から取り除く**。
// 🔴 **`transform` / `height` / 影を遷移させない**（§7.9 / §7.10。hover で動くと 50 行の一覧が
//    波打つ）。遷移は `transition-colors`（background-color / border-color / color）だけで足りる。
//    150ms / `ease-out` は `@theme` の `--default-transition-*` が全ユーティリティに効かせる。

/**
 * focus-visible のリング。🔴 **全プリミティブで同一**（§7.10 / `docs/04` `Q-04-6` 既定 ①
 * ＝「既存プリミティブの見た目が変わることを許容する」）。
 *
 * - 色は `--color-brand`。🔴 **この定数が `docs/04` §7.9 の component 層である**（`@theme` に
 *   `--focus-ring` を宣言しない —— `@theme` に置くと画面からも書けてしまい「部品ごと」の縛りが
 *   消える。`docs/05` §2.3.2 の component 層の行）。**画面から色を変えられない。**
 * - `:focus` ではなく **`:focus-visible`**（マウス操作で出さない）。
 * - 🔴 `outline-none` を単独で書かない（§7.10）。ここでは必ずリングと**対**で出る。
 */
export const FOCUS_RING_CLASSES =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

/**
 * 色の遷移（`docs/04` §7.9: **150ms / `ease-out`**。対象は background-color / border-color /
 * color / opacity のみ）。
 *
 * 🔴 `transition-colors` 以外（`transition-all` / `transition-transform` / `transition-shadow`）を
 *    使わない。**`transform` / `height` を遷移させない** —— hover で動くと 50 行の一覧が波打つ。
 * ⚠️ `duration-150` は Tailwind の既定値と同じだが**明示する**（`docs/05` §2.3.2: トークンを
 *    起こさず既定のユーティリティで書く）。`ease-out` は既定（`ease-in-out` 相当）からの変更である。
 * 🔴 **300ms 以上を使わない**（毎日何百回も見る遷移は短いほどよい）。
 */
export const TRANSITION_CLASSES = 'transition-colors duration-150 ease-out';

/**
 * disabled の見た目（§7.10）。**文字 `--color-fg-placeholder` + 背景 `--color-bg-inset` +
 * `cursor: not-allowed`**。
 *
 * 🔴 この組のコントラスト比は約 2:1 であり、**4.5:1 の検査の対象外とする**（§7.10。意図して
 *    落としている —— 4.5:1 まで上げると有効な要素と区別がつかず、8 状態の弁別そのものが壊れる）。
 * 🔴 **`disabled:pointer-events-none` を入れない。** 入れるとポインタイベントを受け取らないため
 *    `cursor: not-allowed` が出ない（§7.10 が要求している手がかりが消える）。無効な
 *    `<button>` / `<input>` はイベントを発火しないので、押下の封じ込めには不要である。
 *    ⚠️ `pointer-events-none` を落としたぶん、`hover:` が disabled にも当たりうる。
 *    上の 🔴（`disabled:` が後に生成される）で上書きされる。
 * 🔴 **`disabled:opacity-60` をやめた**（従来の表し方）。半透明は「背景が透けた薄い文字」であって
 *    §7.10 の定める 2 色の組ではなく、**背景色を持つ行や帯の上で見え方が変わる**。
 */
export const DISABLED_CLASSES =
  'disabled:cursor-not-allowed disabled:bg-bg-inset disabled:text-fg-placeholder';

/**
 * ネイティブに描かれる切り替え入力（`<input type="checkbox">` / `<input type="radio">`）の disabled。
 *
 * 🔴 **`DISABLED_CLASSES` を使えない。** チェックボックス / ラジオの箱は UA が描くため、
 *    `background-color` / `color` を当てても**箱の見た目に届かない**（届くのは
 *    `accent-color` だけで、それは無効時の表現ではない）。§7.10 の「文字 + 背景の 2 色の組」は
 *    **背景を自分で描く要素**を前提にした定めであり、ここでは成立しない。
 * ⚠️ したがって唯一効く手がかりである不透明度を使う（T-21-05 からの継続）。**`opacity` は
 *    §7.9 が遷移を許している 4 プロパティの 1 つでもある。**
 */
export const DISABLED_TOGGLE_CLASSES = 'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * selected（行選択 / 現在地 / タブ）の見た目（§7.10）。**背景 `--color-brand-bg` + 文字
 * `--color-brand` + 左端 2px**。
 *
 * 🔴 **hover と selected を同じ見た目にしない**（`--color-bg-subtle` と `--color-brand-bg` で
 *    分ける）。**選択は maintained、hover は transient** であり、同じ色にすると「いま選んでいる
 *    行」と「いまポインタが乗っている行」が区別できない。
 */
export const SELECTED_CLASSES = 'border-l-2 border-l-brand bg-brand-bg text-brand';

/**
 * 一覧の行の selected（`<tr data-state="selected">`。`components/table.tsx`）。
 *
 * 🔴 **`SELECTED_CLASSES` から機械的に導出してはならない。** Tailwind はソースの**文字列**を
 *    走査してユーティリティを生成するため、`` `data-[state=selected]:${c}` `` のように組み立てた
 *    クラス名は**ソースに現れず、CSS が 1 行も生成されない**（テストは緑のまま見た目だけ消える。
 *    `apps/web/app/tailwind.css` 冒頭の `@source` と同じ壊れ方）。**必ず literal で書く。**
 * ⚠️ 2 つが食い違わないことは `tests/static/design-tokens.test.ts` が検査する。
 */
export const SELECTED_ROW_CLASSES =
  'data-[state=selected]:border-l-2 data-[state=selected]:border-l-brand data-[state=selected]:bg-brand-bg data-[state=selected]:text-brand';
