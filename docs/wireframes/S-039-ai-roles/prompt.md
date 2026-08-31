# S-039 AI 運用ロールの設定 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-039
- 画面名: AI 運用ロールの設定
- 平面: 主平面
- 対応機能 ID: F-035 / F-036
- 対応ステージ: 横断（Phase 2）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §8.1 / §8.2 / §8.3 / §8.4 / §9.2 / §4.8 `S-039`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-039
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen configures the AI helpers used inside the product: for each one, whether a human reviews its output every time, and which model it uses. Exactly FIVE helpers are configurable and the table has exactly FIVE rows.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, radio `( )` / `(o)`.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- Helpers are named by their BUSINESS name in Japanese. The internal identifier is written only as small gray text inside the model-setting cell.
- Never use a sparkle, lightning, brain, robot or any other metaphor icon anywhere on this screen. No icons on navigation, headings, buttons or badges.
- All visible text is Japanese. No photos, no logos.
- Settings density: one item per row, no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ AI 運用ロールの設定`, the screen title `AI 運用ロールの設定` as the single largest text.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: the configurable helpers are exactly these five and no others:
スキルシート読み取り担当 / スキル表記の統一担当 / 候補の根拠説明担当 / 提案文の下書き担当 / 延長判断の論点整理担当.
Draw exactly five rows. Do not add a sixth row, do not add a grayed-out or disabled row, do not add a row marked as 設定不可, and do not add any footnote, caption or explanatory sentence mentioning an inspection or gate helper. Nothing on this screen may suggest that a further helper exists.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One centred column of about 82 percent width with four stacked sections.

### Section 1: `承認モード` — table with EXACTLY 5 body rows
Columns: `担当` / `承認モード` / `現在確認待ち` / `最終変更`
1. `スキルシート読み取り担当 / (o) 都度承認  ( ) 自動承認 / 3 件 / 2026-06-02 山田`
2. `スキル表記の統一担当 / (o) 都度承認  ( ) 自動承認 / 12 件 / 2026-06-02 山田`
3. `候補の根拠説明担当 / ( ) 都度承認  (o) 自動承認 / 0 件 / 2026-07-19 山田`
4. `提案文の下書き担当 / (o) 都度承認  ( ) 自動承認 / 1 件 / 2026-06-02 山田`
5. `延長判断の論点整理担当 / ( ) 都度承認  (o) 自動承認 / 0 件 / 2026-08-05 田中`
Each row carries, in small gray text at its right edge, the words `テナント × このロール`.
Under the table one gray line: `既定はすべて「都度承認」です。`

### Section 2: `モデル設定` — table with EXACTLY the same 5 body rows in the same order
Columns: `担当` / `モデル` / `モデル変更のコスト影響`
1. `スキルシート読み取り担当（sheet-parser） / [ claude-sonnet-5 ▾ ] / 現行比 1.0 倍`
2. `スキル表記の統一担当（skill-normalizer） / [ claude-haiku-4-5 ▾ ] / 現行比 1.0 倍`
3. `候補の根拠説明担当（match-explainer） / [ claude-haiku-4-5 ▾ ] / Sonnet 5 にすると、この機能の変動費が約 2 倍になります`
4. `提案文の下書き担当（proposal-drafter） / [ claude-sonnet-5 ▾ ] / 現行比 1.0 倍`
5. `延長判断の論点整理担当（renewal-advisor） / [ claude-sonnet-5 ▾ ] / 現行比 1.0 倍`
The parenthesised internal identifiers are small gray text.

### Section 3: `提案の自動承認との違い` — a bordered cross-reference block
Two wrapped lines:
`提案の送信前の承認は別の設定です（組織設定 ＞ 承認ポリシー）。`
`この画面の設定を自動承認にしても、提案が人手なしに送信されることはありません。`
with the text link `[ 組織設定を開く ]`.

### Section 4: `変更履歴` — table, 6 body rows
Columns `変更日時` / `実施者` / `対象の担当` / `変更前` / `変更後`. Example: `2026-07-19 11:20 / 山田 / 候補の根拠説明担当 / 都度承認 / 自動承認`.

### Confirmation dialog drawn beside section 1 with the small gray caption `自動承認へ切り替えるときの確認ステップ`
Title `スキルシート読み取り担当を自動承認にします`
Body, wrapped: `読み取り結果が人の確認なしに台帳へ反映されます。誤りは後から修正できますが、反映された時点で検索の母集団に影響します。`
Buttons `[ 自動承認にする ]` `[ キャンセル ]`

### One state strip at the very bottom with a small gray caption above it
- Caption `変更履歴が無いとき`: `変更はまだありません`
```

## 設計意図メモ（画像生成には使われない）

- 🔴 `gate-inspector`（外部共有物の検査担当）の行を描かない。グレーアウトも「品質ゲートは常に実行されます」といった注記も置かない（§8.1 / `docs/03` 申し送り 11 / `F-035 AC-2` / `BR-19`）。設定項目の存在を示唆した時点で違反であり、ゲート迂回の期待を作る。プロンプトでは「5 行ちょうど」「6 行目・グレーアウト行・注記を足さない」と明示した。
- 承認モードとモデル設定を別セクションにし、粒度を「テナント × このロール」と行ごとに書く（§8.2）。
- `S-035` の `autoApproveEnabled` との違いを相互参照ブロックで説明する（`F-035 AC-6`）。同じブロックに置かない。
- モデル変更のコスト影響を表示する（`docs/03` 申し送り 5）。AI 原価の最大の調整弁であるため。
- 各行に「現在確認待ち N 件」を出し、設定を変える前に滞留量が分かるようにする（§8.4）。
- 業務画面では業務上の呼び名を使い、内部識別子は本画面のモデル設定行にのみ併記する（§9.2）。
- 関連 UC: UC-16（AI ロールの運用）。
