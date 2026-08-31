# S-014 取引先企業の一覧・詳細と招待 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-014
- 画面名: 取引先企業の一覧・詳細と招待
- 平面: 主平面
- 対応機能 ID: F-007 / F-002
- 対応ステージ: ① 集める
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-014` / §3.5（`sandbox` の招待リンク）/ §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-014
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. On this screen the host company registers and invites the partner companies that will share its tenant under a strict information boundary. This particular wireframe depicts the SANDBOX environment, where invitation e-mails to partner staff are not sent and the host hands over a link instead.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text inputs as a Japanese label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border for in-progress states.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- At the very top, full width, a bordered environment banner of 3 wrapped lines that must NOT be squeezed onto one line:
  line 1 `サンドボックス環境 — 取引先への提案・契約書・署名依頼、および取引先の担当者宛のメール（招待を含む）は送信されません。`
  line 2 `取引先の招待は、画面に表示されるリンクをお渡しください。`
  line 3 `自社メンバー宛の招待・期限のお知らせは、お使いのアドレスに実際に届きます。それ以外は本番と同じ動作です`
  Under the box, one line of small gray annotation: `※ 本番環境ではこの帯は表示されない`.
- Header bar below the banner: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 取引先企業`, the screen title `取引先企業` as the single largest text, and exactly one primary button on the right of the title row: `[ 取引先を招待 ]`.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Environment banner, header and sidebar as in the shared prompt. Main content is a 2-column split: a list on the left (about 55 percent) and the detail of the selected company on the right (about 45 percent).

## Left column

### Section 1: `取引先一覧` — table, 9 body rows
Columns: `企業名` / `状態` / `アカウント数` / `公開中の案件数` / `提案数` / `最終アクティビティ`
- `△△テック / < 有効 > outline / 4 / 3 / 12 / 2026-08-31`  (this row is selected, shown with a filled left edge marker)
- `▲▲ソリューション / < 有効 > outline / 2 / 2 / 6 / 2026-08-30`
- `■■エンジニアリング / < 有効 > outline / 3 / 4 / 9 / 2026-08-28`
- `◆◆システムズ / < 有効 > outline / 1 / 1 / 2 / 2026-08-19`
- `●●テクノ / < 停止 > filled / 5 / 0 / 21 / 2026-06-04`
- plus 4 more rows of the same shape.

## Right column

### Section 2: `△△テック` detail — definition list
`企業名` `△△テック株式会社` / `状態` `< 有効 >` / `登録日` `2026-05-12` / `公開中の案件` `3 件` / `受け取った提案` `12 件` / `最終アクティビティ` `2026-08-31 09:41`

### Section 3: `配下アカウント` — table, 4 body rows
Columns `氏名` / `メール` / `ロール` / `2FA` / `最終ログイン` / `状態`. Example: `佐藤 健 / sato@partner-tech.example.jp / PARTNER_ADMIN / 設定済み / 2026-08-31 09:41 / < 有効 >`.

### Section 4: `招待の発行`
- `メールアドレス` ______________
- `ロール` a read-only value box showing `PARTNER_ADMIN`
- Button `[ 招待を作成 ]`
- Below the button, a bordered block titled `招待リンク（サンドボックス環境）`:
  a boxed link string `https://app.example.jp/invite/9f2b8c...` with a `[ コピー ]` affordance, and two wrapped lines of text: `サンドボックス環境では招待メールが送信されません。このリンクをお渡しください。`
  A small gray caption under the block: `※ 本番環境ではこのブロックは表示されない`

### Section 5: `招待の状態` — table, 4 body rows
Columns `メール` / `作成日` / `状態`. Statuses used: `< 送信中 > dashed`, `< 送信済み > outline`, `< 受諾済み > filled`, `< 送信失敗 > filled` — and the failed row carries an inline text link `[ リンクを手渡す ]`.

### Section 6: `取引先を停止する` (small block at the bottom)
- Text link `[ この取引先を停止する ]`
- A bordered confirmation dialog drawn beside it, labelled with a small gray caption `停止の確認`: `配下アカウントは提案の作成・送信・チャット投稿ができなくなります。データは削除されません。` with `[ 停止する ]` and `[ キャンセル ]`.

### One state strip at the very bottom with a small gray caption above it
- Caption `初回空`: `取引先が登録されていません。取引先を招待すると、案件を公開して提案を受け取れるようになります。` with `[ 取引先を招待 ]`
```

## 設計意図メモ（画像生成には使われない）

- この画面は `sandbox` を描いた数少ない画面。`F-007 AC-4` により取引先の招待メールが飛ばないため、リンクの手渡し導線が主経路になる。環境バナーの 3 点構成と同じ趣旨を、操作の隣に再掲した（§3.5 の箇条書き 2）。
- 招待は「送信しました」ではなく「送信を受け付けました」→ 状態列で確定させる（§4.2 `S-014`）。状態列に 4 値を並べた。
- 送信失敗行に「リンクを手渡す」を置くのは、`production` でも fallback として同じ手段を提供するため。
- `PARTNER_ADMIN` は自社 1 社の詳細にのみ到達し、他社は一覧にも件数にも現れない（`F-007 AC-1`）。本画像はホストの `ADMIN` 視点。
- 初回空に業務価値を 1 行添える（取引先が増えないテナントは中核価値に到達していない）。
- 関連 UC: UC-12（取引先の招待）。
