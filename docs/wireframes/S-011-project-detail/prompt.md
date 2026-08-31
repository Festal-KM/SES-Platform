# S-011 案件詳細 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-011
- 画面名: 案件詳細
- 平面: 主平面
- 対応機能 ID: F-013 / F-014 / F-037 / F-051
- 対応ステージ: ①③
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-011` / §3.2 / §5-10 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-011
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. A host SES company and the partner companies it invites share one tenant. The host sees commercial information (end-client name, internal unit price, the list of companies the project is published to); a partner sees none of it and never learns that other partners exist.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border. Mandatory requirements use filled badges, nice-to-have requirements use outline badges.
- Definition lists for the attributes of one record; tables for lists of same-shaped records.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 案件` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 案件 ＞ 金融系 Web API 改修`, the screen title `金融系 Web API 改修` as the single largest text, and exactly one primary button on the right of the title row: `[ 候補を探す ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. This image shows the HOST view as the main layout, and a narrow strip at the very bottom showing what the same screen looks like for a PARTNER user.

### Title row
`金融系 Web API 改修`  `< 募集中 >` filled  `募集人数 2 名`  `開始日 2026-10-01`  and on the right `[ 候補を探す ]` primary plus the secondary buttons `[ 公開範囲を設定 ]` `[ 編集 ]`.

Main content is a 2-column split: left about 55 percent, right about 45 percent.

## Left column

### Section 1: `必須要件` — a block whose rows each carry a FILLED badge
`< 必須 > Java 5 年以上` / `< 必須 > Spring Framework 3 年以上` / `< 必須 > REST API 設計の実務経験` / `< 必須 > 日本語での要件定義が可能`

### Section 2: `尚可要件` — a visually separate block whose rows carry OUTLINE badges
`< 尚可 > AWS（ECS / Lambda）` / `< 尚可 > 金融ドメインの経験` / `< 尚可 > テスト自動化の経験`

### Section 3: `条件` — definition list
`単価レンジ（外部公開用）` `65〜75 万円` / `勤務地` `東京都千代田区` / `リモート` `一部リモート可（週 2 日）` / `契約形態` `準委任`

### Section 4: `商流情報（社内用）` — a bordered block with a permanent one-line caption at its top
Caption: `この情報は公開範囲の相手には表示されません`
Definition list: `エンド企業` `富士アルファ銀行` / `自社単価` `85 万円` / `商流` `1 次`

## Right column

### Section 5: `公開範囲`
- A table of 4 body rows with columns `取引先企業` / `公開日` / `提案数`: `△△テック / 2026-08-20 / 2`, `▲▲ソリューション / 2026-08-20 / 1`, `■■エンジニアリング / 2026-08-22 / 0`, `◆◆システムズ / 2026-08-24 / 1`
- A text link `[ 公開範囲を設定 ]`

### Section 6: `この案件への提案` — table, 8 body rows
Columns `提案 ID` / `提案元` / `エンジニア` / `状態` / `単価` / `最終更新`. Statuses across the rows include `< 承認待ち > filled`, `< 送信済み > outline`, `< 面談日程調整中 > outline`, `< 差し戻し（検査で不合格） > filled`, `< 見送り > outline`.
One row carries a bordered inline warning: `重複提案: このエンジニアは別経路でも提案されています` with a text link `該当の提案を見る`.

### Section 7: `転換率` — a small 3-step funnel skeleton
`提案 12 → 面談 5 → 決定 2` drawn as three plain bars with labels, no decoration.

### Section 8: `チャット` — a compact list of 3 recent messages with the counterpart company name and time.

## Bottom strip of the image: `取引先が同じ画面を開いたときの構成`
A narrow bordered band, clearly labelled with that caption in gray, showing a compressed column with only these blocks in this order:
1. Title `金融系 Web API 改修` `< 募集中 >`
2. `必須要件` and `尚可要件` (same content)
3. `条件` containing ONLY `単価レンジ 65〜75 万円` / `勤務地` / `リモート` — no end-client name, no internal price
4. A bordered line: `この案件は御社に公開されています`
5. `提案（1 件）（御社が作成した提案）` with a single row
6. `チャット`
The strip contains NO 公開範囲 section, NO 商流情報 section, NO count of companies, NO total number of proposals and NO 重複提案 warning.
```

## 設計意図メモ（画像生成には使われない）

- ホストと取引先で構造そのものが違うため、1 枚の中に「取引先が開いたときの構成」を別バンドとして描き、何が消えるかを目で確認できるようにした（枚数を増やさずに §4.2 の 2 系統を伝える）。
- 取引先側に「公開先: 3 社」「総提案数」を出さないことが `F-014 AC-4` / `BR-07`。件数バッジ・並び順の変化・示唆も置かない。
- 必須と尚可を塗り／枠線で区別するのは、ここでの切り分けが `F-020` の整合層と `F-029` の足切りの根拠になるため。
- 重複提案の警告はホストのみ（`F-037 AC-1` / `BR-08`）。取引先バンドには描かない。
- 公開範囲が未設定の場合は「この案件はまだどの取引先にも公開されていません」を要件の上に警告として置く（本画像は公開済みの状態を描いている）。
- 関連 UC: UC-04 / UC-13。
