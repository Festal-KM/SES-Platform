# A-006 監査ログ横断検索（PII マスキング） — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-006
- 画面名: 監査ログ横断検索
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-058
- 対応ステージ: −（`CLAUDE.md` §10.4-6）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-006` / §3.3 / §10.2 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-006
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This is the only screen in the product where records are read across tenants, so personal data is masked and there is no route from a record to the underlying content.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, date fields as a small box containing a date.
- Masked values are written with visible masking characters, for example `山〇 〇〇` and `y〇〇〇〇@〇〇〇.co.jp`.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `記録`, drawn filled black.
- A second, thinner row under the active tab: `監査ログ` (current, underlined) / `代理閲覧の開始` / `代理閲覧の記録`.
- To the right of the screen title, a badge shown at all times: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: no row on this screen links to an engineer record, a skill sheet, a proposal body or a chat message. The 対象 column carries a type and an identifier only, never a personal name and never a clickable link into the tenant's data.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `監査ログ横断検索` as the single largest text with the `閲覧のみ（テナント業務データに対して）` badge beside it. Breadcrumb above it: `記録 ＞ 監査ログ`.

### Section 1: `検索条件`
One row of controls:
`期間（必須）` two date boxes `2026-08-25` and `2026-08-31`, with a small gray line under the label: `全期間の検索はできません`
`テナント` `[ すべて ▾ ]`
`操作種別` `[ すべて ▾ ]`
`主体` `[ すべて ▾ ]`
`対象種別` `[ すべて ▾ ]`
`[ 検索 ]`
A bordered note strip beside the controls: `この検索の実行も監査ログに記録されます。`

### Section 2: `結果` — table, 14 body rows
Columns: `日時` / `テナント` / `主体` / `操作` / `対象種別`
1. `2026-08-31 09:41:12 / 〇〇システム / 山〇 〇〇（ADMIN） / スキルシートのダウンロード / SkillSheet #4821`
2. `2026-08-31 09:40:55 / 〇〇システム / 山〇 〇〇（ADMIN） / スキルシートの閲覧 / SkillSheet #4821`
3. `2026-08-31 09:12:03 / 〇〇システム / 鈴〇 〇（SALES） / エンジニア詳細の閲覧 / Engineer #1204`
4. `2026-08-31 08:58:41 / 北斗ソフトウェア / 佐〇 〇（PARTNER_ADMIN） / 案件詳細の閲覧 / Project #322`
5. `2026-08-30 18:22:10 / 〇〇システム / システム / 承認 / Proposal #0137`
6. `2026-08-30 17:05:33 / さくらエンジニアリング / 田〇 〇（ADMIN） / 公開範囲の変更 / Project #118`
7. `2026-08-30 16:40:02 / 北斗ソフトウェア / 加〇 〇（SALES） / 提案の送信 / Proposal #2210`
8. `2026-08-30 11:11:19 / つばさネットワークス / 森〇 〇〇（OWNER） / 権限変更 / Membership #77`
9. `2026-08-29 20:02:48 / ひばりシステムズ / 運営者 佐〇（PLATFORM_SUPPORT） / 代理閲覧の開始 / ImpersonationSession #41`
10. `2026-08-29 19:58:12 / 〇〇システム / 山〇 〇〇（ADMIN） / ログイン / User #12`
11-14. four more rows of the same shape, mixing 作成, 更新, 削除, 却下 and ログアウト.
Above the table, a count line `該当 8,412 件` and paging `[ 前のページ ]` `1 - 100 / 8,412` `[ 次のページ ]`.
A gray line under the table: `個人名・メールアドレス・電話番号はマスキングして表示しています。チャット本文・提案本文・スキルシート本文は結果にもエクスポートにも含まれません。`

### Section 3: `検索の実行記録` — a compact table of 5 rows
Columns `実行日時` / `実行者` / `条件の要約`. Example: `2026-08-31 15:02 / 佐藤（PLATFORM_SUPPORT） / 2026-08-25〜08-31 ／ 〇〇システム ／ すべての操作`.

### Section 4: bottom row
Two text links: `[ 対象テナントの詳細を開く ]` and `[ 代理閲覧を開始する ]`, with a gray line: `状態とエラーで特定できない場合にのみ代理閲覧に進みます。`

### Three state strips at the very bottom, each with a small gray caption above it
- Caption `期間を指定していないとき`: `期間を指定してください（全期間の検索はできません）` with the search button drawn in a disabled gray state
- Caption `0 件のとき`: `条件に一致する記録はありません`
- Caption `結果が 10 万件を超えたとき`: `結果が多すぎます。期間を短くしてください（概算 132,400 件）`
```

## 設計意図メモ（画像生成には使われない）

- 期間を必須にする（`docs/03` 申し送り 9）。未指定では検索を実行させず、10 万件超では期間短縮を促す（§10.3 の `A-006`）。
- 個人名・メール・電話番号をマスキングして表示する（`F-058 AC-1`）。対象列は種別 + 識別子のみで、内容へ到達する導線を持たない（`F-058 AC-2` / `AC-3`）。
- 検索の実行そのものを監査ログに記録する（`F-058 AC-4`）。実行記録セクションを画面内に置いた。
- サポート導線（`A-006` → `A-007`）を末尾に置き、「状態とエラーで特定できない場合にのみ」と条件を書いた（§2.4 の 🔴）。
- 100 行表示（§7.1 の管理平面 監視系の既定）。
- 関連 UC: UC-10（障害調査）/ UC-22（顧客の説明要求への支援）。
