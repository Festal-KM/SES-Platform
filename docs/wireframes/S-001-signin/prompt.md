# S-001 サインインと 2 要素認証 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-001
- 画面名: サインインと 2 要素認証
- 平面: 主平面
- 対応機能 ID: F-003
- 対応ステージ: −（認証。業務ループの外側）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.1 `S-001` / §3.5 / §10.1
- 生成する画像:
  - `desktop.png` — デスクトップ標準ビュー
  - `tablet.png` — タブレット（Tier 1 のため 3 デバイス分。申し送り 10）
  - `mobile.png` — モバイル 1 カラム

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-001
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: (1) collect engineers and projects, (2) matching, (3) proposal with a quality gate and human approval, (4) interview and decision, (5) contract, (6) assignment and post-assignment follow-up feeding back into (1). A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from ever seeing another partner's data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholder text, secondary notes, disabled elements). No other colors.
- Sharp-cornered rectangles for every block. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons: `[ ラベル ]` in square brackets, text only, no icons.
- Text inputs: a Japanese label above a horizontal rule `______________`.
- Dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`, radio `( )` / `(o)`.
- Status badges: `< ラベル >` in angle brackets.
- All visible text is Japanese.
- No photos, no logos, no decorative graphics, no colors, no icons on buttons or headings.
- Realistic information density. This is an operational tool, not a landing page.

Screen-specific persistent elements:
- This screen has NO header navigation and NO sidebar (the user is not authenticated yet).
- At the very top, full width, a bordered environment banner box of 3 wrapped lines (it must NOT be squeezed onto one line):
  line 1 `サンドボックス環境 — 取引先への提案・契約書・署名依頼、および取引先の担当者宛のメール（招待を含む）は送信されません。`
  line 2 `取引先の招待は、画面に表示されるリンクをお渡しください。`
  line 3 `自社メンバー宛の招待・期限のお知らせは、お使いのアドレスに実際に届きます。それ以外は本番と同じ動作です`
  Directly under the box, one line of small gray annotation text: `※ 本番環境ではこの帯は表示されない`.
- The wordmark `SES Platform` appears exactly once, above the sign-in panel. It is the only place in the product where the product name is written.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. The environment banner from the shared prompt spans the full width at the top. Below it, a wide light-gray page area containing two bordered panels side by side, each about one third of the width, with a centered wordmark `SES Platform` above the left panel.

### Panel A (left): `ステップ 1 — サインイン`
- Caption above the panel border, small gray: `ステップ 1 / 2`
- Fields, stacked, each a Japanese label over a rule:
  - `メールアドレス` ______________
  - `パスワード` ______________
- Primary button, full panel width: `[ サインイン ]`
- Text link below, left aligned: `パスワードをお忘れの方`
- IMPORTANT: the panel contains exactly these two input fields. There is no organization selector, no tenant selector, no "所属を選ぶ" dropdown of any kind.
- Under the button, a bordered error strip (light gray fill) with the text: `メールアドレスまたはパスワードが正しくありません`

### Panel B (right): `ステップ 2 — 2 要素認証`
- Caption above the panel border, small gray: `ステップ 2 / 2`
- Label `認証コード（6 桁）` above six separate small square boxes in a row, each holding one digit placeholder.
- Small gray note: `認証アプリに表示されている 6 桁を入力してください`
- Primary button, full panel width: `[ 確認する ]`
- Text link: `復旧コードを使う`
- A bordered sub-block titled `2 要素認証の初期設定（OWNER / ADMIN は必須）` containing: an empty rectangle with a diagonal cross labelled `QR コード`, a line `シークレット: ABCD-EFGH-IJKL`, and a 2-column list of 8 recovery codes labelled `復旧コード（1 回ずつ使用できます）`.

### Footer strip (full width, small gray text, centered)
- `SES Platform` / `利用規約` / `プライバシーポリシー`
```

## tablet.png プロンプト

```
Layout: tablet landscape view, narrower than desktop. Single column, centered, maximum width about two thirds of the screen.

Order from top:
1. Environment banner, full width, still 3 wrapped lines with the gray annotation line underneath.
2. Wordmark `SES Platform`, centered.
3. Panel `ステップ 1 — サインイン` with `メールアドレス`, `パスワード`, `[ サインイン ]`, `パスワードをお忘れの方`. No organization or tenant selector.
4. Panel `ステップ 2 — 2 要素認証` directly below (not side by side): `認証コード（6 桁）` as six square boxes, `[ 確認する ]`, `復旧コードを使う`.
5. Collapsed bordered strip titled `2 要素認証の初期設定（OWNER / ADMIN は必須）` with an expand affordance on the right.
6. Footer line: `SES Platform` / `利用規約` / `プライバシーポリシー`.

IMPORTANT: this is not a shrunken desktop; the two panels are stacked vertically at full column width, not squeezed side by side.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks.

Order from top:
1. Environment banner pinned at the very top, full width. It wraps onto 6-7 short lines so the whole sentence is readable; it is NOT truncated with an ellipsis and NOT collapsed behind a "詳細" toggle. The small gray annotation `※ 本番環境ではこの帯は表示されない` sits under it.
2. Wordmark `SES Platform`, centered.
3. Heading `サインイン`.
4. `メールアドレス` ______________ (full width)
5. `パスワード` ______________ (full width)
6. Full-width primary button `[ サインイン ]`.
7. Text link `パスワードをお忘れの方`.
8. Divider rule, then heading `2 要素認証`.
9. `認証コード（6 桁）` shown as six square boxes in one row across the full width, with the small gray note `数字キーボードが開きます`.
10. Full-width primary button `[ 確認する ]` and the text link `復旧コードを使う`.
11. Footer line, small gray: `SES Platform`.

IMPORTANT: nothing is omitted compared with the desktop view; the screen is fully usable on mobile.
```

## 設計意図メモ（画像生成には使われない）

- テナント選択 UI を描かないことがこの画面の最大の設計意図（`BR-03` / `docs/04` §4.1）。「画面に選択肢がある時点で、入力で境界が切り替わる設計に見える」ため、プロンプトでは肯定形（入力欄はメールとパスワードの 2 つだけ）で指定した。
- 2 段階目を別パネルとして 1 枚に描いたのは、`F-003 AC-2` の 2FA 必須（`OWNER` / `ADMIN`）と初期設定ウィザードの存在を 1 枚で読み取れるようにするため。
- 認証失敗の文言を「メールアドレスまたはパスワードが正しくありません」に固定したのは、存在の区別をしない要件（`docs/04` §4.1 操作と結果）。
- 環境バナーは `sandbox` の 3 点構成を折り返して全文描く（申し送り 7 / `U-07`）。「メールは一切送信されません」とも「すべてのメールが届きます」とも書かない。
- 関連 UC: 全 UC の入口。管理平面の `A-001` とは別ルート・別セッション。
