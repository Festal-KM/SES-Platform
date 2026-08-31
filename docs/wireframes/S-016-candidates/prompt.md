# S-016 候補検索とマッチング候補（案件起点） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-016
- 画面名: 候補検索とマッチング候補（案件起点）
- 平面: 主平面（ホスト視点。匿名候補が現れるのはホストのみ）
- 対応機能 ID: F-009 / F-017 / F-029 / F-031 / F-018
- 対応ステージ: ② マッチング（越境経路 4 の読み手側）
- Tier: T2（申し送り 10 により 1 枚。ただし申し送り 9 の優先度 2 位）
- 元設計書: `docs/04-ui-design.md` §4.3 `S-016` / `U-06` / §9.3-4 / §10.3 / §11-1 / §11-2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-016
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen is the heart of the product: starting from one project, the host sales user looks at candidates drawn from two sources at once — its own engineer roster, and ANONYMOUS candidates that partner companies chose to expose. Both kinds sit in ONE table with one ordering; they are never split into separate tabs. Anonymous rows show only five rounded-off attributes and have no detail page.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows. Never lay candidates out as a grid of cards.
- AI provenance is written as plain Japanese text on one line. Never use a sparkle, lightning, brain or robot icon for AI.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Very dense; the first screenful shows at least 12 candidate rows.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `② 候補を探す` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 案件 ＞ 金融系 Web API 改修 ＞ 候補を探す`, the screen title `候補を探す` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Under the title row: a requirement summary band across the full width, then a 2-column split with the candidate table on the left (about 68 percent) and a detail panel on the right (about 32 percent).

### Band: `対象案件の要件` (never collapsed)
One dense band containing: `金融系 Web API 改修` / `必須: Java 5 年以上, Spring 3 年以上, REST API 設計, 日本語での要件定義` / `尚可: AWS, 金融ドメイン, テスト自動化` / `単価レンジ 65〜75 万円` / `開始日 2026-10-01` / `東京都・一部リモート可`

### Filter strip (one row)
`スキル` ______________ / `経験年数` two fields with a tilde / `単価レンジ` two fields with a tilde `万円` / `稼働可能時期` `[ 選択 ▾ ]` / `勤務地・リモート` `[ 東京都 ▾ ]` / `[ 検索 ]`
Below it, two UNCHECKED checkboxes on one line: `[ ] 開始日に間に合う人だけ` `[ ] 通勤可能な人だけ` with the gray note `既定はオフです`.

### Count and ordering lines (two lines, bold then gray)
`候補 38 件`
`一致度と更新日の順で表示しています ／ 順位は決まった計算式で算出しています（AI は根拠文のみを作成します）`
IMPORTANT: there is NO score column, NO rank number, NO weight breakdown and NO link to a weight setting screen anywhere in this image (this is the Phase 1 view).

### Candidate table — 8 columns, 12 body rows, own and anonymous candidates INTERLEAVED in one single ordering
Columns: `種別` / `表示名` / `スキル` / `経験年数` / `単価レンジ` / `稼働可能時期` / `勤務地・リモート` / `更新日`
Rows in this exact order, so that the two kinds are visibly mixed:
1. `自社 / 山田 太郎 / Java, Spring, AWS +2 / 8 年 / 65〜75 万円 / 2026-10-01 / 東京都・一部リモート可 / 2026-08-30`
2. `共有候補 / 共有候補 / Java, Spring, AWS, PostgreSQL, Docker, Git, Linux, Jenkins / 5〜10 年 / 60〜70 万円 / 翌月 / 東京都・一部リモート可 / 2026-08-30`
3. `共有候補 / 共有候補 / Java, Spring, Oracle, Linux, Shell, Git, Jenkins, Maven / 10 年以上 / 70〜80 万円 / 翌々月 / 東京都・リモート不可 / 2026-08-29`
4. `自社 / 佐藤 花子 / Java, Spring, Kotlin +1 / 6 年 / 60〜70 万円 / 即時 / 東京都・フルリモート可 / 2026-08-29`
5. `共有候補 / 共有候補 / Java, Spring Boot, AWS, Terraform, Docker, Git, MySQL, Redis / 5〜10 年 / 60〜70 万円 / 即時 / 神奈川県・一部リモート可 / 2026-08-28`
6. `自社 / 高橋 健 / Java, Spring, MySQL / 5 年 / 60〜70 万円 / 2026-11-01 / 千葉県・一部リモート可 / 2026-08-28`
7. `共有候補 / 共有候補 / Java, JSP, Struts, Oracle, Linux, Git, Ant, JUnit / 3〜5 年 / 50〜60 万円 / 翌月 / 東京都・一部リモート可 / 2026-08-27`
8. `自社 / 中村 彩 / Java, Spring, GCP +3 / 7 年 / 65〜75 万円 / 2026-10-15 / 東京都・一部リモート可 / 2026-08-27`
9-12. four more rows of the same shape alternating 自社 and 共有候補.
IMPORTANT for every `共有候補` row: the display name is the single word `共有候補` and nothing else; there is no personal name, no partner company name, no internal ID, no reference number; all five attribute values are the rounded forms shown above (never `7 年`, never `65 万円`, never a ward-level address); the skill list stops at 8 entries with no `+N` overflow marker.
Under the table, one gray line: `必須要件を満たさない候補 14 件を除外しました` — with no breakdown of the reasons and no separate count for anonymous candidates.
Paging under that: `[ 前のページ ]` `1 - 38 / 38` `[ 次のページ ]`.

### Right detail panel — drawn in TWO stacked states so both behaviours are visible in one image

State A, upper half, with the small gray caption `自社候補を選んだとき`:
- `山田 太郎` `< 稼働中 > filled` `自社`
- Definition list: `主要スキル` / `経験年数 8 年` / `単価レンジ 65〜75 万円` / `稼働可能時期 2026-10-01` / `勤務地 東京都・一部リモート可`
- A one-line plain-text provenance label `AI が作成した根拠` followed by two lines of rationale text.
- Buttons: `[ 提案を作成 ]` primary and the text link `エンジニア詳細を開く`.

State B, lower half, with the small gray caption `共有候補を選んだとき（同じパネルが依頼フォームに切り替わる）`:
- `共有候補`
- The same five rounded values only.
- A one-line plain-text provenance label `AI が作成した根拠` and two lines of rationale text.
- Then, inside the SAME panel and not in a modal window, a form titled `提案依頼を送る` with `案件` a read-only value `金融系 Web API 改修`, `メッセージ` drawn as three rules, `返答期限` `[ 3 日後 ▾ ]`, and the button `[ 提案依頼を送る ]`.
- IMPORTANT: this panel has no link to any detail page, no unit-price input field, no quote field, no discount field and no negotiation control of any kind.
```

## 設計意図メモ（画像生成には使われない）

- 自社候補と匿名候補を「同じテーブル・同じ並び」に混在させ、種別 1 列だけで区別する（申し送り 5 / §11-1）。別タブに分けると営業は「まず自社を見る」運用になり、経路 4 が使われない機能になる。
- 匿名候補の行は丸めた値のみ（`U-06`）。表示名は「共有候補」の一語で、案件をまたいで同一人物を突き合わせられる識別子を持たない（`F-017 AC-2` / `BR-55`）。
- 匿名候補に詳細画面を作らない（§11-2）。右パネルで完結させ、パネルがそのまま依頼フォームに切り替わる（モーダルにしない — 5 項目を見ながら書く必要がある）。
- 「共有候補 0 件」を件数として出さない（取引先の共有状況を推測させるため）。除外件数は理由の内訳なしで 1 行のみ。
- Phase 1 の画面なのでスコア・順位・重みは存在しない（`F-009 AC-2` / `F-030 AC-4`）。代わりに「順位は決まった計算式で算出しています（AI は根拠文のみを作成します）」を 1 行置く（`BR-14` / §9.3-4）。
- 単価の交渉欄を持たない（`F-017 AC-4` / `BR-58`）。確定単価は `Proposal` 以降。
- 関連 UC: UC-03（候補探索）/ UC-15（提案依頼）。
