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
- A second, thinner row under the active tab: `契約管理` / `利用量・クォータ` (current, underlined) / `原価・粗利`.
- This screen allows writing (quota overrides), so it does NOT carry the `閲覧のみ` badge.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `利用量・クォータ管理` as the single largest text. Breadcrumb above it: `契約 ＞ 利用量・クォータ`.

### Section 1: `抽出` — a row of three filter chips plus a period selector
`[ 上限に張り付いている 6 ]` (active, filled black) `[ 消化率が常に低い 9 ]` `[ 80% 到達 4 ]` and `期間` `[ 2026-08 ▾ ]` `[ 検索 ]`
A gray line: `上限に張り付くテナントはプラン過小で業務が止まり、消化率が常に低いテナントはプラン過大で更新時の値下げ・解約要因になります。`

### Section 2: `テナント × 期間の一覧` — table, 13 body rows
Columns: `テナント` / `プラン` / `AI コスト（日次）` / `AI クォータ消化率` / `メール通数` / `ストレージ` / `席数` / `超過`
1. `〇〇システム / スタンダード / 20.00 / 20.00 USD / 118% / 488 / 500 / 42.1 / 50.0 GB / 12 / 20 / あり`
2. `北斗ソフトウェア / エンタープライズ / 61.20 / 80.00 USD / 96% / 1,204 / 2,000 / 168.4 / 200.0 GB / 41 / 50 / —`
3. `つばさネットワークス / スタンダード / 19.40 / 20.00 USD / 104% / 322 / 500 / 31.0 / 50.0 GB / 7 / 20 / あり`
4. `さくらエンジニアリング / スタンダード / 1.10 / 20.00 USD / 6% / 22 / 500 / 4.2 / 50.0 GB / 4 / 20 / —`
5. `青葉テクノサービス / スタンダード / 0.40 / 20.00 USD / 2% / 8 / 500 / 1.1 / 50.0 GB / 3 / 20 / —`
6. `こもれびソリューション / ライト / 2.80 / 5.00 USD / 61% / 41 / 200 / 3.9 / 10.0 GB / 2 / 5 / —`
7-13. seven more rows of the same shape.
Rows whose 消化率 is above 100 percent and rows below 10 percent are both visually marked at the row edge, and the sort places the pressed-against-limit tenants first.
Under the table, a gray line: `集計日時: 2026-08-31 03:00（日次）／ 当日分は 1 時間ごとに更新`, then paging `[ 前のページ ]` `1 - 100 / 148` `[ 次のページ ]`.

### Section 3: `クォータの設定` — a bordered block on the right of the table or below it
- `対象テナント` a read-only value `〇〇システム`
- `AI 利用量クォータ（月次）` a numeric field `300,000` with the unit `トークン`
- `AI コスト上限（日次）` a numeric field `20.00` with the unit `USD`
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
- クォータの引き下げには適用日の指定と通知が必須（`F-057 AC-3`）。即時反映のみの操作を作らない。通知チェックは外せない形で描いた。
- `PLATFORM_SUPPORT` には設定の導線が存在しない（`F-057 AC-2` / `BR-44`）。グレーアウトではなくブロックごと非表示にし、その状態を 1 枚の下部に併記した。
- 集計は日次 + 当日分は 1 時間ごと。集計時刻を明示する。
- 書き込みが許される 6 画面の 1 つなので `閲覧のみ` バッジを付けない（§3.3-4）。ただし `PLATFORM_SUPPORT` 視点ではバッジが出る。
- 関連 UC: UC-10（上限接近への先回り）。
