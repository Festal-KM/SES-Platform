# UI_GUIDELINES.md — 画面を作る人のための規約

🔴 **このファイルを読めば、誰が作っても同じ UI になる。** 複数人で画面を分担するための規約である。

| | 役割 |
|---|---|
| **このファイル** | **「どう作るか」**。トークン・部品・レイアウト・禁止事項・新規画面のテンプレート |
| [`docs/design-system.md`](./docs/design-system.md) | **「何 px か」**。🔴 **寸法の出所はここだけ**（人間のデザインシステム定義 v1.0。2026-10-13） |
| [`docs/04-ui-design.md`](./docs/04-ui-design.md) | **「何を作るか」**。画面ごとの仕様（60 画面の目的・項目・権限差分）。🔴 **画面の中身はこちらが正** |
| [`CLAUDE.md`](./CLAUDE.md) | **一次資料**。情報境界・ハードルール。🔴 **衝突したら `CLAUDE.md` が勝つ** |

---

## 1. デザインコンセプト

**Ramp を参考にした、シンプルで情報密度の高い業務 UI。** 装飾やカードを増やさず、情報の階層と整列で、SES の営業・取引先が長時間使いやすい画面にする。Ramp の画面をそのまま模倣せず、BizOrch の業務・情報境界・既存トークンに合わせる。

🔴 ✅ **2026-10-13: 寸法は人間のデザインシステム定義 v1.0（`docs/design-system.md`）が正である。**
本ファイルは**名前と使い方**を持ち、**px はあちらが持つ**。食い違ったら `docs/design-system.md` を直す。

| 原則 | 具体 |
|---|---|
| **情報量が多くても見やすい** | 一覧は既定 50 行・8 列 + 操作列。ファーストビューに 12 行以上 |
| **装飾を足さない** | グラデーション・影の多用・比喩アイコン・絵文字を使わない。🔴 **例外はチャットのリアクションだけ**（絵文字 12 種。2026-10-22 紺野が決定・宮田の確認を PR で求める。絵文字の表は `apps/web/lib/chat/reactions.ts` の 1 か所で、ほかの画面では使わない）。🔴 **アイコンも、ボタン・見出しに付けてよいのはチャットの画面だけ**（2026-10-26 紺野が決定・宮田の確認を PR で求める。`packages/ui/src/icons.ts` の `chat-` で始まるもの。チャットの外で使うと `tests/static/chat-icon-scope.test.ts` が落とす。印だけのボタンは `IconButton` で `aria-label` を必ず付ける） |
| **カードを乱用しない** | 🔴 **同型データの一覧はテーブル。カードで並べない** |
| **階層が一目で分かる** | 1 画面で最も強い要素は 1 つだけ |
| **CTA が明確** | primary ボタンは 1 画面に 1 つ |
| **疲れにくい** | 彩度を上げない。色は意味のあるときだけ使う |

🔴 **色・サイズ・余白を自分で決めない。** 決めるのはこのファイルであり、画面側は**選ぶだけ**である。


### 1.1 業務画面を設計・確認するときの基準（2026-11-05・宮田の指示）

以下はホーム・案件一覧・案件詳細の改善で採用した考え方であり、全画面のタブ数や項目の並びを固定するものではない。画面固有の要件と権限は `docs/04-ui-design.md` を優先する。寸法・色・部品は本書と `docs/design-system.md` の既存トークンを使い、画像内の寸法を全画面の新しい既定値にしない。

- **情報の階層**: 案件名などの主題を最も目立たせ、判断に直結する状態・金額・場所・時期を先に置く。補足・更新日時・注意書きは主情報より控えめにする。内容を読めない小ささや薄さにしない。
- **密度と幅**: 業務の一覧はテーブル・行で整理し、詳細画面は目的ごとのセクションで区切る。同型のカードを並べて場所を消費しない。画面の外枠は共通レイアウトに任せ、本文・表の幅は内容に合う共通の幅を使う。ラベルと値を離しすぎず、長文や名称は自然に折り返す。
- **表示と編集**: ひとつの値を複数の場所に出すときは同じ保存済みデータから描き、更新・再読込・失敗時の整合を保つ。セクション単位の編集では対象だけを切り替え、保存・キャンセル・未保存時の確認を明確にする。公開停止などの業務処理・権限・監査は既存の仕組みを使う。
- **ナビゲーションと操作**: 主要な切替は文字と選択状態で区別し、意味のないアイコンや装飾を増やさない。補助操作は共通部品とツールチップを使う。コピーなどの通知は対象の操作を妨げず、失敗を利用者が認識できるようにする。
- **実データと状態**: 件数・履歴は認可された実データに基づいて表示する。未取得を 0 件、更新操作の記録を更新成功の履歴と決めつけない。未設定・0 件・読み込み・失敗・長文・長い名称も確認する。
- **幅と入力**: スマホでは判断材料を隠さず、必要に応じて並べ替え・折り返し・横スクロールを使う。操作の名前、フォーカス、キーボード、読み上げを確保する。画面ごとの操作やフォームが画面外へ出ないことを実機で確かめる。
- **共通化**: 同じ意味・操作の UI は既存部品を使う。足りなければ既存部品を拡張し、それでも足りない場合に共通部品を追加する。違う権限・情報境界・通知や確認の要件を、見た目だけを理由に一律化しない。変更後は影響する複数画面で表示と操作を確認する。

参考: 案件詳細の表示調整 [PR #213](https://github.com/Festal-KM/SES-Platform/pull/213)、ヘッダーの状態変更 [PR #214](https://github.com/Festal-KM/SES-Platform/pull/214) は作業中の提案であり、マージ済み機能や他画面の一律仕様を意味しない。

---

## 2. Layout 構造

```
AppShell                       … 全画面共通の外枠
├── Sidebar                    … 濃紺。グローバルナビ
└── Main
    ├── TopBar                 … 検索 / 通知 / ヘルプ / 所属 / アバター
    └── PageBody               … 本文領域（幅クラスを選ぶ）
        ├── PageHeader         … パンくず + ページ名 + 説明 + アクション
        ├── Toolbar            … 絞り込み・検索・列の表示切替
        ├── （本体）            … テーブル / フォーム / セクション群
        └── Pagination         … ページ送り
```

🔴 **この順序を入れ替えない。** 画面ごとに並びが違うと、利用者は毎回どこを見ればよいか探し直すことになる。

### 2.1 幅クラス（`PageBody` が決める。🔴 画面側で `max-w-*` を書かない）

| クラス | 用途 | 幅 |
|---|---|---|
| `full` | 一覧・ダッシュボード | 全幅（左右 gutter のみ） |
| `split` | 本体 + 副カラム（候補パネル等） | 🔴 副カラムは **388px 固定**（✅ 2026-10-13。`lg` 以上。**広い画面でも太らせない**） |
| `prose` | フォーム・読み物 | 720px・**左寄せ**（中央寄せにしない） |

**外枠の寸法**（🔴 **画面側で上書き禁止**。出所は `docs/design-system.md` §2 と `packages/ui/src/lib/layout-tokens.ts`）

| | px |
|---|---|
| サイドバー（展開 / アイコンのみ） | **208** / 56 |
| Top Header の高さ | **56** |
| 本文の左右 gutter | **左 28 / 右 16** |
| 本文の上下 | **20** |
| 本体 ↔ 副カラム | **16** |
| セクション Card の間 | **12** |

```tsx
<PageBody width="full">…</PageBody>
```

🔴 **画面ファイルに `max-w-3xl` などを書くと CI が落ちる**（`tests/static/ui-screen-width.test.ts`）。

---

## 3. Color

🔴 **色は `@theme` のトークンだけを使う。** `bg-slate-100` / `text-[#111]` / `bg-red-500` は **CI が落とす**。

### 3.1 一般的な呼び名との対応

| 一般的な呼び名 | このリポジトリ |
|---|---|
| Primary（青 `#2563EB`） | `brand` |
| Background（ページ地） | `bg` |
| **Surface（カード・パネルの地）** | `surface` |
| Border | `border` |
| Text Primary / Text Secondary | `fg` / `fg-muted` |
| Success / Warning / Info | `success` / `warning` / `info` |
| **Error** | 🔴 **`danger`**（`error` という名前は無い） |
| Secondary | 🔴 **無い。** 副次操作は**輪郭ボタンか文字リンク**で表す（色で表さない） |

### 3.2 全トークン

| 用途 | トークン |
|---|---|
| 文字 | `fg` / `fg-muted` / `fg-placeholder` |
| 面 | `bg` / `bg-subtle` / `bg-inset` / `surface` |
| 枠 | `border` / `border-strong` |
| ブランド藍 | `brand` / `brand-hover` / `brand-active` / `brand-bg` / `brand-fg` |
| 危険（赤） | `danger` / `danger-bg` / `danger-border` |
| 注意（橙） | `warning` / `warning-bg` / `warning-border` |
| 成果（緑） | `success` / `success-bg` / `success-border` |
| 情報（青） | `info` / `info-bg` / `info-border` |
| 無彩色 | `neutral-bg` / `neutral-border` |
| 一覧 | `row-hover-bg` / `table-header-bg` / **`border-row`**（🔴 行の区切り線だけ。カードの枠より薄い） |
| ワンポイント | **`tip-bg`**（🔴 ホームのワンポイント Card 1 箇所だけ） |
| サイドバー | `sidebar-bg` / **`sidebar-bg-end`**（🔴 グラデーションの下端） / `sidebar-fg` / `sidebar-fg-muted` / `sidebar-border` / `sidebar-hover-bg` / `sidebar-selected-bg` / `sidebar-selected-fg` |

🔴 **`sidebar-*` は `Sidebar` 以外で使わない**（濃色の面を増やさない。CI が落とす）。

### 3.3 色の意味（🔴 入れ替えない）

| 色 | 意味 |
|---|---|
| 藍 `brand` | 現在地・primary の操作 |
| 赤 `danger` | 失敗・エラー・不可逆な破棄 |
| 橙 `warning` | 期限が近い・要注意。**赤の代わりに使わない** |
| 緑 `success` | 成立・完了 |
| 青 `info` | 補足・案内 |
| 無彩 `neutral` | 状態なし・下書き |

🔴 **「見た目が良いから」で色を選ばない。** 色は業務上の意味を運ぶ。

---

## 4. Typography

🔴 **これ以外の文字サイズを作らない。** 値の出所は `docs/design-system.md` §3.2。

| トークン | px / weight / 行間 | 用途 |
|---|---|---|
| `text-title` | **26** / 700 / 34 | Page Title（1 画面に 1 つ） |
| `text-metric` | **28** / 700 / 32 | 🔴 **KPI の数値のみ**（`KpiCard` 以外で使うと CI が落ちる） |
| `text-rail` | **17** / 700 / 24 | 🔴 **右レールのカード見出しのみ**（`RailCard` 以外で使うと CI が落ちる） |
| `text-lg` | 16 / 700 / 24 | Card Title / Section Title |
| `text-row` | **15** / 500 / 20 | 一覧の行の主題 / ナビ項目 / タブ |
| `text-body` | 14 / 400 / 20 | 本文・ラベル・ボタン |
| `text-cell` | 13 / 500 / 18 | 行のサブ / デルタ / リンク / Badge / Button(sm) |
| `text-xs` | 12 / 400 | Caption・補助文 |
| `text-micro` | 11 / 500 | メタ情報 |

- フォントは `--font-sans`（Noto Sans JP）のみ。🔴 **別のフォントを読み込まない**
- 🔴 **`text-title` / `text-metric` / `text-rail` は「大きい文字が欲しい」ときの逃げ道ではない。** 使ってよいファイルが固定されている（`tests/static/design-tokens.test.ts`）

---

## 5. Spacing

🔴 **4px グリッドの決まった値だけ。** `p-9` / `mt-[10px]` は **CI が落とす**。

| クラス | px | 目安 |
|---|---|---|
| `1` | 4 | アイコンとラベルの間 |
| `1.5` | **6** | ナビ項目の間 |
| `2` | 8 | バッジの内側・密な縦積み |
| `3` | 12 | セルの内側・セクション Card の間 |
| `4` | 16 | 既定の間隔・カードの内側・本体 ↔ 副カラム |
| `5` | **20** | 本文の上下・KPI のアイコン面と文字の間 |
| `6` | 24 | 大きめの区切り |
| `7` | **28** | 本文の左 gutter |
| `8` | 32 | 画面の主要ブロックの間 |
| `12` | 48 | フォームのセクション間・空状態の上下 |

**その他の寸法**

| | 値 | どこで決まるか |
|---|---|---|
| Border Radius | `rounded-xs`(4px = Badge) / `rounded-sm`(6px = Button(sm)・IconButton) / `rounded-md`(8px = Button・Input・Nav) / `rounded-lg`(10px = Card・Panel・Dialog・Drawer) | トークン |
| Border | 1px（`border`）。左端の強調のみ 2px | 🔴 全周 2px は CI が落とす |
| Shadow | `shadow-control`（入力欄の輪郭）/ `shadow-overlay`（Dialog・Drawer・DropdownMenu・Tooltip・Toast） | 🔴 **この 2 つ以外の影は名前が無い** |
| Icon Size | `<Icon size="sm">`(16px) / `size="md"`(20px) | 🔴 `size-6` は CI が落とす |
| Button / Input Height | `sm` = 32px / `md` = **36px** | `CONTROL_HEIGHT_CLASSES` |
| Table Row Height | 約 36.5px（`py-2` + `text-cell`） | `Table` が決める。固定しない |
| **Section Card の行** | **45px**（ホームの要対応キュー） | `ROW_HEIGHT_CLASS`（`layout-tokens.ts`） |
| **行内の操作** | **146 × 32** | `ROW_ACTION_LINK_CLASSES` |

---

## 6. 共通コンポーネント

### 6.1 import の仕方

```tsx
import { Button, DataTable, PageHeader } from '@ses/ui';          // サーバ部品
import { Dialog, Tabs, Tooltip } from '@ses/ui/client';           // 状態を持つ部品
```

🔴 **`'use client'` を画面に足さない。** クライアントが要る部品は `@ses/ui/client` に揃っている。

### 6.2 一覧（用途別）

| 分類 | 部品 | 用途 |
|---|---|---|
| **外枠** | `AppShell` `Sidebar` `TopBar` `PageBody` `PageHeader` `Toolbar` | 全画面共通。🔴 **自作しない** |
| **一覧** | `DataTable` `Table`(+`TableRow` / `TableCell` …) `Pagination` `NameCell` `DataTableSortLink` `DataTableColumnToggle` `DataTableSelectionCheckbox` | 同型データは必ずこれ |
| **操作** | `Button` `IconButton` | primary は 1 画面に 1 つ |
| **入力** | `Input` `Select` `Textarea` `Checkbox` `Radio` `Label` `Field`(+`FieldLabel` / `FieldDescription` / `FieldError`) `SearchInput` | 🔴 ラベル無しの入力を作らない |
| **表示** | `Card`(+`CardHeader` / `CardTitle` / `CardContent`) `Badge` `StatusBadge` `Alert` `EmptyState` `Skeleton` `FoldedList` `SummaryStrip` | |
| **重なり** | `Dialog` `Drawer` `DropdownMenu` `Tooltip` `Toast` `Tabs` | 🔴 `role="dialog"` の自作は CI が落とす |
| **ホーム** | `PageGreeting` `KpiCard` `KpiCardRow` `SectionHeader` `RailCard` `Timeline` `RankedList` | 🔴 **`KpiCard` はホーム 2 画面のみ**（一覧画面に置くと CI が落ちる） |
| **その他** | `Icon` `Avatar` `GlobalSearchBox` `EnvironmentBanner` | |

単独の印だけの補助操作は `@ses/ui/client` の `TooltipIconButton` を使う。別の重なり部品の引き金になる場合は、フォーカスと ref の連携を保てる既存の組み合わせを使う。ツールチップと読み上げ名は同じ `label` を渡す。操作対象、成功・失敗・通知の寿命は各画面の既存仕様と情報境界に従う。

### 6.2.0 複数選択リスト（2026-11-01・人間の指示）

複数選択のリストは **`apps/web/app/_components/multi-select.tsx` の共通部品だけ**を使う（スキル欄と同じ UI: 高さ 36px の引き金 + バッジ + ＋N、ポップオーバーに検索欄・「すべて / 選択中 N」・右にチェックマーク・下に「N 件選択中 / 選択をクリア」）。React の状態で持つ画面は `MultiSelect`、素の `<form method="get">` は `FormMultiSelect`（hidden input で `name` を送る）。🔴 **`<select multiple>` と、チェックボックス付きなど見た目の違う複数選択を新しく作らない。**「複数選択・OR検索」などの説明は欄のラベルに書く。凍結 testid がある画面は `testId` を文字列リテラルで渡す。

### 6.2.1 補助操作のアイコンとツールチップ（2026-10-23・人間の指示）

補助操作は `IconButton` と `Tooltip` を基本にし、ホバーとキーボードフォーカスで操作名を表示する。アイコンだけの場合も `aria-label` に同じ操作名を必ず渡す。保存・上書き・開閉・検索・条件クリアは共通 `Icon` の写像から選ぶ。実行確定や破棄の確認ダイアログは、対象・結果を読めるテキストを維持する。保存条件一覧の適用は独立したボタンを置かず、行クリックと条件名のキーボード操作で行う。三点メニューからは行の適用を発火させない。

### 6.3 使用例

**一覧画面**

```tsx
<PageBody width="full">
  <PageHeader
    crumbs={[{ href: '/projects', label: t('nav.projects') }]}
    title={t('projects.list.title')}
    description={t('projects.list.description')}
    actions={[{ href: '/projects/new', label: t('projects.create'), variant: 'primary' }]}
  />
  <Toolbar>…</Toolbar>
  <DataTable columns={columns} rows={rows} />
  <Pagination nextCursor={nextCursor} />
</PageBody>
```

**フォーム画面**

```tsx
<PageBody width="prose">
  <PageHeader crumbs={crumbs} title={title} description={description} />
  <Field>
    <FieldLabel htmlFor="name" required>{t('project.name')}</FieldLabel>
    <Input id="name" name="name" placeholder={t('project.name.placeholder')} />
    <FieldDescription>{t('project.name.help')}</FieldDescription>
  </Field>
</PageBody>
```

**状態の表示**

```tsx
{/* 🔴 色は部品が決める。className で色を渡さない */}
<StatusBadge entity="PROPOSAL" state="APPROVED" />
```

---

## 7. 🔴 やってはいけない実装

CI（`tests/static/**`）が機械で落とすものには **[CI]** を付けた。

| 禁止 | 代わりに |
|---|---|
| **[CI]** ページ独自の色（`bg-slate-100` / `text-[#111]` / `text-red-500`） | §3 のトークン |
| **[CI]** ページ独自の文字サイズ（`text-sm` / `text-2xl` / `text-[15px]`） | §4 の 6 段 |
| **[CI]** 段外の余白（`p-5` / `gap-7` / `mt-[10px]`） | §5 の 7 段 |
| **[CI]** 画面ごとの `max-w-*` | `PageBody` の幅クラス |
| **[CI]** 独自の影（`shadow-md` / `shadow-lg`） | `shadow-overlay` / `shadow-control` |
| **[CI]** 外枠の寸法を画面で書き直す（`w-52` / `h-14` / `w-97`） | `packages/ui/src/lib/layout-tokens.ts` の定数 |
| **[CI]** 任意値の寸法（`h-[32px]` / `size-6`） | `CONTROL_HEIGHT_CLASSES` / `<Icon size>` |
| **[CI]** `role="dialog"` の自作 | `Dialog` / `Drawer` |
| **[CI]** `sidebar-*` をサイドバー以外で使う | 使わない |
| **[CI]** `KpiCard` をホーム以外で使う | 一覧の要約は `SummaryStrip` |
| **[CI]** `data-testid` / 文言キーの**改名・削除** | 追加のみ可 |
| 同じ用途なのに違うボタン・テーブル・Badge | 既存の部品と variant |
| 共通部品を使わず似た UI を再実装 | §8 の判断順 |
| 文言のハードコード | `packages/i18n` の `t()` |
| 同型データをカードで並べる | `DataTable` |
| モーダルに判断材料を押し込む | 画面へ遷移する |
| 操作できないときに `disabled` で表す | 🔴 **ボタンを描かず、理由テキストを置く** |
| 狭い画面で判断材料を隠す | 列を落として詳細画面へ誘導する |

---

## 8. 新しい UI が要るときの判断順

```
① 既存の共通コンポーネントで対応できないか
      ↓ できない
② variant / prop の追加で対応できないか      ← ここまでで大半は収まる
      ↓ できない
③ packages/ui に新しい共通コンポーネントを作る
```

🔴 **③ をやる前に必ず相談する。** 部品が増えるほど「どれを使えばよいか」が分からなくなる。人間が対象の共通化を明示した場合はその指示に従い、追加理由と利用箇所を記録し、既存の利用画面・権限・キーボード操作・スマホ表示を確認する。
🔴 **画面の中に部品を作らない。** 作ると他の担当者から見えず、2 つ目の実装が生える。

**部品を作るときの約束**

- `packages/ui/src/components/` に置き、`index.ts`（状態を持つなら `index.client.ts`）から export する
- 🔴 **`children` / `ReactNode` の prop を作らない** —— 任意の JSX を入れられると、そこから規約の外のスタイルが入り込む。**文字列と配列を受け取る**
- 🔴 **色を渡せる prop を作らない**（`urgent: boolean` のように**意味**を受け取り、色は部品が決める）
- 文言は受け取る（部品の中に日本語を書かない）

---

## 9. 新規画面のテンプレート

```tsx
// apps/web/app/(main)/<feature>/page.tsx
import { DataTable, EmptyState, PageBody, PageHeader, Pagination } from '@ses/ui';
import { t } from '@ses/i18n';

export default async function Page() {
  const data = await readSomething();          // 🔴 既存の取得経路を使う（withTenant 経由）

  return (
    <PageBody width="full">                    {/* full | split | prose */}
      <PageHeader
        crumbs={[{ href: '/parent', label: t('nav.parent') }]}
        title={t('feature.title')}
        description={t('feature.description')}
        actions={[{ href: '/feature/new', label: t('feature.create'), variant: 'primary' }]}
      />

      {data.rows.length === 0 ? (
        <EmptyState title={t('feature.empty.title')} description={t('feature.empty.body')} />
      ) : (
        <>
          <DataTable columns={columns} rows={data.rows} />
          <Pagination nextCursor={data.nextCursor} />
        </>
      )}
    </PageBody>
  );
}
```

**PR を出す前のチェックリスト**

- [ ] 色・文字サイズ・余白を**自分で決めていない**
- [ ] `max-w-*` を画面に書いていない
- [ ] 同じ用途の既存部品を探した（§8 の①②）
- [ ] 文言を `packages/i18n` に置いた
- [ ] 空・読み込み中・エラーの 3 状態を描いた
- [ ] モバイル（375px）で**判断材料を隠していない**
- [ ] `pnpm lint && pnpm typecheck && npx vitest run tests/static/` が緑

---

## 10. 開発の実務

```bash
pnpm install
docker compose up -d
pnpm --filter @ses/db run migrate:deploy
pnpm --filter @ses/db run seed --preset=demo
pnpm --filter @ses/web run dev          # http://localhost:3000
```

ログインに使うアカウントは [`docs/DEV-ACCOUNTS.md`](./docs/DEV-ACCOUNTS.md)。

🔴 **踏みやすい罠**

| 罠 | 対処 |
|---|---|
| `packages/ui` を変えたのに反映されない | `pnpm --filter @ses/ui run build`（`apps/web` は `dist` を参照する） |
| `t()` が `undefined` を返す | `npx tsc -p packages/i18n/tsconfig.json` |
| `next build` が `/_global-error` で落ちる | `env -u NODE_ENV pnpm --filter @ses/web run build` |
| スタイルが丸ごと消えた | `apps/web/app/tailwind.css` の `@source '../../../packages/ui/src'` を消していないか |

---

## 11. まだ刷新が済んでいない画面

🔴 **次の画面にはまだ旧スタイルの直書きが残っている。ここを手本にしないこと。**

管理平面 `/admin` / 提案 / 設定 / エンジニア / 案件 / 認証 / 提案依頼 / スキル。

残量は `tests/static/support/ui-ratchet-allowlist.ts` で分かる（**許可リストに載っている箇所だけ**が旧スタイルを許されている）。🔴 **許可リストに行を足さない** —— 足すのは刷新を遅らせることと同じである。


### 2026-10-29 案件検索の画像指定（人間の指示）

案件検索は添付された新UI画像を基準に、4カラムを基本とする。狭幅では列数と並びを変える。開発方式と稼働率のセグメントは、画像どおり丸い選択肢・選択中のブランド色と白文字を用いる。この角丸の例外は共通部品 `packages/ui/src/components/segmented-control.tsx` に限定し、カード・タグ・既存のボタン全般へ広げない。文言・色・高さは既存トークンを使う。基本検索・詳細検索・条件サマリー・検索とクリアの順に置き、編集だけで一覧を更新しない。画面外のデザインは変更しない。

検索パネルの控えめな影も今回の画像指定に限る例外とし、入力欄の輪郭と同じ共通定数（shadow-control）を使う。一般のCardへ影を足さない。
