# S-040 マッチング重みの設定 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-040
- 画面名: マッチング重みの設定
- 平面: 主平面
- 対応機能 ID: F-030
- 対応ステージ: ② マッチング（Phase 2。Phase 1 にはこの画面が存在しない）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-040` / `U-02` / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-040
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen sets the weights used to score matching candidates. The weights are a statement of business priority, not a technical knob. One of the six items, the mandatory-requirement match, is also a hard cut-off, and lowering its weight never removes the cut-off.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`. A weight input is a small numeric field with a plain horizontal proportion bar beside it, drawn as a solid black segment inside a thin box.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Settings density: one item per row, no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ マッチング重み`, the screen title `マッチング重みの設定` as the single largest text, and exactly one primary button on the right of the title row: `[ 保存 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 70 percent width with three stacked sections.

### Section 1: `重み` — table with EXACTLY 6 body rows, values pre-filled (never empty)
Columns: `項目` / `重み` / `比率`
1. `必須要件の一致 / 45 / a proportion bar filled to about 45 percent`
2. `稼働開始日 / 15 / bar filled to about 15 percent`
3. `尚可要件 / 12 / bar filled to about 12 percent`
4. `勤務地・リモート可否 / 10 / bar filled to about 10 percent`
5. `単価の適合 / 10 / bar filled to about 10 percent`
6. `経験年数 / 8 / bar filled to about 8 percent`
Under the table, a total line: `合計 100` and beside it a gray line `合計が 100 でなくても保存できます（相対値として扱います）`.
A bordered note strip attached to row 1: `必須要件は足切りです。重みを 0 にしても足切りは無くなりません。`

### Section 2: `変更の影響`
Two wrapped lines inside a bordered block:
`変更は以後の算出に適用されます。`
`過去の提案に紐づく候補の順位と根拠は当時の値のまま残ります。`

### Section 3: `変更履歴` — table, 6 body rows
Columns `変更日時` / `実施者` / `項目` / `変更前` / `変更後`
Example rows: `2026-08-12 10:04 / 田中 / 稼働開始日 / 10 / 15`, `2026-08-12 10:04 / 田中 / 経験年数 / 12 / 8`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `合計が 100 でないとき`: `合計が 100 ではありません（現在 104）。相対値として扱われます。` with `[ このまま保存 ]`
- Caption `未保存で離脱しようとしたとき`: a dialog `入力内容が保存されていません。このページを離れますか？` with `[ 離れる ] [ 編集を続ける ]`
```

## 設計意図メモ（画像生成には使われない）

- 重みは事業上の優先順位の表明であり、テナントごとの設定値として外出しする（`CLAUDE.md` §8.6 / §9-9）。ハードコードしない前提を UI 側でも示す。
- 「必須要件は足切りであり、重みを 0 にしても足切りは無くならない」の注記を行に添える（§4.8 `S-040`）。
- 変更は以後の算出にのみ適用され、過去の提案に紐づく順位と根拠は当時の値のまま残る（`F-030 AC-3`）。
- 未設定でも既定値が入った状態にする（空にしない）。合計が 100 でなくても保存は許す。
- Phase 1 には本画面が存在せず、ナビにも設定の目次にも現れない（`F-030 AC-4`）。本画像は Phase 2 の状態。
- 関連 UC: UC-03（候補探索の順位）。
