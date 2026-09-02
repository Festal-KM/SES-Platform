# A-003 テナント詳細 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-003
- 画面名: テナント詳細
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-056 / F-057 / F-059 / F-054
- 対応ステージ: −（`CLAUDE.md` §10.4-1）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-003` / §3.3 / §6.7 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-003
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin, is used only by the SaaS provider's own staff, and must look unmistakably different from the customer-facing app. The operator sees counts, states, errors and dates — never the content of a customer's business data.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets: `< 契約中 >` outline, `< 停止中 >` filled, `< 解約手続き中 >` filled, `< 削除済み >` outline.
- Definition lists for the attributes of one record; tables carry 10 to 15 rows elsewhere in this console.
- Charts are bare skeletons with axis labels only.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `テナント`, drawn filled black.
- A second, thinner row under the active tab: `テナント一覧` / `テナント詳細` (current, underlined) / `テナントの開設`.
- To the right of the screen title, a badge shown at all times: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: nowhere on this screen is there an engineer name, a skill-sheet excerpt, a project description, a proposal body or a chat message, and there is no link that would lead to any of them.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `〇〇システム株式会社` as the single largest text with `< 契約中 >` outline beside it and the `閲覧のみ（テナント業務データに対して）` badge at the right. Breadcrumb above the title: `テナント ＞ テナント一覧 ＞ 〇〇システム`.

Content is a 2-column split: left about 46 percent, right about 54 percent.

## Left column

### Section 1: `契約`
Definition list: `プラン` `スタンダード` / `ライフサイクル状態` `< 契約中 >` / `契約開始` `2025-04-01` / `更新日` `2027-03-31` / `環境種別` `production`
Text link `[ 契約管理を開く ]`.

### Section 2: `規模`
Definition list: `席数` `12 / 20` / `パートナー数` `4 社` / `エンジニア数` `1,240 件` / `案件数` `312 件` / `提案数（累計）` `1,842 件` / `稼働数` `86 件`

### Section 3: `アクティビティ`
Definition list: `最終ログイン` `2026-08-31 09:41` / `直近 30 日の操作件数` `4,208 件`
Beside it a simple bar chart skeleton with the x axis labelled `8/1` to `8/31` and the y axis labelled `操作件数`.
A gray line: `集計日時: 2026-08-31 03:00（日次バッチ）`

## Right column

### Section 4: `利用量とクォータ消化率`
A small table of 4 rows with columns `対象` / `使用量` / `上限` / `消化率`:
`AI コスト（日次） / 20.00 USD / 20.00 USD / 100%`
`AI クォータ（月次） / 354,000 トークン / 300,000 トークン / 118%`
`メール（本日） / 488 通 / 500 通 / 97%`
`ストレージ / 42.1 GB / 50.0 GB / 84%`
Text link `[ 利用量・クォータ管理を開く ]`.

### Section 5: `このテナントの運用上の異常` — table, 6 body rows
Columns `項目` / `件数` / `最も古い経過時間`
`未対応の送信失敗 / 5 件 / 3 日 2 時間`
`SUBMITTING の滞留 / 1 件 / 41 分`
`ウイルススキャン失敗 / 0 件 / —`
`ゲート FAIL 率の異常 / 9.4%（前週比 +3.1pt） / —`
`計測欠測 / 0 件 / —`
`削除ジョブ失敗 / 0 件 / —`
Text link `[ 運用監視を開く ]`.

### Section 6: `記録`
Two text links stacked: `[ 監査ログを検索する ]` and `[ 代理閲覧を開始する ]`, with a gray line under the second: `理由の入力が必須です。状態とエラーで特定できない場合にのみ使用してください。`

### One state strip at the very bottom with a small gray caption above it
- Caption `PURGED のテナントを開いたとき`: a band showing the title with `< 削除済み >` outline, the single line `このテナントのデータは削除済みです`, the definition list showing ONLY the lifecycle state, and one text link `[ 契約管理の削除完了の確認を開く ]`. This band shows NO deletion counts, NO completed / not-completed figures and NO other content.
```

## 設計意図メモ（画像生成には使われない）

- 件数・状態・日時に徹し、内容には立ち入らない（`F-056 AC-1` / `BR-40`）。運営者に必要なのは「件数・状態・エラー」であって「内容」ではない。
- `PURGED` の表示はライフサイクル状態のみとし、削除の完了 / 未完了と件数を本画面に出さない（§1.2 の 🔴 / `F-062 AC-7`）。確認は `A-010` セクション 4 の 1 経路のみで、そこへのリンクだけを置く。
- `PLATFORM_SUPPORT` には停止・プラン変更・期限延長の導線が存在しない（`BR-44`）。本画像は `PLATFORM_SUPPORT` 視点なので、それらのボタンを描かない。
- サポート対応の導線（`A-005` → `A-003` → `A-006` → `A-007`）が 1 本に繋がるよう、異常一覧と記録セクションからそれぞれ遷移を置いた（§2.4 の 🔴）。
- 日次集計であることを集計日時で明示する。
- 関連 UC: UC-10（サポート対応）。
