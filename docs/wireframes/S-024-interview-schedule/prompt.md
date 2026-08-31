# S-024 面談日程の調整と結果記録 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-024
- 画面名: 面談日程の調整と結果記録
- 平面: 主平面
- 対応機能 ID: F-025 / F-041 / F-020
- 対応ステージ: ④ 商談・決定
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-024` / §6.2 / §5-5（レート制限）/ §10.1
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-024
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen arranges interview dates with a client and then records the outcome that was actually decided outside the system. The system never decides an outcome by itself, and 見送り (lost), 送信失敗 (send failure), 検査で不合格 (gate failure) and 依頼を辞退 (request declined) are four different things that never share a word or a bucket.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`, radio `( )` / `(o)`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border with an elapsed time.
- A week calendar is drawn as a plain grid: seven day columns, hour rows, thin rules, no colour fills. Busy slots are hatched with diagonal lines and labelled; selected candidate slots are outlined heavily and numbered.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `④ 面談・結果` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案 ＞ P-0142 ＞ 面談・結果`, the screen title `面談日程の調整と結果記録` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Under the title row a summary band, then a 2-column split: calendar on the left (about 58 percent), sending and recording on the right (about 42 percent).

### Summary band, full width
`< 送信済み >` outline ・ `提案先 富士アルファ商事 / 大村 部長` ・ `エンジニア 佐藤 花子` ・ `案件 金融系 Web API 改修` ・ `単価 70 万円`

## Left column

### Section 1: `日程候補` — a week calendar grid
- Header row: `9/1 月` `9/2 火` `9/3 水` `9/4 木` `9/5 金` `9/6 土` `9/7 日`
- Hour rows from `09:00` to `19:00`
- Three slots are hatched with diagonal lines and labelled `既存の面談`: `9/2 14:00`, `9/4 10:00`, `9/5 16:00`
- Three slots are outlined heavily and numbered as chosen candidates: `第 1 候補 9/3 13:00`, `第 2 候補 9/4 15:00`, `第 3 候補 9/5 11:00`
- A gray line under the calendar: `表示しているのは自社の予定のみです。相手の予定は持っていません。`

## Right column

### Section 2: `送信前の確認`
Definition list: `宛先` `omura@fuji-alpha.example.co.jp` / `送信元` `@ses-example.co.jp（検証済み）`
`文面` a text area drawn as six rules with a few lines of body text.
A bordered gate strip: `PII 層 < PASS >` `商流層 < PASS >` `整合層 < PASS >` on one line.
A bordered warning strip about the mail rate limit, two lines:
`本日の送信枠の残りが少なくなっています（残り 12 通 / 日次上限 500 通）`
`直近 1 分の送信数 6 / 分次上限 30`
Button `[ 日程候補を送る ]`.
A gray line under the button: `送信は「送信を受け付けました」→ 送信中 → 確定 の順で表示されます。自動での再送は行われません。`

### Section 3: `面談実施の記録`
`面談実施日` a date field `2026-09-03` / `メモ` a text area of three rules / an attachment rectangle labelled `面談メモ.pdf`
Button `[ 面談実施を記録する ]`.

### Section 4: `結果の確定`
Radio group, each on its own row and each with its own explanatory line:
`(o) 決定` — `この提案が決まりました`
`( ) 見送り` — `提案は届いたが選ばれませんでした`
`( ) 辞退` — `こちらから取り下げました`
A gray line: `「見送り」は「送信失敗」「検査で不合格」「依頼を辞退」とは別の区分です。`
`メモ` a text area of two rules.
Primary button `[ 結果を確定する ]`.
A gray line: `システムが自動で結果を確定させることはありません。`

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `定義されていない遷移を実行しようとしたとき`: `この操作はいまの状態では実行できません（現在: 送信済み）` followed by `実行できる操作: 面談日程を確定する / 辞退を記録する`
- Caption `日程候補の送信に失敗したとき`: `この連絡は先方に届いている可能性があります。届いていないことを確認してから再送してください。` with `[ 再送する ] [ キャンセル ]`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

Single column, in this order:
1. Summary band with 提案先 / エンジニア / 案件 / 単価.
2. `日程候補` week calendar, still seven day columns but compressed to the hours 09:00-19:00, with the three hatched 既存の面談 slots and the three heavily outlined numbered candidates.
3. `送信前の確認` including the two-line mail rate-limit warning, which is NOT omitted.
4. `面談実施の記録`.
5. `結果の確定` with the three radio rows and their explanations.

IMPORTANT: this is not a shrunken desktop; the calendar keeps full week width and the columns are merged into one flow.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 5`; under it `〇〇システム`.
2. Pinned summary band: `富士アルファ商事 / 佐藤 花子 / 70 万円 / < 送信済み >`.
3. Section `日程候補`, rendered NOT as a week grid but as a day-by-day list. Each day is a heading followed by its slots:
   `9/3 水` — `13:00-14:00  第 1 候補（選択中）`, `15:00-16:00  [ 候補にする ]`
   `9/4 木` — `10:00-11:00  既存の面談（斜線）`, `15:00-16:00  第 2 候補（選択中）`
   `9/5 金` — `11:00-12:00  第 3 候補（選択中）`, `16:00-17:00  既存の面談（斜線）`
4. A bordered warning strip, wrapped over two lines and NOT omitted on mobile: `本日の送信枠の残りが少なくなっています（残り 12 通 / 日次上限 500 通）` / `直近 1 分の送信数 6 / 分次上限 30`.
5. Section `面談日程を確定する` with a single selectable row `9/3 水 13:00-14:00 に確定` and a full-width button `[ 面談日程を確定する ]`.
6. Section `結果の確定` with the three radio rows `決定` / `見送り` / `辞退`, each with its explanation line, and a `メモ` field.
7. Bottom fixed action bar with one full-width primary button `[ 結果を確定する ]`.
8. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`.

IMPORTANT: date confirmation and outcome recording are both completed on mobile. The mail rate-limit warning is never dropped. Bulk sending of candidate dates is not shown here.
```

## 設計意図メモ（画像生成には使われない）

- モバイルで日程の確定と結果の記録が完結する（`CLAUDE.md` §13.1「面談日程の確定は移動中に発生する」）。カレンダーは日単位リストに劣化させるが、送信枠の警告は省略しない（§6.2）。
- 結果の 3 値それぞれに説明行を付け、「見送り」を「送信失敗」「検査で不合格」「依頼を辞退」と別区分だと明記する（`F-025 AC-3` / `BR-23`）。
- 日程候補の送信も `F-022` と同じ冪等の規律（`idempotency_key` + CAS、自動再送なし）。押した瞬間に「送信済み」と出さない。
- 自社の既存面談枠だけを表示し、相手の予定は持たない旨を 1 行添える（誤解を作らない）。
- 定義されていない遷移は 422 を受けて現在の状態と実行可能な操作を提示する（`F-024 AC-1`）。サイレントに無視しない。
- 関連 UC: UC-07（面談調整と結果記録）。
