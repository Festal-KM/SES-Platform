# A-001 運営者サインイン — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-001
- 画面名: 運営者サインイン（2FA 必須）
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-055
- 対応ステージ: −（`CLAUDE.md` §10.4 の前提）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-001` / §3.3 / §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-001
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin, is used only by the SaaS provider's own staff, and must look unmistakably different from the customer-facing app so that staff never confuse the two. Operator accounts live in a separate table with separate authentication from tenant users.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, text inputs as a Japanese label above a rule `______________`.
- All visible text is Japanese. No photos, no logos, no icons on headings or buttons.
- High information density is the norm in this console, but this particular screen is a sign-in form and therefore sparse by design.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top of the page reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band; this band is the primary at-a-glance distinction between the two planes.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = the operator identity, written with the role spelled out.
- Navigation in this console is a HORIZONTAL TAB STRIP directly beneath the header, never a left sidebar. The customer plane uses a left sidebar, so the operator console must not, and the two are never mistaken at a glance. (On this sign-in screen the tab strip is not drawn, because the operator is not authenticated yet.)
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. A light gray page with the black `運営者コンソール` band across the very top and, under it, a thin header row containing only the wordmark `SES Platform` on the left. There is NO tab strip and NO left sidebar on this screen.

The page holds two bordered panels side by side, each about one third of the width, centred vertically.

### Panel A (left): `ステップ 1 — サインイン`
- Small gray caption above the panel: `ステップ 1 / 2`
- `メールアドレス` ______________
- `パスワード` ______________
- Full-width primary button `[ サインイン ]`
- Text link `パスワードをお忘れの方`
- Under the button, a bordered error strip: `メールアドレスまたはパスワードが正しくありません`
- IMPORTANT: the error strip says nothing about whether the address belongs to a tenant user or to an operator. There is no sentence such as "テナント利用者の認証情報では利用できません" anywhere on this screen.

### Panel B (right): `ステップ 2 — 2 要素認証（必須）`
- Small gray caption above the panel: `ステップ 2 / 2`
- `認証コード（6 桁）` drawn as six separate small square boxes in a row
- Full-width primary button `[ 確認する ]`
- Text link `復旧コードを使う`
- A bordered sub-block titled `2 要素認証の初期設定（運営者は必須）` containing an empty rectangle with a diagonal cross labelled `QR コード`, a line `シークレット: ABCD-EFGH-IJKL`, and a two-column list of 8 recovery codes.
- One emphasised line under the sub-block: `設定が完了するまで、運営者コンソールのいずれの画面にも到達できません。`

### Footer strip (full width, small gray text, centred)
`SES Platform 運営者コンソール` / `このセッションは主平面のセッションと分離されています`
```

## 設計意図メモ（画像生成には使われない）

- 主平面と一目で区別するため、全幅の黒帯 `運営者コンソール` を最上部に置いた（§3.3-1）。色ではなく「帯という構造の有無」で区別する。
- 運営者は別テーブル・別認証（`BR-36`）。認証失敗の理由を区別せず、テナント利用者の認証情報では到達できない旨も書かない（存在の示唆を避ける）。
- 2FA 未設定ではいずれの画面にも到達させない（`F-055 AC-3`）ため、その旨を初期設定ブロックの直下に明記した。
- サインイン画面のためタブストリップは描かない。認証後の全画面では横並びタブが常時出る。
- モバイルでもサインインは完結する（T3 だが遮断しない）。画像は 1 枚。
- 関連 UC: UC-10（サポート対応の起点）。
