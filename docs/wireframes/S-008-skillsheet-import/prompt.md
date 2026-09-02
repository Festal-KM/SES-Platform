# S-008 スキルシートの取込と版管理 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-008
- 画面名: スキルシートの取込と版管理
- 平面: 主平面
- 対応機能 ID: F-011 / F-012 / F-032 / F-033
- 対応ステージ: ① 集める
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-008` / §5-6 / §9.1 / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-008
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages uploaded engineer skill sheets: their versions, their virus-scan state, and the result of an AI reading pass that extracts structured skills. Nothing may be shared outside the tenant until the scan says the file is clean.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, disabled cells, helper text). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border, used for in-progress states together with an elapsed time.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- Files are empty rectangles with a diagonal cross and a Japanese caption.
- AI provenance is written as plain Japanese text on a single line above the generated block. Never use a sparkle, lightning, brain or robot icon for AI.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 人材 ＞ 山田 太郎 ＞ スキルシート`, the screen title `スキルシートの取込と版管理` as the single largest text, and exactly one primary button on the right of the title row: `[ アップロード ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. The content is one column with four stacked sections.

### Section 1: `アップロード`
- A wide bordered drop area with a dashed border, containing the text `ファイルをドロップ、または [ ファイルを選択 ]` and a `版のメモ` rule underneath.
- Under it, two lines of gray helper text:
  `対応形式: xlsx / xls / docx / pdf`
  `画像 PDF・画像ファイルは自動読み取りに対応していません。アップロードは可能ですが、内容は手入力になります。`

### Section 2: `版の一覧` — table, 6 body rows
Columns: `版` / `アップロード日時` / `アップロード者` / `スキャン状態` / `抽出状態` / `最新版` / `操作`
- `v6 / 2026-08-31 10:22 / 山田 / < 検査中（通常 2 分以内） > dashed  経過 00:47 / — / — / 操作は選択できません` (that last cell is gray text with no buttons drawn)
- `v5 / 2026-08-20 09:10 / 山田 / < CLEAN > outline / < 読み取り中（通常 3 分以内） > dashed  経過 01:12 / 最新 / [ 閲覧 ] [ ダウンロード ]`
- `v4 / 2026-07-01 14:35 / 鈴木 / < CLEAN > outline / 読み取り済み / — / [ 閲覧 ] [ ダウンロード ]`
- `v3 / 2026-05-11 11:02 / 鈴木 / < 隔離 > filled / — / — / ダウンロードできません` (gray text, no buttons)
- `v2 / 2026-02-03 16:48 / 山田 / < CLEAN > outline / 読み取り失敗 / — / [ 閲覧 ] [ ダウンロード ]`
- `v1 / 2025-11-19 13:07 / 山田 / < CLEAN > outline / 未実行 / — / [ 閲覧 ] [ ダウンロード ] [ 読み取りを実行 ]`
Under the table a bordered note strip: `「読み取りを実行」を押すと、氏名・生年月日・連絡先・顔写真・現所属会社名を除いた「スキル・経験内容・期間」だけが読み取りに渡されます。` There is NO option, checkbox or link anywhere that turns this masking off.

### Section 3: `抽出結果と採否（v4）`
- A one-line provenance label above the block, plain text: `AI が読み取った結果（スキルシート読み取り担当 / 2026-07-01 生成）`
- A table of 8 rows with columns `項目` / `抽出された値` / `採否` / `手入力`:
  `氏名` / `未抽出` / `—` / `______________`
  `スキル` / `Java, Spring, AWS, PostgreSQL` / `[x] 採用` / `—`
  `経験年数` / `8 年` / `[x] 採用` / `—`
  `従事期間` / `2018-04 〜 2026-07` / `[x] 採用` / `—`
  `業務内容` / `決済 API の設計・実装` / `[ ] 採用` / `______________`
  `資格` / `未抽出` / `—` / `______________`
  `勤務地` / `未抽出` / `—` / `______________`
  `希望条件` / `未抽出` / `—` / `______________`
- Rows whose value is `未抽出` show that exact word in gray; they are never filled with a guess.
- Action row: `[ 台帳に反映する ]` and the text link `破棄する`.

### Section 4: `スキル正規化の結果`
- A one-line provenance label, plain text: `AI が提案した正規化先（スキル表記の統一担当）`
- A table of 4 rows with columns `元の表記` / `正規化先` / `操作`:
  `Java8 / Java / [ 元の表記に戻す ]`
  `SpringBoot / Spring / [ 元の表記に戻す ]`
  `postgres / PostgreSQL / [ 元の表記に戻す ]`
  `AWS(EC2,S3) / AWS / [ 元の表記に戻す ]`

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `読み取りに失敗したとき`: `読み取りに失敗しました。手入力で登録してください。台帳の既存値は変更されていません。` with `[ 手入力で登録 ]`
- Caption `AI の利用上限に達したとき`: `スキルシート解析の月次上限に達したため読み取りを実行できません。あと 0 件 / 180 件 ・ リセット 明日 00:00` with `[ 利用量と上限を見る ]` — NO dollar figure and no old-style remaining/limit currency pairing anywhere in this line; the unit is always a count, matching `S-038` (`U-12`).
- Caption `スキャンで感染が検出されたとき`: `このファイルは隔離されました。以後どのロールからもダウンロードできません。`
```

## 設計意図メモ（画像生成には使われない）

- 非同期が 2 段（ウイルススキャン → 読み取り）あるため、版の行に 2 つの進行中バッジを同時に描いた。`検査中` の版からは操作要素そのものを消す（`F-011 AC-2`）。
- マスキングの説明を実行ボタンの隣に置き、「マスキングを外す」選択肢を画面に一切描かない（`BR-11` / `CLAUDE.md` §3.2）。
- `未抽出` を語として明示し、推測で埋めない（`F-032 AC-4` / §10.3 の `null` 規約）。手入力欄を隣に置く。
- 正規化は「元の表記に戻す」を必ず持つ（`F-033 AC-3`）。自動承認でも巻き戻せることが `F-035 AC-4` の要件。
- AI 由来は文字で 1 行、比喩アイコンを使わない（§9.1 / §7.5）。業務画面では内部識別子ではなく業務上の呼び名を使う。
- 🔴 2026-09-01 改訂: AI 上限到達時のメッセージから USD 表記（`残り 0 / 上限 20.00 USD`）を全廃し、`スキルシート解析` の件数クォータ（`あと 0 件 / 180 件`）に置き換えた（`U-12` / `F-027 AC-6`）。利用者に見せる残量は件数であり金額を出さない、という `S-038` と同じ規律をこの画面にも揃えた。
- 関連 UC: UC-23（スキルシート取込）/ UC-02。
