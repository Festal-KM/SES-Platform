# S-027 契約書テンプレート — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-027
- 画面名: 契約書テンプレート
- 平面: 主平面
- 対応機能 ID: F-048
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-027` / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-027
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages contract templates and the mapping between the placeholders in a template and the fields of a contract record. The merge is purely mechanical: the same input always produces the same draft, and no AI is involved anywhere on this screen.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Documents are empty rectangles with a diagonal cross and a Japanese caption.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- No AI provenance labels of any kind appear on this screen, because no generation happens here.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 契約` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 契約 ＞ テンプレート`, the screen title `契約書テンプレート` as the single largest text, and exactly one primary button on the right of the title row: `[ テンプレートをアップロード ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Three regions: a template list on the left (about 26 percent), a mapping table in the middle (about 37 percent), and a preview on the right (about 37 percent).

### Left: `テンプレート一覧` — table, 6 body rows
Columns: `名称` / `契約種別` / `版` / `更新日`
- `個別契約（標準） / 個別契約 / v4 / 2026-08-12`  (selected row, marked with a filled left edge)
- `個別契約（リモート特約付き） / 個別契約 / v2 / 2026-07-30`
- `基本契約（標準） / 基本契約 / v3 / 2026-05-02`
- `NDA（相互） / NDA / v5 / 2026-04-18`
- `NDA（片務） / NDA / v1 / 2026-02-09`
- `個別契約（短期） / 個別契約 / v2 / 2026-01-22`

### Middle: `差し込み項目のマッピング` — table, 10 body rows
Columns: `テンプレートのプレースホルダ` / `差し込む契約情報` / `状態`
- `{{相手方名}} / [ 契約.相手方 ▾ ] / 設定済み`
- `{{契約種別}} / [ 契約.種別 ▾ ] / 設定済み`
- `{{期間開始}} / [ 契約.期間開始 ▾ ] / 設定済み`
- `{{期間終了}} / [ 契約.期間終了 ▾ ] / 設定済み`
- `{{月額}} / [ 契約.金額 ▾ ] / 設定済み`
- `{{要員氏名}} / [ 稼働.エンジニア ▾ ] / 設定済み`
- `{{勤務地}} / [ 案件.勤務地 ▾ ] / 設定済み`
- `{{契約管理番号}} / [ 未設定 ▾ ] / 未設定`
- `{{検収条件}} / [ 未設定 ▾ ] / 未設定`
- `{{支払サイト}} / [ 契約.支払条件 ▾ ] / 設定済み`
The two rows whose state is `未設定` are shown in gray.
Under the table: `[ マッピングを保存 ]`.

### Right: `プレビュー（サンプル値での差し込み結果）`
A bordered document mock, one page, with about 14 lines of contract-like body text in Japanese. Two places in the text are drawn as visible gaps with a thin box around them and the word `空欄` inside: one for `契約管理番号` and one for `検収条件`.
A gray line under the preview: `マッピングが未設定のプレースホルダは空欄として残ります。推測で埋めません。`
Another gray line: `同じ入力からは常に同じドラフトが生成されます。`
Under the preview a small status strip: `PDF に変換しています` with a dashed border.

### One state strip at the very bottom with a small gray caption above it
- Caption `初回空`: `テンプレートが登録されていません` with `[ テンプレートをアップロード ]`
```

## 設計意図メモ（画像生成には使われない）

- 未設定のプレースホルダをプレビューで「空欄」として見せ、推測で埋めない（`F-048 AC-2`）。マッピング表の状態列と対応させ、どこが空欄になるかを 2 箇所で照合できるようにした。
- 「同じ入力からは常に同じドラフトが生成されます」を明記（`F-048 AC-1`）。この画面には AI が関与しないため、AI 由来ラベルも生成中の AI 表現も一切描かない。
- PDF 変換はワーカー側で行うため「変換しています」の進行表示を置く。
- 取引先は到達しない。`VIEWER` は閲覧のみ。
- 関連 UC: UC-08（契約締結）。
