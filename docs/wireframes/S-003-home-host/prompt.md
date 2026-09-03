# S-003 ホーム（ホスト） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-003
- 画面名: ホーム（ホスト）
- 平面: 主平面
- 対応機能 ID: F-006 / F-027 / F-061
- 対応ステージ: 横断（①〜⑥ の要対応を集約）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.1 `S-003` / §7.2 / §8.4 / §11-3
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-003
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: (1) collect engineers and projects, (2) matching, (3) proposal with a quality gate and human approval, (4) interview and decision, (5) contract, (6) assignment and post-assignment follow-up feeding back into (1). A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis (placeholders, secondary notes, read rows). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]` in square brackets, text only. Dropdowns `[ ラベル ▾ ]`. Toggles drawn as `[x] ラベル`.
- Status badges `< ラベル >` in angle brackets. Filled badge = black background with reversed text; outline badge = thin border; dashed badge = dashed border.
- Tables are the default for lists of same-shaped records: Japanese column headers, thin rules, tight row height, 8-12 body rows. Never lay records out as a grid of cards.
- All visible text is Japanese. No photos, no logos, no charts on this screen.
- No icons on navigation items, section headings, buttons or status badges.
- Very dense and realistic. Sales staff open this first thing in the morning; the first screenful must show at least 12 rows of work.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place in the product where the product name is written), then the scope display `〇〇システム`; right = a usage indicator reading `AI 停止中` in a filled badge (same treatment as S-038 header — this tenant is over its AI daily cost ceiling; the badge shows only the fact, never a percentage and never a currency figure), then `通知 5` and the user menu `山田（営業）` with the role always in parentheses.
- Left sidebar, fixed width, text only, no icons, items in business-loop order: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `ホーム` is the current item, marked with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム`, the screen title `ホーム` as the single largest text, and the toggle `[x] 自分の担当のみ` at the right of the title row.
- A thin bordered announcement strip directly under the header: `お知らせ: 9/5 02:00-04:00 にメンテナンスを実施します`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen must NOT look like a generic dashboard. Do not draw four KPI cards across the top, do not draw a large chart, and do not draw a recent-activity feed. The top of the page is one single table of work that stalls if nobody acts today.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and left sidebar as described in the shared prompt. The main content is a 2-column split: a wide left column of about 65 percent and a narrow right column of about 35 percent.

## Left column

### Section 1: `要対応` — one single table, 10 body rows
Columns: `種別` / `対象` / `相手` / `経過時間` / `期限` / `担当`. The `種別` cell holds a status badge. Row order (sorted by elapsed time weighted by irreversibility, so 送信失敗 is first and 承認待ち next):
1. `< 送信失敗 >` filled / `P-0138 高橋 健` / `富士アルファ商事` / `3 日 2 時間` / `—` / `山田`
2. `< 送信失敗 >` filled / `P-0131 中村 彩` / `けやきリテール` / `1 日 6 時間` / `—` / `鈴木`
3. `< 承認待ち >` filled / `P-0142 佐藤 花子` / `富士アルファ商事` / `2 日 4 時間` / `本日 18:00` / `山田`
4. `< 承認待ち >` filled / `P-0143 山田 太郎` / `みなと物流` / `1 日 1 時間` / `明日 12:00` / `山田`
5. `< 承認待ち >` filled / `P-0145 渡辺 翔` / `けやきリテール` / `4 時間` / `明日 18:00` / `鈴木`
6. `< 差し戻し（検査で不合格） >` filled / `P-0140 田中 誠` / `みなと物流` / `1 日 3 時間` / `—` / `鈴木`
7. `< 提案依頼の返答待ち >` filled / `R-0088 共有候補` / `△△テック` / `2 日` / `残り 22 時間` / `山田`
8. `< 面談日程が未確定 >` outline / `P-0129 小林 大輔` / `富士アルファ商事` / `1 日 5 時間` / `9/3` / `加藤`
9. `< 延長確認 >` filled / `A-0071 伊藤 修` / `けやきリテール` / `6 時間` / `残り 58 日` / `加藤`
10. `< 延長確認 >` filled / `A-0064 吉田 玲` / `みなと物流` / `2 時間` / `残り 60 日` / `山田`
Two of the rows carry a small gray marker `新着` at the right edge.
Under the table, one line of small gray text: `AI の担当別の確認待ち: スキルシートの読み取り結果 3 件 / 提案文の下書き 1 件`

### Section 2: `満了が近い稼働` — table, 8 body rows
Columns: `エンジニア` / `案件` / `満了日` / `残日数` / `延長確認` / `担当`.
First rows: `伊藤 修 / 保険基幹系マイグレーション / 2026-10-29 / 58 日 / < 延長確認中 > filled / 加藤` and `吉田 玲 / 物流管理システム保守 / 2026-10-31 / 60 日 / < 延長確認中 > filled / 山田`. The remaining rows have 残日数 `72 日`, `85 日`, `96 日`, `104 日`, `118 日`, `131 日` and `—` in the 延長確認 column.

## Right column

### Section 3: `待機予定に戻った人材` — table, 6 body rows
Columns: `エンジニア` / `元の案件` / `稼働可能時期` / `単価レンジ`. Example row: `大野 亮 / EC サイト基盤刷新 / 2026-10-01 / 65〜75 万円`.

### Section 4: `後任募集の案件` — table, 5 body rows
Columns: `案件` / `元の稼働` / `開始日` / `公開先`. The top two rows show `< 未設定 >` as a filled badge in the 公開先 column and are sorted to the top; the rest show `3 社に公開中`.

### Section 5: `未読チャット` — list of 5 rows
Each row: thread subject, counterpart company, first line of the last message truncated to one line, relative time. Example: `金融系 Web API 改修 / △△テック / 面談の候補日ですが… / 35 分前`.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt; the sidebar is narrower but still text-only and fully listed.

The main content is ONE column, not a shrunken 2-column desktop.

Order from top:
1. `要対応` table with the `担当` column dropped, so the columns are `種別` / `対象` / `相手` / `経過時間` / `期限`. Still 10 rows, still one single table, and NO horizontal scrollbar.
2. `満了が近い稼働` table with columns `エンジニア` / `案件` / `満了日` / `残日数` / `延長確認`, 8 rows.
3. `待機予定に戻った人材` table, 6 rows.
4. `後任募集の案件` table, 5 rows, the `< 未設定 >` rows first.
5. `未読チャット` list, 5 rows.

IMPORTANT: columns are dropped rather than made horizontally scrollable, and sections 1 to 4 are never collapsed.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column, edge-to-edge blocks.

Order from top:
1. Compact header: a hamburger affordance on the left, the wordmark `SES Platform` centered, a usage indicator badge `AI 停止中` filled (same fact as the desktop header, no percentage, no currency) and `通知 5` on the right. Under it a single line `〇〇システム`.
2. Announcement strip `お知らせ: 9/5 02:00-04:00 にメンテナンスを実施します`.
3. Title row `ホーム` with the toggle `[x] 自分の担当のみ`.
4. Section `要対応`, expanded, 10 rows. Each row is exactly three elements on one line: a status badge, the target, and the elapsed time, for example `< 送信失敗 > P-0138 高橋 健 3 日 2 時間`.
5. Section `満了が近い稼働`, expanded, 6 rows, each row `エンジニア名 / 案件 / 残 58 日`.
6. Section `待機予定に戻った人材`, expanded, 4 rows.
7. Section `後任募集の案件`, expanded, 3 rows, `< 未設定 >` rows first.
8. Section `未読チャット`, COLLAPSED to a single strip showing `未読チャット 5` with an expand affordance.
9. Section `お知らせ`, COLLAPSED to a single strip with an expand affordance.
10. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`. `ホーム` is active.

IMPORTANT: sections 1 to 4 are never collapsed on mobile, because folding them hides the expiry dates. Only sections 5 and 6 collapse.
```

## 設計意図メモ（画像生成には使われない）

- 最上部を「1 本の要対応テーブル」にし、KPI カード 4 枚・グラフ・アクティビティフィードを描かない（申し送り 3 / §7.2 / §11-3）。種別ごとにカードを割ると「今日どれから手を付けるか」が判断できなくなる。
- 並びの主キーは件数ではなく経過時間 × 取り返しのつかなさ。`送信失敗`（外部に届いたか不明）を最上位、`承認待ち` を次に置いた（`BR-21` / `BR-22` を前提にした順序）。
- `満了が近い稼働` と `待機予定に戻った人材` / `後任募集の案件` を同じ画面に置くことで、⑥→① の還流の入口と出口が 1 枚で読める。
- 🔴 2026-09-01 改訂（Iteration 5・オーケストレーター決定）: ヘッダに `AI 停止中` の filled badge を描く（`S-038:35` と同一の描き方）。`〇〇システム` の当月フィクスチャは AI 日次上限到達済み・停止中で全画面統一するため（`S-038` / `A-004` / `S-035` / `S-032` と同一時点）。バッジは事実のみを示し、パーセンテージや金額は出さない。旧文「80% 未満なのでヘッダに描かない」は本フィクスチャでは該当しない。
- 🔴 2026-09-03 修正（Iteration 6・design-reviewer 5 回目の残指摘）: mobile.png プロンプトのヘッダ列挙が desktop / tablet と別に書き起こされていたため `AI 停止中` バッジが漏れていた。desktop / tablet と同じ表現でバッジを追加し、3 デバイスで整合させた（機械的修正。共有フィクスチャの時点は変更なし）。
- AI ロールの確認待ちは業務上の呼び名で 1 行に出す（§8.4 / §9.2）。内部識別子は業務画面に出さない。
- 関連 UC: UC-05（承認）/ UC-09（送信失敗の再送）/ UC-19（延長確認）の起点。
