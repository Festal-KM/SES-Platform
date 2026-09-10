# S-023 提案詳細と履歴 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-023
- 画面名: 提案詳細と履歴
- 平面: 主平面
- 対応機能 ID: F-024 / F-025 / F-020 / F-037 / F-019
- 対応ステージ: ③④
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-023`（**改訂 8 = Issue #35 = A。凍結された `EngineerCareer`**）/ §5-6 / §9.1（由来の 2 層目）/ §10.1 / §10.3 の `S-023` 行 / §11-11 / `designer` 申し送り 14
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-023
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen shows one proposal: its current state and the full history of who did what and when, so that the company can explain itself afterwards. Gate results are kept as history and never overwritten.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, text links written plainly.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border with an elapsed time.
- A timeline is drawn as a vertical rule with small square nodes; each entry has a timestamp on the left and the event on the right.
- Definition lists for the attributes of one record; tables for lists of same-shaped records.
- AI provenance is written as plain Japanese text, never as an icon.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案 ＞ P-0142`, the screen title `提案 P-0142` as the single largest text, and exactly one primary button on the right of the title row: `[ 面談日程を調整する ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 45 percent (heading and timeline), right about 55 percent (frozen content, gate history, result).

### Section 1: `見出し` — a bordered band across the full width under the title row
`< 送信済み >` outline ・ `提案先 富士アルファ商事 / 大村 部長` ・ `エンジニア 山田 太郎（自社）` ・ `案件 金融系 Web API 改修` ・ `単価 70 万円`

## Left column

### Section 2: `履歴` — a vertical timeline of 9 entries, newest at the top
Each entry: timestamp on the left, then 主体, then the event, then an optional note.
- `2026-08-31 16:02 / システム / 送信済み`
- `2026-08-31 16:01 / システム / 送信中`（with a dashed marker）
- `2026-08-31 16:00 / 山田（営業） / 承認して送信`
- `2026-08-29 09:12 / システム / 品質ゲート 3 層 PASS（整合層に警告 1 件）`
- `2026-08-29 09:11 / 鈴木（営業） / レビューに出す`
- `2026-08-29 09:02 / 鈴木（営業） / 本文を編集`
- `2026-08-28 18:41 / システム（全層 PASS のため） / 自動承認` — this entry carries the text link `監査ログを見る`
- `2026-07-03 10:22 / 鈴木（営業） / 提案を作成（この時点の情報を凍結）`
- `2026-07-03 10:20 / システム / 提案依頼 R-0071 の応諾により下書きを生成`

## Right column

### Section 3: `本文と添付（凍結内容）`
- A gray caption line: `2026-07-03 時点のエンジニア情報`
- A one-line plain-text provenance label: `AI 下書き（編集済み）` followed by the text link `この内容の由来`
- Beside that link, a small expanded panel with the small gray caption `「この内容の由来」を開いたとき`, containing: `生成した担当` `提案文の下書き担当` / `プロンプト版` `v3` / `モデル` `claude-sonnet-5` / `生成日時` `2026-07-03 10:24`
- `件名` `【ご提案】Java / Spring エンジニアのご紹介` and about 8 lines of body text
- `添付` an empty rectangle with a diagonal cross labelled `skillsheet_v5.pdf`
- A sub-table headed exactly `2026-07-03 時点の経験内容 — 4 行`, with exactly four columns in this order: `期間` / `役割` / `業務内容` / `使用技術`. No operations column, no sort arrows on the headers, no checkbox. Rows in 期間 descending order:
  1. `2025-04 〜 継続中` / `バックエンド開発 / チームリード` / `保険基幹系のマイグレーション。API 設計とレビュー、メンバー 6 名の進捗管理` / `Java, Spring Boot, PostgreSQL`
  2. `2023-10 〜 2025-03` / `バックエンド開発` / `証券口座管理システムの機能追加。バッチ処理の性能改善` / `Java, Oracle, Jenkins`
  3. `2022-01 〜 2023-09` / `Web アプリ開発` / `EC サイトの受注管理画面の開発と保守` / `Java, Spring, MySQL`
  4. `2018-04 〜 2019-03` / `テスト担当` / `通信キャリアの回線管理システムの結合テスト` / `Java, Excel マクロ`
  Under the sub-table, one small gray line: `提案先に届いた内容です。台帳を更新してもこの表は変わりません。`
  FORBIDDEN in and around this sub-table: do NOT draw a `最新の情報に更新` button or anything like it; do NOT draw an edit or delete control; do NOT add rows taken from the current ledger into this same table; do NOT mark any row as newly added or changed inside this table.
- The text link `現在の台帳との差分を見る` followed by one small gray line: `差分は凍結側と現在側を左右に並べて表示します（同じ表に混ぜません）`

### Section 4: `ゲート結果の履歴` — table, 3 body rows (not overwritten)
Columns `実行日時` / `PII 層` / `商流層` / `整合層` / `指摘`
- `2026-08-29 09:12 / PASS / PASS / PASS / 警告 1 件`
- `2026-08-28 14:40 / PASS / FAIL / — / 2 件`
- `2026-07-03 11:05 / PASS / PASS / PASS / 0 件`

### Section 5: `商談結果の記録`
Buttons in a row: `[ 面談日程を調整する ]` primary, `[ 結果を記録する ]`, `[ 辞退を記録する ]`.
A gray line: `状態が「決定」になると契約の作成導線が表示されます`.

### Section 6: `重複提案` — a bordered block with the gray caption `※ ホストにのみ表示される`
`このエンジニアは別経路でも提案されています` with one row `P-0119 / みなと物流 / 2026-08-21 / < 送信済み >` and the text link `該当の提案を見る`.

### Section 7: `チャット` — a compact list of 3 recent messages with the counterpart company and time.

### Two state strips at the very bottom, drawn side by side, each with a small gray caption above it
- Caption `取引先が同じ画面を開いたとき`: a narrow band showing the same heading, timeline and frozen content, but with NO 重複提案 section at all, and a gray line `他社が作成した提案は表示されません`.
- Caption `「現在の台帳との差分を見る」を開いたとき`: a narrow band containing TWO panels placed side by side. Left panel headed `提案時点（2026-07-03 凍結）— 4 行` with four short lines `2025-04 〜 継続中 / Java, Spring Boot, PostgreSQL`, `2023-10 〜 2025-03`, `2022-01 〜 2023-09`, `2018-04 〜 2019-03`. Right panel headed `現在の台帳 — 4 行` with `2025-04 〜 継続中 / Java, Spring Boot, PostgreSQL, AWS`, `2023-10 〜 2025-03`, `2022-01 〜 2023-09`, `2019-04 〜 2021-12`. Plain-text notes: `使用技術が変わった行` beside the first line of both panels, `提案後に削除された行` beside the last line of the LEFT panel, `提案後に追加された行` beside the last line of the RIGHT panel. The two panels stay separate; do NOT merge them into one list.
```

## 設計意図メモ（画像生成には使われない）

- 改訂 8（Issue #35 = A）で凍結内容に `2026-07-03 時点の経験内容 — 4 行` の 4 列テーブルを足した。**見出しに凍結日時を必ず添える**のは、`S-006` セクション 8 と同じ体裁のため、日時が無いと台帳の現在値と取り違えるから（`F-019 AC-5`）。
- **台帳の現在値を同じ表に混ぜない。** 混ぜると「どの行が提案先に届いた内容か」が読めなくなり、凍結の意味が失われる（商流上、届いた内容が唯一の事実）。差分は左右並置の別ブロックに逃がした（§5-6）。
- 「最新の情報に更新する」に相当するボタンを描かない。更新したい場合は新しい提案を起こす、が本文の規約である。
- エンジニア名を `S-006` と同じ `山田 太郎` に揃えた。凍結側（本画面）と台帳側（`S-006`）の 2 枚を並べて読んだときに、行の追加・削除・変更が同一人物の話として繋がるようにするため。
- 経歴は `S-016`（匿名候補）には 1 項目も出さない。**同じ情報が、提案では最も見せたく、匿名候補では最も見せてはならない**（§11-11）。本画面が「全部見せる側」の端であり、`S-016` は「列そのものを作らない側」の端である。
- 自動承認を `システム（全層 PASS のため）` と表示し、監査ログへの導線を添える（`F-021 AC-5`）。誰が承認したかを後から説明できる状態にする。
- ゲート結果は再実行で上書きせず履歴として残す（`F-020 AC-7`）。テーブルに 3 回分の実行を並べた。
- AI 由来は常時 1 行（`AI 下書き（編集済み）`）、明示操作で 1 段掘るとロールの業務上の呼び名・プロンプト版・モデル・生成日時に到達する（§9.1 の 2 層目）。
- 凍結内容と現在の台帳の差分への導線を置く（§5-6）。SES では提案後の台帳更新が提案に反映されないことが前提。
- 重複提案は取引先の画面に現れない（`BR-08`）。1 枚の下部に取引先バンドを併記して差を示した。
- 関連 UC: UC-07（商談結果の記録）/ UC-22（説明責任）。
