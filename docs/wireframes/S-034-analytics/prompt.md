# S-034 実績ダッシュボード — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-034
- 画面名: 実績ダッシュボード
- 平面: 主平面
- 対応機能 ID: F-051
- 対応ステージ: 横断（Phase 3）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.7 `S-034` / §6.4 / §7.2（ダッシュボードの型の禁止）
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-034
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen reports on the business loop. Its most important block is NOT revenue or growth: it is whether the loop closes, that is, whether ended assignments turn back into new proposals. Four different kinds of "it did not work out" are reported in separate blocks and are never added together.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Charts are bare skeletons: a funnel is three plain horizontal bars with a label and a number; a trend is a simple line with axis labels. No gradients, no fills, no data-point decoration, no legends with colour swatches.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `実績` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 実績`, the screen title `実績ダッシュボード` as the single largest text, and a filter row on the right: `期間` `[ 2026-06 〜 2026-08 ▾ ]` / `案件` `[ すべて ▾ ]` / `担当者` `[ すべて ▾ ]`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: do not draw four KPI cards across the top of this screen and do not place any generic metric such as 売上, ユーザー数, 成長率 or コンバージョン above the business-loop blocks. The block order below is fixed and carries meaning.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Five stacked blocks in this exact order, each with a heading and a one-line gray caption stating who reads it and what they decide.

### Block 1: `業務ループの転換`
- Caption: `営業責任者が「どの段で落ちているか」を見て、候補選定を直すか提案文面を直すかを決める`
- A funnel of three plain horizontal bars, decreasing in length:
  `提案（送信済み） 142 件` — `面談 58 件（40.8%）` — `決定 21 件（14.8%）`
- A gray line: `分母は送信済みに到達した提案のみです`
- Beside the funnel, a simple line chart with the axis labels `2026-06` `2026-07` `2026-08` and a y axis labelled `決定率`.

### Block 2: `⑥ → ① の還流`
- Caption: `本プロダクトの中核の効き目。責任者が「還流が業務として回っているか」を判断する`
- Two large figures side by side: `終了した稼働のうち後任提案に至った割合 72%（18 / 25）` and `待機予定から次の提案までの日数（中央値） 11 日`
- Under them a simple line chart with the axis labels `2026-06` `2026-07` `2026-08`.

### Block 3: `品質ゲートの不合格率` — a visually separate bordered block
- Caption: `管理者が「運用の変化か、資料の問題か」を判断する`
- One figure `検査で不合格 9.4%（16 / 170）` and a small table of three rows: `PII 層 / 2 件`, `商流層 / 11 件`, `整合層 / 3 件`.
- A gray line: `このブロックは成約率とは別に集計しています`

### Block 4: `障害率` — a visually separate bordered block
- Caption: `同上。成約率の分母に入らない`
- One figure `送信失敗 3.5%（6 / 170）` and a small table of failure reasons with 4 rows.

### Block 5: `提案依頼の応答` — a visually separate bordered block
- Caption: `取引先との関係を判断する材料。成約率の分母に入らない`
- Three figures in a row: `応諾 14 件` / `依頼を辞退 6 件` / `期限切れ 3 件`
- A gray line: `辞退の理由は表示されません`

### Bottom: `案件別・担当者別` — table, 10 body rows
Columns: `案件` / `担当者` / `提案` / `面談` / `決定` / `決定率` / `検査で不合格` / `送信失敗` / `見送り` / `依頼を辞退`
IMPORTANT: 検査で不合格, 送信失敗, 見送り and 依頼を辞退 are four separate columns with four different words. Never merge them into one column and never label any of them 失敗 collectively.
Each row is clickable through to a filtered proposal list; show the text link `一覧で見る` in the last cell of the first row.

### One state strip at the very bottom with a small gray caption above it
- Caption `取引先が同じ画面を開いたとき`: a narrow band showing the same five blocks with the gray line `御社が作成した提案のみから算出しています` and NO organisation-wide figure of any kind.
```

## 設計意図メモ（画像生成には使われない）

- ブロックの順序に意味がある（§4.7 の表）。汎用指標を業務ループ上の指標より上に置かない（§7.2 / §6.4）。KPI カード 4 枚の型を禁止している。
- 「⑥ → ① の還流」をブロック 2 に置いたのは、これが本プロダクトの仮説の検証指標だから（§6.4）。
- 4 つの「うまくいかなかった」を別ブロック・別列・別の語にする（`F-051 AC-2` / `AC-3` / `BR-23` / `BR-60`）。テーブルでも 4 列に分けた。
- 分母は `SUBMITTED` に到達した提案のみ（`F-051 AC-1`）。ファネルの直下に明記する。
- 取引先の集計は自社分のみ（`F-051 AC-4`）。全社の転換率を出さない。
- 関連 UC: UC-18（実績の確認）。
