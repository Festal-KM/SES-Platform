# A-002 テナント一覧（健全性・異常順） ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-002
- 画面名: テナント一覧（健全性・異常順）（必須画面）
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-056
- 対応ステージ: −（`CLAUDE.md` §10.4-1）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-002` / §3.3 / §6.7 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-002
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin, is used only by the SaaS provider's own staff, and must look unmistakably different from the customer-facing app so that staff never confuse the two. The operator sees counts, states, errors and dates — never the content of a customer's business data.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`. Filter chips are `[ ラベル ]` boxes with the active one filled black.
- Status badges `< ラベル >` in angle brackets: `< 試用中 >` filled, `< 契約中 >` outline, `< 停止中 >` filled, `< 解約手続き中 >` filled, `< 削除済み >` outline.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height. This console is data dense by nature.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density throughout.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band; this band is the primary at-a-glance distinction.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role always spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar. The customer plane uses a left sidebar, so the operator console must not. The strip holds five group tabs which deliberately do not follow the customer plane's business-loop order: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The 監視 tab carries the alert count badge. The active tab is `テナント`, drawn filled black.
- A second, thinner horizontal row under the active tab lists that group's screens as text links: `テナント一覧` (current, underlined) / `テナント詳細` / `サンドボックス` / `テナントの開設`.
- To the right of the screen title, a badge shown at all times: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: nowhere on this screen is there an engineer name, a skill-sheet excerpt, a project description, a proposal body or a chat message, and there is no link that would lead to any of them.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and horizontal tab strip as in the shared prompt. Title row: `テナント一覧` as the single largest text with the `閲覧のみ（テナント業務データに対して）` badge beside it. No primary action button in the title row.

### Section 1: `異常の要約` — a row of 7 small bordered count boxes, each clickable to filter
`最終アクティビティが 14 日以上停滞 4` / `席が使われていない（利用率 30% 未満） 3` / `パートナー数 0 5` / `トライアル期限切れ 1` / `トライアル期限が 7 日以内 2` / `未対応の送信失敗あり 6` / `粗利率が閾値割れ 2`
Under the boxes, one gray line: `集計日時: 2026-08-31 03:00（日次バッチ）`

### Section 2: filter strip
`ライフサイクル状態` `[ すべて ▾ ]` / `プラン` `[ すべて ▾ ]` / `異常の種別` `[ すべて ▾ ]` / `並び替え` `[ 異常度の高い順 ▾ ]` / `[ 検索 ]`

### Section 3: `テナント一覧` — table, 14 body rows, sorted so the most abnormal tenants are at the very top
Columns: `テナント名` / `ライフサイクル状態` / `プラン` / `席数（使用 / 上限）` / `パートナー数` / `エンジニア数・案件数` / `最終アクティビティ` / `異常の種別`
1. `みどり情報システム / < 試用中 > filled / トライアル / 2 / 5 / 0 / 41・6 / 21 日前 / パートナー数 0 ・ トライアル期限切れ`
2. `青葉テクノサービス / < 契約中 > outline / スタンダード / 3 / 20 / 0 / 88・12 / 17 日前 / パートナー数 0 ・ 最終アクティビティ停滞`
3. `さくらエンジニアリング / < 契約中 > outline / スタンダード / 4 / 20 / 1 / 120・9 / 15 日前 / 最終アクティビティ停滞 ・ 席が使われていない`
4. `北斗ソフトウェア / < 契約中 > outline / エンタープライズ / 9 / 50 / 2 / 402・31 / 2 日前 / 未対応の送信失敗あり（7 件）`
5. `〇〇システム / < 契約中 > outline / スタンダード / 12 / 20 / 4 / 1,240・312 / 本日 / 未対応の送信失敗あり（5 件）`
6. `かなで情報技術 / < 試用中 > filled / トライアル / 1 / 5 / 0 / 12・2 / 5 日前 / パートナー数 0 ・ トライアル期限が 7 日以内`
7. `やまと開発 / < 停止中 > filled / スタンダード / 6 / 20 / 3 / 210・18 / 34 日前 / 停止中`
8. `ひばりシステムズ / < 解約手続き中 > filled / スタンダード / 5 / 20 / 2 / 168・14 / 9 日前 / 解約手続き中（削除まで 24 日）`
9. `つばさネットワークス / < 契約中 > outline / スタンダード / 7 / 20 / 5 / 311・27 / 本日 / 粗利率が閾値割れ`
10. `こもれびソリューション / < 契約中 > outline / ライト / 2 / 5 / 1 / 44・7 / 3 日前 / 席が使われていない`
11-14. four more rows with no abnormality, showing `—` in the last column.
Long tenant names are truncated on one line; row height stays uniform. Under the table, paging: `[ 前のページ ]` `1 - 100 / 148` `[ 次のページ ]`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `テナントが 0 件のとき（PLATFORM_OWNER が見た場合）`: `テナントがまだありません` with `[ テナントを開設する ]`
- Caption `テナントが 0 件のとき（PLATFORM_SUPPORT が見た場合）`: `テナントがまだありません` and NO button of any kind
```

## 設計意図メモ（画像生成には使われない）

- 異常が上位に来ていることが一目で分かる並びにする（申し送り 6 / §6.7）。既定の並び替えは「異常度の高い順」で、要約ボックスと表の順序が一致している。
- 「パートナー数 0」を異常として扱う（§4.9 `A-002`）。取引先が増えないテナントは中核価値に到達しておらず、原価が出ないため `A-011` では検知できない。
- 内容に到達する導線が存在しない（`F-056 AC-1`）。エンジニア名・スキルシート・提案本文・チャット本文を描かない。
- 日次バッチであることを集計日時で明示する（リアルタイムに見えて実は日次、という状態を作らない）。
- 開設導線は `PLATFORM_OWNER` にのみ表示し、`PLATFORM_SUPPORT` にはボタン自体を描かない（グレーアウトもしない。`F-001` の `PP` = `−`）。空状態の 2 種を 1 枚に併記した。
- 主平面との区別は「全幅の黒帯 + 横並びタブ + 閲覧のみバッジ」の 3 点で成立させる（§3.3 / 申し送り 8）。
- 関連 UC: UC-10（サポート対応の起点）。
