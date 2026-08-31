# S-009 スキル辞書・別名・新語候補 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-009
- 画面名: スキル辞書・別名・新語候補
- 平面: 主平面
- 対応機能 ID: F-010 / F-033
- 対応ステージ: ① 集める
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-009` / §9.1 / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-009
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages the skill vocabulary: a global read-only dictionary, tenant-local aliases, and pending new-term candidates raised by users and by an AI normalising pass.

Style rules:
- Pure black and white. Light gray only for de-emphasis (read-only areas, helper text). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, search fields as a label above a rule `______________`.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- AI provenance is written as plain Japanese text on one line. Never use a sparkle, lightning, brain or robot icon for AI.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 人材 ＞ スキル辞書`, the screen title `スキル辞書・別名・新語候補` as the single largest text. There is no primary action button on this screen; the actions live inside the rows.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column with three stacked sections; the pending candidates section is first because leaving it unattended breaks search.

### Section 1: `新語候補（採否待ち） 12 件` — table, 10 body rows, placed at the very top
Columns: `表記` / `起票元` / `起票日` / `出現件数` / `正規化先の候補` / `採否`
- `Java8 / 山田（手入力） / 2026-08-30 / 14 / [ Java ▾ ] / [ 採用 ] [ 却下 ]`
- `SpringBoot / AI が提案した正規化先 / 2026-08-30 / 9 / [ Spring ▾ ] / [ 採用 ] [ 却下 ]`
- `postgres / AI が提案した正規化先 / 2026-08-29 / 7 / [ PostgreSQL ▾ ] / [ 採用 ] [ 却下 ]`
- `react.js / 鈴木（手入力） / 2026-08-29 / 6 / [ React ▾ ] / [ 採用 ] [ 却下 ]`
- `k8s / AI が提案した正規化先 / 2026-08-28 / 5 / [ Kubernetes ▾ ] / [ 採用 ] [ 却下 ]`
- continue with 5 more rows of the same shape (`.NET Core`, `MSSQL`, `Vue3`, `ORACLE`, `GCP(BigQuery)`)
Each row carries, in gray at the right edge, the sentence `採用するまで検索の正規化に使われません`.
The `起票元` cell for AI-raised rows is the plain text `AI が提案した正規化先` with no icon.

### Section 2: `テナント固有の別名` — table, 8 body rows
Columns: `別名` / `正規化先` / `作成者` / `作成日` / `操作`
Example: `JavaSE / Java / 山田 / 2026-06-11 / [ 削除 ]`.
Above the table a search field `別名を検索` ______________ with `[ 検索 ]`.

### Section 3: `グローバル辞書（参照のみ）`
- The whole block has a light gray fill to signal read-only, with a one-line caption at the top right: `この辞書はテナントから編集できません`.
- A search field `辞書を検索` ______________ with `[ 検索 ]`.
- A table of 8 body rows with columns `スキル名` / `カテゴリ` / `別名の数` and NO action column at all.
Example rows: `Java / 言語 / 12`, `Spring / フレームワーク / 8`, `PostgreSQL / データベース / 6`, `AWS / クラウド / 15`.

### One state strip at the bottom with a small gray caption above it
- Caption `新語候補が 0 件のとき`: a bordered strip reading `採否を待っている表記はありません`
```

## 設計意図メモ（画像生成には使われない）

- 新語候補を最上部に置いたのは、放置すると検索の正規化に効かず母集団が欠けるため（§4.2 `S-009`）。0 件が正常であることを空状態の文言で示す。
- 「採用するまで検索の正規化に使われない」を行ごとに明示するのは `F-010 AC-2`（辞書を勝手に増やさない）を UI で読ませるため。
- AI 起票の候補は「AI が提案した正規化先」と文字で由来を書く（§9.1 の第 1 層）。アイコンは使わない。
- グローバル辞書は操作列を持たせず、面全体をグレーで塗って読み取り専用であることを構造で示す。
- 取引先は候補の起票のみで採否の導線を持たない。本画像はホストの `SALES` 視点。
- 関連 UC: UC-23（取込後の正規化）/ UC-03（検索の母集団）。
