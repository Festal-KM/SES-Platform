# S-038 利用量と上限 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-038
- 画面名: 利用量と上限
- 平面: 主平面
- 対応機能 ID: F-026 / F-027
- 対応ステージ: 横断
- Tier: T2（申し送り 10 により 1 枚。申し送り 9 の優先度 8 位）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-038` / `U-12` / §5-4 / §5-5 / §10.3 / §11-10
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-038
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen shows how much of each limit the tenant has consumed. 🔴 Every figure a tenant user sees on this screen is a COUNT, a number of e-mails, a number of gigabytes, or a number of seats — NEVER a dollar or yen amount. The one and only place money appears is a separate "estimated overage charge" block near the bottom, which is a billing figure, not a remaining-quota figure. The AI daily cost ceiling itself is NEVER shown as a gauge or a number at all — it is a circuit breaker: nothing is drawn for it while it has not been hit, and when it has been hit, only the fact "stopped" plus the reason and the reset time are shown, with no dollar figure and no percentage.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- A usage meter is a plain horizontal bar in a thin box: the consumed portion is solid black, the remainder is white. Above each meter is its own label in Japanese with a COUNT unit (件 / 通 / GB / 席), never a currency symbol. Below it is the sentence that states what happens when it is exceeded.
- Buttons `[ ラベル ]`. Charts are bare line skeletons with axis labels only, labelled with a count unit.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = a usage indicator reading `AI 停止中` in a filled badge (this screen is one of the few where the header indicator IS drawn, because the AI daily cost ceiling has been hit — when it has NOT been hit, this indicator is entirely absent, never a percentage), then `通知 5` and the user menu `山田（営業）`.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 利用量と上限`, the screen title `利用量と上限` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column, top to bottom: stopped-features band, then the 4 AI count quotas, then mail, then storage, then seats, then the overage billing block, then a history chart.

### Section 1: 🔴 `停止中の機能` — a bordered band at the very top, filled badge, NO gauge and NO dollar figure anywhere in this section
`< AI が停止中です >` filled
`AI の日次上限に達したため停止中（リセット: 本日 24:00・Asia/Tokyo）`
A list of what is stopped: `スキルシートの読み取り` / `候補の根拠説明` / `提案文の下書き` / `延長判断の論点整理` / `品質ゲートの実行（提案・契約書を送れません）`
IMPORTANT: this band contains no currency amount, no percentage and no consumed/limit numeric pair — only the fact that it is stopped, the reason, and the reset time.

### Section 2: 🔴 `AI の件数クォータ（月次・4 種）` — FOUR separate meter blocks, each its own count, none merged into a single percentage
- `スキルシート解析` meter filled to about 66 percent, values `あと 62 件 / 180 件`, line `超過後は超過分が従量課金になります`
- `マッチング候補の根拠文` meter filled to about 80 percent, values `あと 1,240 件 / 6,200 件`, same line
- `提案ドラフト` meter filled to 100 percent with a small separate box to its right labelled `超過分`, values `あと 0 件 / 180 件`, emphasised line `超過が始まりました。以降は従量課金になります。` with the text link `セクション 6 へ`
- `延長論点の整理` meter filled to about 40 percent, values `あと 12 件 / 20 件`, same line as the first two
IMPORTANT: no gray note, footnote or any other text naming any internal AI role or process appears anywhere in or under this section — the fact that the quality gate is separate from these four quotas is already covered by Section 1 when it applies, and is not repeated here.

### Section 3: `メール` — a bordered block containing TWO separate meters, never merged
- Meter A `本日の送信数` filled to about 97 percent, values `488 通 / 日次上限 500 通`, line `日次上限を超えると送信は停止します`
- Meter B `直近 1 分の送信数` filled to about 20 percent, values `6 通 / 分次上限 30 通`, line `分次上限を超えた分は待機します`

### Section 4: `ストレージ` — a bordered block whose caption says it STOPS uploads
- Meter bar filled to about 84 percent.
- Values: `使用量 42.1 GB / 上限 50.0 GB / 残量 7.9 GB`
- Emphasised line: `上限に達するとファイルのアップロードができなくなります`
- A gray line: `80% で通知します`

### Section 5: `席数`
- Meter bar filled to 60 percent, values `12 席 / 上限 20 席`.

### Section 6: 🔴 `超過分の請求見込み` — the ONLY block on this screen that shows money, visually separated from the meters above by a heavier rule
`超過分の請求見込み 4,800 円（8/1〜8/31 時点）` as the single dollar-adjacent figure on the page, with the gray line `これは残量の表示ではなく請求です。クォータのメーターとは別のブロックです。`

### Section 7: `履歴（日次推移）`
A simple line chart with the x axis labelled `8/1` to `8/31` and the y axis labelled `スキルシート解析（件）` — a count, not a currency — plus a gray line: `本日分は集計中（1 時間ごとに更新）`.

### Section 8: bottom row
Text link `[ プランの変更を相談する ]` and a gray line: `上限の変更は運営者側で行います。この画面からは変更できません。`

### Two state strips at the very bottom, each with a small gray caption above it
- Caption `平常時（AI の日次上限に達していないとき）`: Section 1 is entirely absent — no band, no badge — and the header carries no `AI 停止中` indicator at all (nor any percentage in its place). All four Section 2 meters are below 80 percent.
- Caption `取引先の利用者が同じ画面に到達したとき`: a narrow band showing NO meters, NO remaining counts, NO limit values and NO reset time — only the sentence `AI の利用上限に達しているため、この操作は実行できません` shown at the place of the operation.
```

## 設計意図メモ（画像生成には使われない）

- 🔴 利用者に見せる残量は件数であり、金額を 1 つも出さない（2026-09-01、Issue #12。`F-027 AC-6` / `U-12`）。旧版が USD の使用量・上限・残量を描いていたのは決定前の暫定であり、本改訂で全廃した。
- 🔴 AI の 1 日のコスト上限はメーターにしない。到達したときだけ「停止中」と理由・再開条件を出す遮断器として扱う（`S-038` セクション 1）。平常時はヘッダにも本文にも一切現れない。
- 🔴 AI の件数クォータは 4 種を個別に出す（スキルシート解析 / 候補の根拠文 / 提案ドラフト / 延長論点整理）。集約した 1 つの数字にしない（`S-038` と同じ 4 単位を `A-004` でも使う）。超過は停止せず従量課金に移行するため、ストレージ（停止する）と同じ見た目にしない（`docs/03` 申し送り 6 / 12）。
- 金額を出してよい唯一の場所はセクション 6（超過分の請求見込み）。残量メーターとは視覚的に分離し、「請求であって残量ではない」ことを明示した（`BR-24`）。
- 品質ゲートの検査消費はクォータ外であり、メーターを作らない（`F-027 AC-7`）。上限到達でゲートが止まっているときはセクション 1 の停止項目「品質ゲートの実行（提案・契約書を送れません）」で示す。🔴 2026-09-01 改訂: 業務画面には AI 運用ロールの内部識別子（`docs/04` §9.2）を出さないため、セクション 2 直下のロール名を名指しした注記を削除した。内部識別子は `S-039` のモデル設定行と `A-011` のロール別原価内訳にのみ併記する。
- メールは日次・分次を別メーターで描く（`F-027 AC-2`）。当日分は「集計中（1 時間ごとに更新）」と明示し、リアルタイムに見えて実は遅れている状態を作らない。**セクション順は `docs/04` §4.8 の記載どおりメール → ストレージ**（2026-09-01 改訂で順序を修正）。
- 残量・上限値・リセット時刻はホスト所属ロールにのみ表示し、パートナーには停止の事実と理由だけを操作の場所で示す（`F-027 AC-1`）。1 枚の下部にその差を併記した。
- ヘッダの上限インジケータは、AI 停止時は「AI 停止中」の文字バッジのみで、パーセンテージは表示しない（メール・ストレージ・席数が 80% を超えた場合は別途パーセンテージ表示があり得るが、本画像は AI 停止のケースを描いている）。
- 関連 UC: UC-10（上限到達時の運用）/ UC-16（AI 機能の停止）。
