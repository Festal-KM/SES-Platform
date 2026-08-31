# S-026 契約詳細と署名依頼 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-026
- 画面名: 契約詳細と署名依頼
- 平面: 主平面
- 対応機能 ID: F-047 / F-048 / F-049 / F-020
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-026` / `U-05` / §6.5 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-026
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages one contract: its document versions, its quality-gate result, and a single e-signature request. A signature request is issued exactly once per contract; re-sending is only ever a deliberate human action. If the tenant has not connected its own e-signature account, the feature is presented as NOT CONNECTED with a route to connect it, never as an error or a broken screen.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets: `< 下書き >` outline, `< 送付中 >` dashed with an elapsed time, `< 送付失敗 >` filled, `< 先方確認中 >` outline, `< 締結済み >` filled.
- External service names are written as plain text such as `クラウドサイン`. Never draw a real logo or brand mark.
- Documents are empty rectangles with a diagonal cross and a Japanese caption.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 契約` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 契約 ＞ C-0311`, the screen title `個別契約 C-0311` as the single largest text, and exactly one primary button on the right of the title row: `[ 署名を依頼する ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 55 percent (versions), right about 45 percent (connection, signature, history).

### Section 1: `見出し` — a bordered band across the full width
`< 下書き >` outline ・ `相手方 富士アルファ商事` ・ `契約種別 個別契約` ・ `期間 2026-10-01 〜 2027-03-31` ・ `金額 70 万円 / 月` ・ `対象 A-0071 伊藤 修`

## Left column

### Section 2: `契約書の版` — table, 4 body rows
Columns: `版` / `生成方法` / `作成日` / `スキャン状態` / `ゲート結果` / `最新版` / `操作`
- `v3 / テンプレート差し込み / 2026-08-30 / < CLEAN > outline / PASS / 最新 / [ 閲覧 ]`
- `v2 / アップロード / 2026-08-24 / < CLEAN > outline / FAIL（2 件） / — / [ 閲覧 ]`
- `v1 / テンプレート差し込み / 2026-08-20 / < CLEAN > outline / PASS / — / [ 閲覧 ]`
- one more row of the same shape.
Buttons under the table: `[ テンプレートから生成 ]` and `[ アップロード ]`.
A bordered note strip: `差し込みに失敗した項目は空欄として残ります。推測で埋めません。` followed by a small list: `差し込めなかった項目: 契約管理番号 / 検収条件`.
A document preview beside the table: an empty rectangle with a diagonal cross labelled `個別契約_v3.pdf`.

## Right column

### Section 3: `電子署名の接続状態` — drawn in TWO stacked variants so both are visible in one image
Variant A, upper, with the small gray caption `接続済みのとき`:
a bordered strip reading `電子署名: クラウドサイン（御社アカウント）に接続済み`
Variant B, lower, with the small gray caption `未接続のとき`:
a bordered strip reading `電子署名サービスが接続されていません。接続すると、この画面から署名を依頼できます。` with `[ 電子署名サービスを接続する ]` and the gray line `この場合、契約は「下書き」のまま進みません`
A third, thinner strip below with the caption `接続が失効したとき`: `電子署名サービスとの接続が切れています。再接続してください。` with a single `[ 再接続する ]` link and nothing else.

### Section 4: `署名依頼`
Button `[ 署名を依頼する ]` and, drawn beside it, a confirmation dialog with the small gray caption `署名依頼の確認ステップ`:
Title `この内容で署名を依頼します`
Body list: `相手方: 富士アルファ商事` / `署名者: 大村 部長` / `版: v3` / `金額: 70 万円 / 月`
Buttons `[ 署名を依頼する ]` `[ キャンセル ]`
Under the button a gray line: `1 契約につき 1 リクエストです。押した直後は「送付を受け付けました」と表示され、自動での再送は行われません。`
Below that, a re-send block with the small gray caption `送付失敗からの再送`: `この契約書は先方に届いている可能性があります。届いていないことを確認してから再送してください。` with `[ 下書きに戻して再送する ]`.

### Section 5: `締結状態`
A small progress row of three labelled boxes joined by rules: `下書き` — `送付中` — `先方確認中` — `締結済み`, with the current position marked. A gray line: `Webhook を受信したあと API で再照会してから反映します`.

### Section 6: `履歴` — a compact timeline of 5 entries with timestamp, 主体 and event.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `ゲートが FAIL のとき`: `検査で不合格の項目があるため送付できません` with only `[ 該当箇所を修正する ]` and no send button at all.
- Caption `締結済みの契約を編集しようとしたとき`: `締結済みの契約は変更できません。訂正は新しい契約を作成してください。` with `[ 新しい契約を作成 ]`.
```

## 設計意図メモ（画像生成には使われない）

- 未接続を「壊れている」ではなく「未接続」として理由と接続導線で示す（`U-05` / `docs/03` 申し送り 1 / §6.5）。失効の再接続導線は理由を問わず 1 本に収束させる。
- 署名依頼は 1 契約 1 リクエスト（`BR-24` / `F-049 AC-1`）。押した瞬間に「送付済み」と出さず、自動リトライしない旨を明記する。
- 再送は `送付失敗` → `下書き` に戻したうえでの明示操作のみで、「届いている可能性があります」を必ず出す（`F-049 AC-3` / §7.6）。
- テンプレート差し込みで埋まらなかった項目は空欄として明示し、推測で埋めない（`F-048 AC-2`）。
- 締結済みの編集導線は存在しない（`F-047 AC-5`）。訂正は新規契約。
- 外部サービス名はテキストのみ。ロゴ・ブランドカラーを描かない。
- 関連 UC: UC-08（契約締結）/ UC-21（電子署名の接続）。
