# S-029 稼働一覧（満了カレンダー） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-029
- 画面名: 稼働一覧（満了カレンダー）
- 平面: 主平面
- 対応機能 ID: F-042 / F-043 / F-045
- 対応ステージ: ⑥ 稼働・稼働後フォロー（Phase 2）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.6 `S-029` / §6.2 / §5-5 / `U-03`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-029
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen turns contract expiry from something people have to remember into something that is simply lying there in front of them. It offers a list view and an expiry calendar. Alerts fire 60 days and 30 days before expiry; the 30-day one is a REMINDER and never changes the state badge.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`. A view switch is drawn as two adjoining boxes `[ 一覧 ]` `[ 満了カレンダー ]` with the active one filled black.
- Status badges `< ラベル >` in angle brackets: `< 開始予定 >` outline, `< 稼働中 >` filled, `< 延長確認中 >` filled, `< 終了予定 >` filled, `< 終了 >` outline.
- A month calendar is drawn as a plain grid of weeks and days with thin rules and no colour fills. Markers inside a day cell are small labelled squares: a solid square for 満了, an outlined square for 60 日前の起票, a dashed square for 30 日前の再通知.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `⑥ 稼働` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 稼働`, the screen title `稼働一覧` as the single largest text, and on the right of the title row exactly two buttons: the primary `[ 稼働を登録 ]` and, beside it, the secondary `[ 取引先にはこう見えています ]` which opens the partner-facing assignments screen as a read-only preview.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. Both views are shown in one image: the list occupies the upper two thirds and the calendar the lower third.

### Control row
The view switch `[ 一覧 ]` (filled black, active) `[ 満了カレンダー ]`, then filter chips `[ すべて ]` `[ 開始予定 ]` `[ 稼働中 ]` `[ 延長確認中 ]` `[ 終了予定 ]` `[ 終了 ]`, and a count line `稼働 86 件`.

### Section 1: `一覧` — table, 12 body rows, default sort ascending by 残日数
Columns: `エンジニア` / `案件` / `相手方` / `状態` / `開始日` / `満了日` / `残日数` / `延長確認` / `担当`
1. `伊藤 修 / 保険基幹系マイグレーション / けやきリテール / < 延長確認中 > filled / 2025-04-01 / 2026-10-29 / 58 日 / 起票済み（2026-08-30） / 加藤`
2. `吉田 玲 / 物流管理システム保守 / みなと物流 / < 延長確認中 > filled / 2025-11-01 / 2026-10-31 / 60 日 / 起票済み（2026-09-01） / 山田`
3. `森 涼太 / 社内 DWH 構築 / みなと物流 / < 稼働中 > filled / 2026-01-06 / 2026-11-30 / 90 日 / — / 鈴木`
4. `小林 大輔 / EC サイト基盤刷新 / けやきリテール / < 稼働中 > filled / 2026-02-02 / 2026-12-31 / 121 日 / — / 加藤`
5. `大野 亮 / 金融系 Web API 改修 / 富士アルファ商事 / < 稼働中 > filled / 2026-04-01 / 2027-03-31 / 211 日 / — / 山田`
6. `中村 彩 / 医療系 SaaS フロントエンド / 富士アルファ商事 / < 開始予定 > outline / 2026-10-01 / 2027-03-31 / — / — / 鈴木`
7. `高橋 健 / 保険基幹系マイグレーション / けやきリテール / < 終了予定 > filled / 2024-10-01 / 2026-09-30 / 29 日 / 終了決定（2026-08-25） / 加藤`
8. `渡辺 翔 / 物流管理システム保守 / みなと物流 / < 終了 > outline / 2024-04-01 / 2026-08-31 / — / — / 山田`
9-12. four more rows of the same shape.
A gray line under the table: `延長確認の起票は日次のバッチで行われます。60 日を切った時点で状態が「延長確認中」に変わります。`
IMPORTANT: there is no state or badge called 起票待ち anywhere in this image. Rows above 60 days simply show a day count such as `61 日` with `—` in the 延長確認 column.

### Section 2: `満了カレンダー` — a month grid for 2026-10
- Header: `2026 年 10 月` with `[ 前月 ]` `[ 翌月 ]`.
- A 7 by 5 grid of day cells with thin rules.
- Day 29 holds a solid square labelled `満了 1 件` and the name `伊藤 修`.
- Day 31 holds a solid square labelled `満了 2 件`.
- Day 1 holds an outlined square labelled `60 日前の起票 3 件`.
- Day 15 holds a dashed square labelled `30 日前の再通知 2 件`.
- Four other days hold solid squares labelled `満了 1 件`.
- The week containing days 26 to 31 carries a bordered warning strip drawn across it: `この週に 7 件の満了があります`.
- A second bordered strip under the calendar: `10/2 は面談調整と提案送信が集中します。メールの日次上限（500 通）に近づく可能性があります。`
- A legend row under the calendar with three small squares and their labels: solid `満了`, outlined `60 日前の起票`, dashed `30 日前の再通知`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `初回空`: `稼働はまだありません。決定した提案から稼働を登録します。` with `[ 決定した提案を見る ]`
- Caption `登録時の制約`: `満了日を持たない稼働は作成できません`
```

## 設計意図メモ（画像生成には使われない）

- 満了を「気づくもの」から「置いてあるもの」に変えるため、一覧の既定並びを残日数の昇順にし、カレンダーで俯瞰できるようにした（§4.6 / §6.2）。
- 60 日前の起票と 30 日前の再通知を別の印で示す（`U-03`）。30 日前の再通知で状態バッジを変えないため、カレンダー上でも状態ではなく印として区別する。
- `起票待ち` を UI 上の状態として作らない（`Assignment` の状態を増やさない。`BR-33`）。61 日目は残日数表示のみ。
- 同一週に満了が集中する場合の警告と、送信枠の警告を置く（§6.2 / §5-5）。延長交渉と後任提案が同時に走ると手が回らない。
- 取引先はこの画面に到達しない（`F-042` の `PA`/`PS` = `−`）。
- 🔴 2026-09-01 改訂: タイトル行に「取引先にはこう見えています」ボタンを追加した（`docs/04` §4.6 `S-029` / §5-2）。ホストが `renewal-advisor` の論点や販売単価が `S-044`（取引先ビュー）に漏れていないことを自分の目で確認できる。`S-044` 側にプレビュー時の帯を新設し、対応関係を対にした。
- 関連 UC: UC-19（延長確認）/ UC-20（還流）。
