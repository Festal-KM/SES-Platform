# 01. 設計フェーズ — `docs/01`〜`docs/05` と開発計画を作る

`CLAUDE.md` を埋め終えたら、設計ドキュメントを **1 本ずつ APPROVED まで確定させて**次に進む。

---

## 🔴 大原則

```
作成 → /design-iterate でレビュー → APPROVED → 次のドキュメントへ
```

- **一度に 2 本以上作らせない。** 上流が確定していない状態で下流を書くと、矛盾がそのまま伝播する。
- **APPROVED を見てから次へ進む。** `REQUEST_CHANGES` のまま先に進むと、後で全部やり直しになる。
- `/design-iterate` は **最大 5 周**。収束しなければ `ESCALATE` して人間判断に委ねる。

実行順（この順以外はダメ）:

```
biz-requirements → functional-requirements → tech-selection
  → ui-design → designer → program-design → pm
```

---

## Step 1: 業務要件 `docs/01`

```
biz-requirements エージェントで docs/01-business-requirements.md を作成してください。

一次資料は CLAUDE.md です。特に以下を起点にしてください:
- §1.1 解決する課題
- §1.3 中核となる業務ループ
- §3 ハードルール（各ハードルールに対応する BR-xx を必ず作ること）
- §6 対象外
```

```
/design-iterate biz-requirements
```

**確認すること**: `## APPROVED` が返ったか。返っていなければ `REQUEST_CHANGES` の内容を読み、`CLAUDE.md` 側の記述不足が原因なら**先に `CLAUDE.md` を直す**（§8.6 により人間の承認事項）。

---

## Step 2: 機能要件 `docs/02`

```
functional-requirements エージェントで docs/02-functional-requirements.md を作成してください。

上流: CLAUDE.md, docs/01-business-requirements.md
docs/01 の BR-xx がすべて機能 F-xxx に落ちていることを確認してください。
```

```
/design-iterate functional-requirements
```

---

## Step 3: 技術選定 `docs/03`

🔴 **このステップは他より時間がかかる。** 外部 API の仕様・課金体系を WebSearch / WebFetch で裏取りするため。

```
tech-selection エージェントで docs/03-tech-selection.md を作成してください。

上流: CLAUDE.md, docs/01, docs/02

CLAUDE.md §2 は確定事項です。覆さず、肉付けと未決定領域の補完だけしてください。
CLAUDE.md §9「未確定事項」を公式ドキュメントで裏取りし、確定値を書いてください。
🔴 裏取りできなかった項目は推測で埋めず、「未確定」と明記して根拠のリンクを残してください。
```

```
/design-iterate tech-selection
```

**確認すること**: 外部 API のレート上限・単価・無料枠に**出典 URL が付いているか**。付いていない数値は推測なので信用しない。

---

## Step 4: 画面設計 `docs/04`

```
ui-design エージェントで docs/04-ui-design.md を作成してください。

上流: CLAUDE.md, docs/01, docs/02

- docs/02 の全機能 F-xxx が、いずれかの画面 S-xxx / A-xxx に割り当たっていること
- CLAUDE.md §13 がある場合、全画面を Tier 1〜3 のいずれかに割り当てること
- CLAUDE.md §10 がある場合、管理平面の画面 A-xxx も同じ密度で設計すること
```

```
/design-iterate ui-design
```

**確認すること**: 管理平面（`A-xxx`）が後回しにされていないか。ここを薄くすると運用できない製品になる。

---

## Step 5: ワイヤーフレーム（画像生成）

🔴 **課金が発生する。** 1 枚ごとに画像生成 API の料金がかかる。

事前に `.env` を用意する:

```bash
cp .env.example .env
# WIREFRAME_IMAGE_MODEL と API キーを設定する
```

```
designer エージェントで、docs/04 の全画面（S-xxx と A-xxx の両方）の
ワイヤーフレームプロンプトを作成し、画像を生成してください。

まず --dry-run で対象と枚数を報告し、私の確認を待ってから生成してください。
```

生成コマンド（エージェントが実行する）:

```bash
node scripts/generate-wireframes.mjs --dry-run    # 対象確認
node scripts/generate-wireframes.mjs              # 生成
node scripts/generate-wireframes.mjs --screen S-001   # 特定画面のみ
```

```
/design-iterate designer
```

**確認すること**:
- 枚数 × 単価が想定内か（`--dry-run` の出力で分かる）
- 429 で失敗した画像があれば、`--concurrency` を下げて再実行（**429 の失敗は課金されない**）

---

## Step 6: プログラム設計 `docs/05`

このハーネスで**最も重要なドキュメント**。`programmer` はこれを実装の根拠にする。

```
program-design エージェントで docs/05-program-design.md を作成してください。

上流: CLAUDE.md, docs/01, docs/02, docs/03, docs/04

🔴 CLAUDE.md §3 のハードルール 1 件ごとに、
「どの機構で破れなくするか」を明示してください:
  型 / DB 制約・権限 / Lint ルール / 実行時ガード
実行時ガードだけに頼る設計は弱いので、その旨も書いてください。
```

```
/design-iterate program-design
```

**確認すること**: ハードルールごとに担保機構が書かれているか。「気をつける」で終わっている項目があれば `REQUEST_CHANGES` になるはず。

---

## Step 7: 開発計画 `docs/dev-plan.md` + スプリント

```
pm エージェントで docs/dev-plan.md と docs/sprints/ を作成してください。

上流: CLAUDE.md, docs/01〜docs/05

- タスクは /iterate 1 回で完了できる粒度まで分解すること
- CLAUDE.md §5 のフェーズと成功条件に紐づけること
- 自分でコントロールできない外部依存（審査・契約）を Phase 1 の
  クリティカルパスに置かないこと
```

```
/design-iterate pm
```

---

## Step 8: 設計フェーズ全体の完了確認

```
MODE: REVIEW
TARGET: 設計フェーズ全体

pm エージェントで完了確認をしてください。
```

`## PHASE_COMPLETE` が返れば設計フェーズ終了。`## PHASE_INCOMPLETE: N 件` なら、指摘された箇所を該当エージェントで直してから再確認する。

**1 件でも NG なら INCOMPLETE。** ここで妥協すると実装フェーズで倍のコストになる。

---

## トラブル時

| 症状 | 対処 |
|---|---|
| `/design-iterate` が 5 周して ESCALATE | 上流ドキュメント間に矛盾がある。まず `CLAUDE.md` を疑う |
| レビューが毎回同じ指摘を返す | 指摘が `CLAUDE.md` の記述不足に起因している。§8.6 に従い人間が `CLAUDE.md` を直す |
| ドキュメントが途中で切れる | 出力トークン上限。「章ごとに分割して追記してください」と指示する |
| 生成内容が薄い | ブリーフの §2「なぜ回っていないか」と §5「事故」が弱い。`prompts/00-project-brief.md` に戻る |

詳細は [`90-troubleshooting.md`](90-troubleshooting.md)。

---

## 次のステップ

設計フェーズ完了 → [`02-implementation.md`](02-implementation.md)
