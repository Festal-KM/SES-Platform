# S-041 監査ログ（自テナント） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-041
- 画面名: 監査ログ（自テナント）
- 平面: 主平面
- 対応機能 ID: F-005 / F-012
- 対応ステージ: 横断
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-041` / §10.3 / `BR-27` / `BR-28`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-041
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen answers one question a client company can ask at any time: who looked at whose résumé, and when. Skill-sheet views and downloads are their own filterable operation type. Records can never be edited or deleted from here.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, date fields as a small box with a date in it.
- Tables for lists of same-shaped records: Japanese column headers, thin rules, tight rows, high row count.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- Very dense; this is a search-and-evidence screen.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 監査ログ`, the screen title `監査ログ` as the single largest text, and on the right of the title row a secondary button `[ CSV でエクスポート ]`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen has no edit control and no delete control on any row, in any menu or in any toolbar.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column: a search block, a result table, and an export block.

### Section 1: `検索条件`
One row of controls:
`期間（必須）` two date boxes `2026-08-01` and `2026-08-31` — the label carries the word `必須` and a small gray line under it reads `期間の指定は必須です`
`操作種別` `[ スキルシートの閲覧・ダウンロード ▾ ]`
`主体` `[ すべて ▾ ]`
`対象種別` `[ すべて ▾ ]`
`[ 検索 ]`
Under the row, the full list of operation types is drawn as a plain wrapped list of chips so that the coverage is visible: `ログイン` `ログアウト` `エンジニア詳細の閲覧` `スキルシートの閲覧` `スキルシートのダウンロード` `案件詳細の閲覧` `作成` `更新` `削除` `提案の送信` `承認` `却下` `権限変更` `公開範囲の変更` `代理閲覧`.

### Section 2: `結果` — table, 14 body rows
Columns: `日時` / `主体` / `操作` / `対象` / `IP・デバイス種別`
1. `2026-08-31 09:41:12 / 山田 太一（ADMIN） / スキルシートのダウンロード / 山田 太郎 v5 / 203.0.113.24・デスクトップ`
2. `2026-08-31 09:40:55 / 山田 太一（ADMIN） / スキルシートの閲覧 / 山田 太郎 v5 / 203.0.113.24・デスクトップ`
3. `2026-08-31 09:12:03 / 鈴木 亮（SALES） / スキルシートの閲覧 / 佐藤 花子 v3 / 198.51.100.7・モバイル`
4. `2026-08-31 08:58:41 / 佐藤 健（PARTNER_ADMIN） / エンジニア詳細の閲覧 / 佐々木 涼 / 192.0.2.55・デスクトップ`
5. `2026-08-30 18:22:10 / システム / 承認 / P-0137（全層 PASS のため自動承認） / —`
6. `2026-08-30 17:05:33 / 山田 太一（ADMIN） / 公開範囲の変更 / 金融系 Web API 改修 / 203.0.113.24・デスクトップ`
7. `2026-08-30 16:40:02 / 加藤 直（SALES） / 提案の送信 / P-0135 / 203.0.113.31・モバイル`
8. `2026-08-30 11:11:19 / 田中 修（ADMIN） / 権限変更 / 森 香織 SALES→VIEWER / 203.0.113.24・デスクトップ`
9. `2026-08-29 20:02:48 / 運営者 佐藤（PLATFORM_SUPPORT） / 代理閲覧 / 開始（理由の記録あり） / —`
10-14. five more rows of the same shape mixing ログイン, 更新, 却下 and 案件詳細の閲覧.
Above the table, a count line: `該当 1,284 件`, and paging under it: `[ 前のページ ]` `1 - 100 / 1,284` `[ 次のページ ]`.

### Section 3: `エクスポート`
`[ CSV を生成する ]` and a progress strip with a dashed border: `生成しています（件数により数分かかります）`, plus a gray line `エクスポートの実行も監査ログに記録されます`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `期間を指定していないとき`: `期間を指定してください` with the search button drawn in a disabled gray state
- Caption `0 件のとき`: `条件に一致する記録はありません`
```

## 設計意図メモ（画像生成には使われない）

- 「スキルシートの閲覧」と「スキルシートのダウンロード」を独立した操作種別として絞り込めるようにした（`BR-28`）。取引先からの説明要求がこの 1 操作で終わる。
- 操作種別の選択肢を `BR-27` の記録対象で過不足なく網羅する。選択肢に無い種別は「記録されていない」と読まれるため、チップの一覧として全量を画面に出した。
- 期間は必須（`docs/03` 申し送り 9）。未指定では検索を実行させない。
- 編集・削除の導線が存在しない（`F-005 AC-3`）。
- 主体には `システム` と運営者の代理閲覧も現れる（自動承認と代理閲覧の説明責任）。
- `OWNER` / `ADMIN` のみが到達する。取引先・`SALES` / `VIEWER` は到達しない。
- 関連 UC: UC-22（説明責任への回答）。
