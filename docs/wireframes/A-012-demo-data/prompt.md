# A-012 デモ環境の合成データ管理 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-012
- 画面名: デモ環境の合成データ管理
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-053
- 対応ステージ: −
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-012` / §3.5 / §7.6 / `BR-47` / `BR-63`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-012
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen exists ONLY in the demo environment, where the sales team shows the product using entirely synthetic data. There is no way, anywhere on this screen, to copy or import data from production.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text inputs as a label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; dashed = dashed border for in-progress states.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- At the very top, full width, a bordered environment banner reading, on one wrapped block of two lines: `デモ環境 — 送信は行われません。` / `表示されているデータはすべて架空のものです`. Under the box, one line of small gray annotation: `※ 本番環境ではこの画面自体が存在しない`.
- Below the banner, a full-width BLACK-FILLED band reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `運用`, drawn filled black.
- A second, thinner row under the active tab: `お知らせ・機能フラグ` / `デモ環境データ` (current, underlined).
- This screen allows writing (synthetic data only), so it does NOT carry the `閲覧のみ` badge.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Environment banner, black band, header row and tab strip as in the shared prompt. Title row: `デモ環境の合成データ管理` as the single largest text. Breadcrumb above it: `運用 ＞ デモ環境データ`.

### Section 1: `環境の確認` — a bordered band
A read-only definition list: `APP_ENV` `demo` / `対象テナント` `デモ商事株式会社`
A gray line: `環境は接続先で決まります。この画面から切り替えることはできません。`
IMPORTANT: there is no environment selector, no dropdown listing other environments, and no tenant switcher on this screen.

### Section 2: `現在の投入状況` — a definition list of 6 rows, each with a count
`取引先数` `4 社` / `エンジニア数` `128 名` / `進行中の提案` `21 件` / `満了が近い稼働` `5 件` / `ゲートで止まる資料` `3 件` / `匿名共有が有効な候補` `12 名`
Under the list, a gray line: `いずれも架空のデータです。実在の企業名・氏名は含まれません。`
Beside the list, a table of 8 body rows titled `投入済みのデータセット` with columns `データセット` / `版` / `投入日時` / `件数`, for example `標準デモ一式 / v7 / 2026-08-20 10:04 / 1,204 件`.

### Section 3: `投入 / リセット`
- `投入するデータセット` `[ 標準デモ一式 v7 ▾ ]` with the alternative options listed nearby in plain text: `品質ゲート実演セット v3` / `満了アラート実演セット v2`
- IMPORTANT: the option list contains synthetic datasets ONLY. There is no option, button, link or menu item anywhere on this screen resembling "本番からコピー", "本番データを取り込む" or any import from a customer tenant.
- Buttons `[ 投入する ]` and `[ 初期状態にリセットする ]`
- Beside the buttons, a confirmation dialog with the small gray caption `リセットの確認ステップ`:
  Title `対象テナントの全業務データを削除して初期状態に戻します`
  Body: `環境: demo` / `対象テナント: デモ商事株式会社`
  `確認のためテナント名を入力してください` a rule with the placeholder `デモ商事株式会社`
  Buttons `[ リセットする ]` `[ キャンセル ]`
- A progress strip with a dashed border: `投入しています（数分かかります）` and a gray line `完了すると投入状況が更新されます`.

### Section 4: `実行履歴` — a compact table of 6 rows
Columns `日時` / `実施者` / `操作` / `データセット` / `結果`. Example: `2026-08-20 10:04 / 佐藤 / 投入 / 標準デモ一式 v7 / 成功`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `未投入のとき`: `合成データが投入されていません` with `[ 投入する ]`
- Caption `非対象環境で URL を直打ちしたとき`: `この環境では利用できません` and nothing else — no form, no buttons and no navigation entry for this screen in the tab strip
```

## 設計意図メモ（画像生成には使われない）

- 本番の顧客データを取り込む導線を 1 つも持たない（`BR-47`）。匿名化しての持ち出しも認めない。プロンプトで選択肢・ボタン・リンクのいずれとしても描かないことを明示した。
- 「対象環境を選ぶ」ドロップダウンを置かない。環境は接続先で決まる（`A-014` セクション 1 と同じ考え方）。
- `demo`（および `development`）のときのみ画面と導線が存在し、`production` / `sandbox` / `staging` では管理平面のナビにも現れない（`F-053 AC-6`）。`sandbox` に存在しないのは実演環境と試用環境を兼ねないため（`BR-63`）。
- リセットは環境名の表示 + テナント名の入力（§7.6 の摩擦表）。
- 環境バナー（`demo` 文言）を最上部に固定する（§3.5）。
- 書き込みが許される 6 画面の 1 つだが、対象は合成データのみで顧客の業務データには一切及ばない。
- 関連 UC: UC-10（営業デモの準備）。
