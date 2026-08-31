# S-013 案件の公開範囲設定 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-013
- 画面名: 案件の公開範囲設定
- 平面: 主平面
- 対応機能 ID: F-014 / F-020
- 対応ステージ: ① 集める（越境経路 1 の入口）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-013` / §5-2 / §5-3 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-013
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen is the single gateway through which a project crosses the information boundary and becomes visible to selected partner companies. Nothing is published by default, and a three-layer quality gate must pass first.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border for in-progress states.
- Highlighted problem text inside a preview is drawn as text wrapped in a heavy black rectangle outline, with a leader line to a note in the margin.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 案件` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 案件 ＞ 金融系 Web API 改修 ＞ 公開範囲`, the screen title `公開範囲の設定` as the single largest text, and exactly one primary button on the right of the title row: `[ 公開する ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 45 percent, right about 55 percent.

## Left column

### Section 1: `現在の公開状態`
A bordered strip: `この案件は現在 3 社に公開されています（最終変更 2026-08-24 山田）`

### Section 2: `公開先の選択`
- A table of 8 body rows with columns `選択` / `取引先企業` / `状態` / `アカウント数` / `最終アクティビティ`:
  `[x] / △△テック / < 有効 > outline / 4 / 2026-08-31`
  `[x] / ▲▲ソリューション / < 有効 > outline / 2 / 2026-08-30`
  `[x] / ■■エンジニアリング / < 有効 > outline / 3 / 2026-08-28`
  `[ ] / ◆◆システムズ / < 有効 > outline / 1 / 2026-08-19`
  `[ ] / ●●テクノ / < 有効 > outline / 5 / 2026-08-31`
  plus 3 more unchecked rows.
- IMPORTANT: there is no "すべて選択" control and no select-all checkbox in the table header. The header cell above the checkbox column is empty.

### Section 3: `品質ゲートの結果` — three separate bordered blocks, one per layer
- `PII 層` — header row shows `< PASS >` outline and the line `氏名・生年月日・連絡先・顔写真・現所属会社名の残存: 検出なし`
- `商流層` — header row shows `< FAIL >` FILLED, the whole block has a heavy border, and it lists two findings, each ending with the text link `該当箇所へ`:
  `エンド企業名が外部公開用の記載に含まれています（「富士アルファ銀行」）`
  `自社単価に相当する金額が記載されています（「85 万円」）`
- `整合層` — header row shows `< 検査中 >` dashed with an elapsed counter `00:18`
- Under the three blocks, a bordered action strip: `検査で不合格の項目があるため公開できません。元データを修正してください。` with only one action, the text link `[ 案件を編集する ]`.
- IMPORTANT: there is no "了解のうえ公開" button, no override checkbox and no way to publish while a layer is FAIL. The primary `[ 公開する ]` button in the title row is drawn in a disabled gray state.

## Right column

### Section 4: `公開されたときの見え方（プレビュー）`
- A caption line: `△△テック の画面での見え方`
- A bordered mock of the partner-side project detail screen, drawn smaller: title `金融系 Web API 改修` `< 募集中 >`, then `必須要件` 4 rows, `尚可要件` 3 rows, `条件` showing only `単価レンジ 65〜75 万円` / `勤務地` / `リモート`, then the line `この案件は御社に公開されています`.
- Inside the preview body text, two phrases are wrapped in heavy black outlines with leader lines to margin notes: `富士アルファ銀行` → note `商流層 FAIL: エンド企業名`, and `85 万円` → note `商流層 FAIL: 自社単価`.
- The preview contains no list of other companies and no proposal count.

### Section 5: `公開解除` (a small block at the bottom of the right column)
- Text link `[ 公開を解除する ]` and a gray line: `解除しても、作成済みの提案は残ります`
```

## 設計意図メモ（画像生成には使われない）

- 「すべて選択」を置かない（既定で広げないという設計を操作の側でも守る。§4.2 `S-013`）。テーブルヘッダの選択セルを空にすることで、絵としても存在しないことを示す。
- ゲート FAIL 時に primary を無効化し、代わりに「元データを修正する」導線 1 本にする。「了解のうえ公開」が存在しないことが `BR-18`。
- 商流層 FAIL の指摘をプレビュー本文のハイライトと結ぶことで、「どこを直すか」が 1 画面で分かる（§5-2 / §5-3）。
- 層ごとに確定する進捗（PII → 商流 → 整合）を 3 ブロックの状態差として描いた。整合層はまだ `検査中`。
- 公開解除の確認文言「作成済みの提案は残ります」を導線の隣に置く（§7.6 の摩擦表）。
- 関連 UC: UC-04（案件登録 → 公開）。
