# S-044 自社エンジニアの稼働（取引先ビュー） ★経路 5 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-044
- 画面名: 自社エンジニアの稼働（取引先ビュー）
- 平面: 主平面（`PARTNER_ADMIN` / `PARTNER_SALES` / パートナー `VIEWER`。ホストはプレビューとしてのみ到達）
- 対応機能 ID: F-065 / F-042 / F-043
- 対応ステージ: ⑥ 稼働・稼働後フォロー（Phase 2）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.6 `S-044` / `U-11` / §3.1 / §3.2 / §5-2 / §5-10 / §11-9
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分。申し送り 9 の優先度 7 位・申し送り 13 の新規画面）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-044
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This is a PARTNER-ONLY, READ-ONLY screen. It exists so that a subcontractor company can confirm, on its own, until when its own engineers are staffed on a client's project — without asking the host company. This is boundary-crossing route 5 (CLAUDE.md §3.1-5): the partner may read exactly 4 fields of the host's `Assignment` record (project name / staffing period / contract end date / renewal-review status) and NOTHING else. There is no detail screen — the screen is a list plus a side panel. There is no write action anywhere on this screen: no edit, no renewal reply, no termination request, no unit-price negotiation. The only action button links to chat.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets, same as the host's Assignment badges: `< 開始予定 >` outline, `< 稼働中 >` filled, `< 延長確認中 >` filled, `< 終了予定 >` filled, `< 終了 >` outline.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic. On desktop and tablet, the table has EXACTLY 4 data columns (project name / staffing period / contract end date / renewal-review status) plus a derived 残日数 column — do not invent a 5th table column. On mobile, each card additionally leads with the engineer's name as the record's identifying label — this is not an extra table column, since mobile uses cards rather than a table.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then a two-level scope display on two lines `〇〇システム` over `△△テック（御社）`; right = `通知 3` and the user menu `佐藤（取引先営業）` with the role always in parentheses. Do NOT draw a usage meter or any remaining-quota number in the header — partner-side roles never see it.
- Left sidebar, fixed width, text only, no icons, in this exact order: `ホーム`, `① 自社の人材`, `① 公開された案件`, `② 自社の候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 自社が当事者の契約`, `⑥ 自社エンジニアの稼働`, `共有の設定`, `チャット`, `タスク`, `実績`, `設定`. `⑥ 自社エンジニアの稼働` is the current item, marked with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 自社エンジニアの稼働`, the screen title `自社エンジニアの稼働` as the single largest text. There is NO primary action button in the title row — this screen has no primary action, because it has no write action of any kind.
- No environment banner (this wireframe depicts the production environment).

🔴 IMPORTANT — things that must NEVER appear anywhere in this image, drawn neither as visible content nor as a grayed-out placeholder nor as an empty labelled box (the elements themselves must simply not exist on the canvas):
- the host's upstream contract with the end client, the SALE price charged to the end client, the end-client's name, gross margin
- any host-side renewal-review talking points, rationale text or internal deliberation content
- any other partner company's assignments — no count badge, no "この案件には他に N 件", no per-project total, no hint that other companies are staffed on the same project
- any edit, renewal-reply, termination-request or price-negotiation control
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left = list (about 62 percent), right = side panel for the selected row (about 38 percent).

### Section 1: `見える範囲の説明` — a thin bordered strip directly under the title row, always visible
`この一覧には、御社のエンジニアが稼働している契約のみが表示されます。この画面は閲覧のみです。延長のご意向はチャットでお知らせください。`

### Section 2: `稼働一覧` — table, 9 body rows, default sort ascending by 契約満了日, EXACTLY 4 data columns + 残日数
Columns: `案件名` / `稼働期間` / `契約満了日` / `残日数` / `延長確認の状態`
Above the table, a count line: `御社が当事者の稼働 9 件`
1. `保険基幹系マイグレーション / 2025-04-01 〜 2026-10-29 / 2026-10-29 / 58 日 / < 延長確認中 > filled` — row selected, highlighted
2. `物流管理システム保守 / 2025-11-01 〜 2026-10-31 / 2026-10-31 / 60 日 / < 延長確認中 > filled`
3. `社内 DWH 構築 / 2026-01-06 〜 2026-11-30 / 2026-11-30 / 90 日 / —`
4. `EC サイト基盤刷新 / 2026-02-02 〜 2026-12-31 / 2026-12-31 / 121 日 / —`
5. `非公開の案件 / 2026-04-01 〜 2027-03-31 / 2027-03-31 / 211 日 / —` — 🔴 this row shows the literal Japanese text `非公開の案件` in place of a project name (the project is not currently published to this partner), never a blank cell and never `null`
6. `医療系 SaaS フロントエンド / 2026-10-01 〜 2027-03-31 / 2027-03-31 / 211 日 / —`
7. `保険基幹系マイグレーション / 2024-10-01 〜 2026-09-30 / 2026-09-30 / 29 日 / < 延長確認中 > filled` — 残日数 emphasised as within 30 days (heaviest weight on the page)
8. `物流管理システム保守 / 2024-04-01 〜 2026-08-31 / 2026-08-31 / — / —` with the status badge `< 終了 >` outline in place of 延長確認 — row is kept, not removed
9. one more row of the same shape.
IMPORTANT: no 5th data column exists (no unit price, no counterpart company name, no margin, no "最終更新"). Rows within 60 days of expiry carry a light emphasis mark at the row edge; rows within 30 days carry a heavier one — this is the single most strongly emphasised value type on the page.

### Section 3: right side panel for the selected row (row 1)
Definition list repeating the same 4 fields plus a link to the partner's own roster: `案件名` `保険基幹系マイグレーション` / `稼働期間` `2025-04-01 〜 2026-10-29` / `契約満了日` `2026-10-29` / `延長確認の状態` `< 延長確認中 >`, then `対象エンジニア` as a text link `伊藤 修 →`（自社台帳へ）.
A gray line: `延長確認の状態は日次バッチで更新されます。更新: 2026-09-01 06:00`
A second gray line: `延長のご意向はチャットでお知らせください。`
Below the panel, a single button `[ この稼働について相談する ]` linking to chat — the ONLY action control anywhere on this screen.
IMPORTANT: the panel has exactly these fields. There is no field for 論点, no field for 根拠データ, no field for host-side unit price, no edit control.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `初回空のとき`: `御社のエンジニアの稼働はまだありません。提案が決定すると、ここに稼働として表示されます。` — no hint of any other company's assignments anywhere in this state.
- Caption `ホストがプレビューとして開いたとき`: a full-width band pinned above the header reading `取引先にはこう見えています — 閲覧のみ`. Everything below it is identical to the ordinary partner view, EXCEPT the single `[ この稼働について相談する ]` chat button is absent (chat is a partner-only write action; the host is only confirming what the partner sees) — no other edit, reply or write affordance is added anywhere.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt, sidebar narrower but fully listed and text-only.

Content is ONE column, not a shrunken 2-column desktop:
1. `見える範囲の説明` strip.
2. `稼働一覧` table, same 9 rows and exactly 4 data columns + 残日数, with the count line `御社が当事者の稼働 9 件` above it.
3. Directly below the table, the side panel for the selected row is drawn as a full-width band (not a floating side panel): the same definition list, `対象エンジニア` link, the daily-update note, and the single `[ この稼働について相談する ]` button.

IMPORTANT: this is not a 2-column layout shrunk down — the panel sits below the table as its own full-width section. No 5th column, no host-side price, no other company's assignments.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 3`; under it `△△テック（御社）` with a small expand affordance.
2. Title `自社エンジニアの稼働`.
3. `見える範囲の説明` strip, fully visible, not collapsed.
4. Count line `御社が当事者の稼働 9 件`.
5. `稼働一覧`, rows drawn as cards-of-one-record (not a horizontally-scrolled table). Each card's FIRST line is the engineer name (`対象エンジニア`, e.g. `伊藤 修`), then the same 4 fields on stacked lines with NOTHING omitted and NOTHING folded away: `案件名` (or `非公開の案件`), `稼働期間`, `契約満了日` + `残日数` (largest text in the row), `延長確認の状態` badge. 6 rows visible in the first screenful.
6. Tapping a row opens the side panel as a full-screen sheet: the same definition list, the `対象エンジニア` link, the daily-update note, the chat-guidance line, and the single `[ この稼働について相談する ]` button pinned at the bottom.
7. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`.

🔴 IMPORTANT: the engineer name and all 4 disclosed fields (案件名 / 稼働期間 / 契約満了日 / 延長確認の状態) are visible on every row without tapping or expanding — CLAUDE.md §13.2 requires this screen to be usable to completion on mobile, and none of them may be hidden behind a fold. No 5th column beyond the engineer name, no price, no other company's data.
```

## 設計意図メモ（画像生成には使われない）

- 越境経路 5（`CLAUDE.md` §3.1-5。2026-09-01、Issue #8 で人間が承認）の新規画面。ホストの `S-029` / `S-030` の権限差分ではなく独立画面として起こした（`U-11` / §11-9）。開示は `BR-66` の 4 項目（案件名 / 稼働期間 / 契約満了日 / 延長確認の状態）+ 満了日から機械的に導出できる残日数のみ。
- 詳細画面を作らず一覧 + 右パネルで完結させたのは、開示項目を足す置き場所を作らないため（匿名候補 §11-2 と同じ理由）。カレンダービューも作らない — 自社分だけを見る取引先には過剰で、「他社の満了もあるのでは」と読ませる余地を作る。
- Tier 1（モバイル完結）にした根拠: 満了日の確認は `CLAUDE.md` §13.2 が列挙する「満了アラートの確認」に該当し、外出先で「あの人はいつまでか」に即答できないと後任の手配が 1 日遅れる。4 項目をモバイルでも 1 つも省略しない。
- 未公開の案件は `非公開の案件` という第 3 の語で示し、`null` や空欄にしない（`F-065 AC-1`）。終了した稼働は行を消さず `< 終了 >` バッジで残す（消えると満了日の記録が追えず、経路 5 の信頼が崩れる）。
- 書き込み操作は 1 つも無い。唯一のボタンはチャットへの導線（`この稼働について相談する`）であり、延長の意思表示はチャット（経路 3）で行う旨をパネルに 1 行で書く。
- ホストの販売単価・エンド企業名・粗利・`ExtensionReview` の論点整理・他社の稼働（件数バッジ・「他に N 件」・案件単位の合計を含む）は、グレーアウトでも空欄でもなく要素そのものを描画しない（`BR-67` / `BR-07`）。
- 🔴 2026-09-01 改訂: モバイル行の先頭にエンジニア名を追加した（`docs/04` §4.6 デバイス別）。デスクトップ / タブレットの表は `BR-66` の 4 項目 + 残日数で打ち止めのままとし、エンジニア名は「表の 5 列目」ではなくモバイルのカードを識別するラベルとして位置づけた。あわせて `S-029` からのプレビュー導線に対応する状態ストリップを追加した（`§5-2` の「取引先にはこう見えています」）。
- 関連 UC: UC-25（取引先が自社の稼働と契約を確認する）。
