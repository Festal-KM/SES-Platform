# S-012 案件の登録・編集 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-012
- 画面名: 案件の登録・編集
- 平面: 主平面
- 対応機能 ID: F-013 / F-010
- 対応ステージ: ① 集める
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-012` / §7.1 / §10.1
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-012
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. On this screen a host sales user registers a project, splitting its requirements into mandatory and nice-to-have, and records commercial information that partners must never see.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, helper text). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Text inputs: a Japanese label above a horizontal rule `______________`. Dropdowns `[ ラベル ▾ ]`. Buttons `[ ラベル ]`. Radio `( )` / `(o)`.
- Status badges `< ラベル >` in angle brackets. Filled badge for `必須`, outline badge for `尚可`.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Form screen: medium density, one item per row, no large empty areas.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 案件` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 案件 ＞ 新規登録`, the screen title `案件の登録` as the single largest text, and exactly one primary button on the right of the title row: `[ 保存 ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. The form occupies a centred column of about 65 percent width with a thin section index on the right listing the six section names.

### Section 1: `基本`
- `案件名` ______________
- `募集人数` a small numeric field with the unit `名`
- `開始日` a date field `2026-10-01`
- `状態` `[ 募集中 ▾ ]`

### Section 2: `必須要件` — a bordered block, visually heavier than section 3
- A rows editor of 4 rows, each row: a drag affordance on the left, a FILLED badge `< 必須 >`, the skill name from the dictionary, an experience-years field, and `[ 尚可へ移動 ]` / `[ 削除 ]` text links.
  Rows: `Java / 5 年以上`, `Spring Framework / 3 年以上`, `REST API 設計の実務経験 / —`, `日本語での要件定義が可能 / —`
- A row at the bottom: `スキル辞書から追加` ______________ `[ 追加 ]`

### Section 3: `尚可要件` — a bordered block with a thinner border, clearly separated from section 2
- 3 rows, each with an OUTLINE badge `< 尚可 >`, plus `[ 必須へ移動 ]` / `[ 削除 ]` links.
  Rows: `AWS（ECS / Lambda）`, `金融ドメインの経験`, `テスト自動化の経験`

### Section 4: `条件`
- `単価レンジ` two numeric fields joined by a tilde, unit `万円`
- `勤務地` `[ 東京都 ▾ ]` and a free field `千代田区`
- `リモート可否` radio `( ) 不可` `(o) 一部可（週 2 日）` `( ) フルリモート可`
- `契約形態` `[ 準委任 ▾ ]`

### Section 5: `商流情報（社内用）` — a bordered block with a PERMANENT caption line at its top
Caption: `この情報は公開範囲の相手には表示されません`
- `エンド企業名` ______________
- `自社単価` a numeric field with the unit `万円`
- `商流` `[ 1 次 ▾ ]`

### Section 6: `外部公開用の記載`
- A text area drawn as five rules with the label `公開先に見せる案件概要`
- A gray note under the area: `エンド企業名・自社単価をここに書かないでください。公開の前に品質ゲートで検査されます。`

### Bottom action row (right aligned)
- Primary `[ 保存 ]`, secondary `[ 保存して公開範囲を設定 ]`, text link `キャンセル`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `必須要件が 0 件で保存しようとしたとき`: `必須要件がないと候補の足切りが効きません` with `[ このまま保存 ]` and `[ 要件を追加 ]`
- Caption `未保存で離脱しようとしたとき`: a bordered dialog `入力内容が保存されていません。このページを離れますか？` with `[ 離れる ]` `[ 編集を続ける ]`
```

## 設計意図メモ（画像生成には使われない）

- 必須／尚可を「見た目の重さが違う 2 ブロック」に分けたのは、この切り分けが `F-020` の整合層と `F-029` の足切りの根拠になるため（`F-013 AC-1`）。行の移動導線を両ブロックに置く。
- 商流情報ブロックには「公開範囲の相手には表示されません」を常時添える（`F-013 AC-2`）。入力の瞬間に境界を思い出させる。
- 外部公開用の記載には商流層の観点を注意書きで示すが、この画面では合否を判定しない（判定は `S-013` のゲート）。
- 必須要件 0 件でも保存は許す（後から埋める運用があるため）が、警告は出す。
- primary は 1 つ（§7.6）。「保存して公開範囲を設定」は secondary に落とす — 保存だけでは公開されないことを操作の並びで示す。
- 関連 UC: UC-04（案件登録 → 公開）。
