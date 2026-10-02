# UI_GUIDELINES.md — 画面を作る人のための規約

🔴 **このファイルを読めば、誰が作っても同じ UI になる。** 複数人で画面を分担するための規約である。

| | 役割 |
|---|---|
| **このファイル** | **「どう作るか」**。トークン・部品・レイアウト・禁止事項・新規画面のテンプレート |
| [`docs/04-ui-design.md`](./docs/04-ui-design.md) | **「何を作るか」**。画面ごとの仕様（60 画面の目的・項目・権限差分）。🔴 **画面の中身はこちらが正** |
| [`CLAUDE.md`](./CLAUDE.md) | **一次資料**。情報境界・ハードルール。🔴 **衝突したら `CLAUDE.md` が勝つ** |

---

## 1. デザインコンセプト

**長時間の業務に耐える、情報密度の高い BtoB SaaS。** 参照は Ramp。

| 原則 | 具体 |
|---|---|
| **情報量が多くても見やすい** | 一覧は既定 50 行・8 列 + 操作列。ファーストビューに 12 行以上 |
| **装飾を足さない** | グラデーション・影の多用・比喩アイコン・絵文字を使わない |
| **カードを乱用しない** | 🔴 **同型データの一覧はテーブル。カードで並べない** |
| **階層が一目で分かる** | 1 画面で最も強い要素は 1 つだけ |
| **CTA が明確** | primary ボタンは 1 画面に 1 つ |
| **疲れにくい** | 彩度を上げない。色は意味のあるときだけ使う |

🔴 **色・サイズ・余白を自分で決めない。** 決めるのはこのファイルであり、画面側は**選ぶだけ**である。

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
| `split` | 本体 + 副カラム（候補パネル等） | 副カラムが `lg` 360 → `xl` 400 → `2xl` 480px 固定 |
| `prose` | フォーム・読み物 | 720px・**左寄せ**（中央寄せにしない） |

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
| Primary | `brand` |
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
| 一覧 | `row-hover-bg` / `table-header-bg` |
| サイドバー | `sidebar-bg` / `sidebar-fg` / `sidebar-fg-muted` / `sidebar-border` / `sidebar-hover-bg` / `sidebar-selected-bg` / `sidebar-selected-fg` / `sidebar-selected-bar` |

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

🔴 **6 段だけ。これ以外の文字サイズを作らない。**

| トークン | px | 用途 |
|---|---|---|
| `text-title` | 20 | Page Title（1 画面に 1 つ） |
| `text-lg` | 16 | Section Title |
| `text-body` | 14 | 本文・ラベル・ボタン |
| `text-cell` | 13 | テーブルのセル |
| `text-xs` | 12 | Caption・補助文 |
| `text-micro` | 11 | メタ情報 |
| `text-metric` | 24 | 🔴 **KPI の数値のみ**（`KpiCard` 以外で使うと CI が落ちる） |

- **Card Title** は `text-body` + `font-semibold`（専用の段を作らない）
- フォントは `--font-sans` のみ。🔴 **別のフォントを読み込まない**

---

## 5. Spacing

🔴 **7 段だけ。** `p-5` / `gap-7` / `mt-[10px]` は **CI が落とす**。

| クラス | px | 目安 |
|---|---|---|
| `1` | 4 | アイコンとラベルの間 |
| `2` | 8 | バッジの内側・密な縦積み |
| `3` | 12 | セルの内側 |
| `4` | 16 | 既定の間隔・カードの内側 |
| `6` | 24 | セクション間 |
| `8` | 32 | 大きな区切り |
| `12` | 48 | フォームのセクション間・空状態の上下 |

**その他の寸法**

| | 値 | どこで決まるか |
|---|---|---|
| Border Radius | `rounded-sm`(4px) / `rounded-md`(6px) | トークン |
| Border | 1px（`border`）。左端の強調のみ 2px | 🔴 全周 2px は CI が落とす |
| Shadow | `shadow-control`（入力欄の輪郭）/ `shadow-overlay`（Dialog・Drawer・DropdownMenu・Tooltip・Toast） | 🔴 **この 2 つ以外の影は名前が無い** |
| Icon Size | `<Icon size="sm">`(16px) / `size="md"`(20px) | 🔴 `size-6` は CI が落とす |
| Button / Input Height | `sm` = 32px / `md` = 40px | `CONTROL_HEIGHT_CLASSES` |
| Table Row Height | 約 36.5px（`py-2` + `text-cell`） | `Table` が決める。固定しない |

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

🔴 **③ をやる前に必ず相談する。** 部品が増えるほど「どれを使えばよいか」が分からなくなる。
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
