# S-025 契約一覧 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-025
- 画面名: 契約一覧
- 平面: 主平面
- 対応機能 ID: F-047
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-025` / §5-1（`Contract` の 7 状態）/ §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-025
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists contracts. Three different endings exist and are never merged into one word such as 失効: 送付失敗 (the send itself failed), 取り下げ (we withdrew it), and 期間満了 (it was executed and then expired).

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`. Filter chips drawn as `[ ラベル ]` boxes with the active one filled black.
- Status badges `< ラベル >` in angle brackets: `< 下書き >` outline, `< 送付中 >` dashed with an elapsed time, `< 送付失敗 >` filled, `< 先方確認中 >` outline, `< 締結済み >` filled, `< 取り下げ >` outline, `< 期間満了 >` outline.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 契約` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 契約`, the screen title `契約一覧` as the single largest text, and on the right of the title row exactly two buttons: the primary `[ 契約を作成 ]` and, beside it, the secondary `[ 取引先にはこう見えています ]` which opens the partner-facing contracts screen as a read-only preview.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column: filter chips, count line, table, then a small task block.

### Filter chips (each of the seven states is its own chip; none are grouped)
`[ すべて ]` `[ 下書き ]` `[ 送付中 ]` `[ 送付失敗 ]` `[ 先方確認中 ]` (filled black, active) `[ 締結済み ]` `[ 取り下げ ]` `[ 期間満了 ]`

### Count line
`契約 63 件`

### Table — 6 columns, 11 body rows
Columns: `相手方` / `契約種別` / `対象の稼働・提案` / `状態` / `期間` / `最終更新`
1. `富士アルファ商事 / 個別契約 / A-0071 伊藤 修 / < 先方確認中 > outline / 2026-10-01 〜 2027-03-31 / 2026-08-30` with the inline gray note `先方確認中のまま 5 日経過`
2. `みなと物流 / 個別契約 / P-0142 佐藤 花子 / < 送付中 > dashed 経過 00:04 / 2026-10-01 〜 2027-03-31 / 2026-08-31`
3. `けやきリテール / 個別契約 / A-0064 吉田 玲 / < 送付失敗 > filled / 2026-09-01 〜 2027-02-28 / 2026-08-29`
4. `富士アルファ商事 / 基本契約 / — / < 締結済み > filled / 2025-04-01 〜 2027-03-31 / 2025-04-01`
5. `△△テック / NDA / — / < 締結済み > filled / 2025-05-12 〜 無期限 / 2025-05-12`
6. `▲▲ソリューション / NDA / — / < 取り下げ > outline / — / 2026-06-11`
7. `■■エンジニアリング / 個別契約 / A-0052 森 涼太 / < 期間満了 > outline / 2025-10-01 〜 2026-03-31 / 2026-03-31`
8. `みなと物流 / 個別契約 / A-0058 小林 大輔 / < 下書き > outline / 2026-11-01 〜 2027-04-30 / 2026-08-28`
9-11. three more rows of the same shape.
IMPORTANT: `送付失敗`, `取り下げ` and `期間満了` each keep their own wording and their own row; there is no combined `失効` state, filter or count anywhere in this image.

### Under the table
Paging `[ 前のページ ]` `1 - 50 / 63` `[ 次のページ ]`.

### Section: `締結待ちのタスク` — a small table of 4 rows
Columns `対象` / `期日` / `超過日数` / `担当`. Example: `A-0071 伊藤 修 の個別契約 / 2026-09-05 / — / 加藤`.

### One state strip at the very bottom with a small gray caption above it
- Caption `初回空`: `契約はまだありません` with `[ 決定した提案から作成する ]`
```

## 設計意図メモ（画像生成には使われない）

- 3 つの終わり方を別の語・別のフィルタ・別の集計にする（`F-047 AC-4` / `docs/02` 申し送り 11）。「失効」というまとめ表示を作らない。
- `送付中` は片道であり自動リトライしない（`F-049 AC-2`）。滞留行に経過時間を添える。
- 取引先はこの画面に到達しない（`F-047` の `PA`/`PS` = `−`）。ナビにも項目を出さないため、本画像はホスト視点のみ。
- 🔴 2026-09-01 改訂: タイトル行に「取引先にはこう見えています」ボタンを追加した（`docs/04` §4.5 `S-025` / §5-2）。ホストが送付・公開の前に、販売単価・エンド企業名・ドラフト版が `S-045`（取引先ビュー）に見えていないことを自分の目で確認できる。`S-045` 側にプレビュー時の帯を新設し、対応関係を対にした。
- 初回空は `WON` の提案から作る導線を出す（`F-042` と同じく `WON` 以外から作れない）。
- Phase 3 の画面。`S-026` へ遷移し、そこで版と署名依頼を扱う。
- 関連 UC: UC-08（契約締結）。
