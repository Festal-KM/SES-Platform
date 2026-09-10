# S-007 エンジニアの登録・編集 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-007
- 画面名: エンジニアの登録・編集
- 平面: 主平面
- 対応機能 ID: F-008 / F-010
- 対応ステージ: ① 集める
- Tier: T3（デスクトップ主体。申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-007`（**改訂 8 = Issue #35 = A。`EngineerCareer`**）/ §7.1（設定は低密度）/ §10.1 / §10.3 の `S-007` 行 / §11-11 / `designer` 申し送り 14
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-007
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, helper text, a row that is pending deletion). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Text inputs: a Japanese label above a horizontal rule `______________`. Dropdowns `[ ラベル ▾ ]`. Buttons `[ ラベル ]`. Checkboxes `[ ]` / `[x]`.
- Validation messages are drawn as one line of plain text directly under the field they belong to.
- Lists of same-shaped records are drawn as tables: Japanese column headers, thin rules, tight rows. Never wrap a row in a card frame.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- This is a form screen: medium-low density, one item per row, but no large empty areas.
- Never draw a required-field asterisk, a warning color, or a caution icon anywhere in this wireframe.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 人材 ＞ 山田 太郎 ＞ 編集`, the screen title `人材の編集` as the single largest text, and exactly one primary button on the right of the title row: `[ 保存 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. The form occupies a single centred column of about 62 percent width, with a thin sticky section index on its right listing the six section names.

### Section 1: `基本`
- `氏名` ______________
- `所属区分` a read-only value box showing `自社` with a small gray line under it: `所属は認証情報から決まります。ここでは変更できません`
IMPORTANT: 所属区分 is a read-only value, not an editable field and not a dropdown.

### Section 2: `スキル`
- A search field `スキル辞書から検索` ______________ with a `[ 追加 ]` button
- A table of 4 rows with columns `スキル` / `経験年数` / `レベル` / `操作`:
  `Java / 8 / [ 上級 ▾ ] / [ 削除 ]`, `Spring / 6 / [ 上級 ▾ ] / [ 削除 ]`, `AWS / 4 / [ 中級 ▾ ] / [ 削除 ]`, `PostgreSQL / 5 / [ 中級 ▾ ] / [ 削除 ]`
- A bordered note strip under the table: `「Java8」は辞書にありません。新語候補として起票します。採用されるまで検索には使われません。`

### Section 3: `経験内容と従事期間` — the most important section of this wireframe
An editable table with EXACTLY five columns in this order: `期間` / `役割` / `業務内容` / `使用技術` / `操作`.
The table itself is the editor: every cell is an input edited in place. Do NOT draw a card frame around a row, and do NOT draw a modal dialog for editing a row.
Column widths: `期間` narrow, `役割` narrow, `業務内容` widest, `使用技術` medium, `操作` narrowest.

Row 1 (still running):
- `期間`: two small fields stacked — `開始年月` `2025-04`, and `終了年月` drawn EMPTY with the word `継続中` printed in its place; the checkbox `[x] 継続中` directly under them
- `役割`: a text field containing `バックエンド開発 / チームリード`
- `業務内容`: a multi-line text area drawn as two rules containing `保険基幹系のマイグレーション。API 設計とレビュー、メンバー 6 名の進捗管理`
- `使用技術`: the words `Java` `Spring Boot` `PostgreSQL` `AWS` listed inline, each followed by a small `×`, with a small `[ 辞書から追加 ]` control under them
- `操作`: `[ 削除 ]`

Row 2:
- `期間`: `2023-10` and `2025-03`, checkbox `[ ] 継続中`
- `役割`: `バックエンド開発`
- `業務内容`: `証券口座管理システムの機能追加。バッチ処理の性能改善`
- `使用技術`: `Java` `Oracle` `Jenkins`
- `操作`: `[ 削除 ]`

Row 3 (carries a validation message):
- `期間`: `2022-01` and `2021-09`, and directly under the 期間 cell ONE line of plain text: `終了年月は開始年月より後の年月を入力してください`
- `役割`: `Web アプリ開発`
- `業務内容`: `EC サイトの受注管理画面の開発と保守`
- `使用技術`: `Java` `Spring` `MySQL`
- `操作`: `[ 削除 ]`
IMPORTANT: draw this message as plain text only. No red, no warning color, no caution icon.

Row 4 (deleted but not yet saved — draw the whole row in light gray):
- `期間`: `2018-04` 〜 `2019-03`
- `役割`: `テスト担当`
- `業務内容`: `通信キャリアの回線管理システムの結合テスト`
- `使用技術`: `Java` `Excel マクロ`
- `操作`: the word `削除予定` and the text link `元に戻す` (no `[ 削除 ]` button in this row)

Directly under the table, left aligned: the text link `[ 行を追加 ]`.
Under that, three small gray helper lines, one per line, in this order:
1. `「Spring Boot 3」は辞書にありません。新語候補として起票します。採用されるまで検索には使われません。`
2. `編集中は入力した順のまま並びます。保存すると期間の降順に並べ替えます。`
3. `削除は保存時に確定します。保存後に元へ戻すことはできません。`

FORBIDDEN in this section — do not draw any of these:
- Any note saying this feature is not available yet, or will become available in a later release.
- Any text saying the section is required, and any asterisk, warning color, caution icon or badge.
- A dropdown for `役割` (it must be a free text field with no `▾`).
- A separate editing area for AI-extracted careers (extraction is run on another screen).

### Section 4: `稼働`
- `稼働状況` `[ 稼働中 ▾ ]`
- `稼働可能時期` a date field `2026-10-01` with a small calendar affordance

### Section 5: `条件`
- `単価レンジ` two numeric fields joined by a tilde with the unit `万円`
- `勤務地` `[ 東京都 ▾ ]`
- `リモート` radio `( ) 不可` `(o) 一部可` `( ) フルリモート可`
- `希望条件` a two-line text area drawn as two rules

### Section 6: `連絡先`
- `メールアドレス` ______________
- `電話番号` ______________
- One small gray line: `連絡先は必要最小限のみを保持します`

### Bottom action row (right aligned)
- `[ 保存 ]` primary, and the text link `キャンセル`.

### Three state strips drawn side by side across the very bottom of the image, each with a small gray caption above it
- Caption `新規登録で開いたとき（経験内容 0 行）`: a bordered strip headed `経験内容と従事期間`, containing the table header row with the five column names and NO body rows, one plain gray line `経験内容は登録されていません`, and the text link `[ 行を追加 ]`. The `[ 保存 ]` button drawn beside it is plain and fully enabled. No warning color, no caution icon, no asterisk, no placeholder empty row.
- Caption `未保存で離脱しようとしたとき`: a bordered dialog box containing `入力内容が保存されていません。このページを離れますか？` with `[ 離れる ]` and `[ 編集を続ける ]`, plus one gray line `経験内容の行の追加・削除も未保存の変更に含みます`
- Caption `保存に失敗したとき`: a bordered strip `保存できませんでした。入力内容は保持しています。` with `[ 再試行 ]`
```

## 設計意図メモ（画像生成には使われない）

- 改訂 8（Issue #35 = A）でセクション 3 を **4 列 + 操作列**（`期間` / `役割` / `業務内容` / `使用技術` / `操作`）に直した。旧プロンプトは 3 列で `使用技術` が欠けており、`F-029`（Phase 2 のスコアが使用技術を項目として読む）と `F-008 AC-6`（行単位の凍結）の前提を絵が満たしていなかった。
- 見出しを `人材の登録` から `人材の編集` に変えたのは、**新規フォームは経験内容 0 行で開く**（空行を初期表示しない）ためで、`新規登録` の見出しのまま 4 行埋まった絵を描くと本文と正面から矛盾する。0 行の姿は下部の状態ストリップで別に描いた。
- 0 行を**警告色・注意アイコン・必須マーク・保存抑止のいずれでも表現しない**（`F-008 AC-5`）。スキルシート 1 枚で回している既存データを壊さないための決定であり、絵の側で「未入力 = 欠陥」に見せると意図が反転する。
- `comingSoon` の注記帯を削除した。保存先が無い期間の暫定表示であり、`EngineerCareer` の新設で前提が消えた。残すと「入力できるのに、できないと書いてある」画面になる。
- 削除行を light gray + `削除予定` + `元に戻す` で描いたのは、**保存前に限り取り消せる / 保存後の復元は持たない**（監査ログの「削除」が確定した事実かどうかを読めなくしないため）を 1 枚で示すため。
- 並べ替えの規約（編集中は入力順、保存時に期間の降順）をヘルパー行に出した。入力の途中で行が飛ぶと打ち間違えるので、絵の側でも「今は動かない」ことを明示する。
- 関連 UC: UC-02（台帳整備）。Phase 2 の抽出結果の採否は `S-008` 側であり、本画面に別の編集経路を作らない。
