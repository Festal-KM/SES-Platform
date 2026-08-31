# S-038 利用量と上限 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-038
- 画面名: 利用量と上限
- 平面: 主平面
- 対応機能 ID: F-026 / F-027
- 対応ステージ: 横断
- Tier: T2（申し送り 10 により 1 枚。申し送り 9 の優先度 7 位）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-038` / §5-4 / §5-5 / §10.3
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-038
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen shows how much of each limit the tenant has consumed. There are THREE kinds of limit and they behave differently when exceeded: an AI cost ceiling that STOPS the feature, a monthly AI quota that does NOT stop but switches to metered billing, and a storage limit that STOPS uploads. They must not be drawn with the same visual treatment.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- A usage meter is a plain horizontal bar in a thin box: the consumed portion is solid black, the remainder is white. Above each meter is its own label, and below it is the sentence that states what happens when it is exceeded.
- Buttons `[ ラベル ]`. Charts are bare line skeletons with axis labels only.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = a usage indicator reading `上限接近 82%` (this screen is one of the few where the header indicator IS drawn, because a limit is above 80 percent), then `通知 5` and the user menu `山田（営業）`.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ 利用量と上限`, the screen title `利用量と上限` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. One column: a status band, then a 2 by 3 arrangement of limit blocks, then a history chart.

### Section 1: `現在の状態` — a bordered band at the very top
`< 停止中の機能があります >` filled, followed by a list of two lines: `停止中: スキルシートの読み取り` and `停止中: 提案文の下書き`
and one line of reason: `AI コスト（日次上限）に達したため`.

### Section 2: `AI コスト（日次上限）` — a bordered block whose caption says it STOPS
- Meter bar filled to 100 percent.
- Values: `使用量 20.00 USD / 上限 20.00 USD / 残量 0.00 USD`
- `リセット時刻` `明日 00:00（Asia/Tokyo）`
- Emphasised line: `上限に達したため AI 機能を停止中`
- A list of stopped features: `スキルシートの読み取り` / `提案文の下書き` / `候補の根拠説明` / `延長判断の論点整理`

### Section 3: `AI 利用量クォータ（月次）` — a bordered block whose caption says it does NOT stop
- Meter bar filled to 100 percent with a small separate box to its right labelled `超過分`, because the bar is capped and does not grow past 100 percent.
- Values: `消化率 118% / クォータ 300,000 トークン`
- Emphasised line: `超過が始まりました。以降の利用は従量課金になります。`
- `超過分の従量額` `4.80 USD`
IMPORTANT: this block must look different from the AI cost block above. Its headline value is the metered amount, not a remaining amount, and it does not carry a "停止中" statement.

### Section 4: `ストレージ` — a bordered block whose caption says it STOPS uploads
- Meter bar filled to about 84 percent.
- Values: `使用量 42.1 GB / 上限 50.0 GB / 残量 7.9 GB`
- Emphasised line: `上限に達するとファイルのアップロードができなくなります`
- A gray line: `80% で通知します`

### Section 5: `メール` — a bordered block containing TWO separate meters, never merged
- Meter A `本日の送信数` filled to about 97 percent, values `488 通 / 日次上限 500 通`, line `日次上限を超えると送信は停止します`
- Meter B `直近 1 分の送信数` filled to about 20 percent, values `6 通 / 分次上限 30 通`, line `分次上限を超えた分は待機します`

### Section 6: `席数`
- Meter bar filled to 60 percent, values `12 席 / 上限 20 席`.

### Section 7: `履歴（日次推移）`
A simple line chart with the x axis labelled `8/1` to `8/31` and the y axis labelled `AI コスト（USD）`, plus a gray line: `本日分は集計中（1 時間ごとに更新）`.

### Section 8: bottom row
Text link `[ プランの変更を相談する ]` and a gray line: `上限の変更は運営者側で行います。この画面からは変更できません。`

### One state strip at the very bottom with a small gray caption above it
- Caption `取引先の利用者が同じ画面に到達したとき`: a narrow band showing NO meters, NO remaining amounts, NO limit values and NO reset time — only the sentence `AI の利用上限に達しているため、この操作は実行できません` shown at the place of the operation.
```

## 設計意図メモ（画像生成には使われない）

- 3 種類の上限を同じ見た目にしない（`docs/03` 申し送り 6 / 12 / §5-4）。停止するもの（AI コスト・ストレージ）は残量と停止条件を、従量に移行するもの（AI クォータ）は超過分の従量額を主表示にした。
- メールは分次と日次を別メーターで描く（`F-027 AC-2`）。
- クォータ超過時のメーターは 100% で頭打ちにし、バーを伸ばさず超過分を数値で示す（§10.3 の `S-038` 固有の扱い）。
- 当日分は「集計中（1 時間ごとに更新）」と明示する。リアルタイムに見えて実は遅れている状態を作らない。
- 残量・上限値・リセット時刻はホスト所属ロールにのみ表示し、パートナーには停止の事実と理由だけを操作の場所で示す（`F-027 AC-1`）。1 枚の下部にその差を併記した。
- ヘッダの上限インジケータは 80% 超過時のみ描かれる。本画面は超過状態なので描く。
- 関連 UC: UC-10（上限到達時の運用）/ UC-16（AI 機能の停止）。
