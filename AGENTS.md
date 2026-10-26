# AGENTS.md — Codex など、Claude 以外のコーディングエージェント向けの入口

このリポジトリは **BizOrch for Engineering Service**（SES 事業者向けの BtoB SaaS。仮称 SES Platform）です。
**このファイルは要点の入口です。一次資料は `CLAUDE.md` で、食い違ったら `CLAUDE.md` が正です。**

## 0. 作業を始める前に必ず読む（この順で）
1. `CLAUDE.md` —— 仕様とハードルール（何を作るか・何をしてはいけないか）
2. `HANDOFF.md` —— いま何が未完か・何が壊れているか・知らないと詰まる罠
3. `UI_GUIDELINES.md` —— 画面を 1 つでも触るなら必読（外れた実装は CI が落とす）

## 1. 絶対に守ること（違反はレビューで必ず差し戻し）
- **情報の境界**（`CLAUDE.md` §3.1）
  - テナント分離: DB アクセスは必ず `withTenant(ctx, ...)` 経由（PostgreSQL RLS + Prisma 拡張の二重防御）。`tenant_id` / `partner_company_id` は**認証コンテキスト（ctx）からだけ**取り、リクエストの body / query / path から受け取らない。`@ses/db` の生 `PrismaClient` をアプリから import しない。
  - パートナースコープ: 取引先は自社が持ち込んだ情報しか見えない。越境は §3.1 の 5 経路だけ。**取引先同士が互いを参照できる経路を 1 つも作らない**（他社の提案・エンジニア・単価・存在・件数を出さない）。
  - 越境経路・匿名表示の項目を増やすのは人間の承認事項。勝手に増やさない。
- **AI**（§3.2）: Anthropic Claude API だけ。SDK を直接 import せず `packages/ai` 経由。単価・エンド企業名・個人情報を LLM に渡さない。
- **品質ゲート・外部送信**（§3.3・§3.4）: ゲートを迂回する導線を作らない。外部送信は冪等（自動リトライしない）。
- **環境**（§11）: `production` 以外から実在の相手に送信できる経路を作らない。
- **文言**: ユーザーに見える文字は `packages/i18n` に置く（コンポーネントに直書きしない）。i18n キーと `data-testid` は**追加のみ**（改名・削除は凍結テストで落ちる）。
- **`CLAUDE.md` の書き換えは人間の承認事項**。
- 迷ったら作業を止めずに、既定値を置いて進め、PR 本文に「確認したいこと」として書く（人間への質問は GitHub Issue。`CLAUDE.md` §8.6）。

## 2. 担当（レーン）と、ぶつからないための作法
- **チャット（S-031）は紺野の担当**（`.github/CODEOWNERS`）。対象: `apps/web/app/(main)/chat/`・`apps/web/app/api/(main)/threads/`・`apps/web/lib/chat/`・`docs/chat-lane/`。
- それ以外（案件・人材・提案・管理画面・共通部品・DB 全体など）は宮田が主に担当。エンジニア情報まわりは折笠も触る。
- **依頼された範囲の外のファイルは触らない**。触る必要が出たら、PR 本文にその理由を書く。
- 同じファイルを別の人（Claude を含む）が並行して触っていることがある。**作業の前に `git fetch` して最新の `origin/main` から切る**。

## 3. Git と PR
- `main` に直接 push しない。**`origin/main` から作業ブランチを切り → PR**（ベースは必ず `main`。PR を PR に積まない）。
- 1 つの依頼 = 1 つのブランチ = 1 つの PR。
- コミットメッセージ・PR 本文・コードコメント・画面の文言は**日本語**。専門用語は平易に言い換える。**「なぜそうしたか」を書く**（このプロジェクトの判断の多くはコミット本文に残っている）。
- PR 本文には「何を変えたか」「守っていること（境界）」「確かめたこと／確かめていないこと」「確認してほしいこと」を書く。
- `git stash` / `git checkout -- <file>` / `git restore` で他人の変更を消さない。
- push したら **CI の結果まで見る**（`gh pr checks <番号>`）。ユニットが緑でも、分離テストと E2E はローカルで回せないことがある（HANDOFF の教訓 23）。

## 4. 環境とコマンド（罠つき）
- pnpm workspaces のモノレポ。Node と pnpm が PATH に無い開発機がある（`npx -y pnpm@10.12.1 ...` で代用できる）。
- `packages/i18n` / `packages/ui` / `packages/config` / `packages/db` を変えたら、**その package を作り直してから** `apps/web` を型チェックする（`npx tsc -p tsconfig.json`）。Prisma のスキーマを変えたら `packages/db` で `npx prisma generate`。
- 型チェック: `cd apps/web && npx tsc --noEmit -p .`（テストのコードは `npx tsc --noEmit -p ../../tsconfig.tests.json`）
- lint: `cd apps/web && npx eslint <変えたファイル>`
- ユニット・描画・静的テスト: `npx vitest run <対象>`（`tests/static` は画面規約の機械検査。**必ず回す**）
- 分離テスト（Testcontainers で使い捨ての PostgreSQL を立てる。Docker が要る）: `npx vitest run -c vitest.isolation.config.ts <ファイル>`
- E2E: `tests/e2e/`（Playwright。CI で回る）
- ビルド: **`NODE_ENV` を外して** `env -u NODE_ENV pnpm --filter @ses/web run build`（付いていると落ちる）
- `tests/static/sidebar-form-css-order.test.ts` はビルド済みの出力が要る。ビルドしていない手元では落ちるのが正常。
- DB の migration で**既存の行を書き換える**ときは、HANDOFF §3 の手順（FORCE RLS の一時解除と残存 0 件の検査）に従う。デモが落ちた実例がある。
- 値の集合（CHECK 制約）を変えたら `tests/static/schema-enum-drift.test.ts` の照合も足す。使わなくなった値を消すときは `tests/isolation` も grep する。

## 5. 画面の規約（よく引っかかるもの。詳しくは `UI_GUIDELINES.md`）
- 色はトークンだけ（`text-white` などの直書きは落ちる）。影・`max-w-*` は画面に書かない（`packages/ui` にだけある）。
- `rounded-full` はアバターとカウンタだけ。`group-hover:` は使わない。`size-*` はアイコンだけ。余白は 1/2/3/4/6/8/12 段。
- 生の `<button>` を新しく作らない（`@ses/ui` の `Button` / `IconButton` を使う）。
- JSX の属性に日本語を直書きしない（i18n から渡す）。`data-testid` は静的に読めるテンプレート文字列で書く。
- 押せない状態を `disabled` / 半透明で表さない（押したときに理由を出す）。
- スマホは「隠す」のではなく「並べ方を変える」（`CLAUDE.md` §13）。チャットはスマホで完結する画面（Tier 1）。

## 6. デモ環境
- https://web-production-9a8f44.up.railway.app （`APP_ENV=demo`、外部 API は全部モック、データは全部架空）
- **マージしても自動では反映されない**。反映は人間が `railway up` で行う（HANDOFF §2.3）。エージェントはデモに反映しない・デモの DB を直接触らない。
- デモのログイン用アカウントは `docs/DEV-ACCOUNTS.md`。

## 7. 終わったときの報告
- PR の URL
- 何を変えたか（平易に）
- 確かめたこと／確かめていないこと（回したテストの種類と件数。回せなかったものは理由）
- 人間に確認してほしいこと
