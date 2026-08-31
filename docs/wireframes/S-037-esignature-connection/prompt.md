# S-037 電子署名サービスの接続 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-037
- 画面名: 電子署名サービスの接続
- 平面: 主平面
- 対応機能 ID: F-049 / F-047
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-037` / `U-05` / §6.5 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-037
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. On this screen a tenant connects the e-signature service it contracted for itself. The feature is optional: without it the product still manages contracts and generates documents, and the screen says so plainly rather than presenting the absence as an error. Credentials are masked after entry and can never be displayed again, not even to the vendor's own operators.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text inputs as a Japanese label above a rule `______________`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- External service names are written as plain Japanese text such as `クラウドサイン` or `DocuSign`. Never draw a real logo, brand mark or brand colour.
- Masked values are drawn as a row of bullet characters inside a thin box.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Settings density: one item per row, no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 電子署名`, the screen title `電子署名サービスの接続` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 78 percent width.

### Section 1: `接続状態` — a bordered band, the most prominent block on the page
Main line: `< 接続済み >` outline and the value `クラウドサイン（御社アカウント）`
Under it a definition list: `接続日` `2026-06-14` / `接続者` `山田 太一（管理者）` / `最終疎通確認` `2026-08-31 08:00（成功）`

### Section 2: `サービスの選択と資格情報`
- `サービス` `[ クラウドサイン ▾ ]` with the other options listed in plain text nearby: `DocuSign` / `GMO サイン`
- `クライアント ID` a thin box filled with bullet characters and the gray line `入力後は再表示できません`
- `クライアントシークレット` a thin box filled with bullet characters and the same gray line
- `[ 保存して接続する ]`
IMPORTANT: no plain-text credential is drawn anywhere on this screen, and there is no "表示する" toggle beside the masked fields.

### Section 3: `接続テスト`
`[ 接続テストを実行 ]` and a result line `疎通確認に成功しました（2026-08-31 08:00）`
A gray line: `接続テストでは署名依頼を送りません`

### Section 4: `この設定が影響する機能` — a bordered list of 2 rows
`契約書の署名依頼` / `締結状態の自動反映`
Followed by one line: `接続しない場合も、契約の管理と契約書の生成は利用できます。`

### Section 5: `接続解除`
Text link `[ 接続を解除する ]` and, drawn beside it, a confirmation dialog with the small gray caption `接続解除の確認ステップ`:
Title `解除すると、この組織から署名を依頼できなくなります`
Body: `送付中・先方確認中の契約 3 件は、外部サービス側では進行し続けます。`
Buttons `[ 解除する ]` `[ キャンセル ]`

### Three state strips at the bottom of the image, each with a small gray caption above it
- Caption `未接続`: `電子署名サービスが接続されていません。接続すると、契約書の署名依頼をこの画面から送れるようになります。接続しない場合も、契約の管理と契約書の生成は利用できます。` with `[ サービスを接続する ]`
- Caption `接続が失効したとき`: `接続が切れています。再接続してください。` with a SINGLE action `[ 再接続する ]` and nothing else
- Caption `接続テストに失敗したとき`: `資格情報が無効です` and `サービス側の障害の可能性があります` with `[ 再試行 ]`

### One gray line at the very bottom of the page
`運営者はこの画面の資格情報を復号して見ることはできません。代理閲覧中も表示されません。`
```

## 設計意図メモ（画像生成には使われない）

- BYO（テナントが自社契約を接続する方式）であることを画面の主体として描く（`U-05` / `docs/03` 申し送り 1）。
- 未接続は「できること」を明示して機能を隠さない（§4.8 `S-037` の空状態）。失効の再接続導線は理由を問わず 1 本に収束させる（§6.5）。
- 資格情報は入力後に伏せ字で再表示できない（`BR-25`）。平文の表示トグルを描かない。運営者にも開示しない旨を末尾に置いた。
- 接続解除の確認に「送付中・先方確認中の契約は外部サービス側で進行し続ける」を書く（§7.6 の摩擦表）。
- 接続テストは疎通のみで署名依頼を送らない。
- 外部サービス名はテキストのみ。ロゴ・ブランドカラーを描かない。
- 関連 UC: UC-21（外部連携の設定）/ UC-08（契約締結）。
