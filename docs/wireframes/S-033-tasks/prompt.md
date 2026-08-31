# S-033 タスク一覧 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-033
- 画面名: タスク一覧
- 平面: 主平面
- 対応機能 ID: F-040 / F-043
- 対応ステージ: ④⑤⑥
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.7 `S-033` / §10.1
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-033
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists dated tasks assigned to people: extension reviews, interview arrangements and contracts waiting to be executed. Tasks created automatically by the system CANNOT be deleted, because deleting them is how expiry dates get missed.

Style rules:
- Pure black and white. Light gray only for de-emphasis (completed rows). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `タスク` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ タスク`, the screen title `タスク` as the single largest text.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: no row anywhere on this screen has a delete control. Automatically created tasks can be completed or reassigned, never removed.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 78 percent width, divided into three date sections.

### Filter row
`担当` `[ 自分 ▾ ]` (default) / `種別` `[ すべて ▾ ]` / `[ 検索 ]` and a count line `タスク 21 件`.

### Section 1: `期日超過 4 件` — table, 4 body rows, at the very top
Columns: `種別` / `対象` / `期日` / `超過日数` / `担当` / `完了`
- `延長確認 / A-0064 吉田 玲（物流管理システム保守） / 2026-08-28 / 3 日 / 山田 / [ ] 完了`
- `面談調整 / P-0129 小林 大輔（富士アルファ商事） / 2026-08-29 / 2 日 / 加藤 / [ ] 完了`
- `契約締結待ち / C-0287 けやきリテール / 2026-08-30 / 1 日 / 加藤 / [ ] 完了`
- `延長確認 / A-0058 高橋 健（保険基幹系マイグレーション） / 2026-08-30 / 1 日 / 山田 / [ ] 完了`
The 超過日数 values are the most emphasised text in this section.

### Section 2: `今日` — table, 3 body rows
Same columns, with `超過日数` showing `—`. Example: `面談調整 / P-0142 佐藤 花子（富士アルファ商事） / 2026-08-31 / — / 山田 / [ ] 完了`.

### Section 3: `今週` — table, 6 body rows
Same columns, dates from `2026-09-01` to `2026-09-06`.

### Section 4: `期日なし` — table, 3 body rows
Same columns with `—` in the 期日 and 超過日数 columns.

### Row-level actions shown in a small panel to the right of the first table, with the small gray caption `行の操作`
`[ 完了にする ]` and `[ 担当を変更する ]` with a dropdown `[ 加藤 ▾ ]`. There is NO delete action.
A gray line: `自動生成されたタスクは削除できません`.

### One state strip at the very bottom with a small gray caption above it
- Caption `空のとき`: `対応が必要なタスクはありません`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

Single column at full content width, in this order:
1. Filter row `担当 [ 自分 ▾ ]` / `種別 [ すべて ▾ ]` and the count line.
2. `期日超過 4 件` table with the `担当` column dropped, so the columns are `種別` / `対象` / `期日` / `超過日数` / `完了`.
3. `今日` table, 3 rows.
4. `今週` table, 6 rows.
5. `期日なし` table, 3 rows.
6. The gray line `自動生成されたタスクは削除できません`.

IMPORTANT: columns are dropped rather than horizontally scrolled, and no section is collapsed.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge rows.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 5`; under it `〇〇システム`.
2. Title row `タスク` with a `[ 自分 ▾ ]` selector.
3. Section `期日超過 4 件`, PINNED at the top of the content so it stays visible while the rest scrolls. Each row is one line of three elements: the type, the target truncated, and the overdue days set as the largest text in the row. Example: `延長確認  A-0064 吉田 玲  3 日超過`.
4. Section `今日`, 3 rows, each `種別 + 対象 + 期日`.
5. Section `今週`, 6 rows.
6. Section `期日なし`, COLLAPSED to a strip showing the count with an expand affordance.
7. Each row has a trailing `[ 完了 ]` control. There is no delete control anywhere.
8. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`.

IMPORTANT: the overdue section is fixed at the top on mobile.
```

## 設計意図メモ（画像生成には使われない）

- 自動生成されたタスクに削除導線を置かない（`F-040 AC-1`）。取りこぼしを避けるための構造であり、行の操作は完了と再割当のみ。
- 期日超過を最上部に置き、モバイルでは固定する（§4.7 `S-033` のデバイス別）。超過日数を行内で最も大きい文字にした。
- 種別は `延長確認` / `面談調整` / `契約締結待ち` の 3 つ（`F-040`）。ステージ ④⑤⑥ の期日を 1 画面に集約する。
- `VIEWER` は完了できない（`F-040 AC-3`）。取引先は自社分のみ。
- 期日超過 0 件のときはセクションごと非表示にする（`docs/04` §4.7）。
- 関連 UC: UC-19（延長確認）/ UC-07（面談調整）/ UC-08（契約締結）。
