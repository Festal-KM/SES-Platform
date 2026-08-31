# A-009 お知らせ・機能フラグ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-009
- 画面名: お知らせ・機能フラグ
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-061
- 対応ステージ: −（`CLAUDE.md` §10.4-8）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-009` / §8.1（存在しない選択肢を描画しない原則）/ §10.2
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-009
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. On this screen the operator publishes announcements and opens or closes optional features per tenant. When a feature is closed, the customer is told the reason; nothing degrades silently.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, checkboxes `[ ]` / `[x]`, text areas as stacked rules with a Japanese label above, date fields as small boxes containing a date.
- Status badges `< ラベル >` in angle brackets: `< 掲出中 >` filled, `< 予約 >` outline, `< 終了 >` outline, `< 開放 >` outline, `< 閉鎖 >` filled.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 田中（PLATFORM_OWNER）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `運用`, drawn filled black.
- A second, thinner row under the active tab: `お知らせ・機能フラグ` (current, underlined) / `デモ環境データ`.
- This screen allows writing (announcements and feature flags), so it does NOT carry the `閲覧のみ` badge.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: the feature-flag list contains ONLY optional features. It must NOT contain the quality gate, the information-boundary enforcement or the audit log, and it must not contain a grayed-out or disabled row or any footnote referring to them. Nothing on this screen may suggest that such a switch exists.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `お知らせ・機能フラグ` as the single largest text with the primary button `[ お知らせを作成 ]` at its right. Breadcrumb above it: `運用 ＞ お知らせ・機能フラグ`.

Content is a 2-column split: left about 52 percent (announcements), right about 48 percent (feature flags).

## Left column

### Section 1: `お知らせ` — table, 8 body rows
Columns: `本文（先頭 1 行）` / `対象` / `掲出期間` / `状態`
1. `9/5 02:00-04:00 にメンテナンスを実施します… / すべてのテナント / 2026-08-28 〜 2026-09-05 / < 掲出中 > filled`
2. `メール送信基盤の切り替えについて… / すべてのテナント / 2026-09-10 〜 2026-09-20 / < 予約 > outline`
3. `電子署名連携の提供開始について… / 北斗ソフトウェア ほか 3 社 / 2026-08-01 〜 2026-08-15 / < 終了 > outline`
4-8. five more rows of the same shape.

### Section 2: `お知らせの作成`
- `本文` a text area of five rules
- `対象テナント` `[ すべてのテナント ▾ ]`
- `掲出期間` two date boxes `2026-09-10` and `2026-09-20`
- `[ プレビュー ]` and `[ 掲出する ]`
- A bordered preview mock of the customer-facing announcement strip, showing the text wrapped over two lines inside a thin bordered band.
- A bordered note strip: `他テナントを特定できる情報は本文に含められません。`

## Right column

### Section 3: `機能フラグ` — table, 8 body rows
Columns: `機能` / `対象テナント` / `状態` / `閉鎖理由`
1. `電子署名連携 / 北斗ソフトウェア / < 開放 > outline / —`
2. `電子署名連携 / 〇〇システム / < 閉鎖 > filled / 外部サービスの障害のため一時停止しています（復旧見込み 9/2）`
3. `AI スキルシート解析 / さくらエンジニアリング / < 開放 > outline / —`
4. `AI 提案文の下書き / 青葉テクノサービス / < 閉鎖 > filled / トライアルプランでは提供していません`
5. `マッチングスコア / つばさネットワークス / < 開放 > outline / —`
6. `実績ダッシュボード / こもれびソリューション / < 閉鎖 > filled / Phase 3 の提供開始前です`
7-8. two more rows of the same shape.
IMPORTANT: this table contains only optional features such as the ones listed above. It must not contain rows for the quality gate, the information boundary or the audit log, in any state.

### Section 4: `機能の閉鎖` — a bordered confirmation dialog drawn beside the table with the small gray caption `閉鎖の確認ステップ`
Title `この機能を閉鎖します`
Body: `対象テナントの画面にこの理由が表示されます。`
`閉鎖理由` a text area of three rules carrying the word `必須`
Buttons `[ 閉鎖する ]` `[ キャンセル ]`

### Section 5: `履歴` — a compact table of 5 rows
Columns `日時` / `実施者` / `操作` / `対象`.

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `掲出中が 0 件のとき`: `掲出中のお知らせはありません`
- Caption `PLATFORM_SUPPORT が見たとき`: a band showing both tables with NO create form, NO open/close buttons and NO confirmation dialog, and the badge `閲覧のみ（テナント業務データに対して）` beside the title
```

## 設計意図メモ（画像生成には使われない）

- 統制を落とすフラグを作らない（`F-061 AC-4`）。`F-020`（品質ゲート）/ `F-004`（情報境界）/ `F-005`（監査ログ）は機能フラグの対象一覧に現れない。`gate-inspector` と同じく「存在しない選択肢を描画しない」（グレーアウトもしない。§8.1）。プロンプトで明示的に禁止した。
- 閉鎖時は理由を必須入力とし、顧客の画面にその理由が表示される旨を確認ステップで示す（`F-061 AC-1`。黙って劣化させない）。
- お知らせ本文に他テナントを特定できる情報を含められない（`F-061 AC-3`）。
- `PLATFORM_SUPPORT` は閲覧のみで、作成・開放・閉鎖の導線が存在しない。その状態を 1 枚の下部に併記した。
- 書き込みが許される 6 画面の 1 つなので `閲覧のみ` バッジを付けない（§3.3-4）。
- 関連 UC: UC-10（障害告知）。
