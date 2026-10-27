# 開発の進め方（Claude Code ＋ Codex）

> 対象: このリポジトリで、Claude Code と Codex を使って機能を作るメンバー。
> 元になったもの: 2026-10-26〜27 のチャット（S-031）の開発で、紺野が実際に回したやり方。
> 前提: `CLAUDE.md`（一次資料）・`HANDOFF.md`（引き継ぎ）・`UI_GUIDELINES.md`（画面の規約）・`AGENTS.md`（Codex 向け）を先に読む。この手順書はそれらを上書きしない。食い違ったら `CLAUDE.md` が正。

## 1. 役割

| 誰 | やること |
|---|---|
| **あなた（人間）** | 何を作るかを決める。**マージ・デモへの反映・CLAUDE.md の変更に OK を出す** |
| **Claude Code（メインのセッション）** | 段取り・仕様書・確認・PR・マージ・反映。小さな修正は自分で直す |
| **プログラマー役（Claude のサブエージェント `programmer`）** | 大きめの実装（DB・API・画面・テスト）を裏で作る |
| **`code-reviewer`（Claude のサブエージェント）** | 境界・DB に触る変更を 1 回レビューする |
| **Codex** | 別の目でのレビュー（読むだけ）と、画面の点検（AI くささの点数）。画面の小さな修正も頼める |
| **宮田** | `CLAUDE.md` の変更と、自分の担当の外に影響する変更を PR で確認する |

## 2. 1 つの機能の流れ

1. **依頼する** —— 「こうしたい」を Claude Code に伝える。画面のことは写真を貼ると早い。
2. **仕様書を先に直す** —— Claude に `docs/02` → `docs/04` → `docs/05` の順で書かせる（`CLAUDE.md` §8.7）。このとき、**DB に触るか・越境の境界に触るか**を Claude に判定させる。
3. **作らせる** —— 大きいものはプログラマー役に頼む。**作業用コピー（git worktree）を機能ごとに分ける**ので、並行してもぶつからない。
4. **手元で全部確かめる**（送る前に）
   - 型チェック: `npx tsc --noEmit -p apps/web` と **`npx tsc -p tsconfig.tests.json`**（テスト側も。CI はこちらも見る）
   - lint、変えた範囲のテスト、`tests/static`
   - 境界・DB に触るなら、実 DB の分離テスト（`npx vitest run -c vitest.isolation.config.ts <ファイル>`）
   - 画面は撮影して前後を見比べる（§5）
   - **開いている他の人の PR と試しに合わせる**（`git merge-tree --write-tree --name-only HEAD origin/<相手のブランチ>`）
5. **レビュー**（§4 の基準で）
6. **1 本の PR にまとめて、送るのは 1 回だけ**。CI が通ったら、人間の OK でマージ。
7. **人間の OK でデモに反映**し、ログインして確かめる（§6）。

## 3. 決まりごと

| 決まり | 理由 |
|---|---|
| **送る（push）のは確認を全部済ませてから 1 回** | CI は 1 回で build → 単体 → 分離 → E2E を全部回す（約 15〜20 分）。直すたびに送ると 1 日 50 回・15 時間になった |
| **main の取り込みは、GitHub が「ぶつかる」と言ったときだけ** | 取り込むたびに CI が回る |
| **小さな変更はまとめて 1 本に** | マージのたびに main 側でも CI が回る |
| **同じファイルを触る PR は 1 本ずつ** | `chat-conversation.tsx`・`docs/05`・`packages/i18n/src/index.ts` などはぶつかりやすい。前の PR が入ってから次を出す |
| **番号（改訂・AC・migration）は送る直前に main を見て決める** | 並行する PR が同じ番号を取って衝突した |
| **マージ済みの migration は書き換えない** | 直しは新しい migration に分ける |
| **`CLAUDE.md` の変更は人間 2 人の承認を GitHub に残す** | PR のコメントに残さないと、後から承認を辿れない |
| **レビューが全部済んでからマージ** | 直しの前の版がマージされ、続きの PR が要った |

## 4. レビューの基準

| 変更の中身 | `code-reviewer` | Codex | 人間 |
|---|---|---|---|
| DB・RLS・越境経路・AI・外部送信・状態機械・管理平面 | **1 回** | **1〜2 回**（必ず直すがあれば追加） | DB の変更は担当外の人にも見てもらう |
| 画面だけ・文言・ドキュメント・テストだけ | なし（Claude が型・lint・テスト・撮影で確認） | 画面の点検をしたいときだけ | — |

- 🔴 **Codex は使いすぎない**（あなたの ChatGPT のアカウントの上限を使う）。1 回 5〜15 万トークン。差分だけを渡す。
- `code-reviewer` と Codex は見るところが違う。今回は Codex が、同時に送ったときの容量超過・検査済みファイルの差し替え・取りこぼしなど、手元のテストで見えない競合を何度も見つけた。

## 5. 画面の確かめ方

- **撮影**: 描画テスト（`renderToStaticMarkup`）で HTML を書き出し、Tailwind の CSS を当てて Playwright（`channel: 'chrome'`）で撮る。1440px と 390px の 2 枚。前後を並べて人間に見せる。
- 🔴 **ブラウザでしか起きない不具合がある**。テストは Node で動くので、たとえば `fetch` をオブジェクトに入れて `deps.fetch()` で呼ぶとブラウザだけで `Illegal invocation` になる（`tests/static/chat-browser-fetch.test.ts`）。送信・アップロードのような操作は、デモでブラウザから実際に試す。
- AI くささ: `AGENTS.md` §5.1 と `.claude/agents/e2e-tester.md` の MODE: UI_REVIEW の 11 項目。Codex に写真を渡して点数を付けてもらうと早い。

## 6. デモへの反映（Railway）

- 自動では反映されない。元のフォルダ（Railway と紐づいている）を最新の main にして実行する:
  ```
  cd <リポジトリ> && git checkout main && git pull --ff-only && npx -y @railway/cli up --service web
  ```
- 🔴 作業用コピー（`.claude/worktrees/`）は `.gitignore` で外れているので送られない。**元のフォルダでブランチを切り替えない**（Railway が紐づいている）。
- Claude に反映させる場合は、毎回「反映して」と OK を出す（権限の設定で、OK が無いと止まる）。
- 切り替わったかは、サインイン画面の読み込むファイル名が変わるかで分かる。切り替わったら、合成アカウント（`docs/DEV-ACCOUNTS.md`）でログインして確かめる。

## 7. Codex を Claude から呼ぶ

あなたの ChatGPT のアカウントで、Claude Code から Codex CLI を呼ぶ。

```
# 一度だけ: 自分の設定のモデル名が使えないときは、認証だけを持つ別の置き場を作る
mkdir -p <一時フォルダ>/codex-home && ln -s ~/.codex/auth.json <一時フォルダ>/codex-home/auth.json

# 読むだけのレビュー（差分を作業用コピーに置いて渡す）
CODEX_HOME=<一時フォルダ>/codex-home npx -y @openai/codex exec \
  --sandbox read-only -C <作業用コピー> -o <結果.md> "<依頼文>" < /dev/null

# 書き換えてよい作業（画面の小さな修正など。commit / push はさせない）
... --sandbox workspace-write ...
```

- 🔴 **`< /dev/null` を付ける**（付けないと入力待ちで止まる）。
- 🔴 **見張りを付ける**。ネットワークの切断や長いテストで止まることがある。ログが 20〜25 分書かれなければ止める（`pgrep` と `stat -f %m` で見る）。
- 依頼文には必ず: 読む資料（`AGENTS.md`・`CLAUDE.md` の節）・見てほしい観点・「ファイルを変えない／commit・push しない」・出力の形（結論 / 直すもの〔必ず直す・直したほうがよい〕/ 確かめていないこと）。
- 画面を直させるときは「フックを差し替えるテストを書かない」と書く（実行が止まった）。`HANDOFF.md`・`CLAUDE.md` を書き換えさせない。
- Codex の結果は、Claude が規約違反（生の `<button>`、`'use client'` での `@ses/i18n` の値 import、トークン外の色、状態のバリアント）を grep し、撮影してから取り込む。

## 8. この機械（16GB の Mac）の注意

- 型チェック 1 回に 10 分以上かかることがある。重い処理は裏で回し、同時に 2 つ走らせない。
- 作業用コピーはすぐ増える（1 本 1GB 前後）。マージ済みのものは `git worktree remove` で片付ける。
- 分離テストは Docker（Testcontainers）が要る。Node v22.11 だと import で落ちることがある（`HANDOFF.md` の罠の表）。
- 時間の制限を付けるときに `timeout` コマンドは無い（macOS）。

## 9. 困ったとき

- CI が落ちた: `gh run view <id> --log-failed` で失敗したテストを見る。サイドバー CSS のテスト 7 件はビルド出力が要るので、手元では失敗して当たり前（CI では通る）。
- 他の人の PR とぶつかる: 自分の側で直す。相手のブランチには手を入れず、原因が分かれば PR にコメントで伝える。
- 権限で止められた（デプロイ・マージ・`CLAUDE.md` の書き換え）: 回り道をしない。人間に OK をもらう。
