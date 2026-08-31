# S-005 エンジニア台帳（一覧・複合検索） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-005
- 画面名: エンジニア台帳（一覧・複合検索）
- 平面: 主平面
- 対応機能 ID: F-008 / F-009 / F-045
- 対応ステージ: ①② 集める / マッチング
- Tier: T2（モバイル閲覧可。申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-005` / §7.1 / §7.2 / §10.3
- 生成する画像: `desktop.png` — デスクトップ標準ビュー（Tier 2 のため 1 枚）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-005
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, secondary notes). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]` in square brackets, text only. Dropdowns `[ ラベル ▾ ]`. Checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border.
- Tables are the default for lists of same-shaped records: Japanese column headers, thin rules, tight row height. Never lay records out as a grid of cards.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Very dense. This list must hold 10,000 records, so the first screenful shows at least 12 rows and the header area never takes more than a third of the height.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons, in business-loop order: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item, marked with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 人材`, the screen title `エンジニア台帳` as the single largest text, and exactly one primary button on the right of the title row: `[ 人材を登録 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and left sidebar as in the shared prompt. Main content is a 2-column split: a narrow search panel on the left (about 22 percent) and the result table filling the rest.

### Left: `検索条件` panel, vertical stack of labelled controls
- `スキル` with two chip-like boxes `Java` `Spring` and a rule `______________`, plus a radio pair `(o) すべて含む（AND）` `( ) いずれかを含む（OR）`
- `経験年数` two small numeric fields joined by a tilde
- `単価レンジ` two small numeric fields joined by a tilde, unit `万円`
- `稼働可能時期` `[ 選択 ▾ ]`
- `勤務地 / リモート` `[ 東京都 ▾ ]` and `[ 一部リモート可 ▾ ]`
- `所属区分` `[ すべて ▾ ]`
- `稼働状況` `[ すべて ▾ ]`
- `フリーワード` `______________`
- A separated block titled `絞り込み` holding two UNCHECKED checkboxes: `[ ] 開始日に間に合う人だけ` and `[ ] 通勤可能な人だけ`, with a small gray line under them: `既定はオフです。オンにすると条件に合わない候補が一覧から外れます`
- Buttons at the bottom of the panel: `[ 検索 ]` and the text link `条件をクリア`

### Right: result area
1. One count line, bold: `自社台帳 1,240 件` and to its right a small gray sentence `一致度と更新日の順で表示しています`. There is no score column, no rank number and no weight setting link anywhere on this screen.
2. Result table, 8 columns, 12 body rows, tight rows:
   `氏名` / `所属区分` / `主要スキル（上位 3）` / `経験年数` / `単価レンジ` / `稼働可能時期` / `勤務地・リモート` / `稼働状況`
   Example rows:
   - `山田 太郎 / 自社 / Java, Spring, AWS / 8 年 / 65〜75 万円 / 2026-10-01 / 東京都・一部リモート可 / < 稼働中 > filled`
   - `佐藤 花子 / 自社 / TypeScript, React, Node +2 / 6 年 / 60〜70 万円 / 即時 / 東京都・フルリモート可 / < 待機予定 > outline`
   - `鈴木 一郎 / 自社 / COBOL, PL/SQL / 14 年 / 70〜80 万円 / 2026-11-01 / 東京都・リモート不可 / < 稼働中 > filled`
   - continue with 9 more rows of the same shape; long names and long skill lists are truncated on one line with a trailing `+2`, and row heights stay uniform.
3. Above the table on the right, a text link `[ 列の表示 ▾ ]` for the 9th and later columns.
4. Below the table, cursor paging controls: `[ 前のページ ]` `1 - 50 / 1,240` `[ 次のページ ]`. There is no infinite scroll and no "もっと読む" button.
```

## 設計意図メモ（画像生成には使われない）

- カードでなくテーブルで描く（申し送り 2 / §7.2）。1 万件規模を前提にした 8 列 + 列表示切替であり、ファーストビューに 12 行以上が見えることが §7.1 の基準。
- Phase 1 ではスコア・順位・重みを一切表示しない（`F-009 AC-2`）。代わりに並び順の説明を 1 行置く。台帳は案件に紐づかないため Phase 2 でもスコアは出ない。
- 絞り込みチェックボックス 2 種は既定オフで描く（`U-02` / `F-009 AC-5`）。オンを既定にすると「見えていない候補が増える」課題が再発する。
- 稼働可能時期を既定列から外さないのは、SES の候補探索が「条件に合う人のうち、いつ空くか」で決まるため。
- 匿名候補（越境経路 4）はこの画面には出さない。案件が前提であり `S-016` にのみ現れる。
- ページングはカーソル方式で前後を明示（§7.1）。無限スクロールにしない。
- 関連 UC: UC-03（候補探索）/ UC-20（還流した待機予定の確認）。
