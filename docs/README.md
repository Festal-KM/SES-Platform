# docs/

**このディレクトリの中身は、ハーネスが生成する。** 人間が最初から書くものではない。

例外は [`GETTING-STARTED.md`](GETTING-STARTED.md)（このテンプレートに同梱の手順書）。

---

## 生成されるファイル

| ファイル | 生成するエージェント | 内容 |
|---|---|---|
| `01-business-requirements.md` | `biz-requirements` | 業務要件。なぜ・誰が・どんな価値を得るか。`BR-xx` |
| `02-functional-requirements.md` | `functional-requirements` | 機能要件。入出力・ユースケース・受け入れ基準。`F-xxx` / `UC-xx` |
| `03-tech-selection.md` | `tech-selection` | 技術選定と**外部 API の裏取り**（単価・レート上限・規約） |
| `04-ui-design.md` | `ui-design` | 画面一覧・遷移図・セクション構成。`S-xxx`（主平面） / `A-xxx`（管理平面） |
| `wireframes/{S\|A}-xxx-{slug}/` | `designer` | `prompt.md` + ワイヤーフレーム画像 `*.png` |
| `05-program-design.md` | `program-design` | DB / API / ジョブ / 外部連携 / モジュール設計。**実装の根拠** |
| `dev-plan.md` | `pm` | 開発計画 |
| `sprints/SP-NN-*.md` | `pm` | スプリント分解。`T-NN-NN` のタスク単位 |

---

## 🔴 依存関係

```
CLAUDE.md
  └─ 01 ─┬─ 02 ─┬─ 03 ─┐
         │      ├─ 04 ─┼─ 05 ─ dev-plan / sprints
         │      │   └ wireframes
         └──────┴──────┘
```

**上流を読まずに下流を書かない。** 番号順に依存する。

上流が変わったら下流もすべて更新する（`CLAUDE.md` §8.7 / [`prompts/03-spec-change.md`](../prompts/03-spec-change.md)）。

---

## ID 体系

| ID | 対象 | 定義される場所 |
|---|---|---|
| `BR-xx` | ビジネスルール | `docs/01` |
| `F-xxx` | 機能 | `docs/02` |
| `UC-xx` | ユースケース | `docs/02` |
| `S-xxx` | 主平面の画面 | `docs/04` |
| `A-xxx` | 管理平面の画面 | `docs/04` |
| `SP-NN` | スプリント | `docs/dev-plan.md` |
| `T-NN-NN` | タスク | `docs/sprints/` |

🔴 **ID は削除せず欠番にする。** 参照の安定性を保つため（`CLAUDE.md` §8.8）。

---

## 各ドキュメントの末尾にあるもの

すべての設計ドキュメントは `## 後続エージェントへの申し送り` で終わる。

これは次のエージェントへの引き継ぎ事項であり、**`design-reviewer` が「申し送り項目が下流で消費されているか」を機械的に検査する**。ここが空だと、上流で気づいた懸念が下流に伝わらない。

---

## バージョン管理

- `docs/**/*.md` は**コミットする**。設計の変遷が追えることに価値がある
- `docs/wireframes/**/*.png` も**原則コミットする**。レビューの根拠になるため
  - リポジトリサイズが問題になる場合のみ `.gitignore` で除外する（コメントアウト済みの行がある）
