# S-007 エンジニアの登録・編集 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-007
- 画面名: エンジニアの登録・編集
- 平面: 主平面
- 対応機能 ID: F-008 / F-010
- 対応ステージ: ① 集める
- Tier: T3（デスクトップ主体。申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-007` / §7.1（設定は低密度）/ §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-007
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, helper text). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Text inputs: a Japanese label above a horizontal rule `______________`. Dropdowns `[ ラベル ▾ ]`. Buttons `[ ラベル ]`. Checkboxes `[ ]` / `[x]`.
- Validation messages are drawn as one line of text directly under the field they belong to.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- This is a form screen: medium-low density, one item per row, but no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 人材 ＞ 新規登録`, the screen title `人材の登録` as the single largest text, and exactly one primary button on the right of the title row: `[ 保存 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. The form occupies a single centred column of about 60 percent width, with a thin sticky section index on its right listing the six section names.

### Section 1: `基本`
- `氏名` ______________
- `所属区分` a read-only value box showing `自社` with a small gray line under it: `所属は認証情報から決まります。ここでは変更できません`
IMPORTANT: 所属区分 is a read-only value, not an editable field and not a dropdown.

### Section 2: `スキル`
- A search field `スキル辞書から検索` ______________ with a `[ 追加 ]` button
- A table of 4 rows with columns `スキル` / `経験年数` / `レベル` / `操作`:
  `Java / 8 / [ 上級 ▾ ] / [ 削除 ]`, `Spring / 6 / [ 上級 ▾ ] / [ 削除 ]`, `AWS / 4 / [ 中級 ▾ ] / [ 削除 ]`, `PostgreSQL / 5 / [ 中級 ▾ ] / [ 削除 ]`
- A bordered note strip under the table: `「Java8」は辞書にありません。新語候補として起票します。採用されるまで検索には使われません。`

### Section 3: `経験内容と従事期間`
- A table of 3 rows with columns `期間` / `業務内容` / `役割` / `操作`, each row containing rules for input, plus a `[ 行を追加 ]` text link.

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

### Two state strips drawn at the very bottom of the image, each with a small gray caption above it
- Caption `未保存で離脱しようとしたとき`: a bordered dialog box containing `入力内容が保存されていません。このページを離れますか？` with `[ 離れる ]` and `[ 編集を続ける ]`
- Caption `保存に失敗したとき`: a bordered strip `保存できませんでした。入力内容は保持しています。` with `[ 再試行 ]`
```

## 設計意図メモ（画像生成には使われない）

- 所属パートナーを入力欄にせず読み取り専用にしたのは `F-008 AC-2`（入力できると境界が入力で決まることになる）。プロンプトでも「編集不可の値」であることを明示した。
- 辞書に無い語は受け付けたうえで「採用されるまで検索に使われない」旨を出す（`F-010 AC-1`）。勝手に辞書を増やさない。
- `BR-52` の範囲外（本籍・家族構成・健康情報・信条）は入力欄としても持たないため、フォームに項目自体を描いていない。
- 未保存離脱の確認と保存失敗時の値保持は §10.1 の該当列。バリアント画像を増やさず 1 枚の下部に状態ストリップとして描いた。
- T3 だがモバイルでは 3 ステップフォームに劣化させる（遮断しない）。画像は 1 枚。
- 関連 UC: UC-02（台帳整備）。
