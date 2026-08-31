# S-043 サンドボックスの状況と本契約への移行 — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-043
- 画面名: サンドボックスの状況と本契約への移行
- 平面: 主平面
- 対応機能 ID: F-054 / F-028 / F-064
- 対応ステージ: −（設定）
- Tier: T2（申し送り 10 により 1 枚）
- 元設計書: `docs/04-ui-design.md` §4.8 `S-043` / §3.5 / `U-04` / `U-07`
- 生成する画像: `desktop.png`

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-043
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen belongs to a prospect who is trying the product in a SANDBOX tenant with their own real data. It shows how many days are left, exactly what does and does not happen in this environment, what must be finished before converting to a paid contract, and what happens if the deadline passes. Converting is performed by the vendor, not by the customer.

Style rules:
- Pure black and white. Light gray only for de-emphasis. No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Section headings in Japanese, small and bold. At most 3 heading levels.
- Buttons `[ ラベル ]`. Checklist items are drawn as `[x]` for done and `[ ]` for not done, with a status word beside each.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text.
- All visible text is Japanese. No photos, no logos, no icons on navigation, headings or buttons.
- The remaining-days figure is the single largest text on the page.

Persistent UI on this screen:
- At the very top, full width, a bordered environment banner of 3 wrapped lines that must NOT be squeezed onto one line:
  line 1 `サンドボックス環境 — 取引先への提案・契約書・署名依頼、および取引先の担当者宛のメール（招待を含む）は送信されません。`
  line 2 `取引先の招待は、画面に表示されるリンクをお渡しください。`
  line 3 `自社メンバー宛の招待・期限のお知らせは、お使いのアドレスに実際に届きます。それ以外は本番と同じ動作です`
  Under the box, one line of small gray annotation: `※ 本番環境ではこの帯は表示されない`.
- Header bar below the banner: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（管理者）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `設定` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ 設定 ＞ サンドボックスの状況`, the screen title `サンドボックスの状況` as the single largest heading.
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Environment banner, header and sidebar as in the shared prompt. One centred column of about 78 percent width.

### Section 1: `残り期間` — a heavy bordered band
`あと 12 日` set as the single largest text on the page, with `< 試用中 >` filled beside it, and under it a definition list: `開設日` `2026-08-19` / `期限` `2026-09-12` / `既定の期間` `30 日`.
A gray line: `期限予告のメールはお使いのアドレスに実際に届きます`

### Section 2: `この環境で何が起きて何が起きないか` — a bordered block of three numbered rows
1. `取引先への提案・契約書・署名依頼は送信されません`
2. `取引先の担当者宛のメール（招待を含む）も送信されません。招待は画面のリンクをお渡しください`
3. `自社メンバー宛の招待・期限のお知らせは実際に届きます`
IMPORTANT: do not write "メールは一切送信されません" and do not write "すべてのメールが届きます". The three rows must stay in this order and none may be merged.

### Section 3: `本契約への移行チェックリスト` — table, 4 body rows
Columns: `項目` / `状態` / `導線`
- `[ ] 送信ドメインの検証 / 未完了（本契約では必須） / [ 送信ドメインを設定する ]`
- `[x] メンバーの招待 / 完了（4 名） / [ メンバーを管理する ]`
- `[ ] 取引先の招待 / 未完了（0 社） / [ 取引先を招待する ]`
- `[x] 案件と人材の登録 / 完了（案件 6 件 / 人材 24 件） / [ 一覧を見る ]`
The incomplete rows are sorted to the top and their `状態` cell is emphasised.

### Section 4: `期限到来後に何が起きるか` — a bordered block of three wrapped lines
`期限までに本契約に至らない場合、この組織は解約手続き中となります。`
`新しいデータの作成ができなくなり、返却と閲覧のみ可能になります。`
`その 30 日後にエンジニアの連絡先・スキルシート・チャット本文が削除されます。`
With the text link `[ データの返却と保持期間を見る ]`.

### Section 5: bottom row
`[ 本契約について問い合わせる ]` and a gray line: `本契約への移行は運営者が行います。この画面から実行することはできません。`

### One state strip at the very bottom with a small gray caption above it
- Caption `期限が 7 日以内になったとき`: the remaining-days band redrawn with a heavier border and the badge `< 期限が近づいています >` filled, showing `あと 5 日`.
```

## 設計意図メモ（画像生成には使われない）

- 環境バナーの 3 点構成を画面本文にも再掲する（`U-07` / §3.5）。バナーは常時目に入るが、移行を検討する瞬間に必要な情報は操作の隣にあるべき。
- 「メールは一切送信されません」「すべてのメールが届きます」のどちらも書かない（`F-028 AC-2` / `docs/01` `R-2`）。3 行の順序（送信されない → 代替手段がある → 実際に届く）を固定した。
- 送信ドメインの検証を「本契約では必須」としてチェックリストの先頭に置く（`U-04` / `docs/03` 申し送り 2）。
- 移行そのものはテナント側から実行できない（`F-054 AC-7`）。その旨を導線の隣に明示する。
- 期限到来後の説明を隠さない（`F-054 AC-4` / `F-064`）。返却と削除の順序を書く。
- `production` のテナントではこの画面が存在せず、設定の目次にも出ない。
- 関連 UC: UC-24（サンドボックスから本契約へ）。
