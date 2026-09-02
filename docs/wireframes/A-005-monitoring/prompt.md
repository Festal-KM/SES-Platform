# A-005 運用監視 ★ — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: A-005
- 画面名: 運用監視（必須画面）
- 平面: 管理平面（運営者コンソール `/admin`）
- 対応機能 ID: F-059 / F-026 / F-043
- 対応ステージ: −（`CLAUDE.md` §10.4-5）
- Tier: T3（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.9 `A-005` / §5-9 / §6.9 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen A-005
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for the OPERATOR CONSOLE of a Japanese multi-tenant B2B SaaS called "SES Platform" (a workspace that unifies the sales and staffing work of Japanese SES companies). This console lives at the route /admin and is used only by the SaaS provider's own staff. It must look unmistakably different from the customer-facing app. This screen exists so that the vendor notices a problem before the customer does. It shows only counts, states, error kinds and timestamps — never the content of any business record.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`, dropdowns `[ ラベル ▾ ]`, text links written plainly.
- Tables carry 10 to 15 body rows with Japanese column headers, thin rules and tight row height.
- A threshold breach is drawn as a bordered strip that always contains four facts: what, in which tenant, since when, and what the threshold is.
- All visible text is Japanese. No photos, no logos, no icons on tabs, headings, buttons or badges.
- Very high information density. Monitoring screens never hide columns.

Persistent UI on every operator screen:
- A full-width BLACK-FILLED band at the very top reading `運営者コンソール` in reversed white text. The customer-facing plane has no such band.
- Directly under the band, a header row: left = the wordmark `SES Platform`; right = `運営者: 佐藤（PLATFORM_SUPPORT）` with the role spelled out.
- Navigation is a HORIZONTAL TAB STRIP directly beneath the header, NOT a left sidebar: `監視 (3)` / `テナント` / `契約` / `記録` / `運用`. The active tab is `監視 (3)`, drawn filled black, and it carries the alert count badge.
- A second, thinner row under the active tab: `運用監視` (current, underlined) / `原価・粗利`.
- To the right of the screen title, a badge shown at all times: `閲覧のみ（テナント業務データに対して）`.
- No environment banner (this wireframe depicts the production environment).

IMPORTANT: this screen never shows a proposal body, an engineer name, a skill-sheet excerpt or a chat message, and has no link that leads to any of them.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Black band, header row and tab strip as in the shared prompt. Title row: `運用監視` as the single largest text with the `閲覧のみ（テナント業務データに対して）` badge beside it and, at the far right, the line `最終更新: 2026-08-31 16:04:22`.

### Section 1: `閾値超過` — four bordered warning strips at the very top, each containing four facts
1. `未対応の SUBMIT_FAILED が閾値を超えています ／ 北斗ソフトウェア ／ 2026-08-28 11:04 から ／ 閾値 5 件（現在 7 件）`
2. `ゲート FAIL 率が急変しています ／ 〇〇システム ／ 2026-08-29 から ／ 閾値 前週比 +3.0pt（現在 +3.1pt）`
3. `満了 60 日前の未起票が発生しています ／ つばさネットワークス ／ 2026-08-31 03:00 の照合 ／ 閾値 0 件（現在 1 件）`
4. `送信ドメインが未検証のまま長期化しています ／ みどり情報システム ／ 開設から 9 日 ／ 閾値 3 日（現在 9 日）`

### Section 2: `監視項目` — one dense table, 12 body rows, columns are NEVER hidden
Columns: `監視項目` / `対象テナント` / `件数` / `最も古い経過時間` / `閾値超過` / `導線`
1. `未対応の SUBMIT_FAILED / 北斗ソフトウェア ほか 3 テナント / 18 件 / 3 日 2 時間 / 超過 / [ テナント詳細 ] [ 監査ログ ] [ 代理閲覧 ]`
2. `SUBMITTING の滞留 / 〇〇システム / 1 件 / 41 分 / — / [ テナント詳細 ] [ 監査ログ ] [ 代理閲覧 ]`
3. `失敗ジョブ / 全体 / 6 件（メール送信 4 / PDF 変換 2） / 5 時間 / — / [ テナント詳細 ]`
4. `ウイルススキャン失敗 / さくらエンジニアリング / 2 件 / 1 日 / — / [ テナント詳細 ]`
5. `ゲート FAIL 率の異常 / 〇〇システム / 9.4%（前週比 +3.1pt） / — / 超過 / [ テナント詳細 ]`
6. `計測欠測 / つばさネットワークス / 1 件（AI コスト 8/29） / 2 日 / 超過 / [ テナント詳細 ]`
7. `削除ジョブ失敗 / ひばりシステムズ / 0 件 / — / — / —`
8. `満了 60 日前の未起票 / つばさネットワークス / 1 件 / 本日 / 超過 / [ テナント詳細 ]` — this row carries the inline line `本日の照合: 未起票 1 件（要件は 0 件）`
9. `匿名候補の一意率 / 青葉テクノサービス / 12.4% / — / — / [ テナント詳細 ]` — with the gray note `表示は抑止していません。粒度見直しの判断材料です。`
10. `SENDING の滞留 / 未対応 SEND_FAILED / 電子署名の未着 / 北斗ソフトウェア / 3 件 / 2 日 / — / [ テナント詳細 ]`
11. 🔴 `送信ドメインが未検証・失効 / みどり情報システム ほか 2 テナント / 3 件（未検証 2・失効 1） / 9 日 / 超過 / [ テナント詳細 ]` — this row carries the inline line `このテナントは取引先へ 1 通も送れません`
12. 🔴 `GATE_RUNNING の滞留 / 〇〇システム / 4 件（AI 日次上限による停止 3・ジョブ失敗 1） / 6 時間 / — / [ テナント詳細 ] [ 利用量・クォータ ]` — the two reasons (`AI 日次上限による停止` と `ジョブ失敗`) are written out as separate counts on the same row, never merged into one number, and a gray note reads `上限による滞留は項目 1・3・5 のいずれにも加算していません`
The `監視項目` column wraps to show its full text and is never truncated, because a truncated error kind hides the cause.
Under the table, a gray line: `直近 7 日を都度集計しています。`

### Section 3: `本日の照合結果` — a compact table of 12 rows echoing each item with its count, including the zeros
Columns `監視項目` / `本日の照合`. Example rows: `満了 60 日前の未起票 / 1 件`, `削除ジョブ失敗 / 0 件`, `計測欠測 / 1 件`, `ウイルススキャン失敗 / 2 件`, `送信ドメインが未検証・失効 / 3 件`, `GATE_RUNNING の滞留 / 4 件`, and six more, several of which read `0 件`.
A gray line: `0 件のときも照合が成立したことを表示します。`

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `全項目 0 件のとき`: `異常は検知されていません` followed by the full 本日の照合結果 table with every row reading `0 件`. The page is NOT empty.
- Caption `1 項目が 1,000 件を超えたとき`: `未対応の SUBMIT_FAILED 1,284 件 ／ 最も古い経過時間 6 日 4 時間` with `[ テナントで絞り込む ]` and no detail rows.
```

## 設計意図メモ（画像生成には使われない）

- 異常が上位に来ていることが一目で分かる構成にする（申し送り 6 / §6.9）。最上部を閾値超過の 4 ストリップにし、各ストリップに「何が・どのテナントで・いつから・閾値はいくつか」の 4 点を必ず含める（§5-9）。
- 0 件でも「本日の照合結果」を明示する（`A-005` の空状態）。監視が動いていないのか異常が無いのかを区別できるようにする。特に満了 60 日前の未起票は静かに壊れる指標であり、0 件の明示が要件（`BR-34`）。
- `SUBMIT_FAILED` を `LOST` / `GATE_FAILED` / `DECLINED` と混ぜない（`F-059 AC-2`）。`SENDING` の滞留も `WITHDRAWN` / `EXPIRED` と混ぜない。
- 🔴 項目 11（送信ドメイン未検証・失効）を追加した（`F-059 AC-5` / `U-04`）。オンボーディングが止まっている顧客に、顧客が「使えない」と気づく前に運営者が伴走するための項目。行から `A-003` へのみ遷移し、業務データには立ち入らない。
- 🔴 項目 12（`GATE_RUNNING` の滞留）を追加した（`F-059 AC-6` / `F-027 AC-5`）。理由を「AI 日次上限による停止」と「ジョブ失敗」で必ず区別し、上限による滞留は項目 1（未対応 `SUBMIT_FAILED`）・項目 3（失敗ジョブ）・項目 5（ゲート FAIL 率）のいずれにも加算しない（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。導線は `A-004`（クォータの引き上げ）にも繋ぐ。
- 各行からサポート対応（`A-003` → `A-006` → `A-007`）への導線を繋ぐ（§6.9）。
- 監視画面では列を隠さない（§10.3 の表）。エラー種別は折り返して全文を出す。
- 最終更新時刻を秒単位で表示する（監視では鮮度が最優先）。
- 関連 UC: UC-10（サポート対応）。
