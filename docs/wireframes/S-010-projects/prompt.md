# S-010 案件一覧・検索 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-010
- 画面名: 案件一覧・検索
- 平面: 主平面
- 対応機能 ID: F-015 / F-045
- 対応ステージ: ① 集める
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-010` / §3.2 / §7.1 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-010
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables are the default for lists of same-shaped records: Japanese column headers, thin rules, tight rows. Never lay records out as a grid of cards.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Very dense. This list must hold 10,000 records, so the first screenful shows at least 12 rows.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 案件` is the current item with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 案件`, the screen title `案件一覧` as the single largest text, and exactly one primary button on the right of the title row: `[ 案件を登録 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Content is one column: a horizontal filter strip on top, then the result table filling the rest.

### Filter strip (one row, wrapping to two rows)
`スキル要件` ______________ / `単価レンジ` two numeric fields with a tilde and the unit `万円` / `開始日` `[ 2026-10 ▾ ]` / `勤務地・リモート` `[ 東京都 ▾ ]` `[ 一部リモート可 ▾ ]` / `案件の状態` `[ すべて ▾ ]` / `フリーワード` ______________ / `[ 検索 ]` / text link `条件をクリア`

### Count line
Bold: `自社案件 312 件`

### Result table — 9 columns, 12 body rows, tight rows
Columns: `案件名` / `状態` / `必須要件の要約` / `単価レンジ` / `開始日` / `勤務地・リモート` / `募集人数` / `更新日` / `公開先の設定状況`
The `後任募集` rows are sorted to the very top by default.
1. `保険基幹系マイグレーション（後任） / < 後任募集 > filled / COBOL 5 年以上, Java / 70〜80 万円 / 2026-11-01 / 東京都・リモート不可 / 1 名 / 2026-08-31 / < 未設定 > filled` with a small gray marker `自動で追加されました` at the right edge
2. `物流管理システム保守（後任） / < 後任募集 > filled / Java, Oracle / 60〜70 万円 / 2026-11-01 / 千葉県・一部リモート可 / 1 名 / 2026-08-31 / < 未設定 > filled` with the same `自動で追加されました` marker
3. `金融系 Web API 改修 / < 募集中 > filled / Java 5 年以上, Spring / 65〜75 万円 / 2026-10-01 / 東京都・一部リモート可 / 2 名 / 2026-08-30 / 3 社に公開中`
4. `EC サイト基盤刷新 / < 募集中 > filled / TypeScript, React / 60〜70 万円 / 2026-10-01 / 神奈川県・フルリモート可 / 3 名 / 2026-08-29 / 2 社に公開中`
5. `社内 DWH 構築 / < 募集中 > filled / Python, SQL / 60〜70 万円 / 2026-11-01 / 東京都・一部リモート可 / 1 名 / 2026-08-28 / 4 社に公開中`
6. `医療系 SaaS フロントエンド / < 充足 > outline / TypeScript, Next.js / 55〜65 万円 / 2026-09-01 / 東京都・フルリモート可 / 2 名 / 2026-08-24 / 3 社に公開中`
7-12. six more rows of the same shape, mixing `< 募集中 >` and `< 充足 >`, with long project names truncated on one line and uniform row height.

### Below the table
Cursor paging: `[ 前のページ ]` `1 - 50 / 312` `[ 次のページ ]`. No infinite scroll.

### Two state strips at the very bottom of the image, each with a small gray caption above it
- Caption `ホストの初回空`: `まだ案件が登録されていません` with `[ 案件を登録 ]`
- Caption `取引先の初回空（同じ画面・別文言）`: `御社に公開された案件はまだありません。案件が公開されると、この画面と通知でお知らせします。`
```

## 設計意図メモ（画像生成には使われない）

- 「公開先の設定状況」列はホストにのみ存在する。取引先の画面ではこの列そのものを描かない（`F-014 AC-4`）。本画像はホスト視点。
- `後任募集` を既定の並びで上位に置いたのは、⑥→① の還流が放置されると無意味になるため（`F-045`）。「自動で追加されました」の新着印を付ける。
- 取引先の初回空を「案件が無い」ではなく「公開されていない」と書く（ホストに案件があるかは取引先の知る範囲ではない）。2 文言を 1 枚に併記した。
- カードでなくテーブル、8 列 + 1 列（ホスト固有）、12 行以上（申し送り 2 / §7.1）。
- 関連 UC: UC-04（案件登録と公開）/ UC-13（取引先の閲覧）。
