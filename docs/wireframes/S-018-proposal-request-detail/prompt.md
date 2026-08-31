# S-018 提案依頼の詳細と応諾・辞退（取引先） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-018
- 画面名: 提案依頼の詳細と応諾・辞退（取引先）
- 平面: 主平面（`PARTNER_ADMIN` / `PARTNER_SALES` 専用）
- 対応機能 ID: F-018 / F-019
- 対応ステージ: ②③
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.3 `S-018` / §7.3（最も強調するのは返答期限）/ §7.6
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-018
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen belongs to a PARTNER company user. It is where the partner exercises two freedoms: the freedom to decline a request, and the freedom not to disclose why. Accepting is irreversible: it reveals the engineer's real name, the partner company name and the skill sheet to the host.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, text areas drawn as stacked horizontal rules with a Japanese label above.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border.
- Definition lists for the attributes of one record.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense enough to carry the whole decision; nothing that matters is folded away.
- The single most strongly emphasised value on the page is the remaining time until the reply deadline.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then a two-level scope display on two lines `〇〇システム` over `△△テック（御社）`; right = `通知 3` and the user menu `佐藤（取引先営業）`. Do NOT draw a usage meter or any quota number in the header.
- Left sidebar, fixed width, text only, no icons, partner version: `ホーム`, `① 自社の人材`, `① 公開された案件`, `② 自社の候補を探す`, `③ 提案`, `③ 提案依頼 (2)`, `④ 面談・結果`, `共有の設定`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案依頼 (2)` is the current item with a filled bar. No 契約 item and no 稼働 item.
- Content area top: breadcrumb `ホーム ＞ 提案依頼 ＞ R-0088`, the screen title `提案依頼 R-0088` as the single largest heading.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: the accept action and the decline action are presented with equal visual weight in the same action row. Accepting is the primary button, but declining must not be reduced to a faint text link.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 55 percent, right about 45 percent.

### Deadline band, full width, directly under the title row
A bordered band whose right side carries the largest text on the page: `返答期限まで 残り 22 時間`, with `2026-09-01 14:02 まで` in small gray under it, and on the left the status badge `< 返答待ち >` filled.

## Left column

### Section 1: `依頼の内容`
Definition list: `案件名` `金融系 Web API 改修` / `依頼元` `〇〇システム` / `依頼日` `2026-08-29 14:02`
Then a sub-block `必須要件` with four rows carrying FILLED `< 必須 >` badges: `Java 5 年以上` / `Spring Framework 3 年以上` / `REST API 設計の実務経験` / `日本語での要件定義が可能`
Then a sub-block `尚可要件` with three rows carrying OUTLINE `< 尚可 >` badges: `AWS（ECS / Lambda）` / `金融ドメインの経験` / `テスト自動化の経験`
Then a definition list `単価レンジ` `65〜75 万円` / `開始日` `2026-10-01` / `勤務地・リモート` `東京都千代田区・一部リモート可（週 2 日）`
Then `依頼メッセージ` shown as four lines of body text.

### Section 2: `対象の自社エンジニア`
Definition list showing the REAL name, because this is the partner's own record: `氏名` `佐々木 涼` / `スキル` `Java, Spring, AWS, PostgreSQL` / `経験年数` `7 年` / `単価レンジ` `65 万円` / `稼働可能時期` `2026-10-01` / `勤務地` `東京都`
A small gray line: `この情報は自社の台帳の値です。ホストにはまだ丸めた 5 項目しか見えていません。`

## Right column

### Section 3: `応諾するとどうなるか` — a heavy bordered block
Four wrapped lines:
`応諾すると、この人材の氏名・貴社名・スキルシートがホストに開示されます。`
`同時に提案（下書き）が 1 件作成され、提案の作成画面に移動します。`
`開示されるのは: 氏名 / 貴社名 / スキルシート（v5, CLEAN） / 経験内容 / 従事期間`
`この操作は取り消せません。`

### Section 4: `辞退する`
- Label `辞退の理由（社内向けの記録）` above a text area drawn as four rules.
- Directly UNDER the text area, a bordered one-line note: `この理由はホストには開示されません。`

### Section 5: `アクション` — one row at the bottom of the right column, both buttons the same size
`[ 応諾する ]` primary (black filled) and `[ 辞退する ]` secondary (outlined), side by side and equally prominent.

### Confirmation dialog drawn beside the action row with the small gray caption `応諾の確認ステップ`
Title `開示される項目を確認してください`, body listing `氏名: 佐々木 涼` / `貴社名: △△テック` / `スキルシート: v5（CLEAN）` / `経験内容と従事期間`, then `[ 応諾する ]` `[ キャンセル ]`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `期限切れのとき`: `この提案依頼は期限が切れました` with the badge `< 期限切れ >` dashed and no action buttons at all.
- Caption `ホストが取り下げたとき`: `この提案依頼はホストにより取り下げられました` with the badge `< 取り下げ >` outline and no action buttons.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

Single column, in this order, nothing folded:
1. Deadline band with `返答期限まで 残り 22 時間` as the largest text.
2. `依頼の内容` including 必須要件 (4 filled badges), 尚可要件 (3 outline badges), 単価レンジ, 開始日, 勤務地・リモート and the request message.
3. `対象の自社エンジニア`.
4. `応諾するとどうなるか` heavy bordered block, 4 lines.
5. `辞退の理由（社内向けの記録）` text area with the note `この理由はホストには開示されません。` directly under it.
6. Action row with `[ 応諾する ]` and `[ 辞退する ]` the same size, side by side.

IMPORTANT: this is not a shrunken desktop; the two columns are merged into one flow in the order above.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks, one continuous vertical scroll.

Order from top:
1. Compact header: hamburger, wordmark `SES Platform`, `通知 3`; under it `△△テック（御社）`.
2. A pinned band at the top of the content with `残り 22 時間` as the largest text on the screen and `< 返答待ち >` beside it.
3. `依頼の内容`: `金融系 Web API 改修`, then 必須要件 as four rows with FILLED `< 必須 >` badges, then 尚可要件 as three rows with OUTLINE `< 尚可 >` badges, then `単価レンジ 65〜75 万円`, `開始日 2026-10-01`, `勤務地・リモート 東京都千代田区・一部リモート可`, then the request message in full.
4. `対象の自社エンジニア`: `佐々木 涼` with skills and availability.
5. `応諾するとどうなるか`: the heavy bordered block with all four lines wrapped and fully readable.
6. `辞退の理由（社内向けの記録）` text area with the note `この理由はホストには開示されません。` underneath.
7. A bottom fixed action bar containing BOTH `[ 応諾する ]` and `[ 辞退する ]` at equal width.

IMPORTANT: nothing in items 3, 4 or 5 is inside an accordion or a tab. The mandatory requirements, the unit price range, the start date and the list of what gets disclosed are all visible by scrolling only.
```

## 設計意図メモ（画像生成には使われない）

- 「断る自由」と「断った理由を明かさない自由」を UI で成立させる画面（`BR-57`）。辞退理由欄の直下に非開示の明記を置き、応諾側には開示項目の列挙を確認ステップとして置いた。
- 応諾と辞退を同じ重みで提示する（`docs/04` §4.3 の「なぜこの構成か」）。応諾を primary にしても辞退を目立たなくしない。
- モバイルでも必須要件・単価レンジ・開始日・開示される項目を省略しない（`BR-49` の原則を経路 4 に適用）。タブ・アコーディオンを使わない。
- 対象エンジニアは自社の情報なので実名で表示してよい。ホスト側にはまだ丸めた 5 項目しか見えていないことを 1 行添える。
- 期限切れ・取り下げでは操作が消える（無効化ボタンを残さない）。
- 関連 UC: UC-15（提案依頼への応諾・辞退）。
