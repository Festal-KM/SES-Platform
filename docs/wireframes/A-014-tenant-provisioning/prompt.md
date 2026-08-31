# A-014 テナントの開設 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-014
- 画面名: テナントの開設
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-001
- 対応ステージ: −（`CLAUDE.md` §10.6 の Phase 0 スコープ）
- Tier: T3（申し送り 10 / 申し送り 11 によりフォーム 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-014` / §1.2 の 🔴 / §7.6 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-014
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen creates a tenant — the unit of data isolation — and invites exactly one initial owner. It creates NO business data of any kind. Because the defaults chosen here determine how safe the customer's very first login is, those defaults are printed on the screen before the operator can confirm.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, radio `( )` / `(o)`, text inputs as a Japanese label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets: `< 送信中 >` dashed, `< 送信済み >` outline, `< 受諾済み >` filled, `< 送信失敗 >` filled.
- Tables carry Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Form density: one item per row, but no large empty areas.

Persistent UI on every operator screen:
- At the very top, full width, a bordered environment banner of 3 wrapped lines that must NOT be squeezed onto one line:
  line 1 `サンドボックス環境 — 取引先への提案・契約書・署名依頼、および取引先の担当者宛のメール（招待を含む）は送信されません。`
  line 2 `取引先の招待は、画面に表示されるリンクをお渡しください。`
  line 3 `自社メンバー宛の招待・期限のお知らせは、お使いのアドレスに実際に届きます。それ以外は本番と同じ動作です`
  Under the box, one line of small gray annotation: `※ 本番環境ではこの帯は表示されない`.
- Below the banner, a full-width BLACK-FILLED band reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `テナント`, drawn filled black.
- A second, thinner row under the active tab: `テナント一覧` / `テナント詳細` / `サンドボックス` / `テナントの開設` (current, underlined).
- This screen allows writing (tenant creation), so it does NOT carry the `閲覧のみ` badge.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Environment banner, black band, header row and tab strip as in the shared prompt. Title row: `テナントの開設` as the single largest text. Breadcrumb above it: `テナント ＞ テナントの開設`.

Content is a 2-column split: the form on the left (about 58 percent) and the recent provisioning list on the right (about 42 percent).

## Left column — SEVEN numbered sections in this exact order

### 1. `開設先の環境`
A read-only value box: `sandbox`
A gray line: `環境は接続先で決まります。この画面で選ぶことはできません。`
IMPORTANT: this is a read-only value, never a dropdown and never a set of radio buttons.

### 2. `企業の情報`
`企業名` ______________ showing `みらい情報サービス株式会社`
`商号` ______________
`タイムゾーン` `[ Asia/Tokyo ▾ ]`
`通貨` a read-only value `日本円（JPY）` with no dropdown
A bordered warning strip attached to the 企業名 field: `既存テナントに類似する名称があります: 「みらい情報システム株式会社」（2025-11-02 開設）。取り違えて 2 つ目を開設すると、分離が効いたまま業務が 2 つに割れます。` and a gray line under it `この警告で開設は止まりません`.

### 3. `契約の初期状態`
Radio: `(o) SANDBOX（試用。30 日の期限つき）` `( ) ACTIVE（本契約）`
Directly under the selected radio, an indented note block of three lines: `期限は開設日から 30 日です。` / `サンドボックス管理の対象になります。` / `期限到来で解約手続き中に進みます。`

### 4. `プラン`
`プラン` `[ トライアル ▾ ]` / `席数上限` `5` / `AI 利用量クォータ` `50,000 トークン / 月` / `メール上限` `200 通 / 日` / `機能フラグの既定` a short read-only list `電子署名連携: 閉鎖` `AI スキルシート解析: 開放`

### 5. `初期 OWNER の招待`
`氏名` ______________ showing `森本 一郎`
`メールアドレス` ______________ showing `morimoto@mirai-is.example.co.jp`
A gray line: `招待できるのは 1 名だけです。以降のメンバー追加はテナント側で行います。`
IMPORTANT: there is exactly one name field and one address field. There is no control for adding a second invitee, no plus button and no repeatable row.

### 6. `開設後に自動で入る既定値` — a bordered read-only block placed immediately before the confirmation
Three rows: `自動承認` `無効` / `AI 運用ロールの承認モード` `すべて都度承認` / `案件の公開範囲` `誰にも公開されない`
A gray line: `危険側に倒れた既定では開設されません。`

### 7. `開設の確認`
A bordered confirmation panel repeating: `企業名: みらい情報サービス株式会社` / `環境: sandbox` / `契約の初期状態: SANDBOX（30 日）` / `招待先: morimoto@mirai-is.example.co.jp`
One primary button `[ テナントを開設する ]`.

## Right column

### `直近の開設` — table, 8 body rows
Columns: `開設日時` / `企業名` / `環境` / `契約の初期状態` / `招待の状態`
1. `2026-08-30 16:12 / ひまわりソリューション / sandbox / SANDBOX / < 送信済み > outline`
2. `2026-08-28 10:45 / あおぞら技研 / sandbox / SANDBOX / < 受諾済み > filled`
3. `2026-08-26 09:03 / かなで情報技術 / sandbox / SANDBOX / < 送信失敗 > filled` with the inline links `[ 招待を再送 ]` `[ リンクを取得 ]`
4. `2026-08-24 14:31 / 北斗ソフトウェア / production / ACTIVE / < 受諾済み > filled`
5-8. four more rows of the same shape, one showing `< 送信中 > dashed`.
A gray line under the table: `開設して終わりにせず、受諾までを追えるようにしています。`

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `開設に失敗したとき`: `テナントは作成されていません` with `入力内容は保持しています` and `[ 再試行 ]`
- Caption `招待メールの送信に失敗したとき`: two separate lines `テナントは作成されました` and `招待メールの送信に失敗しています`, followed by `[ 招待を再送 ]` `[ リンクを取得 ]` and the gray line `開設をやり直さないでください。重複テナントが生まれます。`
- Caption `PLATFORM_SUPPORT が見たとき`: an empty band with the single gray line `この画面は表示されません（ナビゲーションにも現れません）`
```

## 設計意図メモ（画像生成には使われない）

- 申し送り 11 に従い、確認ステップの直前に「開設後に自動で入る既定値」ブロック（自動承認 = 無効 / AI ロール = すべて都度承認 / 公開範囲 = 非公開）を必ず描いた（`F-001 AC-1`）。ここが緩い側に入ると、顧客は最初のログイン時点で既にゲートと公開範囲が緩んでいることに気づけない。
- 環境は読み取り専用（選ばせない）。`CLAUDE.md` §11.1 の「起動時の 1 箇所で差し替える」と同じ考え方。
- 初期 `OWNER` は 1 名のみで、複数招待欄を置かない。誰がその組織の責任者かを 1 人に確定させてから引き渡す。
- 同名・類似名の警告は出すが開設は止めない。取り違えた開設は分離が効いたまま業務が 2 つに割れ、後から気づきにくい。
- 開設の失敗と招待メールの失敗を 2 つの事実として分けて示し、開設のやり直しに誘導しない（重複テナントが生まれる）。
- `PLATFORM_SUPPORT` にはこの画面が存在せず、ナビにも現れない（グレーアウトもしない。`gate-inspector` と同じ原則）。
- テナントの器と初期 `OWNER` だけを作り、業務データは 1 件も作らない（`BR-37`）。
- 関連 UC: UC-01（テナント開設）。
