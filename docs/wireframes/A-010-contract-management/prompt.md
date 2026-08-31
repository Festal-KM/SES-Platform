# A-010 契約管理（プラン・停止・請求・削除完了の確認） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-010
- 画面名: 契約管理
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-062 / F-064
- 対応ステージ: −（`CLAUDE.md` §10.4-4）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-010` / §1.2 の 🔴 / §7.6 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-010
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen manages contract lifecycle and, separately, is the ONLY place in the whole product where an operator can confirm that a deletion has completed.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text areas as stacked rules with a Japanese label above, text inputs as a label above a rule.
- Status badges `< ラベル >` in angle brackets: `< 試用中 >` filled, `< 契約中 >` outline, `< 停止中 >` filled, `< 解約手続き中 >` filled, `< 削除済み >` outline.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- Section headings carry a phase marker in small gray text, for example `[Phase 3]` or `[Phase 1]`.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `契約`, drawn filled black.
- A second, thinner row under the active tab: `契約管理` (current, underlined) / `利用量・クォータ` / `原価・粗利`.
- This screen allows writing (contract lifecycle), so it does NOT carry the `閲覧のみ` badge.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen never contains a control that creates a tenant. Tenant provisioning is a different screen entirely.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `契約管理` as the single largest text. Breadcrumb above it: `契約 ＞ 契約管理 ＞ 〇〇システム`.

Content is a 2-column split: left about 55 percent (sections 1 to 3), right about 45 percent (section 4).

## Left column

### Section 1: `テナントの契約` `[Phase 3]`
Definition list: `テナント` `〇〇システム株式会社` / `プラン` `[ スタンダード ▾ ]` / `席数上限` `20` / `AI 利用量クォータ` `300,000 トークン / 月` / `ライフサイクル状態` `< 契約中 >` outline / `契約開始` `2025-04-01` / `更新日` `2027-03-31`
Button `[ プランを変更する ]`.

### Section 2: `ライフサイクルの操作` `[Phase 3]`
Three buttons in a row: `[ 停止する ]` `[ 解消する ]` `[ 解約する ]`.
Beside them, a confirmation dialog with the small gray caption `停止の確認ステップ`:
Title `このテナントを停止します`
Body, wrapped over three lines: `このテナントの利用者は、ログインと閲覧はできますが、提案の承認・送信、契約書の送付・電子署名依頼、面談調整の連絡、提案依頼の発行が一切できなくなります。データは削除されません。`
`理由` a text area of three rules carrying the word `必須`
`確認のためテナント名を入力してください` a rule with the placeholder `〇〇システム株式会社`
Buttons `[ 停止する ]` `[ キャンセル ]`
A second smaller dialog beside it with the caption `解約の確認ステップ` adding one line: `30 日後にエンジニアの連絡先・スキルシート原本・チャット本文が削除されます。`
Under the buttons, a bordered note: `定義されていない遷移は実行できません。例: この遷移は定義されていません（現在: 削除済み）`

### Section 3: `請求` `[Phase 3]` — table, 6 body rows
Columns `対象期間` / `席数` / `AI 利用量` / `超過分` / `請求額` / `状態`. Example: `2026-08 / 12 席 / 354,000 トークン / 4.80 USD / 128,400 円 / 確定`.
A gray line: `決済連携は未接続です。請求書は手作業で発行します。`

## Right column

### Section 4: `削除完了の確認` `[Phase 1]` — a bordered block, the only section that exists in Phase 1
A one-line caption at the top of the block: `これが運営者にとっての唯一の確認経路です。`
A table of 8 body rows with columns `テナント` / `契機` / `対象種別` / `件数` / `状態` / `完了日`
1. `ひばりシステムズ / 解約（CLOSING → PURGED） / エンジニアの連絡先 / 168 件 / 削除処理中 / —`
2. `ひばりシステムズ / 解約（CLOSING → PURGED） / スキルシート原本 / 402 件 / 削除処理中 / —`
3. `ひばりシステムズ / 解約（CLOSING → PURGED） / チャット本文 / 2,140 件 / 未実行 / —`
4. `みどり情報システム / 解約（CLOSING → PURGED） / エンジニアの連絡先 / 41 件 / 完了 / 2026-08-24`
5. `みどり情報システム / 解約（CLOSING → PURGED） / スキルシート原本 / 96 件 / 完了 / 2026-08-24`
6. `やまと開発 / 保持期間（3 年ルール） / エンジニアの連絡先 / 17 件 / 完了 / 2026-08-01`
7-8. two more rows of the same shape.
Under the table two gray lines: `表示されるのは完了 / 未完了と件数のみです。削除された内容や返却データには到達できません。` and `削除ジョブの失敗は運用監視に現れます。この画面は「完了したか」だけを示します。`

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `削除対象が無いとき（Phase 1 の通常状態）`: `削除の対象になったテナントはありません`
- Caption `Phase 1 の画面`: a narrow band showing ONLY section 4, with sections 1 to 3 entirely absent and no placeholder text such as 準備中
- Caption `PLATFORM_SUPPORT が見たとき`: a band showing section 4 only, with NO lifecycle buttons and NO plan control anywhere, and the badge `閲覧のみ（テナント業務データに対して）` beside the title
```

## 設計意図メモ（画像生成には使われない）

- セクションごとにフェーズが違うため、見出しに `[Phase 1]` / `[Phase 3]` の注記を付けた（§4.9 `A-010` の 🔴）。Phase 1 の本画面はセクション 4 だけの画面であり、「準備中」と書かない（存在しない機能を示唆しない）。
- 削除完了の確認はこの 1 経路のみ（`F-062 AC-7`）。`A-013` にも `S-042` にも `A-003` にも運営者向けの確認導線を作らない。ブロック先頭にその旨を 1 行置いた。
- 表示は完了 / 未完了と件数のみで、削除された内容・返却データに到達しない（`BR-40`）。
- 「完了したか」を示すこの画面と、「失敗している異常」を示す `A-005` の役割の違いを注記した。
- 停止・解約は理由の必須入力 + テナント名の入力（§7.6 の摩擦表）。停止の文言は `F-062 AC-4` の内容を欠かさない。
- テナントの開設はこの画面に無い（`A-014` に切り出し）。プロンプトで明示的に禁止した。
- 関連 UC: UC-24（解約と削除の確認）。
