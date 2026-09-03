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
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = a usage indicator reading `AI 停止中` in a filled badge (same treatment as S-038 header — this tenant is over its AI daily cost ceiling; the badge shows only the fact, never a percentage and never a currency figure), then `通知 5` and the user menu `山田（営業）`.
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
`[ すべて ]` `[ 承認待ち ]` `[ 検査で不合格 ]` `[ 送信失敗 ]` `[ 提案依頼 ]` `[ 満了 60 日前 ]` `[ 満了 30 日前（再通知） ]` `[ 上限接近 ]` `[ AI 利用の停止 ]` `[ お知らせ ]` `[ 代理閲覧の開始 ]`

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
8. `AI 利用の停止` — `AI が日次上限に達したため停止中です（提案・契約書の品質ゲートは実行されません。リセット: 本日 24:00）　→ 利用状況を確認` — `3 時間前`
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
2. The type chip row, wrapping onto two lines so every one of the ten type chips is visible.
3. The `新着 3 件` strip.
4. The 12-row notification list with the same content, each row still on one line: unread marker, type glyph, type name, body, relative time.
5. Paging controls.

IMPORTANT: no chip is hidden behind a "more" control; the row wraps instead.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge rows.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, a usage indicator badge `AI 停止中` filled (same fact as the desktop header, no percentage, no currency), `通知 5`; under it `〇〇システム`.
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
- 🔴 2026-09-01 改訂: 行 8（`上限接近`）を `AI コストが日次上限の 82% に達しました` から件数クォータの接近通知に置き換えた（`BR-24` / `U-12` / `docs/04:301`）。AI の 1 日のコスト上限は金額もパーセンテージも一切見せない遮断器であり、到達時は「停止中」とだけ示す（`S-038` と同じ規律）。
- 🔴 2026-09-01 改訂: 行 8 を `マッチング候補の根拠文` のクォータ（`S-038:54` / `S-035:74` / `A-004:53` と同じ `〇〇システム` の当月フィクスチャで あと 1,240 件 / 6,200 件 ＝ 約 80%）に揃えた。旧文言の `スキルシート解析 …（あと 36 件）` は同テナントの `S-038` 上の値（118/180・あと 62 件）と矛盾し、かつ月次カウンタが 3 時間で 62 件から 36 件まで減る想定になってしまうため置き換えた。あわせてヘッダの上限インジケータを「描かない」から「描く」に変更した（`docs/04:301` は件数クォータが 80% を超えたときにヘッダへ出すと定めており、本画面の通知はまさにその状態を伝えるものであるため、ヘッダを平常時のまま描くと矛盾する）。インジケータは件数のみで金額・パーセンテージは出さない。
- 🔴 2026-09-01 改訂（Iteration 5・オーケストレーター決定）: `〇〇システム` の当月フィクスチャを AI 日次上限到達済み・停止中で全画面統一する（`S-038` / `A-004` / `S-035` / `S-003` と同一時点）。行 8 を `上限接近`（`根拠文 4,960/6,200` はちょうど 80.0% で「超えた」に該当しない）から `AI 停止中` の停止通知に差し替え、ヘッダの上限インジケータも `S-038:35` と同じ `AI 停止中` filled badge に統一した。desktop / tablet / mobile の 3 セクションで一致させている。
- 🔴 2026-09-03 修正（Iteration 6・design-reviewer 5 回目の残指摘 / `docs/04` 改訂 4・Issue #17 選択肢 A）: 行 8 の種別を、`docs/04` §4.7 で新設された `AI 利用の停止`（`F-027 AC-5` の停止通知の受け皿。`上限接近` とは別種別）に置き換えた。この種別を受信するのはホスト所属ロール（`OW`/`AD`/`SA`/`VI`）のみで、本プロンプトはホスト視点の描画なので該当する。あわせて本文末尾に `→ 利用状況を確認` の導線を足し、`docs/04:1200` が定める「停止理由 + `S-038` への導線」を満たす表現にした。desktop の種別フィルタチップ行にも `[ AI 利用の停止 ]` を追加し（`承認待ち` 〜 `代理閲覧の開始` の 10 種で `docs/04` と一致）、tablet の折り返し行の説明も「nine」から「ten」に合わせた。フィクスチャの時点（AI 日次上限到達済み・停止中）自体は変更していない。
- 関連 UC: UC-05 / UC-09 / UC-15 / UC-19 の通知経路。
