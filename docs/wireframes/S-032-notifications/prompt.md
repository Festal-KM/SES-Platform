# S-032 通知一覧 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-032
- 画面名: 通知一覧
- 平面: 主平面
- 対応機能 ID: F-039 / F-027 / F-061
- 対応ステージ: 横断
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.7 `S-032` / §7.5（種別の弁別のみアイコン可）/ §10.1
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-032
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists notifications about deadlines and decisions. A notification never contains information from outside the reader's own boundary: a partner never sees another company's name, engineer or proposal in a notification body.

Style rules:
- Pure black and white. Light gray only for de-emphasis (already-read rows). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`. Filter chips drawn as `[ ラベル ]` boxes with the active one filled black.
- The notification TYPE is the one place where a small distinguishing glyph is allowed, drawn as a plain small square containing one Japanese character. Do not use pictorial icons anywhere else, and do not put icons on headings, buttons or navigation.
- Unread rows carry a small solid square marker at the left edge; read rows are gray.
- All visible text is Japanese. No photos, no logos, no decorative graphics.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `ホーム` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 通知`, the screen title `通知` as the single largest text, and on the right of the title row a secondary button `[ すべて既読にする ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 70 percent width.

### Filter row 1: `未読 / 既読`
`[ 未読 ]` (filled black, active) `[ 既読 ]` `[ すべて ]`

### Filter row 2: `種別`
`[ すべて ]` `[ 承認待ち ]` `[ 検査で不合格 ]` `[ 送信失敗 ]` `[ 提案依頼 ]` `[ 満了 60 日前 ]` `[ 満了 30 日前（再通知） ]` `[ 上限接近 ]` `[ お知らせ ]` `[ 代理閲覧の開始 ]`

### A band above the list: `新着 3 件` — a thin bordered strip inserted at the top of the list

### Notification list — 12 rows
Each row: an unread marker square, a small square type glyph, the type name, the body on one line, and a relative time on the right.
1. `送信失敗` — `提案 P-0138（富士アルファ商事 / 高橋 健）の送信に失敗しました` — `3 日前` — unread
2. `送信失敗` — `提案 P-0131（けやきリテール / 中村 彩）の送信に失敗しました` — `1 日前` — unread
3. `承認待ち` — `提案 P-0142（富士アルファ商事 / 佐藤 花子）が承認を待っています` — `2 日前` — unread
4. `検査で不合格` — `提案 P-0140 が検査で不合格になりました（商流層 2 件）` — `1 日前` — unread
5. `提案依頼` — `提案依頼 R-0088 の返答期限まで 22 時間です` — `5 時間前` — unread
6. `満了 60 日前` — `稼働 A-0071（伊藤 修）の延長確認を起票しました` — `昨日`
7. `満了 30 日前（再通知）` — `稼働 A-0058（高橋 健）の満了まで 30 日です` — `2 日前`
8. `上限接近` — `AI コストが日次上限の 82% に達しました` — `3 時間前`
9. `お知らせ` — `9/5 02:00-04:00 にメンテナンスを実施します` — `昨日`
10. `代理閲覧の開始` — `運営者による代理閲覧が開始されました（理由の記録あり）` — `4 日前`
11. `承認待ち` — `提案 P-0145（けやきリテール / 渡辺 翔）が承認を待っています` — `4 時間前`
12. `提案依頼` — `提案依頼 R-0087 に応諾がありました` — `2 日前`
Row 8 carries an inline gray note: `メール送信の上限により、この通知はメールでは送られていません`.

### Under the list
Paging `[ 前のページ ]` `1 - 50 / 128` `[ 次のページ ]`.

### One state strip at the very bottom with a small gray caption above it
- Caption `空のとき`: `通知はありません`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

Single column at full content width, in this order:
1. The `未読 / 既読 / すべて` chip row.
2. The type chip row, wrapping onto two lines so every one of the nine type chips is visible.
3. The `新着 3 件` strip.
4. The 12-row notification list with the same content, each row still on one line: unread marker, type glyph, type name, body, relative time.
5. Paging controls.

IMPORTANT: no chip is hidden behind a "more" control; the row wraps instead.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge rows.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 5`; under it `〇〇システム`.
2. Title row `通知` with the text link `すべて既読にする`.
3. A single horizontally scrollable chip row: `[ 未読 ]` (active) `[ 既読 ]` `[ すべて ]` `[ 承認待ち ]` `[ 送信失敗 ]` `[ 提案依頼 ]` `[ 満了 60 日前 ]`.
4. The `新着 3 件` strip inserted at the top of the list.
5. A list of 12 rows. Each row is exactly three elements: the type name, the body truncated to one line, and a relative time, with an unread marker square at the left edge. Example: `送信失敗  提案 P-0138 の送信に失敗しました  3 日前`.
6. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`.

IMPORTANT: new arrivals are inserted as the `新着 3 件` strip at the top; the existing rows do not reorder underneath while being read.
```

## 設計意図メモ（画像生成には使われない）

- 種別アイコンは「同種項目の視覚的な弁別」に限って許される唯一の用途（§7.5 の②）。それ以外の見出し・ボタン・ナビにはアイコンを描かない。
- 新着は上部に「新着 N 件」として差し込み、既存の並びを動かさない（読んでいる最中に行がずれない。§4.7 `S-032`）。
- メール上限で抑止された通知はアプリ内通知として残る旨を該当行に添える（`F-039 AC-3`）。
- 通知本文に境界外の情報を含めない（`F-039 AC-1`）。本画像はホスト視点であり、取引先の通知には他社の社名・エンジニア名が入らない。
- 満了 60 日前と 30 日前（再通知）を別の種別として列挙する（`U-03`）。
- 関連 UC: UC-05 / UC-09 / UC-15 / UC-19 の通知経路。
