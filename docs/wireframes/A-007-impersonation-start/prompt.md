# A-007 代理閲覧の開始 ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-007
- 画面名: 代理閲覧の開始（必須画面）
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-060
- 対応ステージ: −（`CLAUDE.md` §10.4-7）
- Tier: T3（申し送り 10 により 1 枚。申し送り 9 の優先度 6 位）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-007` / §5-8 / §6.10 / §7.1（ウィザードは最低密度）/ §11-6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-007
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen starts an impersonation session: the operator will look at the customer's own screens, read-only, for a limited time, with a recorded reason, and the customer's administrators are notified the moment it begins. Every one of those conditions is stated on the screen before the operator can start.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, radio `( )` / `(o)`, checkboxes `[ ]` / `[x]`, text areas as stacked horizontal rules with a Japanese label above.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- This is a wizard-style screen: the lowest information density in the console, one decision at a time, but every constraint spelled out in full.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `記録`, drawn filled black.
- A second, thinner row under the active tab: `監査ログ` / `代理閲覧の開始` (current, underlined) / `代理閲覧の記録`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `代理閲覧の開始` as the single largest text. Breadcrumb above it: `テナント ＞ 〇〇システム ＞ 代理閲覧の開始`.

The content is a single centred column of about 60 percent width, holding SEVEN numbered sections in this exact order, plus a smaller column on the right showing what the customer-facing screen looks like during impersonation.

## Main column

### 1. `対象テナント`
Definition list: `テナント名` `〇〇システム株式会社` / `プラン` `スタンダード` / `ライフサイクル状態` `< 契約中 >` outline
A gray line: `業務データの内容は表示していません`

### 2. `理由の入力（必須）`
A text area drawn as four horizontal rules with the label `代理閲覧を行う理由` carrying the word `必須`.
Directly under the area, a bordered note: `この理由は記録され、顧客から求められたら提示します。`
Under that, a gray example line: `例）2026-08-31 の問い合わせ #1042。提案 P-0142 が送信失敗のまま復旧できない件の調査`
A validation line in the same place when empty: `理由の入力は必須です`

### 3. `時間制限の選択`
Radio row: `(o) 15 分` `( ) 30 分` `( ) 60 分` with `既定は 15 分` in gray.
A bordered note: `時間が来ると自動的に終了します。延長はできません（再申請が必要です）。`

### 4. `代理閲覧中にできないこと` — a bordered block listing ELEVEN items, none omitted
`提案の送信・再送` / `承認・却下（自動承認の設定変更を含む）` / `契約書の送付・電子署名依頼` / `面談調整の連絡` / `業務データの作成・更新・削除` / `公開範囲の変更` / `匿名共有設定の変更` / `提案依頼の発行・取り下げ` / `スキルシートの閲覧・ダウンロード` / `一括エクスポート・解約時の返却` / `メンバーの招待・ロール変更`
Header line of the block: `代理閲覧中は閲覧のみです。次の操作は実行できません。`

### 5. `通知される旨`
A bordered note: `開始と同時に、対象組織の管理者に通知が届きます。`

### 6. `代理閲覧中も見えないもの` — a bordered block of four items
`スキルシートの原本と本文` / `エンジニアの氏名・生年月日・連絡先` / `チャットの本文` / `外部サービスの資格情報`

### 7. `開始の確認`
A checkbox `[ ] 上記を確認しました` and one primary button `[ 代理閲覧を開始する ]` drawn in a disabled gray state because the reason field is empty and the checkbox is unchecked.

## Right column: `代理閲覧中の主平面の見え方`
A smaller bordered mock of the customer-facing screen:
- At its very top a full-width impersonation banner: `代理閲覧中 — 対象: 〇〇システム / 実施者: 佐藤 / 残り 8 分 / 閲覧のみ` with `[ 終了して管理平面に戻る ]` pinned at the right edge.
- Under it, a compressed customer header and LEFT SIDEBAR (the customer plane keeps its sidebar), then the proposal approval screen with its judgement header and gate result.
- At the position where the action buttons would be, NO buttons are drawn at all; instead a single line of text reads `代理閲覧中のため、この操作は実行できません`.
- A small gray caption under the mock: `無効化されたボタンは置かず、空白にもしない`

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `同一テナントで既に代理閲覧中のとき`: `このテナントでは佐藤が代理閲覧中です（残り 8 分）` with no start button
- Caption `PURGED のテナントのとき`: `このテナントのデータは削除済みのため代理閲覧できません`
- Caption `残り 2 分を切ったとき`: the impersonation banner redrawn with a heavier border reading `代理閲覧中 — 残り 1 分 50 秒 / 閲覧のみ`
```

## 設計意図メモ（画像生成には使われない）

- 7 セクションの順序を変えない（§4.9 `A-007`）。1 つでも欠けたら開始できない（`BR-38` / §6.10）。
- セクション 4 は `docs/02` 章 4.5 の全 11 項目を漏れなく列挙する。1 つでも欠けるとサポート担当が「できるはず」と考えて操作を試みる。
- 代理閲覧中の主平面は「ボタンを描画せず、その位置に理由テキストを置く」（`U-10` / §11-6）。無効化されたボタンも空白も採らない。この判断は絵で見せないと伝わらないため、右カラムに主平面のモックを併置した。
- 代理閲覧では主平面のレイアウトをそのまま使う（サポート担当が見るのは顧客が見ている画面でなければ意味がない）。したがってモック側には左サイドバーが残る。管理平面の横並びタブとは構造が違う。
- 理由未入力では開始ボタンが有効にならない。既定の時間制限は 15 分で、延長はできない（`F-060 AC-2`）。
- 関連 UC: UC-10（サポート対応の最終手段）。
