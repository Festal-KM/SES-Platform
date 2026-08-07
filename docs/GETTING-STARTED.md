# GETTING STARTED — 導入から実装までの手順書

このハーネスを使って、プロダクトを設計・実装するまでの手順。

**所要時間の目安**: 導入 10 分 / `CLAUDE.md` 記入 1〜3 時間 / 設計フェーズ 半日〜2 日 / 以降は実装

---

## 全体像

```
┌─ 0. 導入 ────────────────────────────────────────────────┐
│  リポジトリを取得し、.env を用意する                        │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌─ 1. CLAUDE.md を埋める ─────────────────────────────────┐
│  /kickoff  または  prompts/00-project-brief.md を書いて渡す │
│  🔴 ここの質がハーネス全体の精度を決める                    │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌─ 2. 設計フェーズ ────────────────────────────────────────┐
│  docs/01 → 02 → 03 → 04 → wireframes → 05 → dev-plan     │
│  各ドキュメントを /design-iterate で APPROVED まで確定      │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌─ 3. 設計フェーズ完了確認 ────────────────────────────────┐
│  MODE: REVIEW / TARGET: 設計フェーズ全体                   │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌─ 4. 実装フェーズ ────────────────────────────────────────┐
│  /iterate T-01-01 ... を 1 タスクずつ                     │
│  programmer → code-reviewer → e2e-tester を最大 5 周      │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌─ 5. スプリント / フェーズ完了確認 ───────────────────────┐
│  MODE: REVIEW / TARGET: SP-01 | Phase 1                   │
└──────────────────────────────────────────────────────────┘
                  ↑                          │
                  └─ 仕様変更が出たら prompts/03-spec-change.md ─┘
```

---

## Step 0. 導入

### リポジトリを取得する

**新規プロジェクトとして始める場合**（推奨）:

```bash
git clone https://github.com/Festal-KM/ClaudeCodeAgents.git my-product
cd my-product
rm -rf .git && git init
```

**既存プロジェクトに組み込む場合**:

```bash
# 必要なものだけコピーする
cp -r <このリポジトリ>/.claude       ./
cp    <このリポジトリ>/CLAUDE.md     ./CLAUDE.md.template
cp -r <このリポジトリ>/recipes       ./
cp -r <このリポジトリ>/scripts       ./
cp    <このリポジトリ>/.env.example  ./
```

既存の `CLAUDE.md` がある場合は、**上書きせず**テンプレートの §3 / §8 を既存ファイルに取り込む形にする。

### `.env` を用意する

ワイヤーフレーム生成（Step 2 の後半）で必要。それまでは不要。

```bash
cp .env.example .env
```

`WIREFRAME_IMAGE_MODEL` と、使うプロバイダの API キーを設定する。

🔴 **`.env` はコミットしない**（`.gitignore` で除外済み）。

### 動作確認

```bash
node scripts/generate-wireframes.mjs --help
```

Node.js 18 以上が必要。依存パッケージのインストールは不要（標準機能のみ使用）。

---

## Step 1. `CLAUDE.md` を埋める

🔴 **ここが最重要。** `CLAUDE.md` は全エージェントの一次資料であり、**ここの質がそのまま下流全体の精度になる**。

### やり方は 2 通り

**A. 対話で埋める**

```
/kickoff
```

8 ラウンドに分けてヒアリングされる。手元に情報が整理されていない場合はこちら。

**B. ブリーフを書いてから渡す（推奨・精度が高い）**

[`prompts/00-project-brief.md`](../prompts/00-project-brief.md) のテンプレートを埋めて保存し、

```
/kickoff docs/project-brief.md
```

### 特に時間をかけるべき箇所

| 章 | なぜ重要か |
|---|---|
| **§1.1 解決する課題** | ここが弱いと、生成される要件が「機能の羅列」になる |
| **§1.3 中核となる業務ループ** | 以降のすべてのドキュメントがこの分解を引き継ぐ |
| 🔴 **§3 ハードルール** | **レビューの照合基準。ここが曖昧だとレビューが機能しない** |
| **§5 成功条件** | `pm` の完了確認がこれを判定基準にする。テスト可能な文で書く |
| **§7 KPI** | 「0 件（許容しない）」の 1 行が `code-reviewer` の厳しさを決める |

### §3 は `recipes/` からコピーする

プロダクトに該当するレシピを [`recipes/`](../recipes/) から選び、語彙を置き換えて §3 に貼る。

| 該当条件 | レシピ |
|---|---|
| 複数の顧客組織のデータを 1 つの DB に入れる | `multi-tenant-rls.md` |
| 取り消せない外部書き込みがある | `idempotent-external-writes.md` |
| LLM を使う | `ai-layer.md` |
| 生成物や投入物に承認が要る | `approval-gate.md` |
| SaaS として運営者が顧客を管理する | `operator-console.md` |
| 営業デモ環境が要る | `demo-environment.md` |

### 完了条件

```bash
grep -c "{{" CLAUDE.md   # 0 であること
grep -c "📝" CLAUDE.md   # 0 であること
```

🔴 **未置換プレースホルダが 1 つでも残っていると、`pm` の完了確認が無条件 NG を返す。**

### 🔴 章番号を詰めない

該当しない章（§10〜§13）は、**章そのものを削除せず、見出しを残して 1 行だけ書く**：

```markdown
## 12. AI 運用ロール（ハーネス設計）

本プロジェクトでは該当なし。
```

`.claude/agents/*.md` は `CLAUDE.md` の章番号を参照する契約で書かれている。番号を詰めると全エージェントの参照がずれる。

---

## Step 2. 設計フェーズ

詳細な指示文は [`prompts/01-design-phase.md`](../prompts/01-design-phase.md)。

### 進め方

```
作成 → /design-iterate <エージェント名> → APPROVED → 次へ
```

**1 本ずつ確定させる。** 一度に 2 本以上作らせない。

### 実行順

| # | エージェント | 成果物 | 目安時間 |
|---|---|---|---|
| 1 | `biz-requirements` | `docs/01-business-requirements.md` | 15〜30 分 |
| 2 | `functional-requirements` | `docs/02-functional-requirements.md` | 20〜40 分 |
| 3 | `tech-selection` | `docs/03-tech-selection.md` | **40〜90 分**（外部 API を裏取りするため長い） |
| 4 | `ui-design` | `docs/04-ui-design.md` | 20〜40 分 |
| 5 | `designer` | `docs/wireframes/*/prompt.md` + `*.png` | 30 分〜（**画像は 1 枚ごとに課金**） |
| 6 | `program-design` | `docs/05-program-design.md` | 30〜60 分 |
| 7 | `pm` | `docs/dev-plan.md`, `docs/sprints/*` | 20〜40 分 |

時間は `/design-iterate` の反復を含む目安。

### ワイヤーフレーム生成の注意

🔴 **画像生成は 1 枚ごとに課金される。** 実行前に必ず対象を確認する：

```bash
node scripts/generate-wireframes.mjs --dry-run
```

- 画面数 × バリアント数（`desktop` / `mobile` / `empty` / `loading` / `error`）が枚数になる
- 同時実行数の既定は 3。**安易に上げない**（実運用で `--concurrency 6` にして 60 枚中 15 枚が 429 で失敗した事例あり）
- **429 で失敗した画像は課金されない**。失敗分だけ再実行してよい（`--force` 不要）

### 完了確認

```
MODE: REVIEW
TARGET: 設計フェーズ全体

pm エージェントで完了確認をしてください。
```

`## PHASE_COMPLETE` を確認してから実装へ進む。

---

## Step 3. 実装フェーズ

詳細な指示文は [`prompts/02-implementation.md`](../prompts/02-implementation.md)。

```
/iterate T-01-01
```

**1 タスク = 1 回の `/iterate`。** 複数タスクをまとめて渡さない。

内部で **programmer → code-reviewer → e2e-tester** が「APPROVED かつ PASS」まで最大 5 周する。

### 進行中に見るべきもの

- `code-reviewer` の Findings で `NG` が付いた項目
- `N/A` の理由（`CLAUDE.md` §3 に該当ルールがあるのに `N/A` なら指摘を追加する）
- `e2e-tester` が報告する外部 API モックの呼び出し回数

### 危険信号

| 症状 | 対処 |
|---|---|
| `code-reviewer` が毎回即 `APPROVED` | `CLAUDE.md` §3 が薄い。書き直す |
| 同じ指摘で 3 周以上 | `docs/05` の設計に問題。`/design-iterate program-design` |
| 🔴 実 API を叩いた形跡 | **即停止**。不可逆な事故になり得る |

---

## Step 4. 完了確認

詳細は [`prompts/04-completion.md`](../prompts/04-completion.md)。

```
MODE: REVIEW
TARGET: SP-01
```

**1 件でも NG なら `## PHASE_INCOMPLETE`。** 指摘を `/iterate` で解消し、再度回す。

---

## 仕様が変わったら

🔴 **その場で上流ドキュメントを更新する。** 実装を続ける前に行う。

エージェントは**チャット履歴を読まない**。ドキュメントに書かれていない決定は存在しないのと同じ。

手順とそのまま貼れる指示文は [`prompts/03-spec-change.md`](../prompts/03-spec-change.md)。

---

## 人間が判断すること

エージェントに委ねず、必ず人間が決める（`CLAUDE.md` §8.6）：

- **`CLAUDE.md` 自体の改訂** — 全エージェントの一次資料であり、書き換えは承認事項
- **事業判断**（料金・スコープの取捨・優先順位）
- **外部 API の契約・課金プランの選択**
- **`ESCALATE` が返ったときの方針決定**
- **本番環境に不可逆な影響を与える操作**

---

## ディレクトリ構成

```
.
├── CLAUDE.md                    ← 全エージェントの一次資料。最初に埋める
├── .claude/
│   ├── agents/                  ← サブエージェント定義 11 本
│   └── commands/                ← /kickoff /design-iterate /iterate
├── recipes/                     ← §3 に貼るハードルールのレシピ
├── prompts/                     ← そのまま貼れる指示文テンプレート
├── scripts/
│   └── generate-wireframes.mjs  ← ワイヤーフレーム画像生成
├── docs/                        ← 🔽 ここから下はハーネスが生成する
│   ├── 01-business-requirements.md
│   ├── 02-functional-requirements.md
│   ├── 03-tech-selection.md
│   ├── 04-ui-design.md
│   ├── 05-program-design.md
│   ├── dev-plan.md
│   ├── sprints/
│   └── wireframes/
└── tests/e2e/                   ← e2e-tester が生成
```

---

## うまくいかないとき

[`prompts/90-troubleshooting.md`](../prompts/90-troubleshooting.md) を参照。

切り分けの順番：

```
1. CLAUDE.md §3 は機械的に判定できる形か   ← ここが原因のことが最も多い
2. CLAUDE.md §7 に「0 件」の事故が書かれているか
3. 上流ドキュメントが APPROVED を得ているか
4. タスクの粒度は 1 回の /iterate に収まるか
5. 環境（DB / ワーカー / モック）は起動しているか
6. 出力が途中で切れていないか
```
