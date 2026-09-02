# S-036 送信ドメインの設定と検証 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-036
- 画面名: 送信ドメインの設定と検証
- 平面: 主平面
- 対応機能 ID: F-001 / F-022 / F-041
- 対応ステージ: −（設定）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-036` / `U-04` / §6.5 / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-036
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. Mail that reaches a client company must leave from the tenant's OWN verified domain, never from the vendor's. Until verification succeeds, the affected features are not merely broken: the screen states the reason and offers the route to fix it, and the send action does not exist. This screen is not an ordinary settings page — it is the FINAL STEP of onboarding (the chain is: the vendor provisions the tenant → the OWNER accepts the invite → the OWNER configures the organization → this screen). The destination the whole chain aims for is "able to send to client companies." This wireframe depicts the SANDBOX environment, where a shared domain is used and verification is not required yet.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, text inputs as a Japanese label above a rule `______________`. A copy affordance is a small square containing the word `コピー`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border for in-progress states.
- Monospaced-looking DNS values are drawn inside thin boxes.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Settings density: one item per row, no large empty areas.

Persistent UI on this screen:
- At the very top, full width, a bordered environment banner of 3 wrapped lines that must NOT be squeezed onto one line:
  line 1 `サンドボックス環境 — 取引先への提案・契約書・署名依頼、および取引先の担当者宛のメール（招待を含む）は送信されません。`
  line 2 `取引先の招待は、画面に表示されるリンクをお渡しください。`
  line 3 `自社メンバー宛の招待・期限のお知らせは、お使いのアドレスに実際に届きます。それ以外は本番と同じ動作です`
  Under the box, one line of small gray annotation: `※ 本番環境ではこの帯は表示されない`.
- Header bar below the banner: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 送信ドメイン`, the screen title `送信ドメインの設定と検証` as the single largest text.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Environment banner, header and sidebar as in the shared prompt. One centred column of about 78 percent width.

### Section 0: `オンボーディングの位置づけ` — a thin bordered strip above Section 1
`テナントの開設 → 招待の受諾 → 組織設定 → 本画面（送信ドメインの検証）` as a 4-step breadcrumb-like strip with the 4th step marked as the current one, and the line `到達点は「取引先へ送信できる状態」です。検証が終わるまで、S-035 と S-003 の最上部に「取引先へまだ 1 通も送れません」の帯が表示されます。`

### Section 1: `現在の状態` — a bordered band, the most prominent block on the page
Main line: `< 検証待ち >` filled, and the value `ses-example.co.jp`
Under it, a sandbox-specific bordered note wrapped over two lines: `サンドボックス環境では共通ドメインで動作するため、ドメインの検証は不要です。本契約への移行時に検証が必要になります。` with the text link `[ サンドボックスの状況を見る ]`.

### Section 2: `ドメインの登録`
`送信元ドメイン` ______________ showing `ses-example.co.jp` and the button `[ 登録する ]`.

### Section 3: `DNS レコードの提示` — table, 4 body rows
Columns: `種別` / `名前` / `値` / `コピー` / `確認結果`
- `TXT / ses-example.co.jp / v=spf1 include:mail.example.net ~all / [ コピー ] / 未確認`
- `CNAME / s1._domainkey.ses-example.co.jp / s1.dkim.mail.example.net / [ コピー ] / 未確認`
- `CNAME / s2._domainkey.ses-example.co.jp / s2.dkim.mail.example.net / [ コピー ] / 未確認`
- `TXT / _dmarc.ses-example.co.jp / v=DMARC1; p=none; rua=mailto:dmarc@ses-example.co.jp / [ コピー ] / 未確認`
Under the table, the button `[ 検証を実行 ]` and a progress strip with a dashed border: `検証しています（DNS の反映に数分〜数時間かかることがあります）` plus the gray line `完了は通知でお知らせします。この画面を離れても検証は続きます。`

### Section 4: `この設定が影響する機能` — a bordered list of 4 rows
`提案の送信（S-021）` / `面談調整の連絡（S-024）` / `取引先の招待（S-014）` / `契約書のメール添付での送付（S-026）`
Followed by one emphasised line: `これらは検証が完了するまで実行できません。`
Directly under that, TWO separate exclusion notes, each visually distinct from the affected-features list above (not part of the same bordered block):
- `自社メンバーの招待（S-035）は対象外です。共通ドメインで送信されるため、検証の完了を待たずに実行できます。` — with a small gray annotation `※ 取引先の招待（S-014）とは扱いが違います`
- `電子署名での契約書送付（S-037 接続時）も対象外です。メールを送るのは電子署名サービス側であり、前提条件は本画面の検証ではなく S-037 の接続です。` — with the text link `[ 電子署名サービスの接続を見る ]`

### Three state strips at the bottom of the image, each with a small gray caption above it
- Caption `未設定（初回）`: `取引先へメールを送るには、御社のドメインの検証が必要です。検証が完了するまで、提案の送信・面談調整の連絡・取引先の招待・契約書のメール添付での送付は実行できません（自社メンバーの招待と、電子署名での契約書の送付は実行できます）。` with `[ ドメインを登録する ]`
- Caption `検証が外れたとき`: `DNS レコードが確認できなくなりました。送信は停止しています。` with the four DNS rows repeated in compact form and `[ 検証を実行 ]`
- Caption `検証に失敗したとき`: `CNAME が見つかりません（s1._domainkey.ses-example.co.jp）` with `[ 再実行 ]`
```

## 設計意図メモ（画像生成には使われない）

- 未検証を「壊れている」ではなく「送信元ドメインが未設定」として理由と設定導線で示す（`U-04` / `BR-51` / §6.5）。送信ボタンを出して失敗させない（`BR-46`）— 顧客は商機を失ったことにすら気づけない。
- 🔴 本画面はオンボーディングの最終工程である（`F-001 AC-4` / §2.3）。`A-014`（運営者が開設）→ `S-002`（受諾）→ `S-035`（組織設定）→ 本画面の鎖を Section 0 に明示した。
- 「この設定が影響する機能」を 4 項目（提案の送信 / 面談調整 / 取引先の招待 / 契約書のメール添付での送付）で列挙し、検証完了まで実行できない旨を明記する（§4.8 `S-036`）。🔴 自社メンバーの招待（`F-002`）は対象外（`F-001 AC-5`）— 取引先の招待（`S-014`）とは扱いが違うことを画面上で書き分けた。🔴 電子署名での契約書送付（`F-049`）も対象外 — 前提条件は本画面の検証ではなく `S-037` の接続であり、「ドメイン未検証なら契約が 1 件も締結できない」とは読ませない。
- `sandbox` では検証が不要である一方、本契約移行時に必須になることを `S-043` への導線とセットで示す（`docs/03` §3.2.7-4）。
- DNS の反映は時間がかかるため、離脱可能であること・完了は通知で届くことを明記する。
- 検証が外れた状態は「送信は停止しています」と事実を先に書く。
- 関連 UC: UC-21（外部連携の設定）/ UC-05（提案送信の前提）。
