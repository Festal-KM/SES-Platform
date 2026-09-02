# A-008 代理閲覧の記録 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-008
- 画面名: 代理閲覧の記録
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-060 / F-058
- 対応ステージ: −（`CLAUDE.md` §10.4-7）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-008` / §3.3-4（バッジの射程注記）/ §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-008
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen is the evidence trail for impersonation: who looked at which organisation, when, for what reason, for how long, and whether the customer was notified.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; outline = thin border; dashed = dashed border for a session still running.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `記録`, drawn filled black.
- A second, thinner row under the active tab: `監査ログ` / `代理閲覧の開始` / `代理閲覧の記録` (current, underlined).
- To the right of the screen title, a badge shown at all times, WITH its scope note written out inside the badge: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `代理閲覧の記録` as the single largest text with the badge `閲覧のみ（テナント業務データに対して）` beside it. Breadcrumb above it: `記録 ＞ 代理閲覧の記録`.

Directly under the title row, one line of gray text explaining why a stop button can coexist with the badge: `バッジの射程はテナントの業務データに対する閲覧のみです。セッションの強制終了は read-only 統制を守るための操作であり、業務データへの書き込みではありません。`

### Section 1: `進行中のセッション` — a bordered block at the very top
`< 進行中 >` dashed, then a definition list on one row: `対象` `ひばりシステムズ` ・ `実施者` `佐藤（PLATFORM_SUPPORT）` ・ `開始` `2026-08-31 15:52` ・ `時間制限` `15 分` ・ `残り` `08:12`
On the right of the block, the button `[ セッションを強制終了する ]` and a gray line under it: `PLATFORM_OWNER のみ`.
A second gray line: `残り時間は毎秒更新されます`

### Section 2: `履歴` — table, 12 body rows
Columns: `開始日時` / `実施者` / `対象テナント` / `理由` / `時間制限` / `実際の所要` / `通知の送信状態`
1. `2026-08-31 15:52 / 佐藤（PLATFORM_SUPPORT） / ひばりシステムズ / 問い合わせ #1051。招待メールが届かない件の調査 / 15 分 / 進行中 / < 送信済み > outline`
2. `2026-08-29 20:02 / 佐藤（PLATFORM_SUPPORT） / 〇〇システム / 問い合わせ #1042。提案 P-0142 が送信失敗のまま復旧できない件の調査 / 15 分 / 11 分 / < 送信済み > outline`
3. `2026-08-27 11:31 / 田中（PLATFORM_OWNER） / 北斗ソフトウェア / 問い合わせ #1038。ゲート FAIL 率の急変についての調査 / 30 分 / 22 分 / < 送信失敗 > filled` — this row carries an inline bordered warning: `通知が届いていません。対象組織の管理者に手動で連絡してください。`
4. `2026-08-24 09:14 / 佐藤（PLATFORM_SUPPORT） / さくらエンジニアリング / 問い合わせ #1030。スキャン失敗の調査 / 15 分 / 6 分 / < 送信済み > outline`
5-12. eight more rows of the same shape, with reasons that are full sentences and are truncated to one line with a trailing marker.
Above the table a filter strip: `期間` two date boxes / `実施者` `[ すべて ▾ ]` / `対象テナント` `[ すべて ▾ ]` / `[ 検索 ]`, and a count line `代理閲覧 41 件`.
Under the table, paging and the button `[ 顧客提示用にエクスポート ]`.

### Section 3: `セッション詳細` — a compact table of 8 rows for the selected session
Columns `日時` / `操作` / `対象種別`
Example rows: `2026-08-29 20:03:11 / 画面の閲覧 / 提案の承認画面`, `2026-08-29 20:05:40 / 画面の閲覧 / 送信失敗一覧`, `2026-08-29 20:08:02 / 画面の閲覧 / 提案詳細`.
A gray line: `この記録には閲覧の操作のみが含まれます。実行系の操作は代理閲覧中に発生しません。`

### One state strip at the very bottom with a small gray caption above it
- Caption `記録が無いとき`: `代理閲覧の記録はありません`
```

## 設計意図メモ（画像生成には使われない）

- `閲覧のみ` バッジに射程の注記（「テナント業務データに対して」）を添える（申し送り 8 の 🔴 / §3.3-4）。この画面は `セッションを強制終了` を同居させるため、注記が無いと矛盾して見える。タイトル直下にも 1 行の説明を置いた。
- 通知の送信失敗を隠さず、警告として記録に残す（§4.9 `A-008`）。通知されない代理閲覧が成立してしまった事実を隠さない。
- 理由は全文が記録され、顧客提示用にエクスポートできる（`F-060 AC-6`）。一覧では 1 行に切り詰めるが詳細では全文。
- 強制終了は `PLATFORM_OWNER` のみ。本画像は `PLATFORM_OWNER` 視点。
- セッション詳細に閲覧操作のみが並ぶことで、代理閲覧が read-only であることが記録の側からも読める。
- 関連 UC: UC-10（サポート対応）/ UC-22（説明責任）。
