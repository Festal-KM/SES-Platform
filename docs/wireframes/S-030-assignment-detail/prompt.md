# S-030 稼働詳細と延長確認 ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-030
- 画面名: 稼働詳細と延長確認（必須画面）
- 平面: 主平面
- 対応機能 ID: F-042 / F-043 / F-044 / F-045
- 対応ステージ: ⑥ →（還流）① 集める。本プロダクトのループの要
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.6 `S-030` / §6.3 / §5-6 / §9.1 / §11-7
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-030
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen is where a human decides whether to extend, end or re-price an ongoing assignment 60 days before it expires. Ending it is not the end of the business: it automatically returns the engineer to the roster as "待機予定" and the project to the roster as "後任募集". The decision must stand on mechanically collected evidence; an AI summary of the discussion points is only an aid and the screen must work perfectly without it.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`. The primary action is a black-filled button with reversed text; the others are outlined.
- Status badges `< ラベル >` in angle brackets: `< 延長確認中 >` filled, `< 稼働中 >` filled, `< 終了予定 >` filled, `< 終了 >` outline.
- A version difference view is a table with the columns 項目 / 変更前 / 変更後 / 根拠, thin rules.
- AI provenance is written as plain Japanese text on one line above the generated block. Never use a sparkle, lightning, brain or robot icon.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.
- The single most strongly emphasised values on the page are the expiry date and the number of days remaining.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑥ 稼働` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 稼働 ＞ A-0071`, the screen title `稼働詳細と延長確認` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 55 percent, right about 45 percent.

### Section 1: `判断ヘッダ` — a heavy bordered band across the full width, never collapsed
Two rows of cells:
`エンジニア` `伊藤 修（自社）` ・ `案件` `保険基幹系マイグレーション` ・ `相手方` `けやきリテール` ・ `状態` `< 延長確認中 >` filled
`満了日` `2026-10-29` ・ `残日数` `58 日` ・ `現在の単価` `72 万円` ・ `担当` `加藤`
`満了日` and `残日数` are set noticeably larger and bolder than everything else on the page.
Under the band, one line of history text: `30 日前の再通知を送信しました（2026-09-29 予定）` and `60 日前の起票: 2026-08-30`.

## Left column

### Section 2: `延長確認の論点`
- A one-line plain-text provenance label directly above the block: `AI が整理した論点（延長判断の論点整理担当）`
- A list of 4 discussion points, each one or two lines: `稼働 14 か月・更新 2 回で継続性は高い`, `前回改定から 12 か月が経過している`, `案件側の必須要件に COBOL が残っており代替が難しい`, `代替候補が 3 件あり、交渉余地はある`
- A gray line: `論点は補助です。下の根拠データだけで判断できます。`

### Section 3: `根拠データ（実績）` — a definition list, always present even if the AI failed
`稼働期間` `14 か月（2025-04-01 〜）` / `契約の更新回数` `2 回` / `前回の単価改定` `2026-01-01（+3 万円）` / `案件の要件との現況` `必須要件 4 件のうち 4 件を充足` / `代替候補の件数` `3 件（自社 1 / 共有候補 2）` / `直近の面談・評価` `2026-06 に継続評価あり`

## Right column

### Section 4: `契約の版履歴と差分`
- A version selector row: `[ v2（2026-01-01） ▾ ]` `↔` `[ v3（2026-07-01） ▾ ]`
- A difference table of 4 rows with columns `項目` / `変更前` / `変更後` / `根拠`:
  `単価 / 69 万円 / 72 万円 / 稼働期間 14 か月・前回改定から 12 か月・契約更新 2 回目`
  `期間 / 3 か月 / 6 か月 / 更新の実績 2 回・直近の延長確認で終了の申し出なし`
  `勤務形態 / 週 3 出社 / 週 2 出社 / 案件側の運用変更`
  `検収条件 / 変更なし / 変更なし / —`
- A small version history list of 5 entries under the table: `v3 2026-07-01 / v2 2026-01-01 / v1 2025-04-01` and so on.

### Section 5: `決定` — an action block at the bottom of the right column
`[ 延長する（条件を更新） ]` primary black-filled, then `[ 終了する ]` and `[ 単価を改定する ]` as outlined buttons, then a text link `緊急離任を記録する`.
Under the buttons, an input group revealed for the primary action: `延長後の期間` `[ 6 か月 ▾ ]` / `延長後の単価` a numeric field `75` with the unit `万円` / `決定の理由` a text area of two rules.

### Section 6: `終了した場合に何が起きるか` — a bordered block placed directly under the decision block, always visible
Two wrapped lines: `終了を確定すると、このエンジニアは「待機予定」として人材台帳に戻り、案件は「後任募集」として案件台帳に戻ります。`

### Confirmation dialog drawn beside the decision block with the small gray caption `「終了する」の確認ステップ`
Title `稼働の終了を確定します`
Body: `伊藤 修 は「待機予定」として人材台帳に戻ります（稼働可能時期: 2026-10-29）。`
`保険基幹系マイグレーション は「後任募集」として案件台帳に戻ります。`
Buttons `[ 終了する ]` `[ キャンセル ]`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `論点が未生成 / AI 上限到達のとき`: `論点を整理できませんでした` followed by `起票と通知は成立しています` — and the 根拠データ block still fully drawn beside it.
- Caption `定義されていない遷移のとき`: `この操作はいまの状態では実行できません（現在: 終了）` with `実行できる操作: 履歴を見る`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

The content is TWO STACKED BANDS, not a shrunk 2-column desktop.

Upper band, pinned:
1. `判断ヘッダ` with `伊藤 修（自社）`, `保険基幹系マイグレーション`, `けやきリテール`, `< 延長確認中 >`, and `満了日 2026-10-29` / `残日数 58 日` as the largest text on the screen, plus `現在の単価 72 万円`.
2. `延長確認の論点` with its plain-text provenance line `AI が整理した論点（延長判断の論点整理担当）` and the four points.

Lower band, scrolling:
3. `根拠データ（実績）` definition list, complete.
4. `契約の版履歴と差分` table with the 根拠 column.
5. `決定` action block with `[ 延長する（条件を更新） ]` primary and the other actions.
6. `終了した場合に何が起きるか` block, always visible.

IMPORTANT: the upper band is fixed while the lower band scrolls.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column. ONE continuous vertical scroll. No tabs and no accordions.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 5`; under it `〇〇システム`.
2. A PINNED 判断ヘッダ block containing on three tight lines: `伊藤 修（自社）` / `保険基幹系マイグレーション ・ けやきリテール`, then `満了日 2026-10-29` and `残 58 日` as the largest text on the screen, then `現在の単価 72 万円` and `< 延長確認中 >`.
3. `延長確認の論点` with the plain-text line `AI が整理した論点（延長判断の論点整理担当）` and the four points, fully written out.
4. `根拠データ（実績）` as label-over-value pairs, all six items visible, NOT inside a fold.
5. `契約の版履歴と差分`: the version selector, then the four difference rows rendered as stacked blocks (項目, 変更前 → 変更後, 根拠), NOT inside a fold.
6. `終了した場合に何が起きるか` bordered block with both lines wrapped.
7. A bottom fixed action bar with one full-width primary button `[ 延長する（条件を更新） ]` and, above it, two outlined buttons `[ 終了する ]` `[ 単価を改定する ]`.

IMPORTANT: the evidence data and the version difference are never folded away, because the decision is irreversible and triggers the return flow.
```

## 設計意図メモ（画像生成には使われない）

- 根拠データ（稼働期間・改定履歴・代替候補の件数）を AI の成否と独立に常時描く（`F-044 AC-1` / §6.3）。論点が主役の画面にしない。
- 差分表に「根拠」列を持たせ、実績がどう次の判断の根拠になったかを見せる（§5-6 / §6.3 の表）。
- 終了の確認ステップに還流の予告を再掲する（§11-7 / `F-045`）。「終了 = 業務の終わり」ではなく「次の周回の起点」であることを操作の瞬間に伝える。
- 30 日前の再通知で状態バッジを変えない（`U-03` / `F-043 AC-3`）。判断ヘッダの下に履歴行として置くだけ。
- モバイルでも根拠データと差分を折りたたまない（`BR-49` の原則を ⑥ に適用）。
- 取引先はこの画面に到達しない。延長の打診はチャット（経路 3）で行う。
- 関連 UC: UC-19（延長確認）/ UC-20（還流）。
