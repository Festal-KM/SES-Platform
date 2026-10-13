# docs/design-system.md — SES Hub Design System v1.0（寸法の唯一の出所）

🔴 **このファイルは「何 px か」を決める唯一の場所である。** 画面ごとに幅・高さ・余白・文字サイズを決め直さないために在る。

**出所**: 人間から渡された `SES Hub Design System v1.0`（2026-10-13。ホーム画面のモックアップ `1672 × 941 px` を 1:1 で計測したもの）と、その正本 HTML（`SES Hub Screens.dc.html`。ホーム / 人材管理 / 案件管理 / チャットの 4 画面）。

| | 役割 |
|---|---|
| **このファイル** | **「何 px か」**。外枠の寸法・密度・角丸・文字の実寸。🔴 **数値の出所はここだけ** |
| [`UI_GUIDELINES.md`](../UI_GUIDELINES.md) | **「どう作るか」**。トークン名・共通部品・禁止事項 |
| [`docs/04-ui-design.md`](./04-ui-design.md) | **「何を作るか」**。画面ごとの中身 |
| [`CLAUDE.md`](../CLAUDE.md) | **一次資料**。情報境界・ハードルール。🔴 **衝突したら `CLAUDE.md` が勝つ** |

---

## 1. なぜこのファイルが要るか

**同じ外枠が画面ごとに少しずつ違う、という壊れ方を防ぐため。** サイドバーがホームでは 208px、人材管理では 220px、案件管理では 240px —— これは 1 画面ずつ見ると気づけず、画面を行き来して初めて「何かずれている」と分かる。原因は担当者の注意力ではなく、**寸法を画面側で決めていること**である。

🔴 **したがって寸法は定数にして、画面側は選ぶだけにする。** 実体は `packages/ui/src/lib/layout-tokens.ts` と `apps/web/app/tailwind.css` の `@theme` であり、本ファイルはその根拠と採用理由を持つ。

---

## 2. Layout（固定・全画面共通）

| 要素 | 値 | 実装 |
|---|---|---|
| Viewport 基準 | **1672 × 941** | — |
| Sidebar 幅 | **208** | `w-52`（`SIDEBAR_WIDTH_PX`） |
| Header 高さ | **56**（下枠 1px `border`） | `h-14`（`HEADER_HEIGHT_PX`） |
| Content Padding | **上 20 / 左 28 / 右 16 / 下 20** | `CONTENT_PADDING_CLASSES` |
| Main カラム幅 | **1018**（1672 のとき） | 残り幅（`flex-1`） |
| Main ↔ Right gap | **16** | `gap-4`（`COLUMN_GAP_PX`） |
| Right カラム幅 | **388** | `w-97`（`RAIL_WIDTH_PX`） |
| セクション Card 間 gap | **12** | `gap-3`（`SECTION_GAP_PX`） |
| KPI Card 間 gap | **16** | `gap-4` |
| Right Card 間 gap | **16** | `gap-4` |

🔴 **1. Sidebar / Header / Content Padding / 2 カラム幅は全画面で同一。画面側で上書き禁止。**
🔴 **2. 画面固有の内容は Main（1018）と Right（388）の中にだけ置く。** カラム幅を変えるときは本ファイルを改訂する。

---

## 3. Foundations

### 3.1 Color — 定義の対応表

🔴 **画面側は semantic トークン名だけを使う**（`UI_GUIDELINES.md` §3）。下表は「仕様書の名前」と「このリポジトリのトークン」の対応であり、**画面側が hex を書いてよいという意味ではない**。

| 仕様書 | 値 | このリポジトリ | 備考 |
|---|---|---|---|
| `--primary` | `#2563EB` | `brand` | 🔴 藍（indigo-700）から**青（blue-600）に変えた** |
| hover | `#1D4ED8` | `brand-hover` | blue-700 |
| `--primary-soft` | `#E8F1FF` | `brand-bg` | KPI アイコン面 / info Badge の地 |
| `--bg` | `#F3F5F9` | `bg-subtle` | ページの地・検索欄の地 |
| `--surface` | `#FFFFFF` | `surface` | Card / Header |
| `--border` | `#E5E9F0` | `border` | Card / Header / Input の枠 |
| `--border-row` | `#EEF1F5` | `border-row` | 🔴 **行の区切り線だけ**（カードの枠より薄い） |
| `--border-btn` | `#D7DDE6` | `border-strong` | Secondary Button の枠 |
| `--text-1` | `#111827` | `fg` | 見出し・行タイトル |
| `--text-2` / `--text-3` | `#4B5563` / `#6B7280` | `fg-muted`（= `slate-600`） | 🔴 **2 段を 1 つにまとめた**（下の §6 ②） |
| `--text-4` | `#8A94A6` | `fg-placeholder` | placeholder / 時刻 |
| `--danger` | `#DC2626` | `danger`（= `red-700`） | 🔴 **階調は採らない**（下の §6 ①） |
| `--success` | `#16A34A` | `success`（= `emerald-700`） | 🔴 **階調は採らない**（下の §6 ①） |
| `--tip-bg` | `#FFFCF2` | `tip-bg` | 🔴 **ワンポイント Card だけ** |
| `--sidebar-bg` | `linear-gradient(180deg,#0B2447,#122E57)` | `sidebar-bg` / `sidebar-bg-end` | 🔴 **グラデーションが許される唯一の面** |
| `--sidebar-active` | `#1E4A86` | `sidebar-selected-bg` | |
| 行 hover | `#F8FAFC` | `row-hover-bg` | 🔴 **ページの地と別の値にする**（同値だと hover が見えない） |

### 3.2 Typography（`--font-sans` = Noto Sans JP）

| Role | size / weight / line-height | トークン |
|---|---|---|
| Page Title (h1) | **26 / 700 / 34** | `text-title` |
| KPI Value | **28 / 700 / 32**（単位 15 / 500） | `text-metric` |
| Right Card Title | **17 / 700 / 24** | `text-rail` |
| Card Title | **16 / 700 / 24** | `text-lg` |
| Row Title / Nav Item / Tab / 見出し直下 | **15 / 500 / 20** | `text-row` |
| Body / KPI Label / Button | **14 / 400 / 20** | `text-body` |
| Row Sub / Delta / Link / Badge / Button(sm) | **13 / 500 / 18** | `text-cell` |
| Caption | **12 / 400** | `text-xs` |
| メタ（最小） | 11 | `text-micro` |

🔴 **`text-title` は 20px から 26px に変わった**（全画面の h1 に効く）。🔴 **`text-row`（15px）と `text-rail`（17px）を足した。** 足したぶんは `tests/static/design-tokens.test.ts` が `@theme` と一致することを固定する。

### 3.3 Spacing / Radius / Shadow

- **4px グリッド**。使用値: `4, 6, 8, 12, 16, 20, 24, 28`（🔴 6 と 20 と 28 を足した。従来は 4 / 8 / 12 / 16 / 24 / 32 / 48）
- **Radius**: Card **10** / Button・Input・Nav **8** / Button(sm)・Icon **6** / Badge **4** / Avatar 50%
- **Shadow**: 🔴 **なし**（枠線だけで区切る）。overlay（Dialog / Drawer / DropdownMenu / Tooltip / Toast）のみ `shadow-overlay`

| トークン | 値 |
|---|---|
| `--radius-xs` | **4px** … Badge |
| `--radius-sm` | **6px** … Button(sm) / Icon Button |
| `--radius-md` | **8px** … Button / Input / Nav item |
| `--radius-lg` | **10px** … Card / Panel / Dialog / Drawer |

---

## 4. Components（寸法）

| 部品 | 寸法 |
|---|---|
| **Sidebar Logo** | マーク 28（radius 6, `brand`）+ 「SES Hub」22/700 白, gap 10。タグライン 13/400（白 .72）。padding 20 20 0 |
| **Sidebar Nav item** | **184 × 46**, 左右 margin 12, 間 6, radius 8, padding-left 16。アイコン 20、アイコン↔語 gap 12、語 15/500 |
| **Sidebar 下部** | メッセージ箱 168 × 72（枠 白 .25, radius 8, padding 12, 13/400）+ バージョン 13/400（白 .55）, margin-top 16 |
| **Header** | 高さ **56**, padding 0 16 0 28。検索 **726 × 36**（地 `bg-subtle`, 枠 `border`, radius 8, 左 padding 40, placeholder 14）+ `⌘ K`。右群 gap 24、縦区切り 1 × 28、会社名 13/500 + 氏名 13/400、chevron 16、アバター **36** 円 |
| **Page Title ブロック** | 高さ **64**, 下 margin **20**。h1 26/700 + 日付 15/400 + メッセージ 15/400（gap 24）。右端は標語（ホーム）または Primary / Secondary |
| **KPI Card** | 高さ **105**, padding 16, radius 10。アイコン面 **48 × 48**（radius 8, 地 `brand-bg`, アイコン 24）、面↔文字 gap **20**。ラベル 14 → 値 **28**/700 + 単位 15/500（baseline 揃え, gap 4）→ デルタ 13/500。行間 4 |
| **Tabs** | 高さ **40**, 地 `surface`, radius 8, 項目 padding 0 16, 左右 padding 4。アイコン 18 + 語 15/500（gap 8）。active = `brand` + 下線 2px。margin 上 8 / 下 12 |
| **Section Card** | radius 10, 枠 `border`, 地 `surface`, overflow hidden。間 **12** |
| **Section Header** | 高さ **40**, padding 0 16。アイコン 20 + タイトル 16/700 + カウント Badge（最小 20 × 20, radius 10, 12/600）+ 右端「すべて見る ›」13/500 |
| **Section Row** | 高さ **45**, padding 0 16, 上枠 1px `border-row`。hover `row-hover-bg` |
| **Right Card** | padding 16, radius 10。見出し: アイコン 20 + タイトル 17/700 + 右端リンク 13/500、下 margin 12 |
| **Schedule Row** | 高さ **58**。時刻列 **64**（13/700 + 13）/ タイムライン列 **24**（線 1px, ドット 8）/ タイトル 15/500 + サブ 14 |
| **Priority Row** | 高さ **50**。番号円 **28**（13/600）/ タイトル 15/500 + サブ 14 / 右端 Badge |
| **Tip Card** | 地 `tip-bg`, 本文 14/400/22, 右上 ✕ 16 |

### 4.1 Section Row の列（🔴 全画面で同じ）

| 列 | 幅 |
|---|---|
| Checkbox | 16（+ 右に gap 28） |
| タイトル 15/500 + サブ 13 | `1fr` |
| Meta（時刻・残り） | **120**（15/400。緊急は `danger`） |
| Badge | **180** |
| Action Button | **146 × 32** |
| More | 24（左 margin 24） |

🔴 **この 1 行の形は `2xl`（1536px）以上でだけ使う。** 固定列の合計（120 + 280 + 146 + 24 + 余白 ≒ 630px）が
主カラムに収まるのは、ビューポートが 1536px 以上のときだけである —— **1280px では主カラムが 624px しかなく、
行がカードの外へはみ出して右レールの下に潜る**（実測。`HANDOFF.md` §6 の 22）。それ未満では件名が自分の行を
取って折り返す。同じ理由で **KPI カードの 4 枚横並びも `2xl` から**である（それ未満は 2 × 2）。

🔴 **寸法は基準（1672 × 941）のものである。** 固定列を足すときは、**その断面の主カラム幅**
（ビューポート − サイドバー 208 − gutter 44 − 副カラム 388 − gap 16）に収まるかを計算してから断面を決める。

### 4.2 Button

| Variant | 高さ | padding | 文字 | 配色 |
|---|---|---|---|---|
| primary | 36 | 0 16 | 14/500 白 | 地 `brand`, radius 8 |
| secondary | 36 | 0 16 | 14/500 `fg` | 白地 + 枠 `border-strong`, radius 8 |
| row-action (sm) | **32** | 0 12 | 13/500 `fg` | 白地 + 枠 `border-strong`, radius 6, 左アイコン 16, **幅 146 固定** |
| icon | 32 × 32 | — | — | 透明, radius 6 |

### 4.3 Badge（高さ 24, padding 0 10, radius 4, 13/500）

| kind | このリポジトリの variant | 用途 |
|---|---|---|
| high | `danger` | 高 / 期限間近 |
| mid | `warning` | 中 / 保留 |
| info | `brand` | 返信待ち / フォロー / 募集中 |
| neutral | `neutral` | 低 / 終了 / 待機 |
| ok | `success` | 稼働中 / 成約 |

🔴 **Badge は 5 種類だけ。新色を足さない。**

### 4.4 アイコン

lucide 系 2px stroke。サイズは **24（KPI）/ 20（Nav・Card Header・Tab）/ 16（Button・行内）** の 3 段。

🔴 **仕様書の 18（Tab）は 20 に寄せた。** `Icon` の寸法は閉じた union（`sm` / `md` / `lg`）で型として縛っており（`packages/ui/src/icons.ts`）、18px のために 4 段目を作ると「どれを使うか」の判断が 1 つ増える。**2px の差はタブの中では見分けられない。**

### 4.5 チャット（`S-031`）—— 仕様書 §3.12（2026-10-13 に人間が追加）

🔴 **✅ 2026-10-13: 骨格は実装した。** 下の表の「出せないもの」を除いた範囲である。

| 実装したもの | 値 |
|---|---|
| Main を **1 枚の白い面**にした | 一覧 **320**（`w-80`）+ 1px の罫線 + 会話（残り）。従来は 2 つの器が 16px 空いて並び、**1 つの会話が 2 つの面に割れて見えていた** |
| スレッド一覧の行 | **60px 固定**（表をやめた）。Avatar 36 + 対象名 15/500 + 時刻 12 + 種別 Badge + 相手の社名 13。選択中は `brand-bg` |
| 会話 | ヘッダ **56** / 本文（**下寄せ**・`overflow-y-auto`）/ コンポーザー **64** の 3 段 |
| メッセージ | **全員左寄せの Slack 型**。Avatar 36 ｜ 送信者 14/700 + 会社 + 時刻 12 ｜ バブル（radius 10・padding 8 16・**max-width 560**・自分 `brand-bg` / 相手 `bg-subtle`） |
| 関連情報パネル | Key-Value **30px** の行 / キーの列 **124** / 区切りは `border-row` |

🔴 **バブルの上限幅（`max-w-140`）は `packages/ui` に置いた** —— `max-w-*` は画面側に書けない（`tests/static/ui-screen-width.test.ts`）。**読める行長の規約**であり、画面ごとに決め直すものではない。

- **Main 1018 = スレッド一覧 320**（右 border 1px）**+ 会話 698**。**Right 388 = 関連情報パネル 1 枚**（Card 10・内部スクロール）
- **スレッド一覧**: 検索 Input 36 → Tabs 40（すべて / 未読 / グループ / お気に入り。15/500・active 下線 2px）→ 行 **60**（Avatar 36 / 名前 15・500 / 時刻 12 / プレビュー 13 の 1 行省略 / 未読カウント 20h の円）。選択行は `brand-bg`
- **会話 Header 56**: Avatar 36 + 名前 15/500 + ☆16 / 参加者 13。右端に Icon Button 32 × 4
- **メッセージ（全員左寄せ・Slack 型）**: Avatar 36 ｜ 送信者 14/700 + 時刻 12 ｜ バブル padding 8 14・radius 10・14/20・max-width **560**。自分 `brand-bg` / 相手 `bg-subtle`、文字は共に `fg`。`@メンション` は `brand` 500。バブル右下に「既読 n」12。行間 gap 10、**下寄せ**（最新がコンポーザー直上）
- **日付区切り**: 中央・24h の pill・地 `bg-subtle`・12
- **添付ファイル Card**: 300 × 48・radius 8・拡張子タイル 32（radius 6）・名前 14/500 + メタ 13・DL アイコン 18
- **コンポーザー 64**: 単一 Input 40（クリップ 20 左 / 絵文字・@・T・画像の Icon Button 32 × 4 + 送信 20 右）
- **関連情報パネル**: Tabs 40（関連情報 / タスク / ファイル / メンバー(n)。14/500・均等幅）→ padding 16・セクション gap 16
  - プロフィール: Avatar 48 + 名前 17/700 + かな 13 + Badge(info) + 補足 14。右端に Secondary Button sm
  - セクション見出し 28h（アイコン 18 + 15/700）/ Key-Value 行 **30h**（キー列 124）/ 関連案件 Box（ヘッダ 40・地 `brand-bg`・KV 行 30h・キー列 112）/ メモ（地 `bg-subtle`・radius 8・padding 12・14/22）

🔴 **この画面は「出せないもの」が多い。** 下は**実装していない**ものと、その理由である。

| 仕様書 | いまの実装の前提 |
|---|---|
| **未読タブ / 未読カウント / 既読 n** | 🔴 `Message` に既読の列が無く、**未読という状態が存在しない**（§6 ⑬ と同じ） |
| **グループ / お気に入りタブ** | `ChatThread` に分類の属性が無い |
| **通話 / ビデオ / メンバー追加** | 機能が存在しない（`docs/02` に無い）。**押して何も起きないボタンを置かない** |
| **`@メンション`** | 記法も通知も無い |
| **タスク / ファイル / メンバー タブ** | `Task` は API が無い（Issue #90）。ファイルは添付の一覧が未実装 |
| **プロフィール（氏名・かな）** | 🔴 **相手が取引先の担当者なら出してよいが、エンジニアの氏名は `BR-27` の対象**。関連案件の KV に単価・エンド企業名を出さない（`CLAUDE.md` §3.1 経路 5） |
| **スレッドのプレビュー（最後の発言の抜粋）** | `ChatThreadListItem` に本文が無い。足すには**読み取り経路（RLS を通る問い合わせ）を変える**必要があり、UI の段で境界の経路を広げない（`CLAUDE.md` §8.3 の上段の変更になる）。代わりに 2 段目には**既に出している相手の社名**を置いた |
| **検索（チャットを検索）** | スレッドの検索 API が無い。**押して何も起きない入力欄を置かない** |

---

## 5. 再利用ルール（仕様書 §4 のまま）

1. Sidebar / Header / Content Padding / 2 カラム幅は**全画面で同一**。画面側で上書き禁止。
2. 画面固有の内容は Main（1018）と Right（388）の中にだけ置く。
3. リストは必ず **Section Card + 45px Row**。密度を画面ごとに変えない。
4. 行内の操作は「Action Button(146 × 32) + More」の 1 パターン。
5. ステータスは Badge 5 種類のみ。
6. 数値サマリは KPI Card（4 列）。3 列以下にしない。
7. アイコンは §4.4 の 4 サイズのいずれか。
8. 影・グラデーションは Sidebar 以外で使わない。
9. 画面タイトルは h1 のみ。**Header に画面名を出さない。**
10. 右カラムが不要な画面でも空にせず、関連サマリを置く。

---

## 6. 🔴 仕様書と実装がずれるところ（理由つき）

**理由の無い不一致を残さない。** 以下は「作り忘れ」ではなく、**出せない / 変えられない理由**がある。

🔴 **①〜③ は「検査が落とした」ものである。** この 3 つは**仕様書どおりに実装したら
`tests/static/design-tokens.test.ts` がコントラスト比の実測で落とした** —— 緩めるのではなく階調を直した
（検査のメッセージが「この検査を緩めるのではなく階調を見直してください」と明示している）。

| # | 仕様書 | 実装 | 理由 |
|---|---|---|---|
| ① | `--danger #DC2626`（`red-600`） | `danger` は **`red-700`** のまま | 🔴 `danger-bg` / `bg-subtle` / `neutral-bg` の上で **4.36:1** となり AA（4.5:1）を満たさない（実測） |
| ② | `--text-2 #4B5563` と `--text-3 #6B7280` の 2 段 | **1 つにまとめて `slate-600`** | 🔴 ページの地が `#F1F5F9` になったことで `#6B7280` は **4.20:1** となり AA を満たさない。**読めない階調を規約に入れない**。2 段の差は補助テキストの中だけの差であり、1 つにしても情報は減らない |
| ③ | `--success #16A34A` | `success` は **`emerald-700`** のまま | 🔴 白地に `#16A34A` は 13px の文字で **3.1:1**。使途は「減少デルタ」1 箇所である |
| ④ | Meta（時刻）の**緊急は `--danger`**（赤） | **`warning`（橙）** | 🔴 `docs/04` §7.4 のハードルール「**橙 = 期限が近い・要注意。赤の代わりに使わない**」。赤は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 状態に予約されており、期限超過を赤にすると**本当に危ない 3 状態が埋もれる** |
| ⑤ | Badge の padding **0 10** | **0 12**（`px-3`） | 10px は 4px グリッドの外（仕様書 §1.3 の使用値にも無い）。2px の差はバッジの中では見分けられない |
| ⑥ | Badge 列の幅 **180** | **304**（`w-76`） | モックは 1 行に 1 つだが、本実装は **種別（何をすべきか）/ 優先度 / 状態（いまどこか）の 2〜3 つ**を出す（`docs/04` §4.1）。180 のままだと 13px のバッジが折り返して 45px の刻みが崩れる |
| ⑦ | 行の先頭の**チェックボックス（完了）** | **描かない**（列の幅も取らない） | `Task` の API が実装側に無い（モデルとマイグレーションのみ）。**押して何も起きない操作を描かない**（`UI_GUIDELINES.md` §7）。[#90](https://github.com/Festal-KM/SES-Platform/issues/90)（既定 = 出さない） |
| ⑧ | 行末の **`…` メニュー** | **`内容を見る` の 1 ボタンにする**（24px の位置は保つ） | 中身が 1 つしか無いメニューを作らない |
| ⑨ | 行の**氏名**（`田中 大輔さん`） | **案件名で識別する** | 🔴 ホームに氏名を出さない（`BR-27`）。60 秒ポーリングで `engineer.view` の監査ログが毎分積まれる |
| ⑩ | 行の**社名**（`株式会社ネクスト`） | **出さない** | 🔴 ホストのホームに取引先の社名を出さない（`CLAUDE.md` §3.1 経路 4。[#91](https://github.com/Festal-KM/SES-Platform/issues/91)、既定 = 出さない） |
| ⑪ | `稼働開始が近い人材` セクション | **無い** | `Assignment` が Phase 2。行に氏名が要るため ⑨ にも当たる |
| ⑫ | 今日のスケジュールの中身 | **0 件の空状態** | `Proposal` に面談日時の列が無い。**架空の予定を描かない。** 器の高さも固定しない |
| ⑬ | メッセージの未読数 | **無い** | `Message` に既読の列が無く、未読という状態が存在しない |
| ⑭ | 仕様書に**無い**「ページ見出しの帯」（パンくず + `案件を登録する`） | **残している** | `data-testid` の凍結（`home-host-register-project`。削除は CI が落とす）と `tests/static/page-heading-single.test.ts` の契約。**そのぶん本文の開始が仕様書より下がる。** 消してよいかは [#92](https://github.com/Festal-KM/SES-Platform/issues/92)（既定 = 残す） |
| ⑮ | Sidebar の項目は 6 つ（ホーム / チャット / 人材管理 / 案件管理 / レポート / 設定） | **実装の項目表のまま**（群分けあり） | 項目表は `docs/04` §3.1 が正。**寸法（184 × 46 / gap 6 / radius 8）だけ**を本ファイルから取る |
| ⑯ | Sidebar の上端に **マーク + `SES Hub` + タグライン**、下端に **メッセージの箱 + `Ver 1.0.0`** | **置いていない**（上端は開閉トグルだけ） | 🔴 **`SES Hub` は未確定のプロダクト名である**（`docs/03` §9-1。現在は仮称 `SES Platform`）。`CLAUDE.md` §8.6 が**事業判断**として人間に留保しており、**モックアップに書いてあるという理由で改名しない**。タグラインと `可能性を、もっとシンプルに。` も同じくブランドコピーである。[#93](https://github.com/Festal-KM/SES-Platform/issues/93)（既定 = いまのまま） |

---

## 7. 壊れないようにする仕掛け

| 検査 | 何を守るか |
|---|---|
| `tests/static/layout-tokens.test.ts` | 🔴 **寸法を画面側で書き直していない**（`layout-tokens.ts` の外に同じ px のクラスが生えていない） |
| `tests/static/design-tokens.test.ts` | `@theme` の値が §3 の表と一致する。`text-metric` / `text-title` の使用箇所の限定 |
| `tests/static/ui-spacing-scale.test.ts` / `ui-type-scale.test.ts` | 段の外が無い |

🔴 **「だいたい似ている」で終わらせない。** 変更したら基準サイズ（1672 × 941）で実機を撮り、本ファイルの表と突き合わせる。

---

## 8. 🔴 この改訂で**他の画面にも効いた**こと

本ファイルの §2〜§4 は共通部品（`AppShell` / `Sidebar` / `TopBar` / `PageBody` / `Card` / `Button` / `Input` / `Badge` / `Tabs`）に入っているので、**ホーム以外の 50 画面にも同時に効く**。

| 変わったもの | 旧 → 新 | 影響 |
|---|---|---|
| 画面タイトル（h1） | 20 → **26px** | 全画面の `PageHeader` |
| 本文の左右 gutter | 24 / 24 → **28 / 16** | 全画面 |
| サイドバー（展開） | 224 → **208px** | 全画面 |
| 副カラム | lg 360 → xl 400 → 2xl 480 → **388 固定** | `split` を使う 20 画面 |
| 本体と副カラムの間 | 24 → **16px** | 同上 |
| Card の角丸 | 6 → **10px** | 全画面 |
| Button / Input の高さ | 40 → **36px**、角丸 4 → **8px** | 全画面 |
| Badge | 11px・角丸 4・padding 8 → **13px・角丸 4・padding 12・高さ 24** | 全画面 |
| ページの地 | `slate-50` → **`slate-100`** | 全画面（白いカードが浮く） |
| 行 hover / 列ヘッダ | 地と同値 → **`slate-50`（地と別）** | 一覧全部（🔴 **淡い地の上で hover が見えない問題が解消した**） |
| ブランド色 | 藍 `indigo-700` → **青 `blue-600`** | 全画面 |

⚠️ **まだ合わせていないもの**: 一覧（`DataTable`）の行高は **36.5px のまま**である（仕様書の 45px は「Section Card の行」の寸法であり、50 行の表に当てると 1 画面の行数が 3 割減る）。表に適用するかは別途の判断とする。
