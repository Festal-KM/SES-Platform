# S-046 パスワード再設定 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-046
- 画面名: パスワード再設定
- 平面: 主平面
- 対応機能 ID: F-003
- 対応ステージ: −（認証。業務ループの外側）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.1 `S-046`（改訂 5 で新設）/ §10.1 主平面の状態設計マトリクス `S-046` 行 / §1.1 画面一覧
- 生成する画像:
  - `desktop.png` — デスクトップ標準ビュー
  - `tablet.png` — タブレット（Tier 1 のため 3 デバイス分。`S-001` / `S-002` と同じ扱い）
  - `mobile.png` — モバイル 1 カラム

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-046
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: (1) collect engineers and projects, (2) matching, (3) proposal with a quality gate and human approval, (4) interview and decision, (5) contract, (6) assignment and post-assignment follow-up feeding back into (1). A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from ever seeing another partner's data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholder text, secondary notes, disabled elements). No other colors.
- Sharp-cornered rectangles for every block. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 2 heading levels.
- Buttons: `[ ラベル ]` in square brackets, text only, no icons.
- Text inputs: a Japanese label above a horizontal rule `______________`.
- Status badges: `< ラベル >` in angle brackets.
- Status/state strips: a bordered box with a small gray caption line above it naming the situation it depicts.
- 🔴 Submitting-state convention (applies to every primary button on this screen): while a request is in flight, the button's label text is replaced with `< 送信中 >` inside a dashed border, and the button is drawn as disabled (non-interactive) so a second click cannot be made until the response returns. This is the same two-double-submit-prevention convention used on `S-021` / `S-022` / `S-036`.
- All visible text is Japanese.
- No photos, no logos, no decorative graphics, no colors, no icons on buttons or headings.
- This is an unauthenticated utility screen: low information density, one decision per panel.

Screen-specific persistent elements:
- No header navigation and no sidebar (the user is not authenticated).
- The wordmark `SES Platform` appears exactly once, centered above the content. It is the only place the product name is written.
- No environment banner in this wireframe (it depicts the production environment, same convention as `S-002`).
- This screen bundles three distinct states of the same flow into one image, the same way `S-001` shows two authentication steps side by side and `S-002` appends edge-case strips at the bottom: (A) the request form where a user types an email address, (B) the confirm form reached from the emailed link where a user sets a new password, and (C) the invalid/expired-link case as a bottom strip. Never draw a tenant or organization selector anywhere on this screen.
- 🔴 Whatever is drawn for the post-submit confirmation must be the exact fixed sentence `ご登録のメールアドレス宛に、パスワード再設定のご案内をお送りしました`, with no wording that reveals whether the account exists. Do not draw any variant of this message that differs by success/failure of the lookup.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. A light-gray page background with two bordered panels side by side, each about two fifths of the width, with the centered wordmark `SES Platform` above them.

### Panel A (left): `① パスワード再設定の依頼`
- Caption above the panel border, small gray: `メールアドレス入力（未認証）`
- Field: `メールアドレス` ______________
- Primary button, full panel width: `[ パスワード再設定メールを送信 ]`
- 🔴 IMPORTANT: while this request is submitting, the button above is redrawn with its label replaced by `< 送信中 >` inside a dashed border and shown disabled — it cannot be clicked a second time until the request resolves (二重送信防止). Draw this submitting-state button as a small labelled inset next to the panel, captioned `送信中のとき`, so both the normal and submitting states are visible in the same image.
- Text link below, left aligned: `サインイン画面に戻る`
- IMPORTANT: the panel contains exactly this one input field. No password field, no tenant/organization selector anywhere in this panel.
- Below a thin divider rule inside the same panel, a sub-block captioned in small gray `② 送信後に表示される内容` containing a bordered strip with the fixed sentence: `ご登録のメールアドレス宛に、パスワード再設定のご案内をお送りしました`. Add a small gray note under the strip: `登録の有無にかかわらず、常にこの表示になります`.

### Panel B (right): `③ 新しいパスワードの設定`
- Caption above the panel border, small gray: `メール内のリンクから遷移（トークン検証済み）`
- Fields, stacked:
  - `新しいパスワード` ______________
  - `新しいパスワード（確認）` ______________
- Small gray rule text directly under the fields: `12 文字以上でご入力ください`
- Primary button, full panel width: `[ パスワードを更新する ]`
- 🔴 IMPORTANT: while this request is submitting, the button above is redrawn with its label replaced by `< 送信中 >` inside a dashed border and shown disabled — it cannot be clicked a second time until the request resolves (二重送信防止, same rule as Panel A). Draw this submitting-state button as a small labelled inset next to the panel, captioned `送信中のとき`, so both the normal and submitting states are visible in the same image.
- Small gray line below the button: `更新後は新しいパスワードでサインインしてください`

### Bottom strip, full width, spanning under both panels
- Caption, small gray: `リンクが無効・期限切れのとき（③ を開いた場合）`
- Bordered strip text: `このリンクは無効か、有効期限が切れています`
- Below it, a secondary button: `[ 再設定をやり直す ]`
- A second bordered strip directly below, captioned `接続エラーのとき（① ③ いずれの送信でも共通）`: `接続できませんでした。時間をおいて再度お試しください`

### Footer strip (full width, small gray text, centered)
- `SES Platform` / `利用規約` / `プライバシーポリシー`
```

## tablet.png プロンプト

```
Layout: tablet landscape view, narrower than desktop. Single centered column, maximum width about two thirds of the screen. Same content and order as desktop, but the two panels are stacked vertically at full column width instead of side by side.

Order from top:
1. Wordmark `SES Platform`, centered.
2. Panel `① パスワード再設定の依頼` with `メールアドレス` ______________, `[ パスワード再設定メールを送信 ]`, `サインイン画面に戻る`. 🔴 Beside the button, a small labelled inset captioned `送信中のとき` shows the same button redrawn with its label replaced by `< 送信中 >` inside a dashed border and disabled (二重送信防止).
3. Inside the same panel below a divider, the sub-block `② 送信後に表示される内容` with the fixed bordered sentence `ご登録のメールアドレス宛に、パスワード再設定のご案内をお送りしました` and the small gray note `登録の有無にかかわらず、常にこの表示になります`.
4. Panel `③ 新しいパスワードの設定` directly below (not side by side) with `新しいパスワード` ______________, `新しいパスワード（確認）` ______________, the hint `12 文字以上でご入力ください`, and `[ パスワードを更新する ]`. 🔴 Beside that button, the same `送信中のとき` inset convention applies — the label becomes `< 送信中 >` inside a dashed border and disabled (同じ二重送信防止の規律).
5. Bottom strip `リンクが無効・期限切れのとき（③ を開いた場合）`: `このリンクは無効か、有効期限が切れています` + `[ 再設定をやり直す ]`.
6. Bottom strip `接続エラーのとき`: `接続できませんでした。時間をおいて再度お試しください`.
7. Footer line: `SES Platform` / `利用規約` / `プライバシーポリシー`.

IMPORTANT: this is not a shrunken desktop; the two panels are stacked vertically at full column width, and nothing is omitted compared with the desktop view.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks. Nothing is omitted compared with the desktop view; the screen is fully usable on mobile.

Order from top:
1. Wordmark `SES Platform`, centered.
2. Heading `パスワード再設定`.
3. Sub-heading `① メールアドレスを入力`.
4. `メールアドレス` ______________ (full width).
5. Full-width primary button `[ パスワード再設定メールを送信 ]`. 🔴 Directly under it, a small labelled inset captioned `送信中のとき` shows the same button redrawn with its label replaced by `< 送信中 >` inside a dashed border and disabled (二重送信防止).
6. Text link `サインイン画面に戻る`.
7. Divider rule, then sub-heading `② 送信後に表示される内容`, followed by a bordered strip with the fixed sentence `ご登録のメールアドレス宛に、パスワード再設定のご案内をお送りしました` and a small gray note `登録の有無にかかわらず、常にこの表示になります`.
8. Divider rule, then sub-heading `③ 新しいパスワードの設定（メール内リンクから遷移）`.
9. `新しいパスワード` ______________ (full width).
10. `新しいパスワード（確認）` ______________ (full width).
11. Small gray hint: `12 文字以上でご入力ください`.
12. Full-width primary button `[ パスワードを更新する ]`. 🔴 Directly under it, the same `送信中のとき` inset convention applies — the label becomes `< 送信中 >` inside a dashed border and disabled (同じ二重送信防止の規律).
13. Divider rule, then bordered strip captioned `リンクが無効・期限切れのとき`: `このリンクは無効か、有効期限が切れています`, followed by a full-width secondary button `[ 再設定をやり直す ]`.
14. Bordered strip captioned `接続エラーのとき`: `接続できませんでした。時間をおいて再度お試しください`.
15. Footer line, small gray: `SES Platform`.

IMPORTANT: the numbered eyebrow labels (①②③) stay visible on mobile so the reader can tell which state each block belongs to; nothing is hidden behind a collapsed toggle.
```

## 設計意図メモ（画像生成には使われない）

- `docs/04` 改訂 5（Issue #30 既定値②。`CLAUDE.md` §8.7 — `S-001` の「パスワードをお忘れですか」リンクの遷移先が未採番だった欠落を埋める新設画面）に基づく。関連機能は `F-002`（招待）ではなく `F-003`（認証・2FA）である点を画面情報に明記した。
- 3 状態（①メール入力 ②送信完了 ③新パスワード設定）を 1 枚の desktop 画像に収める構成は、`S-001` の「認証の 2 段階を左右パネルで併記する」流儀と `S-002` の「エッジケースを下部の状態ストリップで併記する」流儀を組み合わせた。新規の UI 要素（ステップインジケータ等）は追加していない。
- ②の完了文言はアカウントの存在有無を問わず常に同一固定文とすることが `docs/04` §4.1 の最重要要件（総当たり推測の防止）。プロンプト内で「常にこの表示になります」の注記を添え、成功・失敗で文言が分岐する絵を描かせないよう明示的に禁止した。
- ③の無効・期限切れトークンの専用文言と①への再申請導線は `docs/04` §10.1 `S-046` 行の Err 列と本文表の記述をそのまま起こした。
- 環境バナーは描かない（`docs/wireframes/README.md` の環境バナー対象 6 画面に `S-046` は含まれない）。ワードマークは 1 箇所のみ、`S-001`/`S-002` と同じ規律。
- 12 文字以上ヒントは `docs/04` が「暫定値。Issue #30 ①」と明記する値をそのまま採用。将来値が変わった場合は本 `prompt.md` の該当行のみ差し替えればよい。
- 関連 UC: `S-001`（サインイン）からの「パスワードをお忘れの方」リンクの遷移先。完了後は再度 `S-001` へ戻る（UC-01 の周辺フロー）。
- **design-reviewer 1 回目の指摘対応（REQUEST_CHANGES）**: `docs/04:2150` の 🔴「送信中はボタンを送信中表示に置換（二重送信防止。①②③ いずれの送信も同じ規律）」が初版に未反映だったため、`S-021` / `S-022` / `S-036` の `< 送信中 >` ダッシュ枠バッジの描画慣行に倣い、desktop / tablet / mobile の 3 バリアントすべてで①のメール送信ボタンと③のパスワード更新ボタンそれぞれに「送信中のとき」インセットを追加した。あわせて `docs/wireframes/README.md` の主平面画面数・Tier 1 一覧と枚数（45→46 画面、Tier 1 13→14 画面、85→88 枚）を `S-046` を含む形に更新した。
