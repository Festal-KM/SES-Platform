# S-026 契約詳細と署名依頼 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-026
- 画面名: 契約詳細と署名依頼
- 平面: 主平面
- 対応機能 ID: F-047 / F-048 / F-049 / F-020
- 対応ステージ: ⑤ 契約（Phase 3）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.5 `S-026` / `U-04` / `U-05` / §5-1 / §5-3 / §6.5 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-026
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen manages one contract: its document versions, a mandatory three-layer quality gate (contracts carry the unit price and the end-client name, so this gate is not optional), and a single signature request. A signature request is issued exactly once per contract; re-sending is only ever a deliberate human action. E-signature is an OPTIONAL, tenant-connected feature (DocuSign, bring-your-own-account) — when it is not connected, the contract is still sent, as an e-mail attachment, and the screen must say so plainly rather than presenting the absence as an error.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets: `< 下書き >` outline, `< 送付中 >` dashed with an elapsed time, `< 送付失敗 >` filled, `< 先方確認中 >` outline, `< 締結済み >` filled.
- A gate layer that FAILED is a whole block with a heavy black border and a filled `< FAIL >` badge. A WARNING is one list item inside a PASSED block, prefixed by a small outlined box reading `警告`. The two never look the same.
- The external e-signature service name is written as plain text: `DocuSign`. Never draw a real logo or brand mark. Do not draw クラウドサイン or GMO サイン anywhere — DocuSign is the only connector and no service-selection control exists.
- Documents are empty rectangles with a diagonal cross and a Japanese caption.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑤ 契約` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 契約 ＞ C-0311`, the screen title `個別契約 C-0311` as the single largest text, and exactly one primary button on the right of the title row: `[ 契約書を送付する ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 52 percent (versions and gate), right about 48 percent (send method, signing, history).

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
A gray note under that: `ドラフト版は取引先の「自社が当事者の契約」画面に現れません。締結済みの最終版のみが相手に見えます。`
A document preview beside the table: an empty rectangle with a diagonal cross labelled `個別契約_v3.pdf`.

### Section 3: 🔴 `品質ゲートの結果（3 層）` — same visual treatment as S-021 / S-020, three separate blocks for the selected version (v3)
- `PII 層` `< PASS >` outline — `氏名・生年月日・連絡先・顔写真・現所属会社名の残存: 検出なし`
- `商流層` `< PASS >` outline — `契約書に単価・エンド企業名の記載範囲は、送付先である相手方の契約内容として妥当です`
- `整合層` `< PASS >` outline — containing ONE list item prefixed by a small outlined box reading `警告`: `警告: 契約管理番号が空欄です（テンプレート差し込みで埋まりませんでした。合否には影響しません）` with the text link `該当箇所へ`
Under the three blocks a gray line: `検査 2026-08-30 09:40 実行 / 3 層すべて PASS`
A bordered action strip drawn BELOW the three blocks but only described here (not stacked on the passing state): `検査で不合格の項目があるため送付できません。本文を修正して再検査してください。` with only `[ 該当箇所を修正する ]`, and no send button at all — labelled with the small gray caption `FAIL のとき`.
IMPORTANT: there is no "了解のうえ送付" button, no override checkbox and no "警告を無視して進む" control anywhere in this section.

## Right column

### Section 4: 🔴 `送付手段` — drawn in TWO stacked variants so both are visible in one image
Variant A, upper, with the small gray caption `接続済みのとき`:
a bordered strip reading `電子署名: DocuSign（御社アカウント「営業部 契約担当」/ 接続日 2026-09-01）で送付します` — the account name and connection date are shown so the sender identity can be confirmed before sending.
Variant B, lower, with the small gray caption `未接続のとき（既定）`:
a bordered strip reading `電子署名は未接続です。契約書はメール添付で送付します（送信元: @ses-example.co.jp）。電子署名を接続すると、この画面から署名を依頼できます。` with `[ 電子署名サービスを接続する ]`. There is NO wording anywhere suggesting the contract cannot proceed while unconnected — sending by e-mail attachment is the default path, not a degraded one.
A third, thinner strip below with the caption `接続が失効したとき`: `電子署名サービスとの接続が切れています。再接続するか、メール添付で送付してください。` with a single `[ 再接続する ]` link and nothing else.

### Section 5: `送付`
Button `[ 契約書を送付する ]` (primary, same button regardless of which send method Section 4 resolved to) and, drawn beside it, a confirmation dialog with the small gray caption `送付の確認ステップ`:
Title `この内容で送付します`
Body list: `相手方: 富士アルファ商事` / `署名者: 大村 部長` / `版: v3` / `金額: 70 万円 / 月` / `送付手段と送信元名義: DocuSign（営業部 契約担当）またはメール添付（@ses-example.co.jp）`
Buttons `[ 送付する ]` `[ キャンセル ]`
Under the button a gray line: `1 契約につき 1 リクエストです。押した直後は「送付を受け付けました」と表示され、自動での再送は行われません。`
Below that, a re-send block with the small gray caption `送付失敗からの再送`: `この契約書は先方に届いている可能性があります。届いていないことを確認してから再送してください。` with `[ 下書きに戻して再送する ]`.

### Section 6: `締結状態`
A small progress row of four labelled boxes joined by rules: `下書き` — `送付中` — `先方確認中` — `締結済み`, with the current position marked.
🔴 Directly under it, `先方確認中` のときだけ現れる **署名者ごとの進捗**（これは新しい状態ではなく「署名の状態」の内訳）: two rows in signing order (既定は自社 → 取引先) — `1. 御社（山田） < 署名済み > outline ・ 2026-08-31 14:02` / `2. 富士アルファ商事（大村部長） < 未署名 > dashed`. A gray line: `「自社署名済み・先方未署名」という新しい状態は作らず、この内訳で表現しています。Webhook を受信したあと API で再照会してから反映します。`

### Section 7: `履歴` — a compact timeline of 5 entries with timestamp, 主体 and event.

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `締結済みの契約を編集しようとしたとき`: `締結済みの契約は変更できません。訂正は新しい契約を作成してください。` with `[ 新しい契約を作成 ]`.
- Caption `送信元ドメインが未検証で、電子署名が未接続のとき（両方揃わないと送れない、唯一のケース）`: `メール添付で送付するには送信元ドメインの検証が必要です。電子署名を接続すれば、検証を待たずに送付できます。` with two routes side by side, `[ 送信ドメインを設定する ]` and `[ 電子署名を接続する ]`, and the gray line `送信元ドメインが未検証でも、電子署名が接続済みなら送付できます — 電子署名はテナントのメール送信基盤を通らないためです。`
- Caption `AI の日次コスト上限で品質ゲートが停止しているとき（F-027 AC-5）`: ONLY the PII 層 and 商流層 blocks are redrawn as `< 検査中 >` with a dashed border and an elapsed time — NOT orange, NOT `< FAIL >`. The 整合層 block is left exactly as its passing state (`< PASS >` outline, machine check already complete, its finding still shown) because the machine-only check already ran and is not held. Under the three blocks, a bordered strip: `AI が上限到達で停止しているため検査を実行できません（リセット: 本日 24:00）` and `[ 利用量と上限を見る ]`. No "修正して再実行" button is drawn. A small note: `整合層の機械照合の結果は確定して残ります。上限解除で PII 層・商流層が自動的に再実行されます。`
```

## 設計意図メモ（画像生成には使われない）

- 契約書は品質ゲートの対象である（2026-09-01、Issue #15。`BR-15`）。`S-021` と同じ層別の見せ方を流用し、承認者が画面をまたいで同じ読み方をできるようにした（§5-3）。
- 電子署名は BYO・DocuSign 一択（`U-05` / Issue #11）。サービス選択のドロップダウンや資格情報の入力フォームは存在せず、接続は `S-037` の 3 ステップで行う。接続済みのときはアカウント名と接続日時を示し、誰の名義で相手に届くかを送付前に確認できるようにした。
- 🔴 未接続は「機能が無い」ではなく「メール添付という代替手段がある」既定の状態として描いた（`F-049 AC-8` / `AC-9`）。旧版が「下書きのまま進みません」としていたのは誤りで、本改訂で修正した。
- 🔴 送信ドメイン未検証と電子署名未接続は独立したガードである（`U-04` / §2.3）。電子署名が接続済みなら送信ドメインの検証を待たずに送付できる。両方揃わない場合に限りメール添付の経路も塞がる状態を最後の state strip で描いた。
- 🔴 AI 日次コスト上限による停止は `GATE_FAILED`（橙）ではなく `GATE_RUNNING`（検査中）のまま保持する（`F-027 AC-5` / `CLAUDE.md` §4.2「失敗と保留を混同しない」）。「修正して再実行」を促さない — 直すべき元データが無い。**整合層は機械照合のみで完結し AI 停止の影響を受けないため、`GATE_RUNNING` の対象は PII 層・商流層の 2 層に限る**（2026-09-01 改訂: state strip の説明文と描画が食い違っていたのを修正し、整合層は PASS のまま保持するよう揃えた）。
- `UNDER_REVIEW`（先方確認中）の内側は新しい状態を作らず、署名者ごとの進捗として `ContractDocument` の情報で表現する（`docs/03` 申し送り 14 / `BR-33`）。
- 締結済みの編集導線は存在しない（`F-047 AC-5`）。訂正は新規契約。
- 外部サービス名はテキストのみ。ロゴ・ブランドカラーを描かない。
- 関連 UC: UC-08（契約締結）/ UC-21（電子署名の接続）/ UC-25（取引先ビューとの対比）。
