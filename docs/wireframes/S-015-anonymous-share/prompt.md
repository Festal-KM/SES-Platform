# S-015 匿名共有の設定（取引先） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-015
- 画面名: 匿名共有の設定（取引先）
- 平面: 主平面（`PARTNER_ADMIN` / `PARTNER_SALES` 専用）
- 対応機能 ID: F-016 / F-017
- 対応ステージ: ② マッチング（越境経路 4 の入口）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-015` / `U-06` / §5-2 / §7.6
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-015
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen belongs to a PARTNER company user. Here the partner decides, per engineer, whether to expose that engineer ANONYMOUSLY to the host company's candidate list. Only five rounded-off attributes are ever exposed; the real name, the partner company name and the skill sheet stay hidden until the partner itself creates a proposal. The initiative belongs to the partner, and the screen must make that obvious.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, toggles drawn as `[ ] ラベル` / `[x] ラベル`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then a two-level scope display on two lines `〇〇システム` over `△△テック（御社）`; right = `通知 3` and the user menu `佐藤（取引先営業）`. Do NOT draw a usage meter or any quota number in the header.
- Left sidebar, fixed width, text only, no icons, partner version: `ホーム`, `① 自社の人材`, `① 公開された案件`, `② 自社の候補を探す`, `③ 提案`, `③ 提案依頼 (2)`, `④ 面談・結果`, `共有の設定`, `チャット`, `タスク`, `実績`, `設定`. `共有の設定` is the current item with a filled bar. The sidebar has no 契約 item and no 稼働 item.
- Content area top: breadcrumb `ホーム ＞ 共有の設定`, the screen title `匿名共有の設定` as the single largest text. There is no primary button in the title row; the actions live per row.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: lists on the left (about 60 percent) and the disclosure preview on the right (about 40 percent).

## Left column

### Section 1: `共有の意味` — a permanent bordered explanation block, 4 wrapped lines, placed above everything else
`共有可にすると、ホストの候補一覧に匿名で表示されます。`
`実名・貴社名・スキルシートは、貴社が提案を作成するまで開示されません。`
`いつでも解除でき、解除した時点で表示されなくなります。`
`表示されるのは次の 5 項目だけです: スキル / 経験年数 / 単価レンジ / 稼働可能時期 / 勤務地・リモート可否`

### Section 2: `共有中の人材 6 件` — table, 6 body rows
Columns: `氏名（社内表示）` / `共有開始日` / `受け取った提案依頼` / `稼働可能時期` / `操作`
- `佐々木 涼 / 2026-07-02 / 3 件 / 翌月 / [ 共有を解除 ]`  (this row is selected, marked with a filled left edge)
- `森本 健太 / 2026-07-15 / 1 件 / 翌々月 / [ 共有を解除 ]`
- `岡田 真 / 2026-08-01 / 0 件 / 即時 / [ 共有を解除 ]`
- `長谷川 亮 / 2026-08-04 / 2 件 / 翌月 / [ 共有を解除 ]`
- `村上 咲 / 2026-08-11 / 0 件 / 3 か月以内 / [ 共有を解除 ]`
- `坂本 悠 / 2026-08-20 / 1 件 / 翌月 / [ 共有を解除 ]`

### Section 3: `共有していない自社エンジニア 22 件` — table, 8 body rows
Columns: `氏名（社内表示）` / `稼働状況` / `稼働可能時期` / `操作`
Each row ends with `[ 共有可にする ]`. There is NO select-all checkbox, NO bulk action bar and NO "まとめて共有可にする" button anywhere on this screen.

## Right column

### Section 4: `ホストに表示される内容（プレビュー）`
- Caption: `選択中: 佐々木 涼`
- A bordered mock drawn exactly like one row of the host candidate table plus its side panel, showing ONLY these values and nothing else:
  `表示名` `共有候補`
  `スキル` `Java, Spring, AWS, PostgreSQL, Docker, Git, Linux, Jenkins`
  `経験年数` `5〜10 年`
  `単価レンジ` `60〜70 万円`
  `稼働可能時期` `翌月`
  `勤務地・リモート` `東京都・一部リモート可`
  `更新日` `2026-08-30`
- IMPORTANT: the preview must NOT show the real name, the partner company name, any internal ID, any exact figure such as `7 年` or `65 万円` or a ward-level address, and it must NOT place the un-rounded value next to the rounded one.
- Two gray lines below the preview: `実名・貴社名・スキルシートは、貴社が提案を作成するまで開示されません。` and `スキルは上位 8 件までが表示されます。`

### Section 5: `共有可にするときの確認` — a bordered dialog drawn under the preview with a small gray caption above it: `確認ステップ`
Dialog title `この内容がホストに表示されます`, body = a compact repeat of the 5 rounded values, buttons `[ 共有可にする ]` and `[ キャンセル ]`.

### One state strip at the very bottom with a small gray caption above it
- Caption `共有中が 0 件のとき`: `共有している人材はいません` followed by the same explanation block as section 1. There is no persuasive sentence urging the partner to share.
```

## 設計意図メモ（画像生成には使われない）

- 開示プレビューを設定操作の隣に常設したのは、取引先が共有をやめる最大の理由が「何が見えているか分からない」ことだから（§4.2 `S-015` の「なぜこの構成か」）。
- 丸めた値のみを描く（`U-06`）。`7 年` / `65 万円` / `東京都渋谷区` のような丸め前の値、および丸め前後の並置（§5-2）は禁止。
- 「一括で共有可にする」を画面から構造的に消した（`F-016 AC-1`。既定オフの意味が失われるため）。全選択チェックボックスも描かない。
- 解除は確認 1 段（安全側の操作）。1 件ずつの解除はモバイルで完結する必要があるため T2 に置かれている。
- 空状態で煽らない（主導権が取引先にあることが要件）。
- 関連 UC: UC-14（匿名共有の設定）/ UC-15（提案依頼への応諾）。
