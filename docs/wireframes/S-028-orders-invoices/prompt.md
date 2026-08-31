# S-028 発注・請求の記録 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-028
- 画面名: 発注・請求の記録
- 平面: 主平面
- 対応機能 ID: F-050
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-028` / §10.1 / §10.3（金額の単位）
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-028
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen records purchase orders and invoices, each of which must be tied to a contract or an assignment; a record that is tied to nothing cannot be saved. Changes to the amount or the period are kept as history.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text inputs as a Japanese label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows. Amounts are written with thousands separators.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 契約` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 契約 ＞ 発注・請求`, the screen title `発注・請求の記録` as the single largest text, and exactly one primary button on the right of the title row: `[ 記録を作成 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: list on the left (about 58 percent), detail and history on the right (about 42 percent).

### Left: `一覧` — table, 11 body rows
Columns: `相手方` / `対象の契約・稼働` / `期間` / `金額` / `発行日` / `入金` / `状態`
1. `富士アルファ商事 / C-0311 / A-0071 伊藤 修 / 2026-10 / 700,000 円 / 2026-10-31 / — / < 未入金 > filled`  (selected row, marked with a filled left edge)
2. `みなと物流 / C-0298 / A-0064 吉田 玲 / 2026-09 / 660,000 円 / 2026-09-30 / 2026-10-31 / < 入金済み > outline`
3. `けやきリテール / C-0287 / A-0052 森 涼太 / 2026-09 / 680,000 円 / 2026-09-30 / 2026-10-30 / < 入金済み > outline`
4. `富士アルファ商事 / C-0311 / A-0071 伊藤 修 / 2026-09 / 700,000 円 / 2026-09-30 / 2026-10-31 / < 入金済み > outline`
5-11. seven more rows of the same shape with amounts such as `620,000 円`, `750,000 円`, `1,240,000 円`.
Above the table a filter strip: `相手方` `[ すべて ▾ ]` / `期間` `[ 2026-09 ▾ ]` / `状態` `[ すべて ▾ ]` / `[ 検索 ]`.
Under the table paging `[ 前のページ ]` `1 - 50 / 214` `[ 次のページ ]`.

### Right: `詳細`
Definition list: `相手方` `富士アルファ商事` / `対象の契約` `C-0311 個別契約` / `対象の稼働` `A-0071 伊藤 修` / `期間` `2026-10-01 〜 2026-10-31` / `金額` `700,000 円` / `発行日` `2026-10-31` / `入金日` `—` / `状態` `< 未入金 >`
IMPORTANT: the `対象の契約` and `対象の稼働` fields are required. Draw the create form below with these two as `[ 契約を選択 ▾ ]` and `[ 稼働を選択 ▾ ]` and a gray line: `契約または稼働に紐づかない記録は保存できません`.

### Right, lower: `変更履歴` — table, 5 body rows
Columns `変更日時` / `変更者` / `項目` / `変更前` / `変更後`
- `2026-10-25 14:02 / 山田 / 金額 / 680,000 円 / 700,000 円`
- `2026-10-02 09:11 / 加藤 / 期間 / 2026-10-01 〜 2026-10-30 / 2026-10-01 〜 2026-10-31`
- three more rows of the same shape.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `初回空`: `発注・請求の記録はありません` with `[ 契約から作成する ]`
- Caption `紐づけ先が無いとき`: `先に契約または稼働を登録してください`
```

## 設計意図メモ（画像生成には使われない）

- 契約または稼働への紐づけを必須にし、紐づかない状態では保存できないことを作成フォームの注記で示す（`F-050 AC-1`）。
- 金額・期間の変更履歴を持つ（`F-050 AC-2`）。単価は「万円」、請求は「円」で単位を混在させない（§10.3）。3 桁区切りを使う。
- 取引先は到達しない。`SALES` / `VIEWER` は閲覧のみで、作成は `OWNER` / `ADMIN`。
- Phase 3 の画面。T3 のため画像は 1 枚。
- 関連 UC: UC-08（契約 → 発注・請求）。
