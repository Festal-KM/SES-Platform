# S-022 送信失敗一覧と再送 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-022
- 画面名: 送信失敗一覧と再送
- 平面: 主平面
- 対応機能 ID: F-023 / F-022
- 対応ステージ: ③ 提案
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-022` / §7.6（摩擦）/ §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-022
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists proposals whose outbound send failed. Double-sending a proposal to a client is the single worst accident this product can cause, so nothing here retries automatically: a human re-sends explicitly, after confirming that the message did not already arrive.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; dashed = dashed border with an elapsed time for in-progress states.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案 ＞ 送信失敗`, the screen title `送信失敗と再送` as the single largest text.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: there is no automatic retry anywhere in this product. Do not draw any toggle, setting, schedule or button that would re-send by itself, and do not use the word 自動再送 as an available option.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: table on the left (about 62 percent), the selected row's failure detail on the right (about 38 percent).

### Summary band, full width, directly under the title row
Two values side by side, both large: `未対応 5 件` and `最も古い経過時間 3 日 2 時間`.

### Table — 7 columns, 9 body rows
Columns: `提案先` / `エンジニア` / `案件` / `失敗理由` / `最終試行日時` / `経過時間` / `再送回数`
1. `富士アルファ商事 / 高橋 健 / 金融系 Web API 改修 / 応答不明（到達したか確認できない） / 2026-08-28 11:04 / 3 日 2 時間 / 0` (selected row, marked with a filled left edge)
2. `けやきリテール / 中村 彩 / EC サイト基盤刷新 / 送信元ドメインが未検証 / 2026-08-30 09:22 / 1 日 6 時間 / 0`
3. `みなと物流 / 小林 大輔 / 物流管理システム保守 / 宛先アドレスが無効 / 2026-08-30 15:47 / 1 日 / 1`
4. `富士アルファ商事 / 大野 亮 / 社内 DWH 構築 / 送信上限に達した / 2026-08-31 08:03 / 8 時間 / 0`
5. `けやきリテール / 加藤 直樹 / 医療系 SaaS フロントエンド / 外部サービスの障害 / 2026-08-31 12:15 / 4 時間 / 3`  — this row carries an inline gray note: `繰り返し失敗しています。運営に問い合わせてください。`
6. `みなと物流 / 森 涼太 / 保険基幹系マイグレーション / 認証エラー / 2026-08-27 17:31 / 4 日 / 2`
7. `富士アルファ商事 / 伊藤 修 / 金融系 Web API 改修 / < 送信中 > dashed 経過 00:03 / 2026-08-31 16:02 / 3 分 / 1` — the 再送 control in this row is drawn as gray text `確定するまで再送できません`, with no button.
8-9. two more rows of the same shape.
IMPORTANT: `応答不明（到達したか確認できない）` is written out in full and is never shortened to 失敗; it is a different wording from the other reasons because it changes the re-send decision.

### Right panel — `選択した提案の失敗理由`
Definition list: `提案 ID` `P-0138` / `提案先` `富士アルファ商事 / 大村 部長` / `エンジニア` `高橋 健` / `案件` `金融系 Web API 改修` / `単価` `71 万円` / `失敗理由` `応答不明（到達したか確認できない）` / `最終試行日時` `2026-08-28 11:04` / `再送回数` `0`
Action: `[ 再送する ]`.
Directly beside it, a confirmation dialog drawn with the small gray caption `再送の確認ステップ`:
Title `この提案は先方に届いている可能性があります`
Body, wrapped: `届いていないことを確認してから再送してください。`
A repeat of the key facts: `提案先: 富士アルファ商事 / 大村 部長` `エンジニア: 高橋 健` `単価: 71 万円` `最終試行: 2026-08-28 11:04`
Buttons: `[ 再送する ]` and `[ キャンセル ]`.

### Under the table
A bordered strip on the left: `[ 選択した 3 件をまとめて再送 ]` with the gray line `一括再送はデスクトップでのみ表示されます。確認ステップでは 1 件ずつの内容を列挙します。`
Beside it, for the row whose reason is 送信元ドメインが未検証, the text link `[ 送信ドメインを設定する ]`.

### One state strip at the very bottom with a small gray caption above it
- Caption `未対応 0 件のとき`: `送信に失敗した提案はありません`
```

## 設計意図メモ（画像生成には使われない）

- 「応答不明（到達したか確認できない）」を「失敗」と同じ語にしない（§4.4 `S-022`）。再送の判断が変わるため、テーブルの語も詳細も full text で描いた。
- 再送の確認に「先方に届いている可能性があります」と提案先・エンジニア・単価・最終試行日時の再掲を必ず出す（`F-023 AC-2` / §7.6）。
- 自動再送に相当する導線・設定を 1 つも置かない（`F-023 AC-1` / `BR-22`）。`送信中` の行では再送操作自体が選べない（CAS の失敗を UI に反映）。
- 再送回数 3 回超に「運営に問い合わせてください」を添える（`A-005` でも検知されている）。
- 一括再送はデスクトップのみ（`BR-50`）。空が正常であることを空状態の文言で示す。
- 関連 UC: UC-09（送信失敗の再送）。
