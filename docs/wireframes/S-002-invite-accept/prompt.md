# S-002 招待の受諾とアカウント初期設定 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-002
- 画面名: 招待の受諾とアカウント初期設定
- 平面: 主平面
- 対応機能 ID: F-002 / F-003 / F-007
- 対応ステージ: −（オンボーディング）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.1 `S-002` / §7.1 / §10.1
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-002
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles. No rounded corners, no shadows, no gradients.
- Buttons `[ ラベル ]`, text inputs as a Japanese label above a rule `______________`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`.
- Definition lists (label left, value right, thin rules between rows) for read-only information.
- Status badges `< ラベル >` in angle brackets.
- All visible text is Japanese. No photos, no logos, no icons on buttons or headings.
- This is a wizard screen: the lowest information density in the product, one decision per step.

Screen-specific persistent elements:
- No header navigation and no sidebar (the user is not authenticated yet).
- The wordmark `SES Platform` appears once, centered above the wizard. It is the only place the product name is written.
- A 3-step progress indicator under the wordmark, drawn as three labelled boxes joined by rules: `1 招待の内容` — `2 アカウント設定` — `3 2 要素認証`. The current step box is black-filled with reversed text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. A single centered column of about half the viewport width on a light gray page background. Steps 1 and 2 are expanded and step 3 is collapsed, so the whole flow is readable in one image.

### Header block
- Wordmark `SES Platform`, centered.
- 3-step progress indicator with step 2 filled black.

### Step 1 panel: `招待の内容`
Read-only definition list, thin rules between rows:
- `招待元の組織` : `〇〇システム`
- `所属` : `△△テック（取引先）`
- `付与されるロール` : `PARTNER_SALES（取引先の営業）`
- `招待されたメールアドレス` : `sato@partner-tech.example.jp`
- `有効期限` : `2026-09-07 23:59`
Below the list, a bordered note strip: `このアカウントで見えるのは、御社が登録した人材と、御社に公開された案件・御社が作成した提案です。`
A second bordered note strip in gray: `（VIEWER として招待された場合）閲覧のみのアカウントです。承認・送信・ダウンロードはできません。`

### Step 2 panel: `アカウントの設定`
- `氏名` ______________
- `パスワード` ______________
- `パスワード（確認）` ______________
- Small gray rule text: `12 文字以上。英字・数字・記号を含めてください`

### Step 3 panel, collapsed strip: `2 要素認証の設定`
- One line: `OWNER / ADMIN は必須です。それ以外のロールは任意です。` with an expand affordance at the right edge.

### Action row at the bottom of the column
- One primary button, right aligned: `[ 招待を受諾する ]`
- Small gray line under it: `この招待リンクは受諾すると失効します`

### Two bordered state strips at the very bottom, each with a small gray caption above it
- Caption `期限切れのとき` / strip text `この招待は有効期限が切れています。招待元の管理者に再発行を依頼してください。（招待元: 〇〇システム）`
- Caption `受諾済みのとき` / strip text `この招待はすでに受諾されています` followed by `[ サインインする ]`
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Single centered column at about two thirds of the width. Same content and same order as the desktop view: wordmark, 3-step indicator, `招待の内容` definition list, the two note strips, the `アカウントの設定` form, the collapsed `2 要素認証の設定` strip, the primary button `[ 招待を受諾する ]`, and the two state strips.

IMPORTANT: this is not a shrunken desktop. The column widens to fill the available space and no field or note is dropped.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks. One step per screen; this image shows step 1 and the beginning of step 2.

Order from top:
1. Wordmark `SES Platform`, centered.
2. 3-step indicator as three short labelled boxes in one row: `1 招待の内容` / `2 アカウント設定` / `3 2 要素認証`, step 1 filled black.
3. Heading `招待の内容`.
4. Definition list stacked as label-over-value pairs, not two columns: `招待元の組織` `〇〇システム` / `所属` `△△テック（取引先）` / `付与されるロール` `PARTNER_SALES（取引先の営業）` / `招待されたメールアドレス` `sato@partner-tech.example.jp` / `有効期限` `2026-09-07 23:59`.
5. Bordered note strip wrapped over 3 lines: `このアカウントで見えるのは、御社が登録した人材と、御社に公開された案件・御社が作成した提案です。`
6. Heading `アカウントの設定` with `氏名` ______________ and `パスワード` ______________ at full width.
7. Bottom fixed action bar with one full-width primary button `[ 次へ ]` and a small gray line above it: `この招待リンクは受諾すると失効します`.

IMPORTANT: the granted role is visible before acceptance and is never hidden behind a toggle.
```

## 設計意図メモ（画像生成には使われない）

- 付与ロールを受諾前に読ませることが要件（`docs/04` §4.1 権限差分）。`VIEWER` は「あとでできないと気づく」状態を作らないため注記を独立ブロックにした。
- `sandbox` では取引先の招待メールが飛ばないため、この画面へはホストが `S-014` でコピーしたリンク経由で到達する（`F-007 AC-4`）。画像自体は production を描いている。
- 期限切れ・使用済みの 2 状態を 1 枚に別ストリップとして描いたのは、`docs/04` §10.1 の `404` 列が別文言を要求しているため（枚数方針を超えずに伝える）。
- ウィザードは §7.1 の「最低密度・1 ステップ 1 判断」に従い、モバイルは 1 ステップ 1 画面に落とす。
- 関連 UC: UC-01（テナント開設 → 初期 OWNER の受諾）/ UC-12（取引先の招待と受諾）。
