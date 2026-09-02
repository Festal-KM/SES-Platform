# A-011 原価・粗利ダッシュボード ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-011
- 画面名: 原価・粗利ダッシュボード（必須画面。管理平面の筆頭機能）
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-063 / F-026
- 対応ステージ: −（`CLAUDE.md` §10.2 / §10.4-2）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-011` / §6.8 / §9.2 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-011
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This is the console's flagship screen: it must let the vendor spot, without waiting for the month to close, a tenant that becomes less profitable the more it is used. Because gross margin sits near 90 percent for most tenants, a second measure — how many times a baseline unit of cost the tenant consumes — is shown right next to it.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, numeric fields as small boxes.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height. Amounts use thousands separators.
- Charts are bare bar skeletons with axis labels only.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `監視 (3)`, drawn filled black, and it carries the alert count badge. (This dashboard sits in the `監視` group alongside 運用監視, answering "is something wrong right now", not in `契約`.)
- A second, thinner row under the active tab: `運用監視` / `原価・粗利` (current, underlined).
- To the right of the screen title, a badge shown at all times: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen shows only amounts, counts and rates. There is no link anywhere that leads to the content of a tenant's business data.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `原価・粗利ダッシュボード` as the single largest text with the `閲覧のみ（テナント業務データに対して）` badge beside it, and at the far right the line `集計日時: 2026-08-31 03:00（日次更新）`. Breadcrumb above it: `監視 ＞ 原価・粗利`.

### Section 1: `閾値割れの要約` — a bordered band at the very top
Two large figures side by side: `閾値割れ 2 件` and `最も悪いテナント つばさネットワークス（粗利率 42.6% / 基準ユニット比 6.8 倍）`.
Under them a period selector `対象月` `[ 2026-08 ▾ ]`.

### Section 2: `収支一覧` — table, 12 body rows, default sort ascending by gross margin rate
Columns: `テナント` / `プラン` / `売上（席課金）` / `売上（従量）` / `原価（AI）` / `原価（メール）` / `原価（ストレージ）` / `原価（電子署名）` / `粗利` / `粗利率` / `基準ユニット比の倍率` / `金額上限に対する消費率` / `クォータ消化率（件数）`
1. `つばさネットワークス / スタンダード / 140,000 / 6,400 / 78,200 / 3,100 / 1,900 / 800 / 62,400 / 42.6% / 6.8 倍 / 97% / 113%`
2. `〇〇システム / スタンダード / 240,000 / 4,800 / 92,400 / 5,200 / 2,600 / 1,200 / 143,400 / 58.6% / 4.2 倍 / 100% / 109%`
3. `北斗ソフトウェア / エンタープライズ / 820,000 / 12,000 / 141,000 / 9,800 / 8,400 / 3,600 / 669,200 / 80.4% / 2.1 倍 / 77% / 57%`
4. `かなで情報技術 / トライアル / 0 / 0 / 3,200 / 200 / 100 / 0 / -3,500 / — / 1.4 倍 / 15% / 22%`
5. `こもれびソリューション / ライト / 40,000 / 0 / 3,900 / 400 / 200 / 200 / 35,300 / 88.3% / 1.1 倍 / 56% / 67%`
6. `さくらエンジニアリング / スタンダード / 80,000 / 0 / 1,600 / 100 / 300 / 100 / 77,900 / 97.4% / 0.2 倍 / 6% / 5%`
7-12. six more rows of the same shape — all 13 columns present, including `原価（電子署名）` and `金額上限に対する消費率` — with margins between 88 and 98 percent and multiples between 0.2 and 1.6.
The 粗利率 and 基準ユニット比の倍率 columns are adjacent so they can be read together, and the two rows below the threshold are marked at the row edge.
IMPORTANT: `金額上限に対する消費率` (the AI daily cost ceiling, capped at 100 percent — same figure as `A-004`s `AI コスト` column) and `クォータ消化率（件数）` (the count quotas, which may exceed 100 percent because overage moves to pay-as-you-go rather than stopping) are two clearly separate columns with distinct headers; never merge them or let one be mistaken for the other.
Under the table, paging `[ 前のページ ]` `1 - 100 / 148` `[ 次のページ ]`.

### Section 3: `ロール別原価の内訳（つばさネットワークス / 2026-08）` — table with EXACTLY 6 body rows
Columns: `担当` / `内部識別子` / `呼び出し回数` / `入力トークン` / `出力トークン` / `原価` / `構成比`
1. `スキルシート読み取り担当 / sheet-parser / 1,204 / 8,420,000 / 402,000 / 41,200 円 / 52.7%`
2. `スキル表記の統一担当 / skill-normalizer / 2,880 / 1,140,000 / 96,000 / 4,100 円 / 5.2%`
3. `候補の根拠説明担当 / match-explainer / 6,410 / 2,880,000 / 640,000 / 12,600 円 / 16.1%`
4. `外部共有物の検査担当 / gate-inspector / 1,880 / 3,940,000 / 188,000 / 14,800 円 / 18.9%`
5. `提案文の下書き担当 / proposal-drafter / 402 / 880,000 / 220,000 / 4,400 円 / 5.6%`
6. `延長判断の論点整理担当 / renewal-advisor / 84 / 260,000 / 42,000 / 1,100 円 / 1.4%`
Beside the table, a bare bar chart skeleton with the six role names on the axis.
Under the table, one gray line: `「その他」「不明」の行が出た場合は利用記録の欠落であり、運用監視の計測欠測として扱います。`
IMPORTANT: exactly six rows, and there is no `その他` row and no `不明` row in this image.

### Section 4: `閾値の設定`
A small table of 4 rows with columns `プラン` / `粗利率の閾値` / `基準ユニット比の閾値`:
`エンタープライズ / 70% / 3.0 倍`, `スタンダード / 65% / 4.0 倍`, `ライト / 60% / 4.0 倍`, `トライアル / — / 5.0 倍`
Button `[ 閾値を保存 ]` and a gray line `PLATFORM_OWNER のみが設定できます`.

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `閾値割れが 0 件のとき`: `粗利率が閾値を割ったテナントはありません` with the 収支一覧 still fully drawn below it
- Caption `自社カウンタと決済側に差異があるとき`: `自社の計測と決済側の金額に差異があります（2026-08 / 差異 1,240 円）。自動補正は行いません。`
- Caption `PLATFORM_SUPPORT が見たとき`: a band showing sections 1 to 3 with section 4 entirely absent
```

## 設計意図メモ（画像生成には使われない）

- 「基準ユニット比の倍率」を粗利率と並べて出す（`docs/03` 申し送り 7 / §6.8）。通常の価格帯では粗利率が 90% 付近に張り付くため、粗利率だけでは異常なテナントを検知できない。
- ロール別原価内訳は 6 ロール（`gate-inspector` を含む）。`S-039` は設定画面なので 5 ロールだが、こちらは運営者向けの原価分解であり 6 ロールが正しい（§4.9 `A-011` / `F-063 AC-2`）。この差が本プロダクトで最も取り違えやすい点。
- 「その他」「不明」の行が出た時点で記録の欠落であり、`A-005` の計測欠測として扱う（`BR-09` / `BR-10`）。したがって画像にはその行を描かない。
- 日次更新で集計日時を明示する（`CLAUDE.md` §10.2 の「月次を待たずに」が受け入れ基準）。
- 自社カウンタと決済側の差異は警告表示にとどめ、自動補正しない（`docs/03` 申し送り 20）。
- 金額・件数・率のみで、業務データの内容に到達する導線が存在しない（`F-063 AC-4`）。
- 🔴 タブは「監視」に置く（`docs/04` §3.3 の確定表）。「その顧客は使えているか」（テナント）でも「契約と枠をどうするか」（契約）でもなく、「いま異常は起きているか」に答える画面であり、`A-005` 運用監視と並ぶ。
- 🔴 2026-09-01 改訂: `docs/04:1588` の列構成に揃え、`原価（電子署名）` と `金額上限に対する消費率`（`F-063 AC-5`）の 2 列を追加した（従来は 11 列で、電子署名原価と金額ベースの消費率が欠けていた）。原価の合計が変わったため、6 行の例の `粗利` / `粗利率` を再計算し、要約バンドの `粗利率 41.2%` も `42.6%` に更新した。
- 🔴 2026-09-01 改訂: 旧 `クォータ消化率` 列を `クォータ消化率（件数）` に改称した。これは `A-004` の 4 種の件数クォータ（スキルシート解析 / 候補の根拠文 / 提案ドラフト / 延長論点整理）のうち最大値であり、`A-004` の `AI コスト消化率`（`金額上限に対する消費率` として本画面に別列で持つ、上限 100% の遮断器指標）とは別の指標である。値は `A-004` の当月フィクスチャと整合させた（例: `〇〇システム` は `A-004` の `ドラフト 196/180` → `109%`、`つばさネットワークス` は `解析 204/180` → `113%`）。件数クォータは超過しても停止せず従量課金に移行するため 100% を超えてよいが、`金額上限に対する消費率` は遮断器であり 100% を超えない（`A-004` と同じ規律）。列名を並べて描くことで、運営者がこの 2 指標を取り違えないようにした。
- 関連 UC: UC-10（収益性の監視）。
