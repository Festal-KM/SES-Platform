# A-004 利用量・クォータ管理 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-004
- 画面名: 利用量・クォータ管理
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-057 / F-026
- 対応ステージ: −（`CLAUDE.md` §10.4-3）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-004` / §3.3 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-004
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. On this screen the operator looks for tenants that are pressed against their limits AND for tenants whose consumption is always low, because both are commercial problems.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, date fields as a small box containing a date. Filter chips are `[ ラベル ]` boxes with the active one filled black.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `契約`, drawn filled black.
- A second, thinner row under the active tab: `契約管理` / `利用量・クォータ` (current, underlined) / `サンドボックス`. (`原価・粗利` belongs to the `監視` tab group, not here.)
- This screen allows writing (quota overrides), so it does NOT carry the `閲覧のみ` badge.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `利用量・クォータ管理` as the single largest text. Breadcrumb above it: `契約 ＞ 利用量・クォータ`.

### Section 1: `抽出` — a row of three filter chips plus a period selector
`[ 上限に張り付いている 6 ]` (active, filled black) `[ 消化率が常に低い 9 ]` `[ 80% 到達 4 ]` and `期間` `[ 2026-08 ▾ ]` `[ 検索 ]`
A gray line: `上限に張り付くテナントはプラン過小で業務が止まり、消化率が常に低いテナントはプラン過大で更新時の値下げ・解約要因になります。`

### Section 2: `テナント × 期間の一覧` — table, 13 body rows, 8 columns (the 4 AI count quotas are packed into one compact multi-line cell, not 4 separate columns)
Columns: `テナント` / `プラン` / `AI の件数クォータ消化率（4 種）` / `AI コスト（日次・基準比）` / `メール通数` / `ストレージ` / `席数` / `超過`
1. `〇〇システム / スタンダード / 解析 118/180・根拠文 4,960/6,200・ドラフト 196/180・延長 18/20 / 20.00 / 20.00 USD ・ 100% ・ 基準比 4.2 倍 / 488 / 500 / 42.1 / 50.0 GB / 12 / 20 / あり`
2. `北斗ソフトウェア / エンタープライズ / 解析 340/600・根拠文 9,800/20,000・ドラフト 210/600・延長 22/60 / 61.20 / 80.00 USD ・ 77% ・ 基準比 2.1 倍 / 1,204 / 2,000 / 168.4 / 200.0 GB / 41 / 50 / —`
3. `つばさネットワークス / スタンダード / 解析 204/180・根拠文 5,980/6,200・ドラフト 180/180・延長 20/20 / 19.40 / 20.00 USD ・ 97% ・ 基準比 6.8 倍 / 322 / 500 / 31.0 / 50.0 GB / 7 / 20 / あり`
4. `さくらエンジニアリング / スタンダード / 解析 9/180・根拠文 120/6,200・ドラフト 4/180・延長 0/20 / 1.10 / 20.00 USD ・ 6% ・ 基準比 0.2 倍 / 22 / 500 / 4.2 / 50.0 GB / 4 / 20 / —`
5. `青葉テクノサービス / スタンダード / 解析 3/180・根拠文 40/6,200・ドラフト 1/180・延長 0/20 / 0.40 / 20.00 USD ・ 2% ・ 基準比 0.1 倍 / 8 / 500 / 1.1 / 50.0 GB / 3 / 20 / —`
6. `こもれびソリューション / ライト / 解析 30/60・根拠文 900/2,000・ドラフト 40/60・延長 4/10 / 2.80 / 5.00 USD ・ 56% ・ 基準比 1.1 倍 / 41 / 200 / 3.9 / 10.0 GB / 2 / 5 / —`
7-13. seven more rows of the same shape.
Rows whose AI コスト消化率 is at or above 95 percent, whose 基準比 exceeds 4.0 倍, and rows below 10 percent are all visually marked at the row edge, and the sort places the pressed-against-limit tenants first.
Under the table, a gray line: `集計日時: 2026-08-31 03:00（日次）／ 当日分は 1 時間ごとに更新`, then paging `[ 前のページ ]` `1 - 100 / 148` `[ 次のページ ]`.
IMPORTANT: the AI count quotas (スキルシート解析 / 候補の根拠文 / 提案ドラフト / 延長論点整理) are always four separate `used/limit` numbers inside their cell, never merged into a single percentage — this is the same 4-unit breakdown as `S-038`, just packed for density. IMPORTANT: AI コスト消化率 is a circuit breaker, not an overage meter — it can reach 100% (the point at which AI is stopped for that tenant) but never exceeds it. No row anywhere in this table shows a percentage above 100.

### Section 3: `クォータの設定` — a bordered block on the right of the table or below it
- `対象テナント` a read-only value `〇〇システム`
- 🔴 **AI の件数クォータ（月次・利用者に見せる単位）**, four separate numeric fields, one per row: `スキルシート解析` `180` 件 / `候補の根拠文` `6,200` 件 / `提案ドラフト` `180` 件 / `延長論点の整理` `20` 件
- 🔴 **AI コスト上限（日次・内部指標）** a numeric field `20.00` with the unit `USD`, with the gray line `件数側を変更しても、この金額上限は自動追随しません（別の入力です）`
- `メール日次上限` a numeric field `500` with the unit `通`
- `ストレージ上限` a numeric field `50.0` with the unit `GB`
- `適用日` a date box `2026-10-01` with the label carrying the word `必須`
- A checkbox `[x] 対象テナントに通知する` drawn as always checked and not clearable
- Button `[ 変更を適用する ]`
- A bordered note strip: `引き下げには適用日の指定と対象テナントへの通知が必須です。即時に反映する操作はありません。`

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `PLATFORM_SUPPORT が見たとき`: a band showing the table and the filters but with section 3 entirely absent — no form, no button, no grayed-out control, and the `閲覧のみ（テナント業務データに対して）` badge shown beside the title.
- Caption `計測欠測があるとき`: `一部の期間の計測データがありません` with `[ 運用監視を開く ]`
```

## 設計意図メモ（画像生成には使われない）

- 「上限に張り付く」と「消化率が常に低い」の両方を抽出できるようにした（`F-057 AC-1`）。前者はプラン過小で業務が止まり、後者はプラン過大で解約要因になる。
- 🔴 AI の件数クォータは `S-038` と同じ 4 単位（スキルシート解析 / 候補の根拠文 / 提案ドラフト / 延長論点整理）を個別に出す。集約した 1 つの消化率にしない（`U-12`）。AI コストには金額と基準ユニット比の倍率を併記する（`U-12` / `docs/03` 申し送り 7）。**テナント側の `S-038` にはこの金額と倍率が 1 つも出ない**ため、ここが金額で見られる唯一の場所である。
- クォータの引き下げには適用日の指定と通知が必須（`F-057 AC-3`）。即時反映のみの操作を作らない。通知チェックは外せない形で描いた。
- `PLATFORM_SUPPORT` には設定の導線が存在しない（`F-057 AC-2` / `BR-44`）。グレーアウトではなくブロックごと非表示にし、その状態を 1 枚の下部に併記した。
- 集計は日次 + 当日分は 1 時間ごと。集計時刻を明示する。
- 書き込みが許される 6 画面の 1 つなので `閲覧のみ` バッジを付けない（§3.3-4）。ただし `PLATFORM_SUPPORT` 視点ではバッジが出る。
- 🔴 2026-09-01 改訂: AI コスト消化率を 100% を超えない値に修正した（118% → 100% / 104% → 97% / 61% → 56%）。AI の日次コスト上限は到達で AI を停止する遮断器（`CLAUDE.md` §3.4）であり、消化率が 100% を超える状態は起こり得ない。強調条件も「100% 超」から「95% 以上」に修正した。
- 🔴 2026-09-01 追加修正: 上記の変更で `超過` 列（件数クォータの超過。AI コストの遮断器とは別物）の根拠数値が消えていたのを直した。行 1（`〇〇システム`）の `ドラフト 172/180` を `196/180` に、行 3（`つばさネットワークス`）の `解析 176/180` を `204/180` に変更し、`超過 あり` の行には必ず 4 種のいずれかが `used > limit` であることを保証した。あわせて行 1 の `ドラフト` を `S-038`（同じテナントの利用者向け画面。セクション 2 の `提案ドラフト あと 0 件 / 180 件` = 180/180 で超過が始まっている）と整合させた。件数クォータの超過は `docs/04` §4.8 の規律どおり停止せず従量課金に移行するため、`AI コスト消化率 ≤ 100%` の規律とは矛盾しない。
- 関連 UC: UC-10（上限接近への先回り）。
