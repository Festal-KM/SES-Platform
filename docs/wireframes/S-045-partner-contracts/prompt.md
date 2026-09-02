# S-045 自社が当事者の契約・発注（取引先ビュー） ★経路 5 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-045
- 画面名: 自社が当事者の契約・発注（取引先ビュー）
- 平面: 主平面（`PARTNER_ADMIN` / `PARTNER_SALES` / パートナー `VIEWER`。ホストはプレビューとしてのみ到達）
- 対応機能 ID: F-066 / F-047 / F-050
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T2（モバイル閲覧可）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-045` / `U-11` / §3.1 / §3.2 / §5-1 / §5-2 / §5-10 / §11-9
- 生成する画像: `desktop.png`（Tier 2 のため 1 枚。申し送り 9 の優先度 8 位・申し送り 13 の新規画面）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-045
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This is a PARTNER-ONLY, READ-ONLY screen. It exists so that a subcontractor company can track the progress of the contracts and purchase orders in which it is a party — without asking the host company. This is boundary-crossing route 5 (CLAUDE.md §3.1-5): the partner may read exactly the fields listed in BR-66 and NOTHING else. There is no detail screen — the screen is a list plus a side panel. There is no write action anywhere on this screen: no edit, no send, no re-send, no signature request, no price negotiation. The only WRITE action anywhere is the button linking to chat — downloading the already-executed final document is a read-only action, distinct from a write, and is recorded in the audit log.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`.
- Status badges `< ラベル >` in angle brackets, the same 7-state Contract badge set as the host's screens: `< 下書き >` outline (never actually shown to the partner — draft versions do not reach this screen), `< 送付中 >` dashed, `< 送付失敗 >` filled, `< 先方確認中 >` outline, `< 締結済み >` filled, `< 取り下げ >` outline, `< 期間満了 >` outline.
- Documents are empty rectangles with a diagonal cross and a Japanese caption.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic, but the table has EXACTLY 4 data columns — do not invent a 5th column such as 最終更新.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then a two-level scope display on two lines `〇〇システム` over `△△テック（御社）`; right = `通知 3` and the user menu `佐藤（取引先営業）` with the role always in parentheses. Do NOT draw a usage meter or any remaining-quota number in the header.
- Left sidebar, fixed width, text only, no icons, in this exact order: `ホーム`, `① 自社の人材`, `① 公開された案件`, `② 自社の候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 自社が当事者の契約`, `⑥ 自社エンジニアの稼働`, `共有の設定`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 自社が当事者の契約` is the current item, marked with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 自社が当事者の契約`, the screen title `自社が当事者の契約` as the single largest text. There is NO primary action button in the title row — this screen has no primary action, because it has no write action of any kind.
- No environment banner (this wireframe depicts the production environment).

🔴 IMPORTANT — things that must NEVER appear anywhere in this image, drawn neither as visible content nor as a grayed-out placeholder nor as an empty labelled box (the elements themselves must simply not exist on the canvas):
- the host's upstream contract with the end client, the SALE price charged to the end client, the end-client's name, gross margin
- draft contract versions and gate findings
- any other partner company's contracts or orders — no count badge, no "他に N 件", no aggregate total across companies
- any edit, send, re-send, signature-request or price-negotiation control
- a `最終更新` column or any other 5th column
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left = list (about 58 percent), right = side panel for the selected row, itself split into two stacked blocks — 契約書 then 発注 (about 42 percent).

### Section 1: `見える範囲の説明` — a thin bordered strip directly under the title row, always visible
`この一覧には、御社が当事者となる契約のみが表示されます。この画面は閲覧のみです。条件のご相談はチャットでお知らせください。`

### Section 2: `契約一覧` — table, 8 body rows, EXACTLY 4 data columns, sorted with active items first
Columns: `種別` / `状態` / `期間` / `自社との契約単価`
Above the table, a count line: `御社が当事者の契約 8 件`
1. `個別契約 / < 先方確認中 > outline / 2026-10-01 〜 2027-03-31 / 70 万円 / 月` — row selected, highlighted
2. `個別契約 / < 締結済み > filled / 2026-04-01 〜 2027-03-31 / 68 万円 / 月`
3. `基本契約 / < 締結済み > filled / 2026-01-01 〜 2027-12-31 / — 円 / 月`
4. `NDA / < 締結済み > filled / 2025-06-01 〜 期間の定めなし / — 円 / 月`
5. `個別契約 / < 送付中 > dashed 経過 00:04 / — / — 円 / 月` — 契約単価セルは `—`（記入前、注記は行外に置く）
6. `個別契約 / < 送付失敗 > filled / — / 65 万円 / 月`
7. `個別契約 / < 取り下げ > outline / 2025-10-01 〜 2026-03-31 / 60 万円 / 月` — row is kept, not removed
8. `個別契約 / < 期間満了 > outline / 2024-04-01 〜 2025-03-31 / 55 万円 / 月`
IMPORTANT: exactly 4 data columns on every row — no row grows a 5th cell. No `最終更新` column anywhere. No draft (`下書き`) row appears in this table — drafts do not reach the partner.
A gray line under the table: `送付中の行は契約単価を記入前のため — で表示します`.

### Section 3: right side panel for the selected row (row 1), split into two labelled sub-blocks

#### 3a. `契約書`
`版` `v3（最新・締結対象）` — no draft versions listed, only the version currently in play.
`署名の状態` `< 先方確認中 >` outline, then 🔴 per-signer progress as an indented sub-list (this is the内訳 of "署名の状態", not a new status): `1. 富士アルファ商事（御社） < 署名済み > outline ・ 2026-08-31 14:02` / `2. ホスト（山田） < 未署名 > dashed`
A gray line: `署名者ごとの進捗は「署名の状態」の内訳です。新しい状態ではありません。`
`署名済み最終版` — for THIS row it is not yet available: `締結後にダウンロードできます`. As an alternate inline example beside it with the caption `締結済みの契約のとき`, a document rectangle with a diagonal cross labelled `個別契約_締結版.pdf` and a button `[ 最終版をダウンロード ]`, with the gray line `ダウンロードは監査ログに記録されます`.

#### 3b. `発注`
`状態` `未発行` / `期間` `—` / `金額` `—`（この行では未発行）。As an alternate inline example beside it with the caption `発行済みのとき`: `状態` `< 発行済み >` / `期間` `2026-10-01 〜 2027-03-31` / `金額` `70 万円 / 月`.

Below the panel, a single button `[ この契約について相談する ]` linking to chat — the ONLY WRITE action control anywhere on this screen. (The `[ 最終版をダウンロード ]` button in 3a is a read-only action, recorded in the audit log — it is not a write and does not compete with this rule.)
IMPORTANT: the panel never shows a host-side unit price, an end-client name, gross margin, gate findings, or any send/re-send/signature-request control.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `初回空のとき`: `御社が当事者となる契約はまだありません。` — no hint of any other company's contracts anywhere in this state.
- Caption `ホストがプレビューとして開いたとき`: a full-width band pinned above the header reading `取引先にはこう見えています — 閲覧のみ`. Everything below it is identical to the ordinary partner view, EXCEPT the single `[ この契約について相談する ]` chat button and the `[ 最終版をダウンロード ]` button are both absent (both are partner-only actions; the host is only confirming what the partner sees) — no edit, send, re-send or other write affordance is added anywhere.
```

## 設計意図メモ（画像生成には使われない）

- 越境経路 5（`CLAUDE.md` §3.1-5。2026-09-01、Issue #8 で人間が承認）の新規画面。ホストの `S-025` / `S-026` / `S-028` の権限差分ではなく独立画面として起こした（`U-11` / §11-9）。
- 🔴 一覧は `BR-66` の 4 項目（種別 / 状態 / 期間 / 自社との契約単価）ちょうどで打ち止め、`最終更新` 列を持たない（2026-09-01 改訂で削除。開示項目の追加は人間の承認事項。`docs/02` A-23）。`S-044` の残日数（満了日から機械的に導出でき情報が増えない）とは性質が違う。
- ドラフト版・差し戻し前の版は行としても現れない（`F-047 AC-8` / `F-066 AC-2`）。締結に至らなかった条件の履歴に到達させない。
- `先方確認中` の内側は新しい状態を作らず、署名者ごとの進捗を「署名の状態」の内訳として示す（`docs/03` 申し送り 14 / `BR-33`）。
- 発注は状態・期間・金額のみ（`BR-66` の 3 項目）。品質ゲートの対象外である発注書の内容には立ち入らない。
- 書き込み操作は 1 つも無い。唯一の**書き込み**ボタンはチャットへの導線（`この契約について相談する`）であり、単価交渉はチャット（経路 3）で行う旨をパネルに示す。**締結済み最終版のダウンロードは読み取り操作**であり監査ログに記録されるため、上記の「書き込みが無い」原則とは別物として両立させた（2026-09-01 改訂で明確化）。
- ホストの上流契約・販売単価・エンド企業名・粗利・他社が当事者の契約・発注（件数バッジ・合計金額・「他 N 件」を含む）は、グレーアウトでも空欄でもなく要素そのものを描画しない（`BR-67` / `BR-07`）。
- 🔴 2026-09-01 改訂: `S-025` からのプレビュー導線に対応する状態ストリップを追加した（`§5-2` の「取引先にはこう見えています」）。行 5 の `< 送付中 >` 表記を `S-025` と同じ「点線枠 + 経過時間」に揃え、5 列目が生えないよう注記を行外に移した。
- Tier 2 にした根拠: 経路 5 は締結の進捗追跡であり即応の期限を持たない（`S-044` の満了日確認とは性質が違う）。ホスト側の `S-025`（契約一覧）も同じ理由で T2 である。
- 関連 UC: UC-25（取引先が自社の稼働と契約を確認する）。
