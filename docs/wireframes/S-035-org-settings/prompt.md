# S-035 組織設定とメンバー管理 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-035
- 画面名: 組織設定とメンバー管理
- 平面: 主平面
- 対応機能 ID: F-001 / F-002 / F-021（承認ポリシー）
- 対応ステージ: −（設定）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-035` / §6.6 / §8.2 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-035
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages the organisation, its members and one dangerous setting: whether proposals that pass all three quality-gate layers may be approved automatically. That setting is about SENDING things outside the company and must never share a block with the separate, milder setting that governs whether AI outputs need review.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`, toggles `[ ] ラベル` / `[x] ラベル`, text inputs as a Japanese label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Settings screens use lower density than lists: one item per row, but no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 組織`, the screen title `組織設定とメンバー管理` as the single largest text, and exactly one primary button on the right of the title row: `[ メンバーを招待 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 80 percent width with six stacked sections and a thin section index on the right.

### Section 1: `組織情報`
Definition list with edit affordances: `商号` `〇〇システム株式会社` / `タイムゾーン` `[ Asia/Tokyo ▾ ]` / `通貨` a read-only value `日本円（JPY）` with no dropdown at all.

### Section 2: `メンバー` — table, 10 body rows, sorted so that OWNER / ADMIN rows without 2FA come first
Columns: `氏名` / `メール` / `ロール` / `所属` / `2FA` / `最終ログイン` / `状態` / `操作`
1. `田中 修 / tanaka@ses-example.co.jp / ADMIN / 自社 / 未設定 / 2026-08-30 / < 有効 > outline / [ ロールを変更 ]` — this row carries an inline gray note `2FA が未設定のため業務画面に到達できません`
2. `佐野 恵 / sano@ses-example.co.jp / OWNER / 自社 / 未設定 / 2026-08-29 / < 有効 > outline / [ ロールを変更 ]` — same inline note
3. `山田 太一 / yamada@ses-example.co.jp / ADMIN / 自社 / 設定済み / 2026-08-31 / < 有効 > outline / [ ロールを変更 ]`
4. `鈴木 亮 / suzuki@ses-example.co.jp / SALES / 自社 / 設定済み / 2026-08-31 / < 有効 > outline / [ ロールを変更 ]`
5. `加藤 直 / kato@ses-example.co.jp / SALES / 自社 / 設定済み / 2026-08-30 / < 有効 > outline / [ ロールを変更 ]`
6. `森 香織 / mori@ses-example.co.jp / VIEWER / 自社 / — / 2026-08-25 / < 有効 > outline / [ ロールを変更 ]`
7-10. four more rows, some with 所属 showing a partner company name such as `△△テック` and roles `PARTNER_ADMIN` / `PARTNER_SALES`, one with 状態 `< 無効 > filled`.

### Section 3: `招待`
`メールアドレス` ______________ / `ロール` `[ SALES ▾ ]` / `[ 招待を送る ]`
A gray line: `招待は「送信を受け付けました」と表示され、状態で送達を確認します`

### Section 4: `承認ポリシー` — its own bordered block, clearly separated from every other section
- Toggle `[ ] 提案の承認を自動で付与する（品質ゲートの全層 PASS のときのみ）`, currently OFF
- A gray line under the toggle: `この設定の粒度: この組織全体`
- A bordered cross-reference line: `AI の各担当の提出物を確認するかどうかは別の設定です（設定 ＞ AI 運用ロールの設定）`
- Beside the block, a confirmation dialog with the small gray caption `有効にするときの確認ステップ`:
  Title `提案が人手の承認なしに送信されます`
  Body, wrapped over three lines: `有効にすると、品質ゲートの全層 PASS の提案が人手の承認なしに送信されます。` / `1 層でも不合格の提案は、この設定にかかわらず人間に差し戻されます。`
  A checkbox `[ ] 上記を理解しました` and the buttons `[ 有効にする ]` `[ キャンセル ]`
IMPORTANT: this block contains ONLY this one toggle. Do not place any AI-role approval-mode rows, any per-role toggles or any model settings inside or next to it.

### Section 5: `契約プランと利用量（要約）`
Definition list: `プラン` `スタンダード` / `席数` `12 / 20` / `当月の AI 利用量` `消化率 63%` / `残量` `7.4 USD / 20.0 USD`
Text link `[ 利用量と上限の詳細を見る ]`.

### Section 6: `設定の目次` — a plain two-column list of text links
`送信ドメインの設定と検証` / `電子署名サービスの接続` / `利用量と上限` / `AI 運用ロールの設定` / `マッチング重みの設定` / `監査ログ` / `データの返却と保持期間` / `取引先企業`

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `ロール変更の確認ステップ`: a dialog `鈴木 亮 のロールを SALES から VIEWER に変更します` with two lists `できなくなること: 提案の作成・承認・送信、スキルシートのダウンロード` and `できるようになること: （なし）`, plus `[ 変更する ] [ キャンセル ]`
- Caption `メンバーが 1 名のとき`: `メンバーはあなただけです` with `[ メンバーを招待 ]`
```

## 設計意図メモ（画像生成には使われない）

- `autoApproveEnabled` と `S-039` のロール別承認モードを同じブロックに置かない（`F-035 AC-6` / `docs/03` 申し送り 11 / §8.2）。相互参照の 1 行を両画面に置き、粒度の違いを文言で明示した。
- 承認ポリシーの有効化は「危険な操作」の摩擦（説明 + チェックボックスによる同意。§7.6）。1 層でも FAIL なら差し戻る旨を確認文言に含める。
- 2FA 未設定の `OWNER` / `ADMIN` を上位に出す（業務画面に到達できないため放置されると詰まる。§6.6）。
- ロール変更の確認に「できなくなること / できるようになること」を列挙する（`F-002 AC-3`）。
- `PARTNER_ADMIN` は本画面に到達せず、自社配下は `S-014` の自社詳細から管理する（`F-002 AC-4`）。
- 通貨は日本円固定で選択肢を置かない。
- 関連 UC: UC-11（メンバー管理）/ UC-06（自動承認）。
