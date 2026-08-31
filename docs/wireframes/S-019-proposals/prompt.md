# S-019 提案一覧 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-019
- 画面名: 提案一覧
- 平面: 主平面
- 対応機能 ID: F-024 / F-020 / F-022 / F-037
- 対応ステージ: ③④
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-019` / §5-1 / §6.1（一括承認）/ §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-019
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists proposals. Four different kinds of "it did not work out" exist in this product and must never be merged into one bucket: 差し戻し（検査で不合格）, 送信失敗, 見送り, and 依頼を辞退. Each keeps its own filter, its own wording and its own badge treatment.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`. Filter chips drawn as `[ ラベル ]` boxes in rows, the active one filled black.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border used for in-progress states, always accompanied by an elapsed time.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows. Never lay proposals out as a grid of cards.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Very dense; the first screenful shows at least 12 rows.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案`, the screen title `提案一覧` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column: filter block, count line, selection bar, table, paging.

### Filter block — two labelled rows of chips, NOT tabs
Row 1 label `提案の状態（14）`: `[ すべて ]` `[ 下書き ]` `[ 検査中 ]` `[ 差し戻し（検査で不合格） ]` `[ 承認待ち ]` (filled black, active) `[ 承認済み ]` `[ 送信中 ]` `[ 送信済み ]` `[ 送信失敗 ]` `[ 面談日程調整中 ]` `[ 面談実施済み ]` `[ 結果待ち ]` `[ 決定 ]` `[ 見送り ]` `[ 辞退 ]`
Row 2 label `提案依頼の状態（5）`: `[ 返答待ち ]` `[ 応諾 ]` `[ 依頼を辞退 ]` `[ 取り下げ ]` `[ 期限切れ ]`
IMPORTANT: every one of these 19 values is its own separate chip. Do not group two of them under one chip and do not render them as a tab bar.

### Count line
Bold `提案 184 件` and, to its right in gray, `承認待ちで絞り込み中: 6 件`

### Selection bar (shown because rows are selected)
A bordered strip: `3 件を選択中` with the button `[ 3 件をまとめて承認 ]` and the text link `選択を解除`. A gray line under the strip: `承認待ちの提案のみが選択できます`.

### Table — 9 columns, 12 body rows
Columns: `選択` / `提案先` / `エンジニア` / `案件` / `状態` / `単価` / `作成者` / `最終更新` / `経過時間` and a 10th narrow column `重複`
1. `[x] / 富士アルファ商事 / 佐藤 花子 / 金融系 Web API 改修 / < 承認待ち > filled / 70 万円 / 山田 / 2026-08-29 / 2 日 4 時間 / —`
2. `[x] / みなと物流 / 山田 太郎 / 物流管理システム保守 / < 承認待ち > filled / 68 万円 / 山田 / 2026-08-30 / 1 日 1 時間 / 重複`
3. `[x] / けやきリテール / 渡辺 翔 / EC サイト基盤刷新 / < 承認待ち > filled / 62 万円 / 鈴木 / 2026-08-31 / 4 時間 / —`
4. `[ ] / みなと物流 / 田中 誠 / 社内 DWH 構築 / < 差し戻し（検査で不合格） > filled / 66 万円 / 鈴木 / 2026-08-30 / 1 日 3 時間 / —`
5. `[ ] / 富士アルファ商事 / 高橋 健 / 金融系 Web API 改修 / < 送信失敗 > filled / 71 万円 / 山田 / 2026-08-28 / 3 日 2 時間 / —`
6. `[ ] / けやきリテール / 中村 彩 / 医療系 SaaS フロントエンド / < 送信中 > dashed 経過 00:41 / 60 万円 / 鈴木 / 2026-08-31 / 41 分 / —`
7. `[ ] / みなと物流 / 小林 大輔 / 物流管理システム保守 / < 検査中 > dashed 経過 00:12 / 64 万円 / 加藤 / 2026-08-31 / 12 分 / —`
8. `[ ] / 富士アルファ商事 / 伊藤 修 / 保険基幹系マイグレーション / < 送信済み > outline / 75 万円 / 加藤 / 2026-08-27 / 4 日 / —`
9. `[ ] / けやきリテール / 吉田 玲 / EC サイト基盤刷新 / < 面談日程調整中 > outline / 63 万円 / 山田 / 2026-08-26 / 5 日 / —`
10. `[ ] / みなと物流 / 森 涼太 / 社内 DWH 構築 / < 決定 > filled / 67 万円 / 鈴木 / 2026-08-20 / 11 日 / —`
11. `[ ] / 富士アルファ商事 / 大野 亮 / 金融系 Web API 改修 / < 見送り > outline / 69 万円 / 山田 / 2026-08-18 / 13 日 / —`
12. `[ ] / けやきリテール / 加藤 直樹 / 医療系 SaaS フロントエンド / < 辞退 > outline / 61 万円 / 加藤 / 2026-08-15 / 16 日 / —`
Row 6 with `< 送信中 >` carries an inline gray note under the row: `送信中のまま 41 分経過しています`.
Long values in `提案先` / `エンジニア` / `案件` are truncated on one line; row height stays uniform.

### Under the table
Paging `[ 前のページ ]` `1 - 50 / 184` `[ 次のページ ]`, and one gray line: `一括承認はデスクトップでのみ表示されます`.

### One state strip at the very bottom with a small gray caption above it
- Caption `取引先が同じ画面を開いたとき`: a narrow band showing the count line `御社が作成した提案 24 件` and a gray line `他社が作成した提案は表示されません`, with no 一括承認 bar and no 重複 column.
```

## 設計意図メモ（画像生成には使われない）

- 14 + 5 の状態をすべて独立したチップにし、2 つを同じ区分にまとめない（`F-024 AC-2` / §5-1 の区別の要点）。タブにしないのは §10.3 の「タブを 5 つ以上に増やさない」。
- 一括承認の対象は `APPROVAL_PENDING` のみで、ゲート FAIL 分は構造的に選択対象に入らない（選択チェックが付くのは承認待ちの行だけ）。
- `送信中` は点線枠 + 経過時間で描き、自動で `承認済み` に戻らない（`F-022 AC-2`）。30 分超の滞留に注記を出す。
- 重複提案の列はホストのみ（Phase 2。`F-037 AC-1`）。取引先バンドには描かない。
- 取引先の母集団明示（「御社が作成した提案 24 件」）を同じ画像の下部に併記して、境界の見え方を 1 枚で伝えた。
- 関連 UC: UC-05（承認）/ UC-09（送信失敗）/ UC-06（一括承認）。
