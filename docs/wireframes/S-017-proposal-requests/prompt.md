# S-017 提案依頼の一覧 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-017
- 画面名: 提案依頼の一覧
- 平面: 主平面
- 対応機能 ID: F-018
- 対応ステージ: ②③
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.3 `S-017` / §5-1（`ProposalRequest` の 5 状態）/ §10.1
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-017
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen lists 提案依頼 (proposal requests): a host company asks a partner company to turn one of its anonymous candidates into a real proposal. The five outcomes 返答待ち / 応諾 / 依頼を辞退 / 取り下げ / 期限切れ are strictly different things and must never be merged.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, filter chips drawn as `[ ラベル ]` boxes in a row with the active one filled black.
- Status badges `< ラベル >` in angle brackets: `< 返答待ち >` filled, `< 応諾 >` outline, `< 依頼を辞退 >` outline, `< 取り下げ >` outline, `< 期限切れ >` dashed. The three "did not happen" outcomes look alike in weight but their wording is always different.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `③ 提案依頼` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 提案依頼`, the screen title `提案依頼` as the single largest text.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: nowhere on this screen does a decline reason appear, in any list, panel, tooltip or export. The host can tell 依頼を辞退 apart from 期限切れ, but never learns why a partner declined.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: table on the left (about 70 percent), detail panel on the right (about 30 percent). This image shows the HOST view.

### Filter chips row
`[ すべて ]` `[ 返答待ち ]` (filled black, active) `[ 応諾 ]` `[ 依頼を辞退 ]` `[ 期限切れ ]` `[ 取り下げ ]`

### Count line
`提案依頼 27 件`

### Table — 6 columns, 11 body rows
Columns: `依頼 ID` / `案件` / `候補の表示` / `依頼日` / `期限までの残り` / `状態`
1. `R-0088 / 金融系 Web API 改修 / 共有候補 / 2026-08-29 / 残り 22 時間 / < 返答待ち > filled`
2. `R-0087 / 保険基幹系マイグレーション / 共有候補 / 2026-08-29 / 残り 1 日 6 時間 / < 返答待ち > filled`
3. `R-0086 / 社内 DWH 構築 / 共有候補 / 2026-08-28 / 残り 2 日 4 時間 / < 返答待ち > filled`
4. `R-0085 / EC サイト基盤刷新 / 森本 健太 / 2026-08-26 / — / < 応諾 > outline`
5. `R-0084 / 金融系 Web API 改修 / 共有候補 / 2026-08-25 / — / < 依頼を辞退 > outline`
6. `R-0083 / 医療系 SaaS フロントエンド / 共有候補 / 2026-08-24 / — / < 期限切れ > dashed`
7. `R-0082 / 社内 DWH 構築 / 岡田 真 / 2026-08-22 / — / < 応諾 > outline`
8. `R-0081 / 物流管理システム保守 / 共有候補 / 2026-08-21 / — / < 取り下げ > outline`
9-11. three more rows of the same shape.
Under the table, paging: `[ 前のページ ]` `1 - 27 / 27` `[ 次のページ ]`.

### Right detail panel — `R-0088`
Definition list: `案件` `金融系 Web API 改修` / `候補` `共有候補` / `依頼先` `△△テック` / `依頼日` `2026-08-29 14:02` / `返答期限` `2026-09-01 14:02（残り 22 時間）` / `状態` `< 返答待ち >`
Then a block `候補の要約` showing exactly the five rounded values: `スキル Java, Spring, AWS, PostgreSQL, Docker, Git, Linux, Jenkins` / `経験年数 5〜10 年` / `単価レンジ 60〜70 万円` / `稼働可能時期 翌月` / `勤務地・リモート 東京都・一部リモート可`.
Then `依頼メッセージ` shown as three lines of body text.
Action: the text link `[ 取り下げる ]` with a small confirmation dialog beside it: `この提案依頼を取り下げます。取引先には取り下げとして表示されます。` `[ 取り下げる ] [ キャンセル ]`.
The panel shows no decline reason field and no decline reason text for the R-0084 row either.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt; the sidebar is narrower but still text-only and fully listed.

Single column, not a shrunken 2-column desktop:
1. Filter chips row, same six chips.
2. Count line `提案依頼 27 件`.
3. Table with the `依頼 ID` column dropped, so columns are `案件` / `候補の表示` / `依頼日` / `期限までの残り` / `状態`, 11 rows, same values.
4. Tapping a row opens the detail as a sheet sliding up from the bottom; draw that sheet half-open over the lower third of the screen, showing `R-0088` の定義リスト and the five rounded candidate values.

IMPORTANT: no horizontal scrolling; columns are dropped instead.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks. This image shows the PARTNER-side variant of the same screen, where the operator must answer before the deadline.

Order from top:
1. Compact header: hamburger on the left, the wordmark `SES Platform` centered, `通知 3` on the right. Under it one line `△△テック（御社）`.
2. Title `提案依頼`.
3. Filter chips in one scrollable row: `[ 返答待ち ]` (filled, active) `[ 応諾 ]` `[ 依頼を辞退 ]` `[ 期限切れ ]` `[ 取り下げ ]`.
4. Count line `返答が必要な提案依頼 3 件`.
5. A list of 9 rows. Each row is exactly three elements: the project name, the status badge, and the remaining time, with the remaining time set as the largest text in the row. Sorted with the nearest deadline first:
   `金融系 Web API 改修  < 返答待ち >  残り 22 時間`
   `保険基幹系マイグレーション  < 返答待ち >  残り 1 日 6 時間`
   `社内 DWH 構築  < 返答待ち >  残り 2 日 4 時間`
   `EC サイト基盤刷新  < 応諾 >  —`
   `金融系 Web API 改修  < 依頼を辞退 >  —`
   `医療系 SaaS フロントエンド  < 期限切れ >  —`
   plus three more rows.
6. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`.

IMPORTANT: no decline reason is shown anywhere, and there is no indication that any other company received a request for the same candidate.
```

## 設計意図メモ（画像生成には使われない）

- `DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` を独立した区分として扱い、語も別にする（`F-018 AC-5` / `BR-60`）。塗り・枠線・点線枠の形状差でも区別する（§5-1）。
- 辞退の理由はホスト側のどこにも出さない（`F-018 AC-1`）。詳細パネルにも理由欄を描かない。
- 取引先側には「同じ候補に他社から依頼が来ているか」を示す表示が無い（`F-018 AC-6`）。モバイル画像で取引先視点を描いたのは、ここが期限勝負の Tier 1 だから。
- 候補の要約は丸めた 5 項目のみ（`U-06`）。応諾前は実名に到達しない。
- 期限までの残りはクライアント側で毎分更新する値であり、モバイルでは行内で最も大きい文字にした。
- 関連 UC: UC-15（提案依頼 → 応諾・辞退）。
