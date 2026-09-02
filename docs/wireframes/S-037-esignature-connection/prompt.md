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
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. On this screen a tenant connects the e-signature service it contracted for itself — DocuSign, the only connector this product offers, using a bring-your-own-account, Authorization Code Grant redirect flow. There is NO service picker and NO credential input form anywhere: the product never receives or stores a client ID, client secret or API key for this integration. The feature is optional: without it the product still manages contracts and generates documents, and the screen says so plainly rather than presenting the absence as an error.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`.
- Status badges `< ラベル >` in angle brackets: `< 未接続 >` outline, `< 接続済み >` filled, `< 接続が切れています >` filled.
- The 3-step connection flow is drawn as three numbered boxes joined by arrows, each box containing one short action, not a form.
- The external service name is written as plain Japanese/English text: `DocuSign`. Never draw a real logo, brand mark or brand colour. Never draw クラウドサイン, GMO サイン, or any other service name — there is no selection control of any kind on this screen.
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
Main line: `< 接続済み >` filled and the value `DocuSign / 営業部 契約担当`
Under it a definition list: `接続したアカウント` `営業部 契約担当（DocuSign）` / `接続日時` `2026-09-01 10:14` / `接続者` `山田 太一（管理者）` / `最終疎通確認` `2026-08-31 08:00（成功）`
A gray line: `誰の名義で相手に届くかは、この値と同じものが S-026（契約詳細）の送付手段にも表示されます。`

### Section 2: 🔴 `接続する（3 ステップ）` — three numbered boxes in a row joined by arrows, NOT a form
1. `① 「DocuSign に接続する」を押す` — button `[ DocuSign に接続する ]` below it
2. `② DocuSign の同意画面へ移動します（外部サイトに遷移します）` — a plain sentence, no visual mockup of DocuSign's own screen
3. `③ 同意すると、この画面に戻り接続が完了します`
Under the three boxes, a gray line: `資格情報（クライアント ID・シークレット・パスワード）はこの画面に入力しません。本プロダクトが受け取ることも保存することもありません。`
IMPORTANT: there is no text input field, no dropdown for choosing a service, and no `クライアント ID` / `クライアントシークレット` field anywhere in this image.

### Section 3: `接続テスト`
`[ 接続テストを実行 ]` and a result line `疎通確認に成功しました（2026-08-31 08:00）`
A gray line: `接続テストでは署名依頼を送りません`

### Section 4: `この設定が影響する機能と、未接続時の代替手段` — a bordered list of 2 rows
`契約書の署名依頼（S-026）` / `締結状態の自動反映`
Followed by one line: `接続しない場合、契約書はメール添付で送付されます。契約の管理と契約書の生成、⑤ 契約そのものの完了は、接続の有無にかかわらず利用できます。`

### Section 5: `接続解除`
Text link `[ 接続を解除する ]` and, drawn beside it, a confirmation dialog with the small gray caption `接続解除の確認ステップ`:
Title `解除すると、この組織から署名を依頼できなくなります`
Body: `契約書は引き続きメール添付で送付できます。送付中・先方確認中の契約 3 件は、DocuSign 側では進行し続けます。`
Buttons `[ 解除する ]` `[ キャンセル ]`

### Three state strips at the bottom of the image, each with a small gray caption above it
- Caption `未接続（既定）`: `電子署名は接続されていません。契約書はメール添付で送付できます（送信元: @ses-example.co.jp）。接続すると、この画面から御社名義で署名を依頼できます。` with `[ DocuSign に接続する ]` — the tone is informational, not an error state.
- Caption `接続が失効したとき`: `接続が切れています。再接続するか、メール添付で送付してください。` with a SINGLE action `[ 再接続する ]` and nothing else (the reason for the failure is not distinguished on screen).
- Caption `DocuSign の同意画面で拒否して戻ったとき`: `接続は完了していません` with `[ もう一度接続する ]` — the state is drawn clearly as NOT connected, never as a half-connected state.

### One gray line at the very bottom of the page
`運営者はこの画面の接続先アカウント名までは A-003（テナント詳細）で確認できますが、資格情報を復号して見ることはできません。代理閲覧中は接続・解除の導線が描画されず、その位置に理由テキストが表示されます。`
```

## 設計意図メモ（画像生成には使われない）

- 🔴 BYO（テナントが自社契約した DocuSign アカウントを接続する方式）を Authorization Code Grant のリダイレクトとして描いた（`U-05` / `docs/03` §3.1.2a）。入力欄を持たない画面であること自体が、資格情報を本プロダクトが受け取らないことの表現になる。
- 🔴 サービスの選択肢を置かない。DocuSign が唯一のコネクタであり、クラウドサインは第二候補として UI に出さない（`docs/03` §3.1.2）。「今後追加されます」とも書かない（`gate-inspector` と同じ原則。存在しない選択肢を示唆しない）。
- 未接続は「できること」を明示して機能を隠さない（§4.8 `S-037` の空状態）。契約書はメール添付で送付でき、⑤ 契約そのものは未接続でも完了する（`F-049 AC-8` / `AC-9`）。失効の再接続導線は理由を問わず 1 本に収束させる（§6.5）。
- 接続済みの表示にアカウント名と接続日時を出す — `S-026` の送付手段セクションと同じ値であり、誰の名義で相手に届くかを送付前に確認できる（`docs/03` 申し送り 1）。
- 資格情報は入力後に伏せ字で再表示できない（`BR-25`）。平文の表示トグルを描かない。運営者にも開示しない旨を末尾に置いた。
- 接続解除の確認に「送付中・先方確認中の契約は外部サービス側で進行し続ける」を書く（§7.6 の摩擦表）。
- 接続テストは疎通のみで署名依頼を送らない。
- 外部サービス名はテキストのみ。ロゴ・ブランドカラーを描かない。
- 関連 UC: UC-21（外部連携の設定）/ UC-08（契約締結）。
