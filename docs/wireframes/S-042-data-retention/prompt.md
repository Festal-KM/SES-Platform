# S-042 データの返却と保持期間 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-042
- 画面名: データの返却と保持期間
- 平面: 主平面
- 対応機能 ID: F-064 / F-046 / F-052
- 対応ステージ: −（設定）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-042` / §10.1 / `BR-29` / `BR-62` / `BR-64`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-042
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This tenant is holding personal data about third parties (engineers), so this screen lets it export that data and shows when the system will delete it. Deletion is executed by the system on a schedule after an advance notice; the user cannot trigger a deletion at will. This wireframe depicts a tenant whose contract is being terminated, so the screen is in its CLOSING state.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; dashed = dashed border for in-progress states.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Settings density: one item per row, no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ データの返却と保持期間`, the screen title `データの返却と保持期間` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 78 percent width.

### Pinned band at the very top of the content, above every section
A heavy bordered band with the badge `< 解約手続き中 >` filled and three wrapped lines:
`解約手続き中です。新しいデータの作成はできません。`
`返却と閲覧のみ実行できます。`
`あと 24 日で削除されます（2026-09-24）。`

### Section 1: `保持期間の設定`
Definition list with one editable row: `稼働終了・提案終了からの保持期間` `[ 3 年 ▾ ]`
A gray line: `期間を過ぎたエンジニアの連絡先とスキルシート原本が削除の対象になります`

### Section 2: `削除予定の一覧` — table, 8 body rows
Columns: `対象種別` / `件数` / `削除予定日` / `予告の送信状態`
- `エンジニアの連絡先 / 128 件 / 2026-09-24 / 送信済み（2026-08-25）`
- `スキルシート原本 / 342 件 / 2026-09-24 / 送信済み（2026-08-25）`
- `チャット本文 / 1,904 件 / 2026-09-24 / 送信済み（2026-08-25）`
- `提案の添付 / 211 件 / 2026-09-24 / 送信済み（2026-08-25）`
- `エンジニアの連絡先（3 年ルール） / 17 件 / 2026-11-01 / 予告予定（2026-10-02）`
- three more rows of the same shape.
A gray line under the table: `削除はシステムが実行します。この画面から任意に実行することはできません。`

### Section 3: `データの返却`
- A checklist of the export scope: `[x] エンジニア台帳` `[x] 案件` `[x] 提案履歴` `[x] 稼働`
- `書式` `[ CSV ▾ ]`
- Button `[ 返却データを生成する ]`
- A progress strip with a dashed border: `生成しています（データ量により数分かかります）` and a gray line `完了は通知でお知らせします。この画面を離れても生成は続きます。`
- A table of 3 previously generated files with columns `生成日時` / `対象` / `サイズ` / `操作`, each ending with `[ ダウンロード ]`.

### Section 4: `実行履歴` — table, 5 body rows
Columns `日時` / `実施者` / `操作` / `対象`. Example: `2026-08-30 14:02 / 山田 太一 / 返却データの生成 / エンジニア台帳・案件・提案履歴・稼働`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `削除予定が 0 件のとき`: `削除予定のデータはありません`
- Caption `運営者から見たとき`: a narrow band reading `運営者はこの画面に到達できず、返却データの内容にも到達できません` in gray
```

## 設計意図メモ（画像生成には使われない）

- `CLOSING` の固定表示を最上部に置く（`F-004 AC-8`）。「新規作成不可・返却と閲覧のみ・あと N 日」の 3 点を欠かさない。
- 削除は `system` が実行し、利用者が任意に実行する導線を持たない（予告 → 期限到来 → 削除）。予告の送信状態を列として持つのは、通知されないまま削除される経路が無いことの担保。
- 返却データの生成はジョブ。離脱・再訪時は生成済みファイルの一覧が出る。
- 運営者は本画面に到達できず、返却データの内容にも到達できない（`F-064 AC-7` / `BR-40`）。削除完了の確認は `A-010` の 1 経路のみ。
- `F-046`（3 年ルール）は Phase 2 で対象に加わるため、削除予定一覧に別行として並べた。
- 関連 UC: UC-24（解約とデータ返却）。
