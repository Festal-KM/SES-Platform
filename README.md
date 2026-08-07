# Claude Code Agents — 設計から実装まで回すエージェントハーネス

実プロダクト開発で使い、精度が良かった **Claude Code のサブエージェント構成**をテンプレート化したもの。

`CLAUDE.md` を 1 本埋めるだけで、**業務要件 → 機能要件 → 技術選定 → 画面設計 → ワイヤーフレーム → 実装設計 → 開発計画 → 実装 → レビュー → E2E** までを、レビューループ付きで回せる。

```bash
git clone https://github.com/Festal-KM/ClaudeCodeAgents.git my-product
cd my-product && rm -rf .git && git init
```

```
/kickoff
```

📖 **[GETTING STARTED（手順書）](docs/GETTING-STARTED.md)** — 導入から実装までの完全な手順
📝 **[prompts/](prompts/)** — そのまま貼れる指示文テンプレート
🛡 **[recipes/](recipes/)** — ハードルールのレシピ集

---

## 何が入っているか

| | 中身 |
|---|---|
| **11 のサブエージェント** | `biz-requirements` / `functional-requirements` / `tech-selection` / `ui-design` / `designer` / `program-design` / `pm` / `design-reviewer` / `programmer` / `code-reviewer` / `e2e-tester` |
| **3 のスラッシュコマンド** | `/kickoff`（CLAUDE.md を対話で埋める） `/design-iterate`（設計レビューループ） `/iterate`（実装ループ） |
| **CLAUDE.md テンプレート** | 13 章の記入式。全エージェントの一次資料になる |
| **6 のレシピ** | ハードルールの実例。§3 にコピーして使う |
| **6 の指示文テンプレート** | 開発開始時 / 設計 / 実装 / 仕様変更 / 完了確認 / トラブル対応 |
| **ワイヤーフレーム生成スクリプト** | `prompt.md` をパースして画像生成 API を呼ぶ。依存ゼロ |

---

## なぜ動くのか

AI にコードを書かせること自体は難しくない。**難しいのは「正しいものを、壊さずに」書かせること**。この構成は、そこに以下の仕掛けを置いている。

### 1. 一次資料を 1 本に固定する

すべてのエージェントは `CLAUDE.md` を読んでから作業する。エージェント定義には**プロダクト固有の情報を一切書かない**。プロダクトの語彙は `CLAUDE.md` §N を参照する契約になっている。

結果として、**エージェント定義はクローンしたそのまま使える**（プレースホルダの置換が不要）。

### 2. レビューを終端文字列で機械的に判定する

ループは応答末尾の文字列だけで継続を判定する。**文字列が無い応答は契約違反として停止する**。

| エージェント | 終端文字列 |
|---|---|
| `programmer` / `e2e-tester` | `## DONE` / `## BLOCKED: <理由>` |
| `code-reviewer` / `design-reviewer` | `## APPROVED` / `## REQUEST_CHANGES` / `## ESCALATE: <理由>` |
| `pm`（完了確認） | `## PHASE_COMPLETE` / `## PHASE_INCOMPLETE: N 件` |

「だいたい良さそう」で先に進まない。**`APPROVED` が出るまで反復し、5 周で収束しなければ人間に委ねる。**

### 3. 🔴 ハードルールを「機械的に照合できる形」で書かせる

このハーネスの精度は、`CLAUDE.md` §3 の質でほぼ決まる。良いハードルールの条件を 4 つに定義してある：

1. **違反が一意に判定できる** — 「適切に検証する」ではなく「〈特定のアクセサ〉を経由しない DB アクセスを書かない」
2. **破れない担保まで書く** — 「気をつける」ではなく「Lint で禁止する」「DB の `UNIQUE` 制約で担保する」
3. **なぜそれが事故なのかを 1 行添える** — 理由が無いとエージェントは機械的に拡大解釈する
4. **例外を作るなら射程を明示して「ここだけ」と書く** — 例外が 1 つあると、類似ケースにも例外を作りたがる

[`recipes/`](recipes/) には、**実際に事故を踏んでから逆算して書かれたルール**が入っている。コピーして語彙を置き換えるだけで使える。

### 4. 上流を読まずに下流を書かせない

```
CLAUDE.md → 01 業務要件 → 02 機能要件 → 03 技術選定 → 04 画面設計
              → wireframes → 05 実装設計 → dev-plan/sprints → 実装
```

各ドキュメントは `## 後続エージェントへの申し送り` で終わり、`design-reviewer` が**申し送り項目が下流で消費されているか**を機械的に検査する。

---

## 2 つのループ

### `/design-iterate` — 設計レビューループ

```
design-reviewer → (REQUEST_CHANGES なら) 元エージェントが修正 → 再レビュー
```

最大 5 周。`APPROVED` まで回す。

```
biz-requirements エージェントで docs/01-business-requirements.md を作成して
/design-iterate biz-requirements
```

### `/iterate` — 実装ループ

```
programmer → code-reviewer → e2e-tester
```

最大 5 周。「`APPROVED` かつ `PASS`」まで回す。

```
/iterate T-01-03
```

- `code-reviewer` が `REQUEST_CHANGES` → `programmer` に差し戻し（E2E までは進めない）
- `e2e-tester` が `BLOCKED` → 差し戻し。**次周は必ずコードレビューも再実行**

🔴 **1 タスク = 1 回の `/iterate`。** 複数タスクをまとめて渡さない。

---

## 使い方の流れ

```
0. 導入            git clone → .env 用意
1. CLAUDE.md 記入   /kickoff  または prompts/00-project-brief.md を書いて渡す
2. 設計フェーズ      docs/01〜05 を 1 本ずつ /design-iterate で APPROVED まで
3. 完了確認         MODE: REVIEW / TARGET: 設計フェーズ全体
4. 実装フェーズ      /iterate T-01-01 ... を 1 タスクずつ
5. 完了確認         MODE: REVIEW / TARGET: SP-01
```

詳細は **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)**。

---

## 🔴 精度を上げる 3 つのこと

技術的な工夫より、以下 3 点のほうが効く。

**1. 「何を作るか」より「なぜ今それが回っていないか」を書く**

- ❌ 「顧客管理システムを作りたい」
- ✅ 「営業ごとに Excel の列構成が違うため事務が毎月 4〜6 時間かけて名寄せしている。結果、会議に 2 つの数字が並び、最初の 30 分が数字合わせに消える」

**2. 「絶対に起こしてはならない事故」を 1 つ以上書く**

これが `CLAUDE.md` §7 になり、**`code-reviewer` の厳しさを決める**。事故が定義されていないと、レビューは「特に問題ありません」を返し続ける。

**3. 「やらないこと」に理由を添える**

理由の無い「やらない」は、下流のエージェントが**良かれと思って実装してくる**。

→ 詳細と記入テンプレート: **[prompts/00-project-brief.md](prompts/00-project-brief.md)**

---

## ディレクトリ構成

```
.
├── CLAUDE.md                    ← 全エージェントの一次資料。最初に埋める
├── .claude/
│   ├── agents/                  ← サブエージェント定義 11 本
│   └── commands/                ← /kickoff /design-iterate /iterate
├── recipes/                     ← §3 に貼るハードルールのレシピ
│   ├── multi-tenant-rls.md            テナント分離
│   ├── idempotent-external-writes.md  外部書き込みの冪等性
│   ├── ai-layer.md                    LLM 層の単一経路化・利用量記録
│   ├── approval-gate.md               承認・品質ゲート
│   ├── operator-console.md            運営者コンソール
│   └── demo-environment.md            デモ環境・環境分離
├── prompts/                     ← そのまま貼れる指示文テンプレート
├── scripts/
│   └── generate-wireframes.mjs  ← ワイヤーフレーム画像生成（依存ゼロ）
├── examples/                    ← CLAUDE.md の記入例
└── docs/                        ← 🔽 ここから下はハーネスが生成する
    ├── GETTING-STARTED.md
    ├── 01-business-requirements.md
    ├── ...
    └── wireframes/
```

---

## 動作要件

- **Claude Code**（CLI / デスクトップ / IDE 拡張 のいずれか）
- **Node.js 18+** — ワイヤーフレーム生成スクリプトのみ。npm install 不要
- **画像生成 API のキー** — ワイヤーフレームを生成する場合のみ（OpenAI または Gemini）

プロダクト本体の技術スタックは自由。**エージェント定義は特定の言語・フレームワークに依存しない。**

---

## よくある質問

**Q. 既存プロジェクトに組み込めるか**
A. できる。`.claude/` `recipes/` `scripts/` をコピーし、既存の `CLAUDE.md` にテンプレートの §3 / §8 を取り込む。詳細は [GETTING-STARTED](docs/GETTING-STARTED.md#step-0-導入)。

**Q. 日本語以外でも使えるか**
A. エージェント定義は日本語で書かれているが、生成物の言語は `CLAUDE.md` の記述に従う。英語プロダクトなら英語で `CLAUDE.md` を書けばよい。

**Q. エージェントを減らしたい**
A. `.claude/agents/` から削除し、`CLAUDE.md` §8.1 の表を直す。ただし `code-reviewer` と `design-reviewer` を外すと、このハーネスの価値の大半が失われる。

**Q. レビューが甘い / 常に APPROVED が返る**
A. `CLAUDE.md` §3 と §7 が弱い。レビューは §3 を照合基準にするため、§3 が「気をつける」レベルだと何も判定できない。[recipes/](recipes/) を参照して書き直す。

**Q. ループが収束しない**
A. [prompts/90-troubleshooting.md](prompts/90-troubleshooting.md) を参照。

---

## License

MIT — [LICENSE](LICENSE)

---
---

# English Summary

A **Claude Code sub-agent harness** for taking a product from business requirements all the way to reviewed, E2E-tested implementation. Extracted from a real product build where it measurably improved output quality.

## What's inside

- **11 sub-agents** — business requirements, functional requirements, tech selection, UI design, wireframe generation, program design, project management, design review, programming, code review, E2E testing
- **3 slash commands** — `/kickoff` (fill in `CLAUDE.md` interactively), `/design-iterate` (design review loop), `/iterate` (implementation loop)
- **A 13-chapter `CLAUDE.md` template** that acts as the single source of truth every agent reads
- **6 hard-rule recipes** — battle-tested rules for tenant isolation, idempotent external writes, LLM layers, approval gates, operator consoles, and demo environments
- **6 prompt templates** — what to tell the AI at kickoff, during design, during implementation, on spec change, at completion, and when things break
- **A zero-dependency wireframe generation script**

## Quick start

```bash
git clone https://github.com/Festal-KM/ClaudeCodeAgents.git my-product
cd my-product && rm -rf .git && git init
```

Then, in Claude Code:

```
/kickoff
```

Full runbook: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) (Japanese).

## Why it works

**1. One source of truth.** Every agent reads `CLAUDE.md` first. Agent definitions contain **zero product-specific content** — they reference `CLAUDE.md` sections (§1–§13) by number. This means the agent definitions work as-is after cloning, with no placeholders to replace.

**2. Terminator-string contracts.** Loops decide whether to continue purely from the last line of a response — `## APPROVED`, `## REQUEST_CHANGES`, `## DONE`, `## BLOCKED`. A response without one is treated as a contract violation and halts the loop. Nothing proceeds on "looks good enough."

**3. Hard rules written to be mechanically checkable.** The template defines four conditions for a good hard rule: violations must be unambiguously detectable; the enforcement mechanism (type / DB constraint / lint rule / runtime guard) must be stated; a one-line reason must explain why it's an incident; and any exception must state its exact scope. `recipes/` contains rules derived from real production incidents.

**4. No downstream work without upstream.** Documents form a strict chain, each ending with a handoff section that the design reviewer mechanically verifies was consumed downstream.

## Requirements

- Claude Code (CLI, desktop, or IDE extension)
- Node.js 18+ — only for the wireframe script; no `npm install` needed
- An image generation API key (OpenAI or Gemini) — only if you generate wireframes

The harness is **stack-agnostic**: agent definitions don't assume any particular language or framework.

## Note on language

The agent definitions and templates are written in Japanese, since that's the form in which they were proven. Generated artifacts follow whatever language you write `CLAUDE.md` in — write it in English and the outputs will be in English.

## License

MIT
