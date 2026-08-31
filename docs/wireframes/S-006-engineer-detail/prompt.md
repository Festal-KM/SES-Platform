# S-006 エンジニア詳細 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-006
- 画面名: エンジニア詳細
- 平面: 主平面
- 対応機能 ID: F-008 / F-012 / F-016 / F-019 / F-045
- 対応ステージ: ① 集める
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.2 `S-006` / §5-6 / §10.3
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
`山田 太郎`  `< 稼働中 >` filled badge  `自社`  `稼働可能時期: 2026-10-01`  and the primary button `[ この人で提案を作る ]` at the right.

## Left column

### Section: `基本情報` — definition list, 9 rows
`所属区分` `自社` / `スキル` `Java（8 年・上級）, Spring（6 年・上級）, AWS（4 年・中級）, PostgreSQL（5 年・中級）` / `経験年数` `8 年` / `単価レンジ` `65〜75 万円` / `勤務地` `東京都` / `リモート` `一部リモート可` / `希望条件` `長期案件を希望` / `稼働状況` `稼働中` / `稼働可能時期` `2026-10-01`
Under the list, one small gray line: `本籍・家族構成・健康情報にあたる項目は保持していません`

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

### Section: `匿名共有の設定` — drawn as a bordered block with the caption `※ 取引先の利用者にのみ表示される`
- Toggle `[ ] 共有可にする（既定はオフ）`
- A sub-block titled `ホストに表示される内容（プレビュー）` showing exactly five rounded-off values and nothing else:
  `スキル` `Java, Spring, AWS, PostgreSQL, Docker, Git, Linux, Jenkins`
  `経験年数` `5〜10 年`
  `単価レンジ` `60〜70 万円`
  `稼働可能時期` `翌月`
  `勤務地・リモート` `東京都・一部リモート可`
- One small gray line under the preview: `実名・貴社名・スキルシートは、貴社が提案を作成するまで開示されません`
```

## 設計意図メモ（画像生成には使われない）

- スキルシートの版一覧で `検査中` / `隔離` の行から共有・DL の操作要素そのものを消したのは、`F-011 AC-1`（`CLEAN` になるまで共有 URL を発行しない）を UI で成立させるため。
- 「凍結情報との差分」を詳細画面に置くのは、SES では提案後に台帳が変わっても提案内容は変わらないことが商流上の前提であるため（`F-019 AC-2`）。
- 匿名共有のプレビューは丸めた 5 項目のみ（`U-06`）。`7 年` `65 万円` `東京都渋谷区` のような丸め前の値、および丸め前後の並置は描かない（§5-2）。
- ホストはパートナー所属エンジニアのこの画面に到達しない。したがって本画像は自社エンジニアを描いている。
- ダウンロードはモバイルでも可能で監査ログの記録は同じ（`CLAUDE.md` §13.3）。Tier 2 のため画像は 1 枚。
- 関連 UC: UC-02（台帳整備）/ UC-14（匿名共有）/ UC-22（説明責任）。
