---
description: 設計フェーズのドキュメント (docs/01..05, docs/dev-plan.md, docs/sprints/*) を design-reviewer でレビューし、REQUEST_CHANGES なら元エージェントに修正させて APPROVED まで反復する設計レビューループ。引数にドキュメントパスまたは対象エージェント名を渡す。
argument-hint: "<doc path | target agent name>"
---

You are orchestrating the `/design-iterate` loop.

Argument: $ARGUMENTS

## 引数の解釈

`$ARGUMENTS` は以下のいずれか：

- **ドキュメントパス**: 例 `docs/02-functional-requirements.md`
- **対応エージェント名**: 例 `functional-requirements`, `tech-selection`, `ui-design`, `designer`, `program-design`, `pm`, `biz-requirements`

引数からターゲットドキュメントとターゲットエージェントを以下のテーブルでマッピングする：

| ターゲットエージェント | ターゲットドキュメント | 上流ドキュメント |
|---|---|---|
| `biz-requirements` | `docs/01-business-requirements.md` | `CLAUDE.md`（＋より詳細な元仕様書があればそれも） |
| `functional-requirements` | `docs/02-functional-requirements.md` | `docs/01` |
| `tech-selection` | `docs/03-tech-selection.md` | `docs/01`, `docs/02` |
| `ui-design` | `docs/04-ui-design.md` | `docs/01`, `docs/02` |
| `designer` | `docs/wireframes/*/prompt.md` | `docs/04` |
| `program-design` | `docs/05-program-design.md` | `docs/01`, `docs/02`, `docs/03`, `docs/04` |
| `pm` | `docs/dev-plan.md` / `docs/sprints/SP-*.md` | `docs/01`..`docs/05` |

`designer` を対象とする場合、`docs/wireframes/` 配下の全 `prompt.md` をまとめて 1 回のレビューに渡す（画面数が多く 1 件ずつでは非効率なため）。

## Loop protocol

`design-reviewer` の呼び出しを 1 iteration とカウントし、**最大 5 iterations** まで繰り返す。

各 iteration の手順：

### Step 1: design-reviewer

`design-reviewer` サブエージェントを呼び出す。プロンプトに以下を含める：

- `target_doc`: 対象ドキュメントの絶対パス
- `target_agent`: 対応エージェント名
- `upstream_docs`: 上記マッピング表の上流ドキュメント絶対パス（複数）
- 一次資料として **必ず** `CLAUDE.md` を読むよう明示。より詳細な元仕様書は存在すれば読むよう指示
- 2 回目以降は「前回の修正指示と、それに対する元エージェントの対応サマリ」を添付して、対応漏れチェックを依頼

verdict を待つ：

- `## APPROVED` → ループ成功終了。ユーザーに 3〜5 行のサマリ（対象ドキュメント / iterations 回数 / 最終 verdict / 主な改善ポイント）を返す。
- `## REQUEST_CHANGES` → Required Changes リストを「reviewer feedback」として保持し、Step 2 へ進む。
- `## ESCALATE: <理由>` → ループ停止、ユーザーに escalation を報告して終了。

### Step 2: ターゲットエージェント（元エージェント）による修正

ターゲットエージェントを再起動する。プロンプトには以下を含める：

```
Previous design-reviewer feedback (must address all items, verbatim):

<reviewer の Required Changes セクションをそのまま貼り付け>

修正対象ドキュメント: <target_doc 絶対パス>
保持すべき上流ドキュメント: <upstream_docs リスト>
一次資料: CLAUDE.md

元の作成指示は以下のとおりですが、今回は「指摘事項をすべて反映した改訂版を上書き保存」が目的です：

<元エージェントのデフォルト指示。簡潔に再掲>

完了したら、改訂後の出力ファイルの絶対パスと、各指摘への対応サマリ（チェックリスト形式）を返してください。
```

ターゲットエージェントが改訂版の上書き保存 + 対応サマリを返すのを待つ。設計ドキュメント作成系エージェントは `## DONE` ターミネーターを必ずしも使わないが、**ファイル上書き完了かつ全指摘への言及がある** ことを応答内容から確認できれば次イテレーションへ進む。

確認できない場合: `## BLOCKED: 修正対応が不完全` 扱いで停止し、ユーザーに報告して終了。

### Step 3: 次イテレーション

Step 2 が完了したら Step 1 に戻り、`design-reviewer` を再度起動して改訂版をレビューする。

## Escalation after 5 iterations

5 iteration 経過しても `## APPROVED` に到達しなければ、6 回目を回さず以下を出力して終了：

```
## /design-iterate ESCALATED
- Target doc: <target_doc>
- Target agent: <target_agent>
- 5 iterations did not converge to APPROVED.
- Last reviewer verdict: <REQUEST_CHANGES / ESCALATE>
- 未解決の主要指摘:
  - <item 1>
  - <item 2>
- 推奨される次の一手:
  - CLAUDE.md / 上流ドキュメントの矛盾を解消する / レビュー観点を絞る / 人間がドキュメントを直接編集する
```

## Rules

- **自分でドキュメントを編集しない**。改訂は対応エージェントの責任。レビューは `design-reviewer` の責任。
- **verdict 文字列を独自判断しない**。`design-reviewer` の出力末尾の `## APPROVED` / `## REQUEST_CHANGES` / `## ESCALATE` で判定する。
- **フィードバックは要約せず verbatim** で次イテレーションに渡す。
- 各 iteration の冒頭に短いステータスをユーザーに出力する：
  - `Design Iteration N/5: design-reviewer (verdict: ...) → <target_agent> (revision: ...)`
- `design-reviewer` が ESCALATE した場合、ターゲットエージェントによる修正はスキップし、即座に人間判断に委ねる。
- 🔴 **`CLAUDE.md` 自体の改訂が必要と判定された場合はループを止める**。`CLAUDE.md` は全エージェントの一次資料であり、書き換えは人間の承認事項とする（`CLAUDE.md` §8.6）。
- ターミネーター文字列がない `design-reviewer` 応答は契約違反として扱い、停止する。
