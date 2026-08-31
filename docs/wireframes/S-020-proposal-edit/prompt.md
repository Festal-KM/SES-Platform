# S-020 提案の作成・編集 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-020
- 画面名: 提案の作成・編集
- 平面: 主平面
- 対応機能 ID: F-019 / F-020 / F-034 / F-011
- 対応ステージ: ③ 提案
- Tier: T2（申し送り 10 により 1 枚。申し送り 9 の優先度 7 位）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-020` / §5-2 / §5-3 / §9.1 / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-020
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen is where a proposal is written before it goes through a three-layer quality gate. The only way to clear a gate failure is to fix the source data here; there is no override anywhere in the product. A gate FAILURE and a gate WARNING must look like two different things.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text areas drawn as stacked horizontal rules with a Japanese label above.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border for in-progress states with an elapsed time.
- A gate layer that FAILED is drawn as a whole block with a heavy black border and a filled `< FAIL >` badge. A WARNING is drawn as a single list item inside a PASSED block, prefixed with the word `警告` in a small outlined box. The two must not look the same.
- AI provenance is written as plain Japanese text on one line directly above the generated block. Never use a sparkle, lightning, brain or robot icon.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案 ＞ P-0142`, the screen title `提案の作成 P-0142` as the single largest text, and exactly one primary button on the right of the title row: `[ レビューに出す ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 55 percent (conditions and body), right about 45 percent (attachments and gate result).

## Left column

### Section 1: `対象`
Definition list: `案件` `金融系 Web API 改修` / `エンジニア` `佐藤 花子（自社）` / `提案先` `富士アルファ商事`
Under it, a bordered note strip, two wrapped lines: `この提案には 2026-07-03 時点の情報が使われます。以後の台帳の更新はこの提案に反映されません。`

### Section 2: `提案条件`
`単価` a numeric field showing `70` with the unit `万円` / `開始日` `2026-10-01` / `稼働形態` `[ 準委任 ▾ ]`

### Section 3: `本文`
- A one-line plain-text provenance label directly above the body block: `AI 下書き（編集済み）`
- `件名` ______________ with the value `【ご提案】Java / Spring エンジニアのご紹介`
- `本文` a text area drawn as ten horizontal rules with a few lines of body text visible
- `エンジニア紹介文` a text area drawn as six horizontal rules
- Under the body, a row of controls: `[ AI に下書きを作らせる ]` and the gray line `単価とエンド企業名は渡されません。マスキング後の候補情報のみが渡されます。`
- IMPORTANT: there is no option, dropdown or checkbox anywhere that would include the unit price or the end-client name in what is sent to the AI.

## Right column

### Section 4: `添付（スキルシートの版）`
A table of 3 body rows with columns `版` / `アップロード日` / `スキャン状態` / `選択`:
`v5 / 2026-08-20 / < CLEAN > outline / (o) 選択`
`v4 / 2026-07-01 / < CLEAN > outline / ( ) 選択`
`v2 / 2026-02-03 / < CLEAN > outline / ( ) 選択`
A gray line under the table: `検査中・隔離の版は選択肢に現れません`.

### Section 5: `品質ゲートの結果` — three separate blocks
- `PII 層` — `< PASS >` outline, line `氏名・生年月日・連絡先・顔写真・現所属会社名の残存: 検出なし`
- `商流層` — `< FAIL >` FILLED, the whole block drawn with a heavy black border, listing two findings each ending with the text link `該当箇所へ`:
  `本文にエンド企業名が含まれています（「富士アルファ銀行」）`
  `本文に自社単価が含まれています（「85 万円」）`
- `整合層` — `< PASS >` outline, containing ONE list item prefixed by a small outlined box reading `警告`: `警告: スキルシート v5 に Spring の記載が見当たりません（合否には影響しません）`
- Under the three blocks, a bordered action strip: `検査で不合格の項目があるため送信できません。本文を修正して再検査してください。` with only `[ 該当箇所を修正する ]`.
- IMPORTANT: there is no "了解のうえ送信" button, no override checkbox and no "警告を無視して進む" control. The `[ レビューに出す ]` button in the title row is drawn in a disabled gray state while the FAIL exists.

### Section 6: `送信元ドメイン`
An inline line: `送信元: @ses-example.co.jp（検証済み）`
Beside it, drawn with the small gray caption `未検証のとき`, an alternative strip: `送信元ドメインが未設定です` with the text link `[ 送信ドメインを設定する ]`.

### Section 7: `進行中の表現` — a small band at the bottom of the right column with the caption `ゲート実行中の見え方`
Three chips in a row showing per-layer progress: `PII 層 < PASS >` / `商流層 < 検査中 > dashed 00:08` / `整合層 < 未実行 >`, plus the gray line `完了すると通知とホームの要対応に現れます`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `添付できる版が無いとき`: `共有できるスキルシートがありません（検査中または未登録）` with `[ スキルシートを取り込む ]`
- Caption `AI の利用上限に達したとき`: `AI の利用上限に達しています（残り 0 / 上限 20.00 USD ・ リセット 明日 00:00）。手入力での作成は続けられます。`
```

## 設計意図メモ（画像生成には使われない）

- 「不合格」と「警告」を視覚的に別物にする（申し送り 5 / `docs/02` 申し送り 5 / `BR-61`）。不合格は層ブロック全体を重い枠で FAIL 表示にして送信導線を閉じ、警告は PASS の層の中の 1 項目として併記する。
- ゲート FAIL の解消手段は元データ修正のみ（`BR-18` / `F-020 AC-2`）。「了解のうえ送信」に相当する要素を画面に一切描かない。
- 凍結情報の注記を対象ブロックの直下に置く（`F-019 AC-2`）。SES では提案後に台帳が変わっても提案内容は変わらない。
- AI ドラフトには単価とエンド企業名を渡さない（`BR-12` / `F-034 AC-1`）。「単価も含めて書かせる」に相当する選択肢を置かない。
- 添付は `CLEAN` の版のみ選択肢に現れる（`F-011 AC-1` / `F-019 AC-3`）。検査中・隔離は選択肢そのものが無い。
- AI 由来は文字で 1 行（`AI 下書き（編集済み）`）。アイコンを使わない（§9.1 / §7.5）。
- 関連 UC: UC-05（提案作成 → ゲート → 承認）/ UC-16（AI 下書き）。
