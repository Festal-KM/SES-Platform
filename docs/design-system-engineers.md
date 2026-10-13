# docs/design-system-engineers.md — 人材管理タブの寸法（受領した定義。2026-10-13）

🔴 **これは人間から受け取った定義書をそのまま保存したものである。** 共通基盤は
[`docs/design-system.md`](./design-system.md)、画面の中身は [`docs/04-ui-design.md`](./04-ui-design.md) が正。

🔴🔴 **着手前に読むこと: §2.2 の「公開用」の列は、`CLAUDE.md` §3.1 経路 4 の匿名 5 項目に
6 列を足している。**（名前（イニシャル）/ 掲載元 / 並行 / 区分 / ステータス / カテゴリ）
**項目を増やすことは `CLAUDE.md` §8.6 の人間承認事項**であり、エージェントが判断してはならない。
[Issue #94](https://github.com/Festal-KM/SES-Platform/issues/94) で確認中。
🔴 **既定値 = 公開用の列はいまの 5 項目のまま**（スキル / 経験年数 / 単価レンジ / 稼働可能時期 /
勤務地・リモート可否）。**掲載元・並行・ステータス・区分・イニシャルは出さない。**
⚠️ 特に **掲載元 = 共有元の会社名**であり、**2 日前に CI の E2E が同じ値の漏れを捕まえたばかりである**
（`HANDOFF.md` §6 の 18 / [#91](https://github.com/Festal-KM/SES-Platform/issues/91)）。

🔴 **実装状況: 未着手**（2026-10-13 時点）。

---

# SES Hub Design System — 人材管理タブ 仕様 v1.0

前提: `DESIGN_SYSTEM.md`（共通基盤）を継承。Sidebar 208 / Header 56 / Content padding 20-16-20-28 / Main 1018 / gap 16 / Right 388 は**変更しない**。
実装正本: `SES Hub 人材管理.dc.html`（2a〜2e）。

## 0. 画面一覧
| ID | 画面 | Main | Right |
|---|---|---|---|
| 2a | 人材一覧（社内用） | Title + Tabs + Filter bar + Data Table + Pagination | 選択人材 Detail Panel |
| 2b | 人材一覧（他社公開用・マスキング） | Title + Filter bar + Data Table（公開列） | Detail Panel（公開項目 + Lock Notice） |
| 2c | 人材プロフィール（社内用） | Profile Header + Category Chips + Tabs + 2×2 Card Grid | クイックアクション / AI サマリ / メモ |
| 2d | 人材プロフィール（他社公開用） | 同上（マスキング列） | クイックアクション / 公開メモ / Lock Notice |
| 2e | 新規人材登録 | Title + Step Rail 200 + Form Cards | Step3 諸条件フォーム / Step4 確認 |

社内 / 公開は**同一レイアウト・同一コンポーネント**で、表示する列・項目だけを切り替える（マスキング = データ側の責務、UI を変えない）。

## 1. 追加トークン
| Token | 値 | 用途 |
|---|---|---|
| `--badge-cat-bg` / `-fg` | #EDE9FE / #6D28D9 | カテゴリ Badge（6 種目。既存 5 種に追加） |
| `--table-head-bg` | #F8FAFC | テーブルヘッダ、行 hover |
| `--border-input` | #D7DDE6 | Input / Select / Filter 枠線 |
| `--dropzone-border` | #C6CDD8（dashed） | アップロード領域 |
| `--selected-row` | #E8F1FF（= primary-soft） | 選択行、アクティブ Step |

### Badge の割り当て（固定）
- ステータス: 面談調整中 mid / 提案中・提案可能 ok / 稼働中 info / タレントプール neutral / 条件交渉中 high / 公開可 info
- 稼働条件: フルリモート ok / ハイブリッド cat / 常駐 info
- 区分: 自社社員 info / フリーランス ok / BP cat
- 並行: あり high / なし neutral
- 経験レベル: 上級 high / 中級 info / 初級 neutral
- カテゴリ: バックエンド cat / インフラ ok / AI開発 info / フロントエンド info / PM・PMO cat / ヘルプデスク mid

## 2. コンポーネント

### 2.1 Filter Bar（高さ 36, gap 8）
- 検索 Input 300×36（白, border `--border-input`, radius 8, アイコン 18, placeholder 14 `--text-4`）
- Filter Select: 高さ 36, padding 0 10 0 12, 14/500 `--text-1` + chevron 16 `--text-3`, radius 8, hover `--bg`
- 「+ 詳細条件」Secondary Button 36
- 右端 View Toggle: 2 セグメント 36×34, border 1px, radius 8; active bg `--primary` 白
- 下に件数行 24h（「全 48 件」15/700 ＋ 右リンク 13/500: 表示項目 / エクスポート）, margin-bottom 8

### 2.2 Data Table（Card radius 10, border 1px）
- Header 行 **36h**, bg `--table-head-bg`, 13/500 `--text-3`, border-bottom `--border`
- Body 行 **45h**（共通 Row 高さと同一）, padding 0 16, border-top `--border-row`, hover `--table-head-bg`, 選択行 `--selected-row`
- 列は固定幅（px, 各列の padding-right 8 を含む）。合計は Card 内側 **984**（1016 − padding 32）以下に収める
- 社内用: check 24 / 名前 140 / スキル 140 / 経験 48 / 単価 64 / 稼働開始 88 / ステータス 92 / 稼働条件 84 / 最寄 48 / 並行 44 / 区分 76 / 最終対応日 84 / more 24 ＝ 956
- 公開用: check 24 / 名前(イニシャル) 72 / カテゴリ 160 / スキル 148 / 稼働条件 84 / 最寄 48 / 並行 44 / 区分 76 / 掲載元 56 / ステータス 92 / 詳細 72 / more 24 ＝ 900
- セル型（7 種のみ）: check 16 / name（Avatar 32 + 14/500 + 12 `--text-3`）/ text 14 / badge 22h 12/500 / chips（badge 22h 複数, gap 6）/ btn（Row-action sm 32h）/ more 24
- 表内 Badge は **22h・12px**（Card 外の 24h・13px より 1 段小さい）
- Checkbox: 16, radius 4, border #C6CDD8; checked bg `--primary` + 白チェック

### 2.3 Pagination（margin-top 12）
- ボタン 32×32, radius 6, border `--border-input`; current bg `--primary` 白 14/500; prev disabled `--text-4`
- 右端「1-10 / 48 件」13 `--text-2` ＋ ページサイズ Select 32h

### 2.4 Detail Panel（Right 388, 一枚 Card, 内部スクロール）
- ヘッダ padding 16: Avatar **56** + 名前 20/700 + 編集アイコン 14 / Badge 22h ×n / メタ 13 `--text-3`; 右上 ✕ 16
- ボタン行: Primary 36（チャット, flex 1）+ Secondary 36（提案を作成, flex 1）+ Icon Button 36（more）
- Tabs 40（均等幅 4 タブ, 14/500）
- セクション: 見出し 32h 15/700（右に Secondary sm 28h「編集」）→ KV 行 **30h**（キー 112, 13 `--text-3` / 値 14 or Badge 22h）
- PRポイント 13/20 / スキル Chips 24h neutral, wrap gap 6
- 公開用はヘッダ編集アイコン・編集ボタンを非表示、最下部に Lock Notice

### 2.5 Lock Notice
- bg `--bg`, radius 8（Card 全体なら 10）, padding 16（単体 Card は 24 16）, 鍵アイコン 20〜24 `--text-2`, 本文 13/20 `--text-2` 中央寄せ

### 2.6 Profile Header（Title ブロックの代替, 高さ 56 + chips 24）
- 左: Bookmark タイル 48×48（白, border, radius 8, アイコン 22 `--primary`）| 名前 26/700 + かな 15 `--text-2` + ステータス Badge 24h | メタ行 14 `--text-3`
- 右: Primary 36「チャット」+ Secondary 36 ×(1〜3) + Icon Button 36 more, gap 12
- 下: カテゴリ Badge 24h 行（gap 8, margin-bottom 8）→ Tabs 40（7 タブまで）

### 2.7 Profile Card Grid（2 列 1fr/1fr, gap 16, align-content start）
- 基本情報 Card: 見出し 28h（アイコン 18 + 16/700）→ KV 行 **32h**（アイコン 16 `--text-4` + キー 132 13 `--text-3` / 値 14・Badge 22h・Chips）
- スキル Card: ヘッダ 48h（タイトル + 右「+ スキルを追加」sm）→ Table Header 36h → 行 **36h**（ドット 8 + スキル名 / 年数 / レベル Badge / 直近 / 備考）。公開用は「スキル / 経験レベル」2 列のみ
- PRポイント Card: 見出し 28h（右「編集」リンク, 公開では非表示）+ 本文 14/22 pre-line
- 資格・その他 / 対応可能業務 Card: 行 40h, border 1px radius 8, アイコン 16 `--primary` + 14

### 2.8 Right Cards（プロフィール）
- クイックアクション: 行 **44h**, border 1px radius 8, アイコン 18 `--primary` + 14/500 + 右 chevron 16 `--text-4`, gap 8, hover `--table-head-bg`
- AI 生成サマリ: 見出しに「AI」タグ 20h bg `--primary` 白 11/700; 右「コピー」sm 28h; 本文 13/20 pre-line
- メモ: 見出し右「+ 追加」sm 28h; 内部 Tabs 36h（社内メモ / 公開メモ）; エントリ = Avatar 28 + 名前 14/500 + 時刻 12 `--text-4` + 本文 13/20, 区切り `--border-row`

### 2.9 Step Rail（幅 200）
- Card padding 8; Step 項目 **64h** radius 8: 番号円 28（active bg `--primary` 白 / done bg ok / todo #E5E7EB `--text-2`）+ タイトル 14/500（active `--primary`）+ サブ 12 `--text-3`; active 行 bg `--selected-row`
- 下に「登録のポイント」Card: 見出し 15/700 + チェック付き箇条書き 13/20 `--text-2`

### 2.10 Form
- Field: ラベル 13/500 `--text-2`（必須 `*` `--danger`）+ gap 6 + Input 36（白, border `--border-input`, radius 8, padding 0 12, 14）; 2 列グリッド gap 12×16, span 指定可
- Select = Input + 右 chevron 16 / Date = Input + 右カレンダー 16 / 先頭アイコン付き Input は padding-left 12 + アイコン 16 + gap 8
- 単位付き Input: 右に 「万円」セグメント（bg `--bg`, border-left）; 横に Checkbox「応相談」
- Radio: 16 円, selected = border 5px `--primary`; 選択肢 gap 24
- Chips 入力: Input 36 内に Badge 24h（× 10）, 右 chevron
- Step 番号付き Card 見出し: 番号円 28 `--primary` + 16/700; 説明 13 `--text-3`（margin-left 38）
- フォーム内 Tabs 36〜40h, 14/500, border-bottom `--border`

### 2.11 Upload
- Dropzone: 高さ 176, border 1px dashed `--dropzone-border`, bg `--table-head-bg`, radius 8, 中央: 円 48 `--primary-soft` + アイコン 24 / 15/700 / 13 + 「ファイルを選択」28h `--primary-soft` `--primary` / 12 `--text-4`
- ファイル行 48h: 拡張子タイル 28 radius 6（PDF `--danger` / XLS #15803D / DOC `--primary`, 10/700 白）+ 名前 13/500 + サイズ 12 + 完了 ✓ 16 ok + ✕ 14
- 読取結果ステータス Badge 24h ok（✓ 読み取りが完了しました）+ 右「再読み取り」sm
- 抜粋プレビュー: 幅 320, bg `--table-head-bg`, 内側白 Card radius 6, 本文はスケルトン線 8h radius 4 `--border`

## 3. 再利用ルール（人材管理）
1. 一覧は Data Table（45h 行）、詳細は Detail Panel（Right 388）。別画面に遷移せず右で開く。
2. 社内 / 公開はコンポーネントを分岐させない。`internal` フラグで列・ボタン・編集 UI を出し分ける。
3. マスキング時に消す項目: 氏名→イニシャル、年齢、ID、希望単価、最終対応日、社内メモ、AI サマリ、編集系ボタン。追加する項目: 掲載元、Lock Notice。
4. Badge の色対応表（§1）を全画面で固定。新ステータスは 6 種のどれかに割り当てる。
5. Avatar サイズは 56（Detail ヘッダ）/ 36（Header・一覧行外）/ 32（テーブル行）/ 28（メモ・番号円）の 4 段階のみ。
6. フォーム Input は常に 36h。Row-action / Icon Button は 32h、見出し内の小ボタンは 28h。
7. 右カラム Card は 3 枚まで。はみ出す場合は最下段 Card を内部スクロールにし、カラム高さを超えない。
8. Step ウィザードでも 2 カラムを維持する（Main: Step1-2、Right: Step3-4）。
