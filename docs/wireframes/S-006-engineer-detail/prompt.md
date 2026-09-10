# S-006 エンジニア詳細 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-006
- 画面名: エンジニア詳細
- 平面: 主平面
- 対応機能 ID: F-008 / F-012 / F-016 / F-019 / F-045
- 対応ステージ: ① 集める
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-006`（**改訂 8 = Issue #35 = A。セクション 8 = `EngineerCareer`**）/ §5-2 / §5-6 / §10.1 / §10.3 の `S-006` 行 / §11-11 / `designer` 申し送り 14
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-006
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies into one closed loop: collect engineers and projects, matching, proposal with a quality gate and human approval, interview and decision, contract, assignment and follow-up. A host SES company and the partner companies it invites share one tenant, and a hard information boundary keeps each partner from seeing any other partner data.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`, toggles `[x] ラベル`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border.
- Definition lists (label left, value right, thin rules) for the attributes of a single record. Tables for lists of same-shaped records, with Japanese column headers and tight rows.
- Files and attachments are empty rectangles with a diagonal cross and a Japanese caption.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic; this screen is read while deciding whether to propose this person.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `① 人材` is the current item with a filled bar on its left edge.
- Content area top: breadcrumb `ホーム ＞ 人材 ＞ 山田 太郎`, the screen title `山田 太郎` as the single largest text, and exactly one primary button on the right of the title row: `[ この人で提案を作る ]`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Main content is a 2-column split: left about 40 percent, right about 60 percent.

### Title row (full width, under the breadcrumb)
`山田 太郎`  `< 稼働中 >` filled badge  `自社`  `稼働可能時期: 2026-10-01`  and, at the right, the single text link `編集` followed by the primary button `[ この人で提案を作る ]`. The `編集` link is the ONLY editing affordance anywhere on this screen.

## Left column

### Section: `基本情報` — definition list, 9 rows
`所属区分` `自社` / `スキル` `Java（8 年・上級）, Spring（6 年・上級）, AWS（4 年・中級）, PostgreSQL（5 年・中級）` / `経験年数` `8 年` / `単価レンジ` `65〜75 万円` / `勤務地` `東京都` / `リモート` `一部リモート可` / `希望条件` `長期案件を希望` / `稼働状況` `稼働中` / `稼働可能時期` `2026-10-01`
Under the list, one small gray line: `本籍・家族構成・健康情報にあたる項目は保持していません`

### Section: `経験内容と従事期間` — placed DIRECTLY under `基本情報`, above `稼働履歴`. Read-only table, 4 body rows
Exactly four columns in this order: `期間` / `役割` / `業務内容` / `使用技術`. There is NO operations column and NO edit button inside this section.
IMPORTANT: draw the column headers as plain text. Do NOT draw sort arrows, carets or any sorting affordance on any header — the order is fixed at 期間 descending.
Rows, in this exact order (期間 descending):
1. `2025-04 〜 継続中` / `バックエンド開発 / チームリード` / `保険基幹系のマイグレーション。API 設計とレビュー、メンバー 6 名の進捗管理` / `Java, Spring Boot, PostgreSQL, AWS`
2. `2023-10 〜 2025-03` / `バックエンド開発` / `証券口座管理システムの機能追加。バッチ処理の性能改善` / `Java, Oracle, Jenkins`
3. `2022-01 〜 2023-09` / `Web アプリ開発` / `EC サイトの受注管理画面の開発と保守` / `Java, Spring, MySQL`
4. `2019-04 〜 2021-12` / `開発メンバー` / `社内業務システムの改修。要件ヒアリングから実装まで` / `Java, Struts, Oracle`
In row 1 the end of the period is the word `継続中`, not `—` and not a blank.
Each row carries a small gray provenance word placed under the `役割` value, NOT as a fifth column: rows 1, 3 and 4 read `手入力`, row 2 reads `AI 抽出を採用`.
Under the table, two small gray lines:
- `期間の降順で表示しています（並び替えはできません）`
- `編集は「編集」から人材の編集画面で行います`

### Section: `稼働履歴` — table, 4 body rows
Columns `案件` / `相手方` / `期間` / `状態`. Example: `保険基幹系マイグレーション / けやきリテール / 2025-04 〜 2026-10-29 / < 稼働中 > filled`.

## Right column

### Section: `スキルシートの版` — table, 5 body rows
Columns: `版` / `アップロード日` / `スキャン状態` / `最新版` / `操作`
- `v5 / 2026-08-20 / < CLEAN > outline / 最新 / [ 閲覧 ] [ ダウンロード ]`
- `v4 / 2026-07-01 / < 検査中（通常 2 分以内） > dashed with an elapsed counter / — / 操作は選択できません` (gray text only, no buttons drawn in this cell)
- `v3 / 2026-05-11 / < 隔離 > filled / — / ダウンロードできません`
- `v2 / 2026-02-03 / < CLEAN > outline / — / [ 閲覧 ] [ ダウンロード ]`
- `v1 / 2025-11-19 / < CLEAN > outline / — / [ 閲覧 ] [ ダウンロード ]`
Under the table one small gray line: `閲覧とダウンロードは監査ログに記録されます`

### Section: `提案履歴` — table, 5 body rows
Columns `提案 ID` / `提案先` / `案件` / `提案日` / `状態`. Example: `P-0142 / 富士アルファ商事 / 金融系 Web API 改修 / 2026-07-03 / < 承認待ち > filled`.

### Section: `凍結情報との差分`
A bordered block. Its header row is a selector `[ 提案 P-0142（2026-07-03 凍結） ▾ ]` followed by the label `↔ 現在`.
Inside, a 3-column difference table with 5 rows: `項目` / `提案時点` / `現在`.
- `単価レンジ` / `60〜70 万円` / `65〜75 万円`  with the note `提案後に変更` at the right of the row
- `稼働可能時期` / `即時` / `2026-10-01`  with the note `提案後に変更`
- `スキル` / `Java, Spring, AWS` / `Java, Spring, AWS, PostgreSQL`  with the note `提案後に変更`
- `勤務地` / `東京都` / `東京都` (no note)
- `リモート` / `一部リモート可` / `一部リモート可` (no note)
Directly under that table, still inside the same bordered block, a sub-block titled `経験内容（行単位）` drawn as TWO panels placed SIDE BY SIDE, left and right:
- Left panel, headed `提案時点（2026-07-03 凍結）— 4 行`, four short lines: `2025-04 〜 継続中 / バックエンド開発 / チームリード / Java, Spring Boot, PostgreSQL`, `2023-10 〜 2025-03 / バックエンド開発`, `2022-01 〜 2023-09 / Web アプリ開発`, `2018-04 〜 2019-03 / テスト担当`
- Right panel, headed `現在の台帳 — 4 行`, four short lines: `2025-04 〜 継続中 / バックエンド開発 / チームリード / Java, Spring Boot, PostgreSQL, AWS`, `2023-10 〜 2025-03 / バックエンド開発`, `2022-01 〜 2023-09 / Web アプリ開発`, `2019-04 〜 2021-12 / 開発メンバー`
- Three plain-text notes: `使用技術が変わった行` beside the first line of both panels, `提案後に削除された行` beside the last line of the LEFT panel, `提案後に追加された行` beside the last line of the RIGHT panel
IMPORTANT: the two panels stay visually separate. Do NOT interleave the frozen rows and the current rows into one merged list.

### Section: `匿名共有の設定` — drawn as a bordered block with the caption `※ 取引先の利用者にのみ表示される`
- Toggle `[ ] 共有可にする（既定はオフ）`
- A sub-block titled `ホストに表示される内容（プレビュー）` showing exactly five rounded-off values and nothing else:
  `スキル` `Java, Spring, AWS, PostgreSQL, Docker, Git, Linux, Jenkins`
  `経験年数` `5〜10 年`
  `単価レンジ` `60〜70 万円`
  `稼働可能時期` `翌月`
  `勤務地・リモート` `東京都・一部リモート可`
- One small gray line under the preview: `実名・貴社名・スキルシートは、貴社が提案を作成するまで開示されません`
- One more small gray line under that: `経験内容（従事期間・役割・業務内容・使用技術）はホストに開示されません`
FORBIDDEN inside this preview block: do NOT draw any 経験内容 / 経歴 row, column, count, summary phrase, or empty placeholder for it. The preview contains five values and nothing else — even though the same page shows the full career table further up.

### One narrow state strip at the very bottom of the image, with a small gray caption above it
- Caption `経験内容が 0 行のとき`: a single-line bordered band headed `経験内容と従事期間`, containing the plain sentence `経験内容が登録されていません` and the text link `人材の編集で登録する`. Draw it in the same plain style as the rest of the screen: no warning color, no caution icon, no badge.
```

## 設計意図メモ（画像生成には使われない）

- 改訂 8（Issue #35 = A）でセクション 8「経験内容と従事期間」を**基本情報の直下**に差し込んだ。最初に見るのは稼働可能時期と単価レンジであり、経歴はその次に読む判断材料なので基本情報より上には置かない（§4.2 `S-006`）。
- 列ヘッダに並び替えを付けないのは、並び順が利用者ごとに変わると `S-023` の凍結側と並べたときに「行が入れ替わったのか、内容が変わったのか」が判別できなくなるため（`F-008 AC-5` の決定的順序）。
- 編集導線を `S-007` への遷移 1 本にした（セクション 8 の中にボタンを置かない）。詳細画面にインライン編集を持たせると、行の追加・更新・削除を監査ログに残す経路が 2 実装になる。
- 匿名共有プレビューに経歴を 1 項目も置かない禁止を明文で足した。**同じ画面の上部に全文が出ているため、プレビュー側にも出したくなる誘因が最も強い箇所**であり（§4.2 の 🔴）、絵の側で明示しないと下流が足す。
- 経験内容の行単位差分は左右に並置し、1 つのリストに混ぜない（§5-6 / `F-019 AC-5`）。混ぜると「どの行が提案先に届いたか」が読めなくなる。
- 0 行は欠陥ではなく正常なので、状態ストリップも警告色・注意アイコンなしで描く（スキルシートのみで運用している人材が実在する）。
- スキルシートの版一覧で `検査中` / `隔離` の行から共有・DL の操作要素そのものを消したのは、`F-011 AC-1`（`CLEAN` になるまで共有 URL を発行しない）を UI で成立させるため。
- 「凍結情報との差分」を詳細画面に置くのは、SES では提案後に台帳が変わっても提案内容は変わらないことが商流上の前提であるため（`F-019 AC-2`）。
- 匿名共有のプレビューは丸めた 5 項目のみ（`U-06`）。`7 年` `65 万円` `東京都渋谷区` のような丸め前の値、および丸め前後の並置は描かない（§5-2）。
- ホストはパートナー所属エンジニアのこの画面に到達しない。したがって本画像は自社エンジニアを描いている。
- ダウンロードはモバイルでも可能で監査ログの記録は同じ（`CLAUDE.md` §13.3）。Tier 2 のため画像は 1 枚。
- 関連 UC: UC-02（台帳整備）/ UC-14（匿名共有）/ UC-22（説明責任）。
