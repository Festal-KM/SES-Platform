# SP-07 ai-layer-gate — `packages/ai` の単一経路と品質ゲート 3 層

> **Phase**: 1（MVP） / **前提**: SP-06 / **後続**: SP-09 / SP-10
> **一次資料**: `docs/02` `F-020` `F-026` `F-027`（AI 上限）/ 章 8.5 / 章 8.7 / `docs/03` §3.3 / §4.1 / §4.2 / §4.5 / §7.6 / `docs/05` §7 / §9.3 / §11 / §16.5 / `CLAUDE.md` §3.2 / §3.3 / §12
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-07`
> 🔴 **着手条件（2 件。いずれもブロッカーではないが、着手前に確認する）**: ① **E-3 Anthropic API キーの取得**（`docs/dev-plan.md` §5 E-3。~~2026-09-03 時点で未着手・ユーザー作業~~ → 🔴 **2026-09-09（SP-07 の完了時）でもなお未取得。ただし T-07-01〜T-07-10 は `MockAnthropicClient` で完了した。** 残るのは ①`packages/ai/src/client.ts` の **`createAnthropicMessagesApi` 1 関数の実装**〔現在は `AiClientNotAvailableError` を投げる **fail-closed**〕②`maxRetries: 0` のテスト固定 ③**キーの取得（ユーザー作業）。[Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19) に依頼を追記済み**。🔴 **未取得のままだと `production` / `staging` / `sandbox` で AI クライアントの生成が起動時に失敗するため、T-07-11 の配線を入れた瞬間にそれらの環境でワーカーが起動しなくなる**〔`development` = `mock` なら T-07-11 の受け入れ基準は満たせる。`Q-07-1`〕）② ~~**[Issue #23](https://github.com/Festal-KM/SES-Platform/issues/23)（`prompts/` の衝突）の決定確認**~~ — ✅ **決着（2026-09-08、回答 A）。製品プロンプトは `prompts/roles/{role}.v{n}.ts` 配下**（形式は `docs/05` §7.7 が正。本ファイル旧記載の `{role}/v{N}.md` は誤り — プロンプトは `export const prompt = { system, user, version }` の TS モジュールであり md ではない）。`packages/ai` は `prompts/roles/` のみを読む（`docs/dev-plan.md` §9 / T-07-05）。

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
| T-07-11 | 🔴 **ワーカーの起動配線とスケジュール基盤** | `gate.run` の Worker が待ち受け、宣言済みの 5 本が実際に走る（🔴 **着手条件は下記 `## Open Questions` の 2 件**） | `F-027 AC-5` / `F-043 AC-4` / `docs/05` §9.1 | L |

## 4. タスク詳細

### T-07-01 `packages/ai` の単一経路と構造化出力（L）

- **実装**: `packages/ai/src/client.ts`（唯一の SDK 経路）/ `run.ts`（`runRole`）/ `mock/`（`MockAnthropicClient`）。
- 🔴 **アプリコードから SDK を直接 import しない**（`CLAUDE.md` §3.2）。`ai-single-path.test.ts`（`docs/05` §17.2 #10）が `@anthropic-ai/sdk` の import 元を 1 ファイルに固定する。
- 🔴 **構造化出力は `output_config.format` + `zodOutputFormat` を使い、受信後に必ず Zod で `safeParse` する**（`docs/03` `program-design` 申し送り 10）。**JSON Schema 側は `minimum` / `maxLength` 等の制約を無視するため、受信後の再検証が唯一の担保である。** 自由文を正規表現でパースしない。
- **リトライ / フォールバック**（`docs/02` 章 8.7 / `docs/05` §7.4）: 🔴 **LLM の再試行は `runRole` の内部で最大 2 回まで**。**ジョブ単位での再試行は行わない**（`AiUsage` が二重に積まれるため。`attempts: 1`）。
- 🔴 **ロールごとにモデルを設定可能にする**（`CLAUDE.md` §12.3）。ハードコードしない。既定は `claude-sonnet-5`、定型処理は `claude-haiku-4-5-20251001`。設定は `TenantRoleModel`（画面は SP-14）。
- **ブロッカーではないが確認中**: `Q-T-5`（Anthropic の ZDR 適用）。**設計に影響しない**（マスキングは ZDR の有無にかかわらず必須）。適用時は `client.ts` のヘッダを足すだけ。
- **完了の判定**: `ai-single-path.test.ts` が green。スキーマ違反・タイムアウト・`enforced_spend_limit_reached` の 3 ケースをモックで再現するユニットテスト。
- ✅ **完了（2026-09-08、コミット `024b67c`）** — `packages/ai` を **AI 呼び出しの単一経路**として立ち上げた。🔴 **経路を 3 層に割った**: `client.ts`（**`@anthropic-ai/sdk` を import してよい唯一のファイル**。`tests/static/ai-single-path.test.ts` が走査）→ `run.ts` の `runRole`（レート制御・再試行・構造化出力の検証・`provenance` の付与）→ 各ロール。🔴 **`runRole` は 4 つのポートを必須引数に取る**（`AiClient` / プロンプト解決 / 利用量記録 / コスト予約）—— **どれか 1 つでも省いた呼び出しがコンパイルできない**形にしてあり、「記録を通らない経路」を後から書けない（`BR-09` / `BR-10`）。構造化出力は `output_config.format` + Zod スキーマで要求し、🔴 **受信後に必ず `safeParse` で再検証する**（JSON Schema 側が `minimum` / `maxLength` を無視するため、受信後の再検証が唯一の担保である。`docs/03` `program-design` 申し送り 10）。🔴 **再試行は `runRole` の内部で最大 2 回まで**とし、ジョブ単位の再試行は行わない（`attempts: 1`。`AiUsage` が二重に積まれるため）。🔴 **SDK アダプタ（`createAnthropicMessagesApi`）は本タスクでは実体化せず `AiClientNotAvailableError` を投げる** —— **fail-closed であって未実装の放置ではない**（「未設定なら黙ってモックへ落ちる」を作らないという `CLAUDE.md` §11.1 の規律を、AI 層でも同じ形で守る）。**依存 `@anthropic-ai/sdk` は追加済みで、残るのはこの 1 関数の実装と `maxRetries: 0` のテスト固定、および E-3 の API キー取得である**（`## Open Questions` `Q-07-1` / [Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19)）。モデルはロール別に設定可能（ハードコードしない。`CLAUDE.md` §12.3）。スキーマ違反・タイムアウト・`enforced_spend_limit_reached` の 3 ケースをモックで再現するユニットテストが green。

### T-07-02 🔴 PII マスキングと型による画像禁止（L）

- **実装**: `packages/ai/src/mask.ts` と `MaskedText` のブランド型（`docs/03` §4.2 / `docs/03` `program-design` 申し送り 11）。
- 🔴 **`packages/ai` の LLM 呼び出し関数が `image` / `document` コンテンツブロックを型として受け取れないようにする。** 画像を送れない構造にすることで、`CLAUDE.md` §7 の「PII 未マスキング送信 0 件」を**型で担保**する。
- 🔴 **マスキング対象**（`BR-11`）: 氏名・生年月日・連絡先・顔写真・現所属会社名。**LLM に渡してよいのはスキル・経験内容・期間だけ。**
- 🔴 **単価とエンド企業名を LLM に渡さない**（`BR-12`）。商流情報が生成物に混入し、そのまま外部共有される経路になる。
- 🔴 **マスキングを迂回する入力経路を作らない**（`CLAUDE.md` §12.3）。`runRole` の引数が `MaskedText` しか受け取らない。
- **プロンプトインジェクション対策**（`docs/05` §7.8）: スキルシート本文に埋め込まれた指示がゲートの判定を変えないこと（E2E #18 で検証。本タスクではプロンプト側の防御を実装）。
- **完了の判定**: 型テスト（生の `string` / `image` ブロックを渡すとコンパイルエラー）+ マスキングのユニットテスト（氏名・生年月日・連絡先・会社名・単価・エンド企業名の 6 種が除去される）。
- ✅ **完了（2026-09-08、コミット `be524fe`）** — `packages/ai/src/mask.ts` と **`MaskedText` のブランド型**。🔴 **「マスキングを通っていない文字列を LLM に渡せない」ことを 4 層で担保した**: ①**型** —— `runRole` の入力は `MaskedText` のみで、生の `string` は代入できない ②**構造** —— コンテンツブロックの型に `image` / `document` が**存在しない**（画像を送る実装は書こうとしても通らない。`CLAUDE.md` §7 の「PII 未マスキング送信 0 件」を型で否定する）③**単一経路** —— `MaskedText` を作れるのは `mask()` だけで、`tests/static/masked-text-single-path.test.ts` が生成箇所を固定する ④**実装** —— 台帳の既知値による置換とパターン検出の併用（`packages/ai/src/mask.test.ts`）。🔴 **マスキング対象は氏名・生年月日・連絡先・顔写真・現所属会社名に加え、単価とエンド企業名まで**（`BR-11` / `BR-12`。商流情報が生成物に混入して外部共有される経路を作らない）。🔴 **表記ゆれを吸収する**（`mask.test.ts:204` の 6 ケース = 国際表記の電話 / スラッシュ区切りと区切り無しの生年月日 / 姓名の空白違い / 法人格の略記 / 万円表記の単価）一方で、🔴 **素の年月（職務期間）はパターンで伏せない**（`mask.test.ts:231`）—— **伏せすぎると LLM に渡してよい「経験内容と期間」まで消え、解析が成立しなくなる**ため、境界を**テストで明示的に固定**している。マスキング結果には**境界タグ**（何をどの手段で伏せたか = `hits`）を残し、後から検査できるようにした。プロンプトインジェクション対策のプロンプト側の防御も本タスクで実装（判定が変わらないことの検証は §5 の E2E #18）。

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
- ✅ **完了（2026-09-08、コミット `d915465`）** — 🔴 **呼び出し 1 回につき `AiUsage` が必ず 1 行**で、**記録に失敗したら throw する**（成果物だけが残って原価が消える経路を作らない。`docs/05` §1.4）。`runRole` の戻り値は `provenance`（ロール識別子 / プロンプト版 / モデル）を**必須**で持ち、`AiUsage` にロール識別子が入らない経路が型として存在しない（`F-026 AC-2`。欠けると `F-063` のロール別原価が成立しない）。🔴 **原価は整数演算で計算する** —— トークン単価をマイクロ USD の整数として持ち、浮動小数の誤差が積算で効かないようにした（`tests/static/ai-usage-cost-single-path.test.ts` が算出箇所を 1 本に固定する）。🔴 **件数と金額を独立に持ち、片方から他方を導出しない**（`F-026 AC-6` / `docs/03` `program-design` 申し送り 30）—— 件数の加算は `runRole` の内部 1 箇所に閉じ、`ROLE_UNIT` の写像表が「1 件」を定義する（スキルシート解析は `sheet-parser` 1 回で 1 件。`skill-normalizer` を別に数えない / 根拠文は**根拠文が付いた候補の数** / **システムの再試行は件数に加算しないが金額には計上する** / 🔴 **`gate-inspector` は `AiUsage` に記録するが利用者向けクォータの分母・分子に入れない** = 記録しないのではなく見せ方の問題）。`UsageCounter` の件数を `AiUsage` の行数から数え直さない。**標準原価を変えても過去の期間の件数消費と残量表示が変わらない**ことをテストで固定した。

### T-07-04 コスト上限ガード（M）

- **実装**: `packages/ai/src/quota.ts`（`reserveAiCost` / `decideQuota`）。`docs/03` §4.5 / `docs/03` `program-design` 申し送り 8 / `docs/05` §7.6。
- 🔴 **利用量カウンタは DB を正とし、Redis は表示用キャッシュとトークンバケットに限る。** `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` で原子的に加算する。
- 🔴 **呼び出し前に見積りコストで予約し、呼び出し後に実コストで補正する。予約に失敗したら呼び出さない。**
- 🔴 **「1 日の AI コスト上限」には `gate-inspector` を含め、到達時はゲートも停止する。** **上限到達時に `gate-inspector` をスキップして `ReviewGate` を PASS にする分岐を作らない**（`docs/03` `program-design` 申し送り 30）。
- 🔴 **`Plan` は 2 種類の上限を持ち、判定は独立に評価する** — 内部指標の金額上限（日次）と、利用者向けの単位別件数上限（月次）。
- **ブロッカーではないが確認中**: `Q-T-3`②（プラン別の件数クォータ初期値）。既定は `docs/03` §7.6.2 の表。**設計は値に依存させない**（`Plan` の設定値）。
- **完了の判定**: 予約失敗で外部呼び出しが 0 回になる結合テスト。上限到達の境界値テスト。
- ✅ **完了（2026-09-08、コミット `ba30053`）** — 🔴 **呼び出し前に見積りコストで「予約」し、予約に失敗したら外部を 1 回も呼ばない。呼び出し後に実コストで補正する。** 予約は **1 文の SQL**（`INSERT ... ON CONFLICT DO UPDATE ... WHERE`（上限内のときだけ加算）`... RETURNING`）で行い、**読んでから書く 2 文にしない** —— 2 文だと同時実行で上限をすり抜ける。🔴 **利用量カウンタは DB を正とし、Redis は表示用キャッシュとトークンバケットに限る。** 🔴 **日次の窓は暦日（テナントのタイムゾーンの日付）で切り、TTL は「次の暦日の境界まで」とする** —— 「最初の呼び出しから 24 時間」にすると、上限に張り付いたテナントで窓の起点が毎日ずれて**利用者に説明できない**（残量表示と実際のリセット時刻が食い違う）。🔴 **上限には `gate-inspector` を含め、到達時はゲートも停止する**（**上限到達時に `gate-inspector` をスキップして PASS にする分岐は存在しない**）。🔴 **`Plan` の 2 種類の上限（内部指標の金額日次 / 利用者向けの件数月次）を独立に評価する。**<br>🔴 **実装パスの読み替え（2026-09-09 に固定。`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 / 2026-09-06 SP-04 / 2026-09-07 SP-05 / 2026-09-08 SP-06 の前例と同じ扱い）**: 🔴 **本タスク詳細が書いた `packages/ai/src/quota.ts` は存在せず、`decideQuota` という関数もコードに無い。** 実体は **3 つに割れている** —— ①**予約と補正（I/O）** = `packages/db/src/ai-cost-guard.ts` の **`reserveAiCost`**（上の 1 文 SQL。`packages/db` に置いたのは、`packages/ai` が DB に依存しないという `CLAUDE.md` §2.1 の依存方向を崩さないため）②**判定（純粋関数）** = `packages/domain/src/quota/ai-cost.ts` の **`decideAiDailyCost`** ③**メトリック別の判定** = `packages/domain/src/quota/{email-rate,storage}.ts`（`provider.ts` は SP-04 で先行実装済み）。🔴 **`decideQuota` という「全メトリックを 1 関数で捌く」形を採らなかった理由**は、メトリックごとに窓（日次 / 月次）・単位（USD / 件数 / 通数 / バイト数）・超過時の扱い（保留 / 拒否 / 発行しない）が違い、1 つの分岐に押し込むと**どのメトリックの話をしているか型で分からなくなる**ためである。**テストを新設して名前を計画に合わせるのではなく、実体への読み替えを本記録に固定する。** ⚠️ **申し送り（`program-design` 宛）**: 🔴 **`docs/05` §7.6 が `decideQuota` / `packages/ai/src/quota.ts` の署名で書かれているため、上記 3 分割に合わせた更新が要る**（`CLAUDE.md` §8.7。**本ファイルとコードだけを直して `docs/05` を放置しない**）。**署名の更新は `program-design` の仕事**であり、本スプリントの実装は変えない。

### T-07-05 プロンプト管理と `gate-inspector` のプロンプト（M）

- **実装**: `prompts/roles/gate-inspector.v1.ts` ほか（~~`prompts/gate-inspector/v1.md`~~ は Issue #23 決定前の旧記載。プロンプトは md ではなく `export const prompt = { role, version, build }` の TS モジュールである）。`packages/ai/src/prompts.ts`（🔴 **`prompts/roles/` を読む唯一のファイル**）。**実装済み（2026-09-08）。確定形は `docs/05` §7.13 を正とする。**
- 🔴 ~~配置場所は [Issue #23](https://github.com/Festal-KM/SES-Platform/issues/23) の決定待ち~~ ✅ **決着（2026-09-08、回答 A）** — 製品プロンプトは **`prompts/roles/{role}.v{n}.ts`**（例: `prompts/roles/gate-inspector.v1.ts`。形式は `docs/05` §7.7 が正。旧記載 `{role}/v{N}.md` は誤りとして是正）に置き、`packages/ai` は **`prompts/roles/` のみを読む**（Claude Code ハーネスのエージェント資産と同居させない）。**決定が既定値と異なる場合は、`CLAUDE.md` §2.1 / `docs/05` を §8.7 の手順で先に直してから実装する**（本ファイルだけを直さない）。版番号の付け方と `ReviewGate` へのプロンプト版の保存（`BR-13`）は、どちらに決まっても変わらない。
- 🔴 **プロンプトをコード中にベタ書きしない**（`CLAUDE.md` §3.2）。**生成物に使用プロンプト版を保存し、後から再現できるようにする**（`BR-13`）。
- **`gate-inspector` の責務**（`CLAUDE.md` §12.2）: PII 層・商流層の検査実行と、**整合層の警告の生成**。🔴 **整合層の合否は判定しない。**
- **期待する構造化出力**: 層ごとの判定（PII / 商流）、指摘の配列（種別・該当箇所・重大度）、整合層の**警告**の配列。
- **完了の判定**: プロンプト版が `ReviewGate` に保存され、同じ版で再現できる結合テスト。
- ✅ **完了（2026-09-08、コミット `4314694`）** — [Issue #23](https://github.com/Festal-KM/SES-Platform/issues/23) の回答 A を実装した。🔴 **`prompts/` を「依存を持たないワークスペースパッケージ `@ses/prompts`」にした** —— Claude Code ハーネスのエージェント資産と製品プロンプトを同じディレクトリに同居させず、**`packages/ai/src/prompts.ts` だけが `@ses/prompts` を import する**（`tests/static/prompt-registry-single-path.test.ts` が走査）。プロンプトは **`prompts/roles/{role}.v{n}.ts` の TS モジュール**（`export const prompt = { role, version, build }`）であり、**md ではない**（本ファイルの旧記載 `{role}/v{N}.md` は誤りとして是正済み。確定形は `docs/05` §7.7 / §7.13）。🔴 **`PromptKit` を挟んだ理由**: プロンプトの `build` が受け取れるのを `MaskedText` に限り、**プロンプト側からマスキングを迂回できない**ようにするため（型引数 `PromptKit<MaskedText>`）。版はコードではなくファイル名と `version` が持ち、**生成物（`ReviewGate`）に使用プロンプト版とモデルを保存して後から再現できる**（`BR-13`）。`gate-inspector` のプロンプトは **PII 層・商流層の検査実行と、整合層の警告の生成**までを責務とし、🔴 **整合層の合否を出力スキーマに持たない**（出せないものは書けない。合否の判定は T-07-07 の機械的照合だけが行う）。🔴 **上流を先に直した**（`CLAUDE.md` §8.7）—— `CLAUDE.md` §2.1 / `docs/05` §7.7 / §7.13 / `docs/dev-plan.md` §9 の Issue #23 の行を確定形に更新してから実装した。

### T-07-06 品質ゲートのパイプライン（L）

- **実装**: `docs/05` §11.1〜§11.4 / §11.7。ジョブ `gate.run`。**実装済み（2026-09-08）。確定形は `docs/05` §11.9 を正とする**（`GateInput` を対象種別で判別する合併にしたこと、機械的検出を商流層にも置いたこと、AI のオフセットを原文へ戻すこと、保存の順序（完了 CAS / `aiFailed` の上書き）、T-07-08〜T-07-10 への申し送り 7 点）。
- 🔴 **未解決（人間の判断が要る。`docs/05` §11.9 ⑦）→ [Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) として起票済み（2026-09-09。`decision-needed`。既定 = `app_scan_probe` と同型）**: パートナー所属エンジニアの提案は、ジョブのホスト文脈から `engineers` / `engineer_skills`（C3）を読めないためゲートを通せない（現在は `ReviewGate` を 1 行も書かずに落ちる = fail-closed）。**Phase 1 の中核 E2E（パートナーが提案 → ホストが承認 → 送信）の前に決着が要る。** 🔴 **持ち主は `docs/sprints/SP-09-proposal-flow.md` のヘッダの着手条件①と `docs/dev-plan.md` §9 である**（無主にしない）。
- **対象**（`F-020` の入力。Phase 1 は 3 種）: 提案 / スキルシートの外部共有 / 案件の公開。**チャット添付は Phase 2、契約書は Phase 3 で `targetType` を追加する**（`ReviewGate.targetType` は SP-02 で `CONTRACT_DOCUMENT` を含めて定義済み）。
- **3 層**: ①PII 層（氏名・生年月日・連絡先・顔写真・現所属会社名の残存）②商流層（単価・エンド企業名・他社名がその公開範囲で出してはならない相手に出ていないか）③整合層（T-07-07）。
- 🔴 **AI の失敗時フォールバック**（`F-020` AI 利用欄）: LLM が失敗・タイムアウト・スキーマ違反の場合、**PII 層と商流層は判定不能として FAIL 扱い**とし、「検査を完了できなかったため送信できない」と表示する。**PASS へフォールバックしない。**
- 🔴 **これは「LLM を呼んで失敗した」場合の扱いであり、「AI の日次コスト上限に達していて呼べない」場合とは区別する**（T-07-10）。
- 🔴 **1 層でも FAIL なら `GATE_FAILED`** とし、指摘を該当箇所とともに返す。
- **結果を `ReviewGate` に保存**（`F-020 AC-7`）。🔴 **`(targetType, targetId, contentHash)` が同じなら再実行しない**（`P-A-09`）。**ただし AI 失敗（`aiFailed=true`）の結果はキャッシュしない**（再実行で PASS になりうる）。
- **指摘の構造化フォーマット**（`docs/05` §11.7）: `GateResultView` = `{ execution, layers: {pii, commerce, consistency}, aiWarnings, aiFailed, contentHash, held? }`。
- **完了の判定**: `F-020 AC-5`（PII 層で氏名が残っていると FAIL + 該当箇所）/ `AC-6`（商流層でエンド企業名が公開範囲外に出ると FAIL）/ `AC-7` の結合テスト。AI 失敗時に FAIL になることのテスト。
- ✅ **完了（2026-09-08、コミット `19d6b47`）** — ジョブ `gate.run` のパイプライン本体（3 層の実行順・入出力型・保存）。🔴 **T-07-07（整合層）を先に実装してから本タスクに入った** —— パイプラインが `decideConsistency` を**呼ぶ側**であり、逆順に作ると「整合層が無い間だけ PASS を返す」暫定分岐が生まれるためである（コミット順が `7f0d7af`（T-07-07）→ `19d6b47`（T-07-06）なのはこの理由による。計画の番号順との差は意図的である）。🔴 **素通り経路がゼロであることを構造で担保した**: `GateInput` を**対象種別で判別する合併**にし（提案 / 案件公開 / スキルシート共有）、**どの枝も 3 層すべての結果を返さないと `GateOutcome` に組み立てられない**。🔴 **AI の失敗・タイムアウト・スキーマ違反は「判定不能 ＝ FAIL」**であり、**PASS へフォールバックしない**（`F-020` AI 利用欄。「検査を完了できなかったため送信できない」と表示する）。🔴 **機械的検出を商流層にも置いた** —— 単価・エンド企業名・他社名の検出を AI だけに委ねると、LLM が黙って落ちた回だけ検査が薄くなる。AI が返すオフセットは**原文の位置へ戻して**指摘に添える（マスキング後の位置のまま返すと、利用者が直すべき箇所を指せない）。保存は**完了 CAS**（同一対象への多重実行が 1 行に収束する）で行い、🔴 **`(targetType, targetId, contentHash)` が同じなら再実行しないが、`aiFailed=true` の結果はキャッシュしない**（再実行で PASS になりうるため）。**1 層でも FAIL なら `GATE_FAILED`**、指摘は該当箇所とともに `GateResultView` の構造で返す。⚠️ **未解決（人間の判断。`docs/05` §11.9 ⑦）**: 🔴 **パートナー所属エンジニアの提案は、ジョブのホスト文脈から `engineers` / `engineer_skills`（C3）を読めないためゲートを通せず、現在は `ReviewGate` を 1 行も書かずに落ちる（fail-closed）。** → **[Issue #41](https://github.com/Festal-KM/SES-Platform/issues/41) として起票済み**（`decision-needed`。既定 = `app_scan_probe` と同型の専用ロール + `SECURITY DEFINER` + 列レベル `GRANT`）。🔴 **SP-09 の中核 E2E（パートナーが提案 → ホストが承認 → 送信）の前に決着が要る**（`docs/sprints/SP-09-proposal-flow.md` のヘッダの着手条件 / `docs/dev-plan.md` §9）。

### T-07-07 🔴 整合層の機械的照合（純粋関数）（L）

- **実装**: `packages/domain/src/gate/consistency.ts` の `decideConsistency`（純粋関数）。**実装済み（2026-09-08）。確定形は `docs/05` §11.8 を正とする**（`ConsistencyInput` は `Pick<GateInput, …>` ではなく 3 項目を束ねた形、`duplicateFindings` は「空配列しか渡せない継ぎ目」、`excerpt` の表記契約、T-07-06 への申し送り 4 点）。
- 🔴 **整合層の判定関数に LLM の出力を入力として渡さない**（`docs/02` `program-design` 申し送り 4 / `BR-61`）。**警告は別のフィールドに載せる。**
- **静的テスト**: `gate-consistency-purity.test.ts`（`docs/05` §17.2 #9）— **`decideConsistency` の引数型に AI 由来の型が現れない**ことを AST / 型で検査する。
- 🔴 **Phase 1 の整合層が照合するのは 2 項目のみ**（`F-020` 処理③ / `docs/02` 章 8.5）: ①案件の必須要件との齟齬 ③スキルシートと登録スキルの矛盾。**②重複提案の照合は `F-037`（Phase 2 / SP-15）で有効化される。**
- 🔴 **整合層の合否は、同一入力に対して常に同じ結果になる**（`F-020 AC-3`）。**LLM の応答が変わっても整合層の合否は変わらない。**
- 🔴 **AI の指摘は「警告」として表示され、警告のみが存在する状態でも当該層は PASS**（`F-020 AC-4`）。承認画面では警告が承認者に見える（SP-09 の `F-021 AC-4`）。
- **完了の判定**: 同一入力で 100 回実行して同じ結果になるユニットテスト + 静的テスト green。**LLM のモック応答を変えても合否が変わらない**結合テスト（`packages/ai/src/gate-consistency-independence.test.ts`。モック応答 5 通り）。🔴 **パイプラインを通した検証（応答を変えても `ReviewGate.consistencyVerdict` と対象状態が変わらない）は T-07-06 が引き継ぐ**（`docs/05` §11.8 ⑦-3）。
- ✅ **完了（2026-09-08、コミット `7f0d7af`）** — 🔴 **T-07-06 より先に実装した**（パイプラインが本タスクの関数を呼ぶ側であり、逆順だと「整合層が無い間だけ PASS」の暫定分岐が生まれるため）。`packages/domain/src/gate/consistency.ts` の **`decideConsistency`**（純粋関数）。🔴 **AI の出力を渡せる型が存在しない構造にした** —— `ConsistencyInput` は `GateInput` の `Pick` ではなく**照合に要る 3 項目だけを束ねた独立の型**であり、`duplicateFindings` は 🔴 **「空配列しか渡せない継ぎ目」**（`F-037` = Phase 2 / SP-15 で有効化されるまで、重複提案を根拠に FAIL にできない）。「渡さない運用にする」ではなく**渡す型が無い**ことが `BR-61` の担保である。🔴 **4 層の静的検査で固定**（`tests/static/gate-consistency-purity.test.ts` / `domain-purity.test.ts`）: ①`decideConsistency` の引数型に AI 由来の型が現れない ②`packages/domain` が I/O・現在時刻・DB に依存しない ③戻り値に警告フィールドが無い（警告は AI 側の別フィールドに載る）④`excerpt` の表記契約（該当箇所の切り出し方が実装ごとにぶれない）。🔴 **Phase 1 の整合層が照合するのは 2 項目のみ**（①案件の必須要件との齟齬 ③スキルシートと登録スキルの矛盾）。**同一入力で 100 回実行して同じ結果**（`F-020 AC-3`）、**LLM のモック応答を 5 通りに変えても合否が変わらない**（`packages/ai/src/gate-consistency-independence.test.ts`）ことが green。**警告のみが存在する状態でも当該層は PASS**（`F-020 AC-4`）。

### T-07-08 🔴 API #39 / #40 と失敗した `gate.run` の再実行（L）

- **実装**: `POST /api/proposals/{id}/gate`（#39）/ `GET /api/proposals/{id}/gate`（#40）。**実装済み（2026-09-09）。確定形は `docs/05` §11.10 を正とする**（`gateContentHash` を domain と `packages/db` に割ったこと、🔴 **`jobId` の区切りを `:` から `.` に変えたこと**〔BullMQ がカスタム `jobId` に `:` を許さない。実測〕、BullMQ の実体化を `packages/connectors/src/bullmq.ts` に置いたこと〔+ `ioredis` の依存追加〕、`DONE` 行チェックを `DRAFT` の経路にも掛けたこと、T-07-09 / T-07-10 / SP-09 への申し送り 6 点）。
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
- ✅ **完了（2026-09-09、コミット `9a23602`）** — `POST /api/proposals/{id}/gate`（#39）/ `GET /api/proposals/{id}/gate`（#40）。🔴 **`docs/05` §9.10 の再実行 5 手順をそのまま実装した**（[Issue #16](https://github.com/Festal-KM/SES-Platform/issues/16)）: ①入口はテナント利用者の #39 だけ（**運営者の retry 操作を作らない**）②トランザクションの**外**で `Queue.getJob()` を取り、**`failed` のときだけ `Job.remove()`**（`waiting` / `active` は止めない）③`review_gates(..., execution='DONE')` が無いことを確認し、あれば **422** ④**同じ payload・同じ `jobId`** で再 enqueue ⑤**`Proposal` は `GATE_RUNNING` のまま**（状態を足さない）。🔴 **実測に基づく設計変更 —— `jobId` の区切りを `:` から `.` に変えた**（`gate.run.{targetType}.{targetId}.{contentHash}`）: **BullMQ はカスタム `jobId` に `:` を許さず**、`:` を含めると内部キーが壊れて重複排除そのものが効かなくなる（＝ 二重実行の防止が静かに無効化される）。🔴 **BullMQ の実体化を `packages/connectors/src/bullmq.ts` に置いた**（+ `ioredis` の依存追加）—— キューの生成箇所を 1 本に閉じ、`QUEUE_CONSTRUCTION_ALLOWLIST` で走査できる形を維持するため。🔴 **`gate.run` の `defaultJobOptions.removeOnComplete` を `true` に固定**（`tests/static/queue-attempts.test.ts:437`）—— 無いと **HELD 後の同 `jobId` 再 enqueue が静かに捨てられ、対象が `GATE_RUNNING` に留まり続ける**。`removeOnFail` は付けない（`failed` は `§16.5` の失敗ジョブ数の根拠であり、§9.10 の手順が消す）。🔴 **`contentHash` の算出を 1 実装に割った**（`gateContentHash` を `packages/domain` と `packages/db` に分担）—— 2 実装あると「承認 CAS が見るハッシュ」と「ゲートが保存したハッシュ」がずれ、T-09-04 の承認無効化が空振りする。**`DONE` 行チェックは `DRAFT` からの通常経路にも掛けた**（再実行経路だけに掛けると、通常のレビュー依頼で確定済みの結果を上書きできてしまう）。🔴 **`force=true` / `gate/override` に相当する API・設定・導線は存在しない**（`F-020 AC-2` / `BR-18`）ことを結合テストで固定。

### T-07-09 案件公開とスキルシート外部共有のゲート接続（M）

- **実装**: SP-06 の T-06-06 で作った接続点に、本スプリントのゲート本体をつなぐ。**実装済み（2026-09-09）。確定形は `docs/05` §11.11 を正とする**（中間テーブル `ProjectPublishRequest` で「これから公開する相手」を運ぶこと〔§11.9 ⑧-5 の解消〕、`PROJECT_PUBLISH` の内容のハッシュに公開先と取引先の社名まで含めること、`#28` は確定済みのゲート結果を理由に断らないこと〔`#39` との差分〕、公開範囲の行を作るのは `settleProjectPublish` の 1 か所であること、`SKILL_SHEET_SHARE` の決着〔§11.9 ⑧-6〕、T-07-10 / SP-09 / Phase 2 への申し送り 4 点）。
- 🔴 **`F-014 AC-3` を検証する**（SP-06 からの申し送り）: 公開された案件の表示に**エンド企業名・内部単価・他社名が含まれる内容は商流層 FAIL となり、公開できない**。✅ `tests/isolation/project-publish-gate.test.ts`（`#28` → `gate.run` → 公開の確定 → **パートナー文脈で見えるか**まで通す）。
- ~~**スキルシートの外部共有**（`F-020` 対象の 2 種目）: `F-011` の共有 URL 発行前にゲートを通す。`CLEAN` かつゲート PASS の両方が必要。~~ → ✅ **決着（2026-09-09。`docs/05` §11.11 ⑤⑥）**: 🔴 **Phase 1 には検査対象の本文が存在しない**（原本は読めず、抽出は Phase 2 の `F-032`。原本を LLM に渡すことは `BR-11` と型で不可能）ため、**`SKILL_SHEET_SHARE` は Phase 1 では PASS しない**。版のメモだけを検査して PASS にする案は採らない（原本を 1 バイトも見ずに「ゲートを通した」ことになる）。`F-020 AC-1` は**共有の側**で成立させた —— `issueDownloadUrl`（発行の単一チョークポイント）に前提条件⑤「**所有会社の境界の外へ渡すならゲートの 3 層 PASS が要る**」を足した（`CLEAN` との **AND**）。結果として **Phase 1 にスキルシートの原本が境界を越える経路は 1 つも無い**。
- 🔴 **`F-020 AC-1`**: テナント外へ共有される対象は、**ゲートを経ずに共有状態へ進めない**。
- **完了の判定**: `F-014 AC-3` / `F-020 AC-1`（Phase 1 の 3 種のうち案件公開・スキルシート共有）の結合テスト。✅ `tests/isolation/project-publish-gate.test.ts`（11 本）/ `tests/isolation/skill-sheet-download.test.ts` の T-07-09 ブロック（7 本）。
- ✅ **完了（2026-09-09、コミット `2ba9be7`）** — 🔴 **SP-06 の T-06-06 から送られた申し送り（`F-014 AC-3` は未検証）を解消した。** 🔴 **中間テーブル `ProjectPublishRequest` を置いて「これから公開する相手」を運ぶ**（`docs/05` §11.9 ⑧-5 の解消）—— `project_visibilities.review_gate_id` が NOT NULL FK であるため、**ゲートを通す前は公開範囲の行を作れない**。公開先をどこにも保持しないままゲートを回すと「何を検査したか」が復元できないので、**要求を別の表に置き、`settleProjectPublish` の 1 か所だけが公開範囲の行を作る**形にした。🔴 **`PROJECT_PUBLISH` の `contentHash` に、公開先と取引先の社名まで含めた** —— 本文が同じでも**公開先が変われば商流層の判定が変わる**（`AC-6` は「その公開範囲で出してはならない相手に出ていないか」を見る）ため、公開先を含めないとキャッシュが誤って再利用される。🔴 **`#28` は確定済みのゲート結果を理由に断らない**（`#39` との差分）—— 公開範囲の変更要求は何度でも出せてよく、断るべきなのは**公開の確定**の側である。**`F-014 AC-3`（エンド企業名・内部単価・他社名を含む公開内容は商流層 FAIL となり公開できない）を `tests/isolation/project-publish-gate.test.ts` が `#28` → `gate.run` → 公開の確定 → **パートナー文脈で見えるか**まで通して検証**（11 本）。🔴 **`SKILL_SHEET_SHARE` は Phase 1 では PASS しないと決着した**（`docs/05` §11.11 ⑤⑥）—— Phase 1 には**検査対象の本文が存在しない**（原本は読めず、抽出は Phase 2 の `F-032`。原本を LLM に渡すことは `BR-11` と型で不可能）。版のメモだけを検査して PASS にする案は採らない（**原本を 1 バイトも見ずに「ゲートを通した」ことになる**）。`F-020 AC-1` は**共有の側**で成立させた —— `issueDownloadUrl`（発行の単一チョークポイント）に前提条件⑤「**所有会社の境界の外へ渡すならゲートの 3 層 PASS が要る**」を足し、`CLEAN` との **AND** にした（`tests/isolation/skill-sheet-download.test.ts` の T-07-09 ブロック 7 本）。結果として **Phase 1 にスキルシートの原本が境界を越える経路は 1 つも無い。** ⚠️ **本タスクの実装中に判明した論点**: 🔴 **公開後に公開欄（案件名 / 公開文 / 要件のフリーテキストの 3 欄）を編集したときに再検査するか** → **[Issue #42](https://github.com/Festal-KM/SES-Platform/issues/42)**（`decision-needed`。既定 = 現状維持、推奨 = 再検査して FAIL なら公開を解除）。**実施タスクは SP-12 の T-12-10**（Phase 1 のリリース前）。

### T-07-10 `gate.hold-release` と HELD の結合 / E2E（M）

- **実装**: ジョブ `gate.hold-release`（毎 10 分。`attempts: 3`）。`docs/05` §9.3 / `F-027 AC-5`。**実装済み（2026-09-09）。確定形は `docs/05` §11.12 を正とする**（上限の再判定を「予約と同じ判定式の**空撃ち**」（`probeAiCostHeadroom`）にしたこと、見積りを `gate-inspector` 1 回ぶんの**下限**にしたこと〔向きの理由〕、復帰を `capacity`（件数）で `held_since` の古い順に配ること、`stepped` バックオフの写像〔T-07-08 の申し送り②の解消〕、E2E は SP-09 と同時に行う判断〔⑦〕、`apps/worker/src/main.ts` の配線を**あえて足さなかった**理由〔⑧〕）。
- 🔴 **AI の日次コスト上限による停止中にレビュー依頼を行っても、ゲートは実行されず未実行のまま保持され、対象は `GATE_RUNNING` に留まる。`GATE_FAILED` にはならない。**
- 🔴 **理由**: `GATE_FAILED` は「元データの欠陥」を意味する状態である（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。混ぜるとゲート FAIL 率（`F-059`）が汚れ、**直すべき元データが無いのに「修正して再実行」を促す誤った導線**になる。
- **整合層の機械的照合は動作し、その結果は保持して上限解除後の再実行に用いる。**
- 🔴 **上限解除後の再実行はゲートジョブが自動で行う**（ゲートは外部送信系ではないため自動再試行が許される。**§10 の自動リトライ禁止の対象は外部送信ジョブに限る**）。利用者が手動で再実行することもでき、**自動・手動のいずれの経路でも同一対象へのゲート実行が多重化しない**。
- 🔴 **多重化防止は 3 段**（`docs/05` §9.3）: HELD 部分 UNIQUE / `jobId` 重複排除 / 完了 CAS。
- 🔴 **新しい状態を作らない**（`ReviewGate.execution` は実行の属性であり状態機械ではない。`P-A-16`）。
- **静的テスト**: `gate.hold-release` が **`gate.run` 以外を enqueue しない**（`docs/05` §17.2 #19。送信系の再 enqueue に転用されていない）。✅ `tests/static/gate-hold-release-enqueue.test.ts`（積む先の型が `GateRunJob` であること / 保留行と公開要求を書き換えないことも同時に固定）。
- **完了の判定**: E2E #23 の前半（上限到達中にレビュー依頼 → HELD → 承認・送信が 409 / 422 → 上限解除 → 自動で DONE）。✅ `tests/isolation/gate-hold-release.test.ts`（**実 DB + 実 Redis + 実 BullMQ ワーカー + 実 Route Handler**）。⚠️ **ブラウザ経路（Playwright）の #23 は SP-09 と同時に行う** —— 承認・送信 API も提案の画面も存在せず、E2E ハーネスに Redis とワーカーが無いため（`docs/05` §11.12 ⑦）。「承認・送信が通らないこと」は、承認 CAS と送信の事前判定が見るのと**同じ 1 実装**（`findPassedReviewGate`）が保留中に `null` を返すことで表明している。
- ✅ **完了（2026-09-09、コミット `c58623f`）** — 🔴 **CI green: run [`34332902675`](https://github.com/Festal-KM/SES-Platform/actions/runs/34332902675) で E2E 35 passed**（SP-07 の最終コミットであり、10 コミットすべてが green であることの確認点でもある）。ジョブ `gate.hold-release`（毎 10 分 / `attempts: 3`）と HELD の結合。🔴 **保留を失敗に倒さない**（`F-027 AC-5`）—— AI の日次コスト上限に達している間にレビュー依頼が来ても、対象は `GATE_RUNNING` のまま `ReviewGate.execution='HELD_AI_COST_LIMIT'` で保持され、**`GATE_FAILED` にはならない**（`GATE_FAILED` は「元データの欠陥」を意味する状態であり、混ぜるとゲート FAIL 率（`F-059`）が汚れ、**直すべき元データが無いのに「修正して再実行」を促す誤った導線**になる。`CLAUDE.md` §4.2）。**整合層の機械的照合は上限中も動作し、その結果を保持して解除後の再実行に使う。** 🔴 **上限の再判定を「予約と同じ判定式の空撃ち」（`probeAiCostHeadroom`）にした** —— 復帰の可否を別の式で判定すると、**予約は通らないのに復帰だけが通る**（＝ 嘘の再投入）状態が生まれ、ジョブが復帰と失敗を往復する。見積りは 🔴 **`gate-inspector` 1 回ぶんの「下限」**とし（多めに見積もると復帰が永久に起きない / 少なく見積もると復帰直後に予約が落ちる。**復帰させすぎるより、復帰した 1 件が確実に走るほうを採る**）、復帰は `capacity`（件数）の範囲で **`held_since` の古い順**に配る。`stepped` バックオフの写像で T-07-08 の申し送り②を解消。🔴 **多重化防止は 3 段**（HELD 部分 UNIQUE / `jobId` 重複排除 / 完了 CAS）で、**自動・手動のどちらの経路でも同一対象へのゲート実行が多重化しない**。**上限解除後の再実行はゲートジョブが自動で行う**（ゲートは外部送信系ではないため自動再試行が許される。§10 の自動リトライ禁止の対象は外部送信ジョブに限る）。**静的テスト** ✅ `tests/static/gate-hold-release-enqueue.test.ts`（積む先の型が `GateRunJob` であること = **送信系の再 enqueue に転用されていない** / 保留行と公開要求を書き換えないこと）。**結合** ✅ `tests/isolation/gate-hold-release.test.ts`（**実 DB + 実 Redis + 実 BullMQ ワーカー + 実 Route Handler**）。⚠️ **ブラウザ経路（Playwright）の E2E #23 は SP-09 と同時に行う** —— 承認・送信 API も提案の画面も存在せず、E2E ハーネスに Redis とワーカーが無いため（`docs/05` §11.12 ⑦）。🔴 **`apps/worker/src/main.ts` の配線はあえて足さなかった**（同 ⑧）—— 今つないでもどの環境でも動かない（`production` / `staging` / `sandbox` は SDK アダプタ未実体化で起動に失敗し、`development` / `demo` はモックの既定応答が無く全ゲートが失敗ジョブになる）。**残件は T-07-11 として持ち越した**（下記 / `docs/dev-plan.md` §3.2 / §4.1 / §8）。

### T-07-11 🔴 ワーカーの起動配線とスケジュール基盤（L）

- **なぜ独立したタスクなのか**: T-07-10 までで `gate.run` / `gate.hold-release` の**ハンドラ**は実装済みだが、**`apps/worker/src/main.ts` には配線が 1 本も無い**。宣言済みのスケジュールジョブ 5 本（`usage.seat-snapshot` / `domain.recheck` / `send.hold-release` / `scan.poll` / `gate.hold-release`）と `gate.run` の Worker が**すべて無主**であり、この状態では Phase 1 の中核 E2E（案件公開 → 提案 → ゲート → 承認 → 送信）に到達できない。**1 本だけ先に配線すると、スケジュールの仕組みが 2 つに割れる**ため、まとめて 1 タスクにする。
- **実装**:
  1. `apps/worker/src/main.ts` に **`gate.run` の Worker** を配線する（`createBullMqWorker({ queueName: 'gate.run', … })`。🔴 **`QUEUE_CONSTRUCTION_ALLOWLIST` に 2 件目を足さない**）。deps（`aiClient` / `models` / `aiDailyCostLimitUsd`）は `bootstrapWorker()` が返した `RuntimeConfig` から組み立て、`process.env` を読み直さない（`docs/05` §13.1）。
  2. **`runScheduled(jobName, handler)`**（`apps/worker/src/scheduler.ts`）と `SchedulerRun` への `INSERT`（`withSystemScope`。`docs/05` §9.1 / §4.4.2）を実装し、**宣言済み 5 本すべて**を同じラッパで登録する。
  3. **テナントのファンアウト**（payload に `tenantId` を必ず載せる。`docs/05` §9.1）。🔴 **母集団の決め方は設計判断である**（下記 `## Open Questions` の申し送り 1）。
  4. 🔴 **起動経路テストとの整合**: `tests/startup/startup-di.test.ts` は現在「`node apps/worker/src/main.ts` が **exit 0 で終了する**」ことを表明している。ワーカーが常駐するとこの表明は成り立たないため、**「設定を検証して終了する」経路**（例: `--verify-config`）を用意するか、テストを「起動ログを確認して停止させる」形に変えるかを決め、**`docs/05` §13.1 に記録する**。どちらでも `bootstrapWorker()` を必ず通ることは変えない。
- 🔴 **着手条件（2 件。いずれも人間の判断。`## Open Questions` の `Q-07-1` / `Q-07-2`）** —— **今つないでも、どの環境でも動かない**（`production` / `staging` / `sandbox` は SDK アダプタ未実装で起動に失敗し、`development` / `demo` はモックの既定応答が無く全ゲートが失敗ジョブになる。`docs/05` §11.12 ⑧）。
- **受け入れ基準**: ①`development` でワーカーが起動し `gate.run` の Worker が待ち受ける ②`gate.hold-release` が 10 分ごとに全テナントぶん実行される ③🔴 **二重起動しても `SchedulerRun.runKey` の `UNIQUE` によりハンドラは 1 回**（`docs/05` §9.1）④起動経路テスト（`tests/startup/**`）が緑 ⑤🔴 `QUEUE_CONSTRUCTION_ALLOWLIST` が 1 件のまま。
- **参照**: `docs/05` §9.1 / §9.2 / §11.10 ⑩-1 / **§11.12 ⑧**（見送りの判断とその理由）。
- 🔴 **持ち越し（2026-09-09 に確定。`docs/dev-plan.md` §3.2 / §4.1 / §8 に記載済み）**: **本タスクは SP-07 の期間内に着手しない。実施は SP-08 と並走、遅くとも SP-09 の先頭タスクとする。** 🔴 **SP-09 より後ろに置いてはならない** —— **`gate.run` の Worker が無主のままでは、ブラウザ経路の E2E #3（1 サイクル完遂）/ #4（ゲート FAIL が送信できない）/ #23（AI 上限と HELD）が成立せず、`CLAUDE.md` §5 の Phase 1 成功条件 1・2 に到達できない**（`docs/sprints/SP-09-proposal-flow.md` T-09-11）。**タスク ID は `T-07-11` のまま変えない**（`CLAUDE.md` §8.8。ID を振り直すと SP-07 の完了記録・`docs/05` §11.12 ⑧・Issue #44 からの参照が切れる）。**着手条件は下記 `Q-07-1` / `Q-07-2` の 2 件であり、いずれも既定値が置いてあるため回答を待って止めない。**

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | マスキング（6 種の除去）。`decideConsistency` の決定性（100 回同結果）。`ROLE_UNIT` の写像。予約 → 補正のコスト計算。Zod の `safeParse` 失敗時の扱い。 |
| **結合（DB + Redis）** | `F-020` の全 AC。`F-026 AC-1` / `AC-2` / `AC-6`。`F-027 AC-5` / `AC-7`。`ReviewGate` のキャッシュ（`contentHash` 一致で再実行しない / `aiFailed` はキャッシュしない）。HELD の 3 段の多重化防止。**§9.10 の再実行 5 手順。** |
| **静的テスト** | `tests/static/ai-single-path.test.ts`（#10）/ `tests/static/gate-consistency-purity.test.ts`（#9）/ `gate.hold-release` の enqueue 先 = `tests/static/gate-hold-release-enqueue.test.ts`（#19）/ `gate.run` の `removeOnComplete: true` = **`tests/static/queue-attempts.test.ts:437`**（#19。`packages/connectors/src/queues.test.ts` が対になる）。<br>🔴 **読み替え（2026-09-09 に固定。`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 / 2026-09-06 SP-04 / 2026-09-07 SP-05 / 2026-09-08 SP-06 の前例と同じ扱い）**: 🔴 **`redact-snapshot.test.ts`（`docs/05` §17.2 #11）というファイルは存在しない。** 実体は ①**denylist の固定** = **`packages/ai/src/mask.test.ts:204`**（表記ゆれ 6 ケース。**削られたら落ちる**）+ **`:223`**（台帳に無い値のパターン検出 8 ケース）②**マスキングの単一経路** = `tests/static/masked-text-single-path.test.ts`（`MaskedText` を作れるのが `mask()` だけであること）である。🔴 **テストを新設して名前を計画に合わせるのではなく、実体への読み替えを本欄と §4 T-07-02 の完了記録に固定する**（`mask.test.ts` は「伏せる 14 ケース」と「**伏せてはならない 1 ケース**（素の年月＝職務期間）」を対で持っており、切り出すと**境界の両側を別ファイルで管理する**ことになる）。 |
| **E2E** | E2E #4 の一部（案件公開のゲート FAIL）。E2E #18（プロンプトインジェクションでゲートの判定が変わらない）。E2E #23 の前半（AI 上限と HELD）。**提案のゲート FAIL → 送信不可の E2E は SP-09**。<br>🔴 **読み替え（2026-09-09 に固定。上の静的テスト欄と同じ扱い）**: 🔴 **本スプリントの時点でブラウザ経路（Playwright）に置ける項目は 1 つも無い** —— 提案の画面・承認 API・送信 API がまだ存在せず（SP-09）、**`gate.run` の Worker が `apps/worker/src/main.ts` に配線されていない**（T-07-11。持ち越し）ため、E2E ハーネスから `gate.run` を走らせる経路自体が無い。したがって **3 件の実体**は次のとおり: ①**#4 の案件公開分** = **`tests/isolation/project-publish-gate.test.ts`**（11 本。`#28` → `gate.run` → 公開の確定 → パートナー文脈での可視性まで通す）②**#18（プロンプトインジェクション）** = 🔴 **`tests/isolation/gate-injection.test.ts`（26 件 / 4 つの describe）。一次資料は `docs/05` §11.13**（新設）—— **実 DB + RLS で `gate.run` の本番と同じ 1 本の経路**（`loadGateInput` → `decideConsistency` → `mask()` + `wrapUntrusted` + `runRole(gate-inspector)` → `decideGate` → `ReviewGate` 保存 + 状態確定）を通し、`MockAnthropicClient` に「**釣られた応答**」を与える。検証は 4 つで、**どれか 1 つでは足りない**: **(1) 本文の指示が合否を変えない**（注入 5 種 × 台帳の氏名。**AI が全層 PASS と答えていても PII 層 FAIL**。🔴 **逆向きを対で置く** —— 注入文だけの本文は 3 層 PASS のままである。**過検知も判定の揺れ**であり、「怪しい語があれば FAIL」にすると `BR-18` の「直せるのは元データだけ」が成立しなくなる。商流層 3 種〔`UNIT_PRICE` / `END_CLIENT` / `OTHER_COMPANY`〕も同じ形で、「承認済みだから検査不要」と本文に書かれても FAIL になる）**(2) LLM が釣られても PASS へ倒れない**（釣られた応答 5 通り = 全層 PASS / **整合層に `BLOCK` を書こうとする** / 自由文 / PASS + BLOCK / タイムアウト。後ろ 4 つは**出力スキーマに適合しない**ため `runRole` が失敗し、PII 層・商流層は FAIL になる。`failureKind='SCHEMA'` まで固定。**整合層に `BLOCK` を書こうとした応答が「警告」として通る経路は無い**）**(3) 整合層は本文に影響されない**（既存の `packages/ai/src/gate-consistency-independence.test.ts` と `tests/isolation/gate-run.test.ts` は**応答を変えて**固定しているが、**注入本文そのものを入力にしたケースが無かった** = `K-3` の穴。ここは**本文を変えて** `consistencyVerdict` と `CONSISTENCY` の指摘が 1 ビットも変わらないことを見る。逆向きも対）**(4) 囲いが結合経路でも成立**（送信された要求を捕まえ、境界タグの組が**欄数と一致**〔提案 2 / 公開 3〕/ 注入 4 形〔閉じ・開き・大文字・空白ゆれ〕が 0 件 / 🔴 **本文そのものは削られていない**〔`docs/05` §7.10 ⑥〕/ `AiUsage.mask_pattern_hits` に `BOUNDARY_TAG: 4` = **本番経路で実際に起きたことが DB 側にも証跡として残る**）。🔴 **`tests/security/prompt-injection.test.ts`（`docs/05` §7.8 対策 5 の旧記載）は作らなかった** —— 読み替えの一次資料は `docs/05` §11.13 である。⚠️ **実行順の前提（同 ④）**: 🔴 **`tests/isolation/**` は `dist` 越しに走るため、`pnpm -r build` を挟まないと防御を壊しても緑のままになる。** 空振り検査（`packages/ai/src/mask.ts` の `BOUNDARY_TAG` 正規表現を無効化すると (4) の 3 件が落ちる）はこの手順で実施済み・復元済み。③**#23 の前半** = **`tests/isolation/gate-hold-release.test.ts`**（**実 DB + 実 Redis + 実 BullMQ ワーカー + 実 Route Handler**）。🔴 **ブラウザ経路の #4 / #18 / #23 は T-07-11（Worker の配線）の後に SP-09 の T-09-11 が実装する** —— **`docs/dev-plan.md` §3.2 / §4.1 / §6.1 K-3 / §8 と `docs/sprints/SP-09-proposal-flow.md` の着手条件に持ち主を書いてある**（無主にしない）。🔴 **E2E を足した後も「判定が変わらない」という主張は上記②が持ち続ける**（E2E が見るのは画面と配線である）。**同じ検証を 2 箇所に書かない**（`docs/05` §17.4 で確立した規律）。 |
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
9. ~~🔴 **ワーカーの起動配線（T-07-11）が済み、宣言済みのジョブが実際に走る。**~~ → 🔴 **本項は SP-07 の完了判定から外した（2026-09-09）。** 予告どおり **T-07-11 だけを持ち越した**（1〜8 は T-07-10 までで満たされている）。🔴 **無主にしないという条件は満たしてある** —— 持ち主は **`docs/dev-plan.md` §3.2（SP-07 のタスク数 11 と持ち越し注記）/ §4.1（依存グラフの破線）/ §8（2026-09-09 の意思決定ログ）/ §9（`Q-07-1` / `Q-07-2` の行）** と **`docs/sprints/SP-09-proposal-flow.md` の着手条件**である。**実施は SP-08 と並走、遅くとも SP-09 の先頭タスク**（🔴 **SP-09 より後ろに置いてはならない**。§4 T-07-11 の持ち越し行）。**この持ち越しを SP-07 の未完として数えない**（計画側に持ち主が書かれていることが条件である）。

## Open Questions

🔴 **オーケストレーターへ**: 下記 2 件は **T-07-11 の着手条件**であり、`CLAUDE.md` §8.6 に従って Issue 化して人間の判断を仰ぐこと（ラベル `decision-needed` / assignee `Festal-KM`）。**回答を待たずに既定値で進む**（既定値は各項に書いた）。

✅ **起票済み（2026-09-09）**: **`Q-07-1` は [Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19) への追記**（Anthropic API キーの取得 = E-3 の督促と、`createAnthropicMessagesApi` の実装可否）/ **`Q-07-2` は [Issue #44](https://github.com/Festal-KM/SES-Platform/issues/44)**（`development` / `demo` でモックのゲートが返す既定応答。既定 = ③ `demo` は PASS / `development` は未設定）。**`docs/dev-plan.md` §9 の対応表に 2 行があり、相互参照している**（どちらか一方にしか無い状態を作らない。`CLAUDE.md` §8.6）。

| # | 決めてほしいこと | なぜ今か | 選択肢 / 既定値 | 参照 |
|---|---|---|---|---|
| **Q-07-1**<br>（[Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19) に追記済み） | **`@anthropic-ai/sdk` のアダプタを実装してよいか、と Anthropic API キーの取得**（E-3） | これが無いと `production` / `staging` / `sandbox` では **AI クライアントの生成が起動時に失敗する**ため、T-07-11 の配線を入れた瞬間にワーカーが起動しなくなる | ⚠️ **依存（`@anthropic-ai/sdk`）は追加済みである。** 残っているのは ①`packages/ai/src/client.ts` の **`createAnthropicMessagesApi` 1 関数の実装**（現在は `AiClientNotAvailableError` を投げる）②`maxRetries: 0` をテストで固定すること（SDK 内部の再試行が `AiUsage` の行数とずれるため）③**E-3 の API キー取得**（ユーザー作業）。**既定**: T-07-11 は `development`（`mock`）だけで受け入れ基準を満たし、実接続の確認は E-3 の完了後に行う | `docs/05` §7.9 ⑥ / §11.10 ⑩-6 / `docs/dev-plan.md` §5 E-3 |
| **Q-07-2**<br>（[Issue #44](https://github.com/Festal-KM/SES-Platform/issues/44)） | **`development` / `demo` で `MockAnthropicClient` が返す既定応答をどうするか** | 応答が未設定だと `MockAnthropicNotConfiguredError` になり、**その環境のゲートは全件が失敗ジョブになる**。逆に「常に PASS」を既定にすると、**ゲートが実質的に無効な環境を 1 つ作る**ことになる（`demo` は営業が実演する環境である） | ①**常に PASS**（デモは通るが、ゲートの価値を実演できない）②**未設定のまま失敗させる**（現状。デモでゲートに到達すると必ず落ちる）③**`demo` は PASS / `development` は未設定**（環境で分ける。`docs/05` §13.2 に追記が要る）。**既定**: ③ を推奨。**この判断は §13.2 のモック設計に属し、実装者が黙って決めてよいものではない** | `docs/05` §13.2 / §11.12 ⑧ |

**申し送り（T-07-11 の実装で決めること。Issue にはしない）**

1. 🔴 **ファンアウトの母集団から `SUSPENDED` / `CLOSING` / `PURGED` のテナントを外すか。** `systemTenantCtx` は `lifecycleState: 'ACTIVE'` 固定で、ジョブ本体は実行系ガード（`requireExecutable`）の対象外である（`packages/db/src/context.ts`）。したがって**判断を置ける場所はファンアウト側しか無い**。現状のまま全テナントへ配ると、**停止中のテナントの保留ゲートが自動復帰して AI 原価を消費する**（`CLAUDE.md` §4.2「`SUSPENDED` は実行系ができない」の趣旨と食い違う）。
2. 🔴 **`gate.run` が `TARGET_NOT_FOUND` を返した保留行の掃除。** 対象が消えても保留行は残るため、`gate.hold-release` の走査対象に残り続け、毎回 1 枠を消費する（LLM は呼ばれないので原価は増えない）。**提案・案件の削除 API を実装するタスク**が、保留行の削除を併せて決めること（現時点では削除 API が無いので到達しない）。

---

## 7. SP-07 の状態（2026-09-09）

**T-07-01〜T-07-10 の 10 タスクが完了**（§4 の各タスクの ✅ 行）。**T-07-11 は予告どおり持ち越した**（§4 T-07-11 の持ち越し行 / §6-9。**持ち主は `docs/dev-plan.md` §3.2 / §4.1 / §8 / §9 と `docs/sprints/SP-09-proposal-flow.md` の着手条件**）。

コミットは T-07-01 `024b67c` / T-07-02 `be524fe` / T-07-03 `d915465` / T-07-04 `ba30053` / T-07-05 `4314694` / **T-07-07 `7f0d7af`** / **T-07-06 `19d6b47`**（以上 2026-09-08）/ T-07-08 `9a23602` / T-07-09 `2ba9be7` / T-07-10 `c58623f`（以上 2026-09-09）。🔴 **T-07-07 を T-07-06 より先に実装した** —— パイプライン（T-07-06）が整合層（T-07-07）を**呼ぶ側**であり、逆順に作ると「整合層が無い間だけ PASS を返す」暫定分岐が生まれるためである。**計画の番号順との差は意図的であり、依存の向き（`docs/dev-plan.md` §4.3 の「DB → AI 層 → API → UI → E2E」）に従った結果である。**

**主な成果は 6 つ** — ①🔴 **AI 呼び出しの単一経路**（SDK の import は `client.ts` 1 ファイル / `runRole` が 4 ポートを必須引数に取り**記録を通らない経路を書けない** / SDK アダプタ未実体化は **fail-closed**）②🔴 **PII マスキングを型で強制**（`MaskedText` のブランド型 + **`image` / `document` ブロックが型として存在しない** + 生成箇所の単一経路 + 「伏せる 14 / **伏せてはならない 1**」の対のテスト）+ 🔴 **`K-3` を結合経路で証明**（**`tests/isolation/gate-injection.test.ts` の 26 件** —— 実 DB + RLS で `gate.run` の本番と同じ経路を通し、**AI が「全層 PASS」と釣られても合否が変わらない**ことを、**逆向き〔過検知しない〕と対で**固定する。一次資料は `docs/05` §11.13 / `docs/dev-plan.md` §6.1 K-3）③🔴 **`AiUsage` の記録強制と、件数と金額の独立**（整数演算の原価 / `ROLE_UNIT` の写像 / **再試行は金額のみ** / `gate-inspector` は記録するがクォータに入れない / **件数を金額から割り戻さない**）④🔴 **コスト上限ガード**（**1 文 SQL の予約 → 実コスト補正** / 窓は**暦日**で TTL は次の暦日境界 / **上限到達時に `gate-inspector` をスキップして PASS にする分岐が無い**）⑤🔴 **品質ゲート 3 層**（`@ses/prompts` のパッケージ化と `PromptKit` / **整合層は渡せる型が無い構造**で合否を機械的照合のみに固定 / **AI 失敗は PASS へフォールバックせず FAIL** / §9.10 の再実行 5 手順 + `jobId` の区切りを `.` に是正 + `removeOnComplete: true`）⑥🔴 **`F-014 AC-3` の解消と HELD**（中間テーブル `ProjectPublishRequest` で公開先まで含めて検査 / `SKILL_SHEET_SHARE` は Phase 1 では PASS しないと決着し **原本が境界を越える経路が 1 つも無い** / **保留を失敗に倒さず**、復帰は**予約と同じ判定式の空撃ち**で嘘の再投入を止める）。

🔴 **テスト green の証跡（2026-09-09）**: **unit 193 files / 3556**、**isolation 50 files / 1320**、**E2E 35**（**desktop 23 + mobile 12**。🔴 **SP-06 から増えていない** —— 本スプリントの検証はすべて結合層と静的層に置いた。理由は §5 の E2E 欄の読み替えのとおりで、**提案の画面・承認 API・送信 API が無く、`gate.run` の Worker も未配線（T-07-11）であるため、ブラウザ経路から本スプリントの機能に到達できない**）、**startup 14**。**10 コミットすべてで CI green**（最終 `c58623f` は run `34332902675` で **E2E 35 passed** を確認。2026-09-09。単一ジョブ直列。[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の**運用 C の確認記録**として残す —— 機械的強制は未達であり「CI があるから守られている」と読み替えない。`docs/dev-plan.md` §6.4 R-05）。**全タスクで `code-reviewer` APPROVED。**

**本スプリントで生じた論点は 4 件で、いずれも既定値のまま進行・ブロッカーではない**（`docs/dev-plan.md` §9 に対応表の行がある。**どちらか一方にしか無い状態を作らない**。`CLAUDE.md` §8.6）:

| Issue | 論点 | 既定値 | 実施先 | 決着期限 |
|---|---|---|---|---|
| 🔴 [#41](https://github.com/Festal-KM/SES-Platform/issues/41) | **パートナー所属エンジニアの提案がゲートで fail-closed** になる（ジョブのホスト文脈から C3 を読めない） | `app_scan_probe` と同型（専用ロール + `SECURITY DEFINER` + 列レベル `GRANT`） | **SP-09（T-09-01 / T-09-11 の前）** | 🔴 **SP-09 の中核 E2E の前**（`docs/sprints/SP-09-proposal-flow.md` の着手条件） |
| [#42](https://github.com/Festal-KM/SES-Platform/issues/42) | **公開後に公開欄（案件名 / 公開文 / 要件フリーテキストの 3 欄）を編集したときの再検査** | 現状維持（推奨は「再検査し、FAIL なら公開を解除」） | **SP-12 の T-12-10** | Phase 1 のリリース前 |
| [#43](https://github.com/Festal-KM/SES-Platform/issues/43) | **Tailwind CSS / shadcn/ui が未導入**（`CLAUDE.md` §2 の確定事項との差分） | SP-07 の後に UI 基盤スプリントを差し込む | 未定（`docs/dev-plan.md` §9） | SP-08 の画面タスク着手前 |
| [#44](https://github.com/Festal-KM/SES-Platform/issues/44) | **`development` / `demo` でモックのゲートが返す既定応答**（= `Q-07-2`） | ③ `demo` は PASS / `development` は未設定 | **T-07-11** | T-07-11 の着手前 |

**後続へ引き継ぐ残件は 4 件**: ①🔴 **T-07-11（ワーカーの起動配線）** —— **SP-08 と並走、遅くとも SP-09 の先頭**（🔴 **SP-09 より後ろに置かない**）②🔴 **ブラウザ経路の E2E #4 / #18 / #23** —— T-07-11 の後に **SP-09 の T-09-11**（`docs/dev-plan.md` §6.1 K-3 / §3.2）。⚠️ **これは「証明が無い」という意味ではない** —— **`K-3` の「判定が変わらない」という主張は結合層の `tests/isolation/gate-injection.test.ts`（26 件）が既に持っており、E2E を足した後もそこが持ち続ける**（E2E が見るのは画面と配線である。`docs/05` §11.13 ①）③🔴 **Issue #41 の決着** —— SP-09 の中核 E2E の前 ④⚠️ **`docs/05` §7.6 の `decideQuota` / `packages/ai/src/quota.ts` の署名更新**（実体は `reserveAiCost` / `decideAiDailyCost` / メトリック別の 3 分割。**`program-design` の仕事**。§4 T-07-04 の完了記録の申し送り）。
