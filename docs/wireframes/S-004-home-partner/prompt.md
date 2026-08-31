# S-004 ホーム（取引先） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-004
- 画面名: ホーム（取引先）
- 平面: 主平面（`PARTNER_ADMIN` / `PARTNER_SALES`）
- 対応機能 ID: F-006 / F-027 / F-061
- 対応ステージ: 横断
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.1 `S-004` / §3.2 / §5-10 / §11-4
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-004
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This particular screen is the home screen seen by a PARTNER company user (a subcontractor invited into the host company tenant). The partner spends 4 to 5 hours a day in this product, longer than the host sales staff, so the screen must be exactly as dense and complete as the host home screen.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]` in square brackets, text only. Dropdowns `[ ラベル ▾ ]`. Toggles `[x] ラベル`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border.
- Tables are the default for lists of same-shaped records: Japanese column headers, thin rules, tight row height. Never lay records out as a grid of cards.
- All visible text is Japanese. No photos, no logos, no charts on this screen.
- No icons on navigation items, section headings, buttons or status badges.
- Very dense and realistic. The first screenful must show real work, not a welcome message.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then a two-level scope display on two lines `〇〇システム` over `△△テック（御社）`; right = `通知 3` and the user menu `佐藤（取引先営業）` with the role always in parentheses. Do NOT draw a usage meter or any remaining-quota number in the header — partner-side roles never see quota amounts.
- Left sidebar, fixed width, text only, no icons, in this exact order: `ホーム`, `① 自社の人材`, `① 公開された案件`, `② 自社の候補を探す`, `③ 提案`, `③ 提案依頼 (2)`, `④ 面談・結果`, `共有の設定`, `チャット`, `タスク`, `実績`, `設定`. `ホーム` is the current item, marked with a filled bar on its left edge. The sidebar has no 契約 item and no 稼働 item at all.
- Content area top: breadcrumb `ホーム`, the screen title `ホーム` as the single largest text.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT — things that must NOT appear anywhere in this image, because the partner must never learn anything about other partner companies: any count or mention of other companies, any phrase such as "他にも提案があります", any ranking or position such as "あなたは 2 番目", any total number of proposals on a project, any competitor name. Every count on this screen is scoped to the partner's own company and is labelled as such.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and left sidebar as described in the shared prompt. Main content is a 2-column split: wide left column about 65 percent, narrow right column about 35 percent.

## Left column

### Section 1: `提案依頼（返答期限つき）` — table, 4 body rows, the most prominent block on the page
Columns: `案件` / `依頼日` / `返答期限までの残り` / `候補の要約` / `状態`. The `返答期限までの残り` column is the single most strongly emphasised value on the screen (largest, boldest).
1. `金融系 Web API 改修` / `2026-08-29` / `残り 22 時間` / `Java / Spring ・ 5〜10 年 ・ 60〜70 万円 ・ 翌月 ・ 東京都・一部リモート可` / `< 返答待ち >` filled
2. `保険基幹系マイグレーション` / `2026-08-30` / `残り 2 日 4 時間` / `COBOL / Java ・ 10 年以上 ・ 70〜80 万円 ・ 翌々月 ・ 東京都・リモート不可` / `< 返答待ち >` filled
3. `EC サイト基盤刷新` / `2026-08-25` / `期限切れ` / `TypeScript / React ・ 3〜5 年 ・ 50〜60 万円 ・ 即時 ・ 神奈川県・フルリモート可` / `< 期限切れ >` dashed
4. `社内 DWH 構築` / `2026-08-22` / `—` / `Python / SQL ・ 5〜10 年 ・ 60〜70 万円 ・ 翌月 ・ 東京都・一部リモート可` / `< 応諾 >` outline

### Section 2: `要対応` — table, 7 body rows
Columns: `種別` / `対象` / `相手` / `経過時間` / `期限`. Types used: `< 差し戻し（検査で不合格） >` filled, `< 面談日程の回答待ち >` outline, `< 未読チャット >` outline.

### Section 3: `御社に公開された案件` — table, 8 body rows
Columns: `案件` / `必須要件の要約` / `単価レンジ` / `開始日` / `勤務地・リモート` / `公開日` / `新着`. The first three rows carry a small `新着` marker. Directly above the table a count line: `御社に公開された案件 14 件`, and directly under the filter strip one gray line: `この一覧には、御社に公開された案件のみが表示されます`.

## Right column

### Section 4: `自社提案の状態` — table, 8 body rows
Columns: `エンジニア` / `案件` / `状態` / `最終更新`. Statuses used across the rows: `< 下書き >` outline, `< 検査中 >` dashed with `00:12` elapsed, `< 承認待ち >` filled, `< 送信済み >` outline, `< 面談日程調整中 >` outline, `< 決定 >` filled, `< 見送り >` outline. Above the table a count line: `御社が作成した提案 24 件`.

### Section 5: `稼働可能時期が近い自社エンジニア` — table, 6 body rows
Columns: `氏名` / `稼働可能時期` / `共有設定`. The 共有設定 column shows either `共有中` or `—`. This table contains no project name, no unit price and no contract information.

### Section 6: `見える範囲の説明` — a bordered permanent block, 2 wrapped lines
`この画面には、御社が登録した人材と、御社に公開された案件・御社が作成した提案のみが表示されます。`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt; the sidebar is narrower but still text-only and fully listed, still without 契約 and 稼働.

The main content is ONE column, not a shrunken 2-column desktop. Order from top:
1. `提案依頼（返答期限つき）`, 4 rows, with `返答期限までの残り` still the most emphasised value.
2. `要対応`, 7 rows.
3. `御社に公開された案件`, 8 rows, with the count line `御社に公開された案件 14 件` and the gray scope line under the filter strip.
4. `自社提案の状態`, 8 rows, with the count line `御社が作成した提案 24 件`.
5. `稼働可能時期が近い自社エンジニア`, 6 rows.
6. `見える範囲の説明` block.

IMPORTANT: no column is horizontally scrolled; columns are dropped instead. Sections 1 to 4 are never collapsed.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks.

Order from top:
1. Compact header: hamburger on the left, wordmark `SES Platform` centered, `通知 3` on the right. Under it one line `△△テック（御社）` with a small expand affordance.
2. Title `ホーム`.
3. Section `提案依頼（返答期限つき）`, expanded, 3 rows. Each row is one line of three elements: project name, remaining time in the largest text on the screen, and a text link `[ 応諾 / 辞退 ]`. Example: `金融系 Web API 改修  残り 22 時間  [ 応諾 / 辞退 ]`.
4. Section `要対応`, expanded, 5 rows, each `状態バッジ + 対象 + 経過時間`.
5. Section `御社に公開された案件`, expanded, 5 rows, each `案件名 / 単価レンジ / 開始日` on two lines, with the count line `御社に公開された案件 14 件` above.
6. Section `自社提案の状態`, expanded, 5 rows, each `状態バッジ + エンジニア + 案件`.
7. Section `稼働可能時期が近い自社エンジニア`, COLLAPSED to a strip with a count.
8. Section `見える範囲の説明`, a bordered block wrapped over 3 lines, always visible.
9. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`. `ホーム` is active.

IMPORTANT: sections 1 to 4 are never collapsed on mobile. No count or hint about any other company appears anywhere.
```

## 設計意図メモ（画像生成には使われない）

- 取引先は 1 日 4〜5 時間滞在する主利用者であり、`S-003` と同じ密度で描く（`U-09` / `CLAUDE.md` §1.2 の 🔴 段落）。簡易版にしない。
- 最上部を「返答期限」にしたのは、取引先にとって最も時間切れが痛いのが `ProposalRequest` の `EXPIRED` だから（§11-4）。ホストの `S-003` が「放置時間」を主キーにしたのと対になる。
- ナビから ⑤ 契約・⑥ 稼働を消したのは機能の省略ではなく、パートナーに `−` の機能をグレーアウトで見せないという原則（§3.1 の 🔴）。代わりにセクション 5 で自社台帳の属性として稼働可能時期を提供する。
- 件数バッジは自社スコープのものだけ（「御社に公開された案件 14 件」「御社が作成した提案 24 件」）。他社に関する件数・存在・順位の示唆は 1 つも描かない（`BR-07` / `F-004 AC-4`）。
- 上限インジケータの残量・上限値はパートナーには出さない（`F-027 AC-1`）。停止の事実と理由は操作の場所で示す。
- 関連 UC: UC-13（取引先の 1 日）/ UC-14（匿名共有）/ UC-15（提案依頼への応諾）。
