# SP-07 ai-layer-gate — `packages/ai` の単一経路と品質ゲート 3 層

> **Phase**: 1（MVP） / **前提**: SP-06 / **後続**: SP-09 / SP-10
> **一次資料**: `docs/02` `F-020` `F-026` `F-027`（AI 上限）/ 章 8.5 / 章 8.7 / `docs/03` §3.3 / §4.1 / §4.2 / §4.5 / §7.6 / `docs/05` §7 / §9.3 / §11 / §16.5 / `CLAUDE.md` §3.2 / §3.3 / §12
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-07`
> 🔴 **着手条件（2 件。いずれもブロッカーではないが、着手前に確認する）**: ① **E-3 Anthropic API キーの取得**（`docs/dev-plan.md` §5 E-3。**2026-09-03 時点で未着手・ユーザー作業**。未取得でも `MockAnthropicClient` で開発と E2E は止まらないが、実接続の確認と tier / 月次上限の記録ができないため督促する）② **[Issue #23](https://github.com/Festal-KM/SES-Platform/issues/23)（`prompts/` の衝突）の決定確認** — 既定値 A（**製品プロンプトは `prompts/roles/{role}/v{N}.md` 配下。`packages/ai/src/prompts.ts` は `prompts/roles/` のみを読む**）で進める（`docs/dev-plan.md` §9 / T-07-05）。

---

## 1. 目的

`CLAUDE.md` §1.3 が「次に強い中核」と位置づける **③ の品質ゲート**を作る。あわせて **AI 呼び出しの唯一の経路（`packages/ai`）** を確立する。本スプリントで守るハードルールは 4 つ。

1. 🔴 **記録を経由しない AI 呼び出し経路を作らない**（`BR-09` / `BR-10`）。`AiUsage` にロール識別子を必須にする。
2. 🔴 **スキルシートの原本を無加工で LLM に送らない。単価とエンド企業名も渡さない**（`BR-11` / `BR-12`）。**型で送れなくする。**
3. 🔴 **整合層の合否は機械的な照合のみで決まる**（`BR-61`）。AI の指摘は**警告**にとどめ、合否を変えない。
4. 🔴 **ゲートの FAIL を「無視して送信」できる導線を作らない**（`BR-18`）。API も設定も存在しない。

## 2. 対応機能 ID

`F-020`（Phase 1 の対象は **提案 / スキルシートの外部共有 / 案件の公開** の 3 種。チャット添付は Phase 2、契約書は Phase 3）/ `F-026`（AI 部分）/ `F-027`（AI の日次コスト上限）

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-07-01 | `packages/ai` の単一経路（`runRole`）と構造化出力 | 🔴 SDK の import が `packages/ai/src/client.ts` のみ。受信後に必ず Zod で `safeParse` | `BR-09` / K-3 | L |
| T-07-02 | 🔴 **PII マスキングと型による画像禁止** | 🔴 `image` / `document` ブロックを**型として受け取れない**。`MaskedText` のブランド型 | `BR-11` `BR-12` / K-3 | L |
| T-07-03 | `AiUsage` の記録強制と件数カウンタ | 呼び出し 1 回につき `AiUsage` が 1 件。**記録失敗で throw** | `F-026 AC-1` `AC-2` `AC-6` | L |
| T-07-04 | コスト上限ガード（予約 → 補正） | 呼び出し前に見積りで**予約**し、予約に失敗したら呼び出さない | `F-027` / `docs/03` §4.5 | M |
| T-07-05 | プロンプト管理と `gate-inspector` のプロンプト | プロンプト版が生成物に記録され、後から再現できる | `BR-13` / `CLAUDE.md` §3.2 | M |
| T-07-06 | 品質ゲートのパイプライン（層の実行順・入出力型） | 3 層の結果が `ReviewGate` に保存され、後から参照できる | `F-020 AC-7` | L |
| T-07-07 | 🔴 **整合層の機械的照合（純粋関数）** | 🔴 `decideConsistency` の**引数型に AI 由来の型が現れない** | `BR-61` / `F-020 AC-3` `AC-4` | L |
| T-07-08 | 🔴 **API #39 / #40 と失敗した `gate.run` の再実行** | 🔴 `docs/05` §9.10 の 5 手順をすべて満たす（[Issue #16](https://github.com/Festal-KM/SES-Platform/issues/16)） | `F-020` / R-09 | L |
| T-07-09 | 案件公開とスキルシート外部共有のゲート接続 | 🔴 **`F-014 AC-3`（ゲート FAIL なら公開しない）を検証する**（SP-06 からの申し送り） | `F-014 AC-3` / `F-020 AC-1` | M |
| T-07-10 | `gate.hold-release` と HELD の結合 / E2E | 上限到達で `GATE_RUNNING` のまま HELD。**`GATE_FAILED` にならない** | `F-027 AC-5` | M |

## 4. タスク詳細

### T-07-01 `packages/ai` の単一経路と構造化出力（L）

- **実装**: `packages/ai/src/client.ts`（唯一の SDK 経路）/ `run.ts`（`runRole`）/ `mock/`（`MockAnthropicClient`）。
- 🔴 **アプリコードから SDK を直接 import しない**（`CLAUDE.md` §3.2）。`ai-single-path.test.ts`（`docs/05` §17.2 #10）が `@anthropic-ai/sdk` の import 元を 1 ファイルに固定する。
- 🔴 **構造化出力は `output_config.format` + `zodOutputFormat` を使い、受信後に必ず Zod で `safeParse` する**（`docs/03` `program-design` 申し送り 10）。**JSON Schema 側は `minimum` / `maxLength` 等の制約を無視するため、受信後の再検証が唯一の担保である。** 自由文を正規表現でパースしない。
- **リトライ / フォールバック**（`docs/02` 章 8.7 / `docs/05` §7.4）: 🔴 **LLM の再試行は `runRole` の内部で最大 2 回まで**。**ジョブ単位での再試行は行わない**（`AiUsage` が二重に積まれるため。`attempts: 1`）。
- 🔴 **ロールごとにモデルを設定可能にする**（`CLAUDE.md` §12.3）。ハードコードしない。既定は `claude-sonnet-5`、定型処理は `claude-haiku-4-5-20251001`。設定は `TenantRoleModel`（画面は SP-14）。
- **ブロッカーではないが確認中**: `Q-T-5`（Anthropic の ZDR 適用）。**設計に影響しない**（マスキングは ZDR の有無にかかわらず必須）。適用時は `client.ts` のヘッダを足すだけ。
- **完了の判定**: `ai-single-path.test.ts` が green。スキーマ違反・タイムアウト・`enforced_spend_limit_reached` の 3 ケースをモックで再現するユニットテスト。

### T-07-02 🔴 PII マスキングと型による画像禁止（L）

- **実装**: `packages/ai/src/mask.ts` と `MaskedText` のブランド型（`docs/03` §4.2 / `docs/03` `program-design` 申し送り 11）。
- 🔴 **`packages/ai` の LLM 呼び出し関数が `image` / `document` コンテンツブロックを型として受け取れないようにする。** 画像を送れない構造にすることで、`CLAUDE.md` §7 の「PII 未マスキング送信 0 件」を**型で担保**する。
- 🔴 **マスキング対象**（`BR-11`）: 氏名・生年月日・連絡先・顔写真・現所属会社名。**LLM に渡してよいのはスキル・経験内容・期間だけ。**
- 🔴 **単価とエンド企業名を LLM に渡さない**（`BR-12`）。商流情報が生成物に混入し、そのまま外部共有される経路になる。
- 🔴 **マスキングを迂回する入力経路を作らない**（`CLAUDE.md` §12.3）。`runRole` の引数が `MaskedText` しか受け取らない。
- **プロンプトインジェクション対策**（`docs/05` §7.8）: スキルシート本文に埋め込まれた指示がゲートの判定を変えないこと（E2E #18 で検証。本タスクではプロンプト側の防御を実装）。
- **完了の判定**: 型テスト（生の `string` / `image` ブロックを渡すとコンパイルエラー）+ マスキングのユニットテスト（氏名・生年月日・連絡先・会社名・単価・エンド企業名の 6 種が除去される）。

### T-07-03 `AiUsage` の記録強制と件数カウンタ（L）

- **実装**: `docs/05` §7.3 / `P-A-18`。
- 🔴 **`runRole` の戻り値が `provenance`（ロール識別子 / プロンプト版 / モデル）を必須で持つ**（型で担保）。**記録に失敗したら throw する**（`docs/05` §1.4）。
- 🔴 **`AiUsage` にロール識別子を必ず含める**（`F-026 AC-2`）。欠損すると `F-063` のロール別原価が成立しない。記録項目: `tenant_id` / ロール識別子 / model / 用途 / 入出力トークン / 推定コスト / 対象エンティティ。
- 🔴 **利用者向け件数の加算を `runRole` の内部（手順 6b）に閉じ、`ROLE_UNIT` の写像表で「1 件」を定義する**（`P-A-18` / `docs/03` §7.6.1）:
  - スキルシート解析 = `sheet-parser` の実行 1 回 = 1 件（**`skill-normalizer` を別途 1 件と数えない。二重計上になる**）
  - 根拠文 = **根拠文が付いた候補の数**（10 候補を 1 リクエストにまとめても 10 件）
  - 🔴 **システムの再試行は件数に加算しないが金額には計上する**
  - 🔴 **`gate-inspector` は `AiUsage` に記録するが、利用者向けクォータの分母・分子に入れない**（`F-026 AC-6` / `F-027 AC-7`。**記録しないのではなく見せ方の問題**）
- 🔴 **`UsageCounter` の件数を `AiUsage` の行数から数え直さない**（`docs/03` `program-design` 申し送り 30）。数え直すと再試行・`skill-normalizer`・`gate-inspector` が混入する。
- 🔴 **件数を金額から割り戻さない**（`F-026 AC-6`）。1 件あたり標準原価を変更しても、過去の期間の件数消費と残量表示が変化しない。
- **完了の判定**: `F-026 AC-1` / `AC-2` / `AC-6` の結合テスト。**記録を経由しない呼び出し経路が存在しない**ことの静的テスト。標準原価を変えても過去の件数が変わらないテスト。

### T-07-04 コスト上限ガード（M）

- **実装**: `packages/ai/src/quota.ts`（`reserveAiCost` / `decideQuota`）。`docs/03` §4.5 / `docs/03` `program-design` 申し送り 8 / `docs/05` §7.6。
- 🔴 **利用量カウンタは DB を正とし、Redis は表示用キャッシュとトークンバケットに限る。** `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` で原子的に加算する。
- 🔴 **呼び出し前に見積りコストで予約し、呼び出し後に実コストで補正する。予約に失敗したら呼び出さない。**
- 🔴 **「1 日の AI コスト上限」には `gate-inspector` を含め、到達時はゲートも停止する。** **上限到達時に `gate-inspector` をスキップして `ReviewGate` を PASS にする分岐を作らない**（`docs/03` `program-design` 申し送り 30）。
- 🔴 **`Plan` は 2 種類の上限を持ち、判定は独立に評価する** — 内部指標の金額上限（日次）と、利用者向けの単位別件数上限（月次）。
- **ブロッカーではないが確認中**: `Q-T-3`②（プラン別の件数クォータ初期値）。既定は `docs/03` §7.6.2 の表。**設計は値に依存させない**（`Plan` の設定値）。
- **完了の判定**: 予約失敗で外部呼び出しが 0 回になる結合テスト。上限到達の境界値テスト。

### T-07-05 プロンプト管理と `gate-inspector` のプロンプト（M）

- **実装**: `prompts/gate-inspector/v1.md` ほか。`packages/ai/src/prompts.ts`（`prompts/` からのみ読む）。
- 🔴 **配置場所は [Issue #23](https://github.com/Festal-KM/SES-Platform/issues/23)（`prompts/` の衝突）の決定待ち。既定値 A で進める** — 製品プロンプトは **`prompts/roles/{role}/v{N}.md`**（例: `prompts/roles/gate-inspector/v1.md`）に置き、`packages/ai/src/prompts.ts` は **`prompts/roles/` のみを読む**（Claude Code ハーネスのエージェント資産と同居させない）。**決定が既定値と異なる場合は、`CLAUDE.md` §2.1 / `docs/05` を §8.7 の手順で先に直してから実装する**（本ファイルだけを直さない）。版番号の付け方と `ReviewGate` へのプロンプト版の保存（`BR-13`）は、どちらに決まっても変わらない。
- 🔴 **プロンプトをコード中にベタ書きしない**（`CLAUDE.md` §3.2）。**生成物に使用プロンプト版を保存し、後から再現できるようにする**（`BR-13`）。
- **`gate-inspector` の責務**（`CLAUDE.md` §12.2）: PII 層・商流層の検査実行と、**整合層の警告の生成**。🔴 **整合層の合否は判定しない。**
- **期待する構造化出力**: 層ごとの判定（PII / 商流）、指摘の配列（種別・該当箇所・重大度）、整合層の**警告**の配列。
- **完了の判定**: プロンプト版が `ReviewGate` に保存され、同じ版で再現できる結合テスト。

### T-07-06 品質ゲートのパイプライン（L）

- **実装**: `docs/05` §11.1〜§11.4 / §11.7。ジョブ `gate.run`。
- **対象**（`F-020` の入力。Phase 1 は 3 種）: 提案 / スキルシートの外部共有 / 案件の公開。**チャット添付は Phase 2、契約書は Phase 3 で `targetType` を追加する**（`ReviewGate.targetType` は SP-02 で `CONTRACT_DOCUMENT` を含めて定義済み）。
- **3 層**: ①PII 層（氏名・生年月日・連絡先・顔写真・現所属会社名の残存）②商流層（単価・エンド企業名・他社名がその公開範囲で出してはならない相手に出ていないか）③整合層（T-07-07）。
- 🔴 **AI の失敗時フォールバック**（`F-020` AI 利用欄）: LLM が失敗・タイムアウト・スキーマ違反の場合、**PII 層と商流層は判定不能として FAIL 扱い**とし、「検査を完了できなかったため送信できない」と表示する。**PASS へフォールバックしない。**
- 🔴 **これは「LLM を呼んで失敗した」場合の扱いであり、「AI の日次コスト上限に達していて呼べない」場合とは区別する**（T-07-10）。
- 🔴 **1 層でも FAIL なら `GATE_FAILED`** とし、指摘を該当箇所とともに返す。
- **結果を `ReviewGate` に保存**（`F-020 AC-7`）。🔴 **`(targetType, targetId, contentHash)` が同じなら再実行しない**（`P-A-09`）。**ただし AI 失敗（`aiFailed=true`）の結果はキャッシュしない**（再実行で PASS になりうる）。
- **指摘の構造化フォーマット**（`docs/05` §11.7）: `GateResultView` = `{ execution, layers: {pii, commerce, consistency}, aiWarnings, aiFailed, contentHash, held? }`。
- **完了の判定**: `F-020 AC-5`（PII 層で氏名が残っていると FAIL + 該当箇所）/ `AC-6`（商流層でエンド企業名が公開範囲外に出ると FAIL）/ `AC-7` の結合テスト。AI 失敗時に FAIL になることのテスト。

### T-07-07 🔴 整合層の機械的照合（純粋関数）（L）

- **実装**: `packages/domain/src/gate/consistency.ts` の `decideConsistency`（純粋関数）。
- 🔴 **整合層の判定関数に LLM の出力を入力として渡さない**（`docs/02` `program-design` 申し送り 4 / `BR-61`）。**警告は別のフィールドに載せる。**
- **静的テスト**: `gate-consistency-purity.test.ts`（`docs/05` §17.2 #9）— **`decideConsistency` の引数型に AI 由来の型が現れない**ことを AST / 型で検査する。
- 🔴 **Phase 1 の整合層が照合するのは 2 項目のみ**（`F-020` 処理③ / `docs/02` 章 8.5）: ①案件の必須要件との齟齬 ③スキルシートと登録スキルの矛盾。**②重複提案の照合は `F-037`（Phase 2 / SP-15）で有効化される。**
- 🔴 **整合層の合否は、同一入力に対して常に同じ結果になる**（`F-020 AC-3`）。**LLM の応答が変わっても整合層の合否は変わらない。**
- 🔴 **AI の指摘は「警告」として表示され、警告のみが存在する状態でも当該層は PASS**（`F-020 AC-4`）。承認画面では警告が承認者に見える（SP-09 の `F-021 AC-4`）。
- **完了の判定**: 同一入力で 100 回実行して同じ結果になるユニットテスト + 静的テスト green。**LLM のモック応答を変えても合否が変わらない**結合テスト。

### T-07-08 🔴 API #39 / #40 と失敗した `gate.run` の再実行（L）

- **実装**: `POST /api/proposals/{id}/gate`（#39）/ `GET /api/proposals/{id}/gate`（#40）。
- **#39 の通常経路**: `DRAFT` → `GATE_RUNNING` へ CAS して `gate.run` を enqueue する。🔴 **`jobId = 'gate.run:{targetType}:{targetId}:{contentHash}'`**（BullMQ が待機中・実行中の同 ID を重複排除）。
- 🔴 **`gate.run` キューの `defaultJobOptions.removeOnComplete` を `true` にする**（`docs/05` §9.1 / §17.2 #19）。**無いと HELD 後の同 `jobId` 再 enqueue が静かに捨てられ、対象が `GATE_RUNNING` に留まり続ける。** `removeOnFail` は付けない。
- 🔴 **本タスクの受け入れ基準に、`docs/05` §9.10「失敗した `gate.run` の再実行手順」の 5 手順をそのまま含める**（[Issue #16](https://github.com/Festal-KM/SES-Platform/issues/16) で 2026-09-01 に決定。**`docs/03` の申し送りには載っていないため、ここで明示する**）:
  1. 🔴 **入口はテナント利用者の #39 だけ**（作成者 / `SALES` / `ADMIN` の「レビュー依頼」を、`GATE_RUNNING` かつ HELD 行が無い対象 = `JOB_FAILED` に対しても受け付ける）。**運営者は `A-005` で滞留を検知して再依頼を促すだけで、BullMQ の retry に相当する運営者操作を作らない。**
  2. DB トランザクションの**外**で `Queue.getJob('gate.run:{...}')` を取得し、**状態が `failed` のときだけ `Job.remove()`** で削除する。`waiting` / `active` なら削除しない（走っているものを止めない。再 enqueue は重複排除で no-op）。
  3. `withTenant(ctx)` で `review_gates(targetType, targetId, contentHash, execution='DONE')` が**無い**ことを確認し、あれば enqueue せず **422**。
  4. **同じ payload・同じ `jobId`** で `gate.run` を enqueue する。
  5. 🔴 **`Proposal` は `GATE_RUNNING` のまま**（状態を足さず、この時点では遷移も起こさない）。再実行の結果で `APPROVAL_PENDING` か `GATE_FAILED` に確定する。
- **#40 の応答**: 層ごとに確定を返し、**ゲート状態は 3 値**（`RUNNING` / `DONE` / `HELD_AI_COST_LIMIT`）。HELD のとき `heldReasonKey` / `resetAt` / 上限引き上げの導線と、**保持済みの整合層結果**を返す。
- 🔴 **作らないもの**（`docs/05` §6.8）: `POST /api/proposals/{id}/submit?force=true` 相当 / `POST /api/proposals/{id}/gate/override`。**FAIL を上書きできるロールは存在しない**（`F-020 AC-2` / `BR-18`）。
- **完了の判定**: `F-020 AC-2` の結合テスト（force / override の API が存在しない）+ **§9.10 の 5 手順の結合テスト**（failed の削除 → `DONE` 行チェック → 同 `jobId` 再 enqueue → 状態が変わらない）。

### T-07-09 案件公開とスキルシート外部共有のゲート接続（M）

- **実装**: SP-06 の T-06-06 で作った接続点に、本スプリントのゲート本体をつなぐ。
- 🔴 **`F-014 AC-3` を検証する**（SP-06 からの申し送り）: 公開された案件の表示に**エンド企業名・内部単価・他社名が含まれる内容は商流層 FAIL となり、公開できない**。
- **スキルシートの外部共有**（`F-020` 対象の 2 種目）: `F-011` の共有 URL 発行前にゲートを通す。`CLEAN` かつゲート PASS の両方が必要。
- 🔴 **`F-020 AC-1`**: テナント外へ共有される対象は、**ゲートを経ずに共有状態へ進めない**。
- **完了の判定**: `F-014 AC-3` / `F-020 AC-1`（Phase 1 の 3 種のうち案件公開・スキルシート共有）の結合テスト。

### T-07-10 `gate.hold-release` と HELD の結合 / E2E（M）

- **実装**: ジョブ `gate.hold-release`（毎 10 分。`attempts: 3`）。`docs/05` §9.3 / `F-027 AC-5`。
- 🔴 **AI の日次コスト上限による停止中にレビュー依頼を行っても、ゲートは実行されず未実行のまま保持され、対象は `GATE_RUNNING` に留まる。`GATE_FAILED` にはならない。**
- 🔴 **理由**: `GATE_FAILED` は「元データの欠陥」を意味する状態である（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。混ぜるとゲート FAIL 率（`F-059`）が汚れ、**直すべき元データが無いのに「修正して再実行」を促す誤った導線**になる。
- **整合層の機械的照合は動作し、その結果は保持して上限解除後の再実行に用いる。**
- 🔴 **上限解除後の再実行はゲートジョブが自動で行う**（ゲートは外部送信系ではないため自動再試行が許される。**§10 の自動リトライ禁止の対象は外部送信ジョブに限る**）。利用者が手動で再実行することもでき、**自動・手動のいずれの経路でも同一対象へのゲート実行が多重化しない**。
- 🔴 **多重化防止は 3 段**（`docs/05` §9.3）: HELD 部分 UNIQUE / `jobId` 重複排除 / 完了 CAS。
- 🔴 **新しい状態を作らない**（`ReviewGate.execution` は実行の属性であり状態機械ではない。`P-A-16`）。
- **静的テスト**: `gate.hold-release` が **`gate.run` 以外を enqueue しない**（`docs/05` §17.2 #19。送信系の再 enqueue に転用されていない）。
- **完了の判定**: E2E #23 の前半（上限到達中にレビュー依頼 → HELD → 承認・送信が 409 / 422 → 上限解除 → 自動で DONE）。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | マスキング（6 種の除去）。`decideConsistency` の決定性（100 回同結果）。`ROLE_UNIT` の写像。予約 → 補正のコスト計算。Zod の `safeParse` 失敗時の扱い。 |
| **結合（DB + Redis）** | `F-020` の全 AC。`F-026 AC-1` / `AC-2` / `AC-6`。`F-027 AC-5` / `AC-7`。`ReviewGate` のキャッシュ（`contentHash` 一致で再実行しない / `aiFailed` はキャッシュしない）。HELD の 3 段の多重化防止。**§9.10 の再実行 5 手順。** |
| **静的テスト** | `ai-single-path.test.ts`（#10）/ `gate-consistency-purity.test.ts`（#9）/ `redact-snapshot.test.ts`（#11）/ `gate.hold-release` の enqueue 先（#19）/ `gate.run` の `removeOnComplete: true`（#19）。 |
| **E2E** | E2E #4 の一部（案件公開のゲート FAIL）。E2E #18（プロンプトインジェクションでゲートの判定が変わらない）。E2E #23 の前半（AI 上限と HELD）。**提案のゲート FAIL → 送信不可の E2E は SP-09**。 |
| **外部 API のモック方針** | 🔴 **`MockAnthropicClient`（`packages/ai/src/mock/`）を E2E と結合で同一実装として使う**（`docs/05` §17.5）。**固定の構造化応答**を返し、①スキーマ違反 ②タイムアウト ③`enforced_spend_limit_reached` の各ケースを再現する。テスト専用の別モックを書かない。 |

## 6. 完了判定

1. `F-020` の全 AC（Phase 1 の対象 3 種のうち案件公開・スキルシート共有）、`F-026 AC-1` / `AC-2` / `AC-6`、`F-027 AC-5` / `AC-7` が green。
2. 🔴 **`F-014 AC-3`（ゲート FAIL なら公開しない）が検証済み**（SP-06 からの申し送りの解消）。
3. 🔴 **AI 呼び出しが `packages/ai` の単一経路に閉じ、記録を経由しない経路が存在しない**（静的テスト + 結合テスト）。
4. 🔴 **`image` / `document` ブロックを型として渡せず、`MaskedText` 以外を `runRole` に渡せない**（型テスト）。
5. 🔴 **`decideConsistency` の引数型に AI 由来の型が現れない**（静的テスト）。整合層の合否が LLM 応答で変わらない。
6. 🔴 **ゲート FAIL を上書きする API・設定・導線が存在しない。**
7. 🔴 **`docs/05` §9.10 の再実行 5 手順が実装され、結合テストで green**（Issue #16）。運営者向けの retry 操作が存在しない。
8. AI 上限到達で `GATE_RUNNING` のまま HELD になり、`GATE_FAILED` にならない。解除後に自動再実行される。
