# S-023 提案詳細と履歴 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-023
- 画面名: 提案詳細と履歴
- 平面: 主平面
- 対応機能 ID: F-024 / F-025 / F-020 / F-037
- 対応ステージ: ③④
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-023` / §5-6 / §9.1（由来の 2 層目）/ §10.1
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
`< 送信済み >` outline ・ `提案先 富士アルファ商事 / 大村 部長` ・ `エンジニア 佐藤 花子（自社）` ・ `案件 金融系 Web API 改修` ・ `単価 70 万円`

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
- The text link `現在の台帳との差分を見る`

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

### One state strip at the very bottom with a small gray caption above it
- Caption `取引先が同じ画面を開いたとき`: a narrow band showing the same heading, timeline and frozen content, but with NO 重複提案 section at all, and a gray line `他社が作成した提案は表示されません`.
```

## 設計意図メモ（画像生成には使われない）

- 自動承認を `システム（全層 PASS のため）` と表示し、監査ログへの導線を添える（`F-021 AC-5`）。誰が承認したかを後から説明できる状態にする。
- ゲート結果は再実行で上書きせず履歴として残す（`F-020 AC-7`）。テーブルに 3 回分の実行を並べた。
- AI 由来は常時 1 行（`AI 下書き（編集済み）`）、明示操作で 1 段掘るとロールの業務上の呼び名・プロンプト版・モデル・生成日時に到達する（§9.1 の 2 層目）。
- 凍結内容と現在の台帳の差分への導線を置く（§5-6）。SES では提案後の台帳更新が提案に反映されないことが前提。
- 重複提案は取引先の画面に現れない（`BR-08`）。1 枚の下部に取引先バンドを併記して差を示した。
- 関連 UC: UC-07（商談結果の記録）/ UC-22（説明責任）。
