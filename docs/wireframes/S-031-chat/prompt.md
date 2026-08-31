# S-031 チャット — ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-031
- 画面名: チャット
- 平面: 主平面
- 対応機能 ID: F-038 / F-011 / F-020
- 対応ステージ: ③④（越境経路 3）
- Tier: T1（モバイル完結）
- 元設計書: `docs/04-ui-design.md` §4.7 `S-031` / §5-11 / §10.1 / §10.3
- 生成する画像: `desktop.png` / `tablet.png` / `mobile.png`（Tier 1 のため 3 デバイス分）

## 生成方法

```bash
node scripts/generate-wireframes.mjs --screen S-031
```

## 共通プロンプト

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese B2B SaaS called "SES Platform" — a workspace that unifies the sales and staffing work of Japanese SES companies. This screen is the chat between the host company and exactly ONE partner company per thread. A company that is not a participant cannot learn that the thread exists at all. Attachments are not visible to the other side until a virus scan says they are clean, and every message passes the quality gate before it is posted.

Style rules:
- Pure black and white. Light gray only for de-emphasis (own older messages, secondary notes). No other colors.
- Sharp-cornered rectangles everywhere. No rounded corners, no shadows, no gradients.
- Message bubbles are plain rectangles with a thin border; own messages are right aligned, the counterpart's are left aligned. Each has a small sender line above it with the person name, the company name and the time.
- Buttons `[ ラベル ]`. Attachments are empty rectangles with a diagonal cross and a Japanese caption.
- Status badges `< ラベル >` in angle brackets. Filled = black background with reversed text; dashed = dashed border for in-progress states.
- All visible text is Japanese. No photos, no logos, no emoji, no reaction icons, no icons on navigation, headings, buttons or badges.
- Dense and realistic.

Persistent UI on this screen:
- Header bar across the full width: left = the wordmark `SES Platform` (the only place the product name is written), then the scope display `〇〇システム`; right = `通知 5` and the user menu `山田（営業）`. Do NOT draw a usage meter in the header.
- Left sidebar, fixed width, text only, no icons: `ホーム`, `① 人材`, `① 案件`, `② 候補を探す`, `③ 提案`, `③ 提案依頼`, `④ 面談・結果`, `⑤ 契約`, `⑥ 稼働`, `チャット`, `タスク`, `実績`, `設定`. `チャット` is the current item with a filled bar.
- Content area top: breadcrumb `ホーム ＞ チャット`, the screen title `チャット` as the single largest text.
- No environment banner (this wireframe depicts the production environment).
```

## desktop.png プロンプト

```
Layout: desktop browser view, landscape. Header and sidebar as in the shared prompt. The content is a 3-column split: thread list (about 24 percent), messages (about 50 percent), thread information (about 26 percent).

## Column 1: `スレッド一覧` — 8 rows
Each row: the subject, the counterpart company, the first line of the last message truncated to one line, a relative time and an unread count.
- `金融系 Web API 改修 / △△テック / 面談の候補日ですが… / 35 分前 / 2`  (selected row, marked with a filled left edge)
- `保険基幹系マイグレーション / ▲▲ソリューション / 承知しました。明日中に… / 2 時間前 / —`
- `△△テック（企業スレッド） / △△テック / 契約書の宛名について / 昨日 / 1`
- `EC サイト基盤刷新 / ■■エンジニアリング / スキルシートを送りま… / 昨日 / —`
- four more rows of the same shape.
Above the list a search field `スレッドを検索` ______________.

## Column 2: `メッセージ`
- A thread header line: `金融系 Web API 改修` ・ `参加会社: 〇〇システム / △△テック`
- Directly under the header, a connection indicator strip: `接続中` in small gray text.
- 7 messages alternating sides:
  1. left `佐藤 健 / △△テック / 8/30 14:02` — `候補の件、社内で確認しました。`
  2. right `山田 / 〇〇システム / 8/30 14:20` — `ありがとうございます。面談の候補日を 3 つお送りします。`
  3. left `佐藤 健 / △△テック / 8/31 09:11` — `9/3 13:00 で調整可能です。`
  4. right `山田 / 〇〇システム / 8/31 09:40` — `了解しました。先方に確定でお伝えします。`
  5. left `佐藤 健 / △△テック / 8/31 10:05` — with an attachment rectangle labelled `skillsheet_v5.pdf` and, next to it, the badge `< CLEAN > outline`
  6. right `山田 / 〇〇システム / 8/31 15:22` — with an attachment rectangle labelled `面談案内.pdf` and, next to it, the badge `< 検査中 > dashed` plus the gray line `検査が完了するまで相手には表示されません`
  7. left `佐藤 健 / △△テック / 8/31 16:10` — `よろしくお願いいたします。`
- A composer at the bottom: a text area of three rules, an `[ 添付 ]` button and a `[ 送信 ]` button.
- A bordered strip above the composer, drawn with the small gray caption `ゲートで止まったとき`: `品質ゲートで指摘があるため投稿されていません` with one finding line `本文にエンド企業名が含まれています（「富士アルファ銀行」）` and the text link `該当箇所へ`.

## Column 3: `スレッド情報`
Definition list: `対象` `案件: 金融系 Web API 改修` / `参加会社` `〇〇システム / △△テック` / `作成日` `2026-08-28`
A gray line: `このスレッドは 2 社のみが参加しています`
Then `添付一覧` as a table of 5 rows with columns `ファイル` / `送信者` / `日時` / `スキャン状態`.

### One state strip at the very bottom with a small gray caption above it
- Caption `接続が切れたとき`: a strip drawn immediately above the composer reading `接続が切れています。再接続しています…` with the send button rendered as `[ 送信待ち ]`.
```

## tablet.png プロンプト

```
Layout: tablet landscape view. Header and sidebar as in the shared prompt.

TWO panes only, not three: the thread list on the left (about 34 percent) and the messages on the right (about 66 percent). The thread information column is not shown inline; instead a `[ スレッド情報 ]` button in the thread header opens it as a sheet, drawn half-open over the right edge showing 対象 / 参加会社 / 添付一覧.

The message area contains the same 7 messages, the `接続中` indicator, the two attachments with `< CLEAN >` and `< 検査中 >`, and the composer with `[ 添付 ]` and `[ 送信 ]`.

IMPORTANT: this is not a shrunken desktop; the third column becomes a sheet rather than a narrow strip.
```

## mobile.png プロンプト

```
Layout: mobile portrait view, single column. This image shows the MESSAGE screen (the second of the two mobile screens: list then messages).

Order from top:
1. Compact header: a back affordance on the left, the thread subject `金融系 Web API 改修` centered on one line with `△△テック` in small gray under it, and a `[ スレッド情報 ]` text link on the right.
2. A connection indicator strip directly under the header reading `接続が切れています。再接続しています…`.
3. A scrolling message list of 6 messages alternating sides, each with the sender line `氏名 / 会社名 / 時刻` above the bubble. One incoming message carries an attachment rectangle labelled `skillsheet_v5.pdf` with `< CLEAN >`; one outgoing message carries `面談案内.pdf` with `< 検査中 >` and the gray line `検査が完了するまで相手には表示されません`.
4. A bottom fixed composer: a one-line text field, an `[ 添付 ]` button and a send button rendered as `[ 送信待ち ]` because the connection is down.
5. Bottom tab bar with 5 text labels: `ホーム` / `提案` / `候補` / `チャット` / `その他`, with `チャット` active.

IMPORTANT: sending and attaching are both completed on mobile. The disconnected state is always visible above the composer, never hidden.
```

## 設計意図メモ（画像生成には使われない）

- スレッドは常にホスト 1 社 + パートナー 1 社（`F-038 AC-2`）。スレッド情報に参加会社を明示し、他社の存在に到達する経路を作らない（`F-038 AC-1`）。
- 検査中の添付は自分側にのみ「検査中」として見え、相手側には表示されない（相手に「何か送られてくる」ことを先に見せない）。
- SSE の切断・再接続を常時表示し、送信ボタンを送信待ちの表現に切り替える（§5-11 / `docs/03` 申し送り 10）。モバイル画像でその状態を描いた。
- 投稿は `F-020` のゲートを通す。FAIL のときは投稿されず、指摘と修正導線のみを出す。
- 運営者はチャット本文に到達しない（代理閲覧中も。`BR-40`）。したがって管理平面には本文が出る画面が無い。
- 関連 UC: UC-17（チャット）/ UC-07（面談調整の連絡）。
