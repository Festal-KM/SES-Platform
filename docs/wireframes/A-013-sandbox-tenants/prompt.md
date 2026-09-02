# A-013 サンドボックステナントの管理 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-013
- 画面名: サンドボックステナントの管理
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-054 / F-064
- 対応ステージ: −（`CLAUDE.md` §10.4-4）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-013` / §1.2 の 🔴 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-013
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen manages trial tenants: their deadlines, the checklist they must complete before converting, and the conversion itself, which is a state change and never a data copy.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text areas as stacked rules with a Japanese label above, checklist items as `[x]` / `[ ]`.
- Status badges `< ラベル >` in angle brackets: `< 試用中 >` filled, `< 送信済み >` outline, `< 送信失敗 >` filled.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `契約`, drawn filled black. (Sandbox tenant management belongs to the `契約` tab group, alongside contract management and quota management, not to `テナント`.)
- A second, thinner row under the active tab: `契約管理` / `利用量・クォータ` / `サンドボックス` (current, underlined).
- This screen allows writing (conversion and deadline extension), so it does NOT carry the `閲覧のみ` badge.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen must NOT contain any deletion-completion confirmation. It shows deadlines, conversion, extension and the state of advance notices only.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `サンドボックステナントの管理` as the single largest text. Breadcrumb above it: `契約 ＞ サンドボックス`.

Content is a 2-column split: list on the left (about 56 percent), detail of the selected tenant on the right (about 44 percent).

## Left column

### Section 1: `SANDBOX テナント一覧` — table, 10 body rows, sorted by the nearest deadline first
Columns: `テナント` / `開設日` / `残り日数` / `エンジニア数・案件数` / `最終アクティビティ` / `期限予告の送信状態`
1. `みどり情報システム / 2026-07-28 / 期限切れ（-3 日） / 41・6 / 21 日前 / < 送信失敗 > filled` — this row carries an inline bordered warning: `期限予告が届いていません。通知されないまま削除される状態です。`
2. `かなで情報技術 / 2026-08-08 / 5 日 / 12・2 / 5 日前 / < 送信済み > outline`
3. `〇〇システム（試用） / 2026-08-19 / 12 日 / 24・6 / 本日 / < 送信済み > outline`  (selected row, marked with a filled left edge)
4. `ひまわりソリューション / 2026-08-22 / 15 日 / 8・1 / 2 日前 / < 送信済み > outline`
5. `あおぞら技研 / 2026-08-26 / 19 日 / 0・0 / 4 日前 / < 送信済み > outline`
6-10. five more rows of the same shape with remaining days from 21 to 29.
Above the table a count line `試用中のテナント 10 件` and a filter strip `残り日数` `[ すべて ▾ ]` `[ 検索 ]`.

## Right column

### Section 2: `〇〇システム（試用）` — definition list
`開設日` `2026-08-19` / `期限` `2026-09-12` / `残り` `12 日` / `状態` `< 試用中 >` filled / `プラン` `トライアル` / `環境種別` `sandbox`

### Section 3: `投入状況`
Definition list: `メンバー` `4 名` / `取引先` `0 社` / `エンジニア` `24 件` / `案件` `6 件` / `提案` `9 件`

### Section 4: `移行チェックリスト` — table, 4 body rows, incomplete rows first
Columns: `項目` / `状態`
- `[ ] 送信ドメインの検証 / 未完了（本契約では必須）`
- `[ ] 取引先の招待 / 未完了（0 社）`
- `[x] メンバーの招待 / 完了（4 名）`
- `[x] 案件と人材の登録 / 完了（案件 6 件 / 人材 24 件）`

### Section 5: `移行 / 期限延長`
Two buttons in a row: `[ 本契約へ移行する ]` and `[ 期限を延長する ]`.
Beside them, a confirmation dialog with the small gray caption `移行の確認ステップ`:
Title `このテナントを本契約に移行します`
Body: `未完了の項目: 送信ドメインの検証 ／ 取引先の招待`
An emphasised line: `送信ドメインが未検証のまま移行すると、取引先へメールを送信できません。`
`データのコピーは発生しません（状態の遷移のみ）。`
Buttons `[ 移行する ]` `[ キャンセル ]`
A second dialog beside it with the caption `延長の確認ステップ`: `延長後の期限` a date box `2026-09-26` and `理由` a text area of three rules carrying the word `必須`, then `[ 延長する ]` `[ キャンセル ]`.
A gray line under both: `移行・延長は PLATFORM_OWNER のみが実行できます。`

### Section 6: bottom row
A gray line: `削除完了の確認は契約管理で行います。` with the text link `[ 契約管理を開く ]`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `SANDBOX テナントが 0 件のとき（PLATFORM_OWNER が見た場合）`: `サンドボックスのテナントはありません` with `[ テナントを開設する ]`
- Caption `PLATFORM_SUPPORT が見たとき`: a band showing the list and the checklist with NO 移行 button, NO 延長 button and NO dialogs, and the badge `閲覧のみ（テナント業務データに対して）` beside the title
```

## 設計意図メモ（画像生成には使われない）

- 削除完了の確認をこの画面に置かない（§4.9 `A-013` の 🔴 / `F-062 AC-7`）。`A-010` の 1 経路に保つため、末尾はリンクだけにした。
- 移行は状態遷移のみでデータのコピーは発生しない（`F-054 AC-3`）。確認ステップにその旨を明記する。
- 移行の確認に「送信ドメイン未検証のまま移行すると取引先へ送信できない」を出す（`U-04` / `docs/03` 申し送り 2）。
- 期限予告の送信失敗を警告として表示する（`F-064 AC-10` の「通知されないまま削除される経路が存在しない」が破れている状態であるため）。
- 移行・延長は `PLATFORM_OWNER` のみ（`F-054 AC-7` / `AC-8`）。延長は理由の必須入力。
- 0 件のときの開設導線は `PLATFORM_OWNER` にのみ表示する。
- 関連 UC: UC-24（サンドボックスから本契約へ）。
