# S-021 提案の承認 ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-021
- 画面名: 提案の承認（必須画面）
- 平面: 主平面
- 対応機能 ID: F-021 / F-020 / F-022 / F-037
- 対応ステージ: ③ 提案（本プロダクトの中核工程）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.4 `S-021` / §6.1 / §7.3 / §11-5 / §11-8
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（申し送り 1 により 3 デバイス必須）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-021
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This is the approval screen, the single most important screen in the product. A human decides whether a proposal may leave the tenant and reach a client company. Once approved it is sent, and sending is irreversible. Therefore the unit price, the recipient, the engineer, the three-layer gate result and a faithful preview of what the recipient will receive must all be visible on the same screen, on every device.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`. The primary action is a black-filled button with reversed text; secondary actions are outlined; destructive actions are outlined and followed by a confirmation.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border with an elapsed time for in-progress states.
- A gate layer that FAILED is a whole block with a heavy black border and a filled `< FAIL >` badge. A WARNING is one list item inside a PASSED block, prefixed by a small outlined box reading `警告`. The two never look the same.
- Inside the preview, phrases that the gate flagged are wrapped in a heavy black rectangle outline with a leader line to a margin note.
- Definition lists for the attributes of one record.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Medium-high density: each decision input is its own block, but nothing is hidden.
- The single most strongly emphasised values on the page are the unit price and the recipient company.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案 ＞ P-0142 ＞ 承認`, the screen title `提案の承認` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 48 percent, right about 52 percent, with a fixed action area at the bottom right.

## Left column

### Section 1: `判断ヘッダ` — a heavy bordered band, never collapsed
A definition list laid out in two rows of four cells:
`提案先` `富士アルファ商事 / 大村 部長` ・ `エンジニア` `佐藤 花子（自社）` ・ `案件` `金融系 Web API 改修` ・ `単価` `70 万円`
`開始日` `2026-10-01` ・ `作成者` `山田` ・ `経過時間` `2 日 4 時間` ・ `状態` `< 承認待ち >` filled
`単価` `70 万円` and `提案先` `富士アルファ商事` are set noticeably larger and bolder than everything else on the page.

### Section 2: `品質ゲートの結果` — three separate blocks
- `PII 層` `< PASS >` outline — `氏名・生年月日・連絡先・顔写真・現所属会社名の残存: 検出なし`
- `商流層` `< PASS >` outline — `外部公開用の記載に商流情報は含まれていません`
- `整合層` `< PASS >` outline — containing ONE list item prefixed by a small outlined box reading `警告`: `警告: スキルシート v5 に Spring の記載が見当たりません（合否には影響しません）` with the text link `該当箇所へ`
Under the three blocks a gray line: `検査 2026-08-29 09:12 実行 / 3 層すべて PASS`

### Section 3: `重複提案の警告` — a bordered block
`このエンジニアは別経路でも提案されています` with a small table of one row: `P-0119 / みなと物流 / 2026-08-21 / < 送信済み >` and the text link `該当の提案を見る`.
A gray caption on this block: `※ ホストにのみ表示される`

## Right column

### Section 4: `送信先での見え方（プレビュー）`
A bordered mock of the e-mail the recipient will receive:
`宛先` `omura@fuji-alpha.example.co.jp`
`件名` `【ご提案】Java / Spring エンジニアのご紹介`
Body text of about 10 lines.
`添付` an empty rectangle with a diagonal cross labelled `skillsheet_v5.pdf`
Inside the body, one phrase is wrapped in a heavy black outline with a leader line to a margin note: `70 万円` → `単価が本文に含まれています（承認者の確認事項）`.

### Section 5: `添付`
A table of 1 row: `v5 / 2026-08-20 / < CLEAN > outline / [ 閲覧 ]` and a gray line `閲覧は監査ログに記録されます`.

### Section 6: `送信元ドメイン`
Inline line: `送信元: @ses-example.co.jp（検証済み）`
Beside it, with the small gray caption `未検証のとき`, an alternative strip: `送信元ドメインが未検証のため、承認はできますが送信できません` with `[ 送信ドメインを設定する ]`.

### Section 7: `アクション` — fixed at the bottom right of the content area
`[ 承認して送信 ]` primary black-filled, then `[ 手直しして承認 ]`, `[ 却下（差し戻し） ]`, `[ 再生成を依頼 ]` as outlined buttons.
Under the buttons a gray line: `「手直しして承認」を選ぶと、編集した内容で品質ゲートが再実行されます`.

## Two state strips across the very bottom of the image, each with a small gray caption above it
- Caption `ゲート FAIL の提案を開いたとき`: a band containing the heavily bordered `商流層 < FAIL >` block, the sentence `検査で不合格のため承認できません。作成者が元データを修正すると再度検査されます。`, a list of two findings — and NO action buttons of any kind in the action position.
- Caption `送信を押した直後`: a band showing `送信を受け付けました` and the badge `< 送信中 >` dashed with `経過 00:06`, plus the gray line `自動での再送は行われません`. It does NOT say 送信済み.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

The content is TWO STACKED BANDS, not a shrunk 2-column desktop.

Upper band, pinned and always visible:
1. `判断ヘッダ` with `提案先 富士アルファ商事 / 大村 部長`, `エンジニア 佐藤 花子（自社）`, `案件 金融系 Web API 改修`, `単価 70 万円`, `開始日`, `作成者`, `経過時間`, `< 承認待ち >`. `単価` and `提案先` are the largest text on the screen.
2. `品質ゲートの結果` with the three layer blocks, PII / 商流 both `< PASS >` and 整合 `< PASS >` containing one `警告` item.

Lower band, scrolling:
3. `重複提案の警告` block.
4. `送信先での見え方（プレビュー）` with 宛先 / 件名 / 本文 / 添付, and the flagged phrase `70 万円` wrapped in a heavy outline with a margin note.
5. `添付` table.
6. `送信元ドメイン` line.
7. Action row fixed at the bottom of the screen: `[ 承認して送信 ]` primary, then `[ 手直しして承認 ]` `[ 却下（差し戻し） ]` `[ 再生成を依頼 ]`.

IMPORTANT: the upper band is fixed while the lower band scrolls. Do not shrink the desktop 2-column layout.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column. ONE continuous vertical scroll from top to bottom. There are NO tabs and NO accordions anywhere on this screen.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 5`; under it `〇〇システム`.
2. A PINNED 判断ヘッダ block that stays at the top while the rest scrolls, containing on three tight lines: `提案先 富士アルファ商事 / 大村 部長`, `エンジニア 佐藤 花子（自社）`, `案件 金融系 Web API 改修`, and `単価 70 万円` set as the largest text on the screen, plus `経過 2 日 4 時間` and `< 承認待ち >`.
3. `品質ゲートの結果`: three stacked blocks fully expanded — `PII 層 < PASS >`, `商流層 < PASS >`, `整合層 < PASS >` with its one `警告` item written out in full. None of these is inside a fold.
4. `重複提案の警告` block with its one row.
5. `送信先での見え方（プレビュー）`: 宛先, 件名, about 10 lines of body text, and the attachment rectangle `skillsheet_v5.pdf`. The flagged phrase `70 万円` is wrapped in a heavy outline. The preview is long and clearly continues down the page.
6. `添付` row and `送信元: @ses-example.co.jp（検証済み）`.
7. A bottom fixed action bar containing one full-width primary button `[ 承認して送信 ]` drawn in a DISABLED gray state, with two outlined buttons `[ 却下（差し戻し） ]` `[ 手直しして承認 ]` beside or under it, and directly above the bar one line of gray text: `プレビューの末尾まで確認すると、承認できるようになります`.
8. A scroll position indicator on the right edge showing that the page is only about 60 percent scrolled.

IMPORTANT: the gate result is never folded away, the judgement header is never collapsed, and the approve button is inactive until the preview has been scrolled to its end. Do not draw a summary-plus-approve shortcut.
```

## 設計意図メモ（画像生成には使われない）

- 単価と提案先を判断ヘッダに固定し、モバイルでも折りたたまない（`F-021 AC-4` / §7.3 の「1 画面で最も強調するのは 1 つ」）。「この単価でこの客に出してよいか」は人間しか判断できない。
- プレビューを右（モバイルではスクロールの末尾）に置くのは、承認者が相手の見るものを見てから押す順序を強制するため。モバイルでは末尾までスクロールするまでアクションを有効にしない（§11-5 / `BR-49`）。
- モバイルはタブでもアコーディオンでもなく 1 本の縦スクロール（申し送り 1）。形式的に表示していることと読まれることは違う。
- ゲート FAIL の提案では承認アクションを 1 つも描画しない（無効ボタンも置かない）。「了解のうえ送信」は存在しない（`BR-18`）。
- 送信は押した瞬間に「送信済み」と出さない（`送信を受け付けました` → `送信中` → 確定。`BR-22`）。自動リトライしない旨を添える。
- 重複提案はホストのみ（`F-037 AC-1` / `BR-08`）。一括承認は `S-019` 側にあり、モバイルには表示しない（`F-021 AC-6` / `BR-50`）。
- 関連 UC: UC-05（承認 → 送信）/ UC-06（一括承認）/ UC-09（送信失敗）。
