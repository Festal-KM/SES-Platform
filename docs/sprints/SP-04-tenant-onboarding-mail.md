# SP-04 tenant-onboarding-mail — 送信ドメイン検証・メール単一経路・取引先招待

> **Phase**: 1（MVP） / **前提**: SP-03 / **後続**: SP-06 / SP-09（クリティカルパス CP-2 の合流点）
> **一次資料**: `docs/02` `F-001 AC-4` `AC-5` / `F-002` / `F-007` / `F-059 AC-7` / 章 7.6 NFR-ENV-1 / 章 7.7 / `docs/03` §3.2（Amazon SES）/ §3.2.4 / §3.2.7 / §3.2.8 / `docs/04` `S-014` `S-036` / `A-005` 項目 11・13 / `docs/05` §3.9 / §8.1〜§8.3（🔴 **§8.3-Q を含む**）/ §9.1 / §9.4 / §10.4 / §13.2 / §13.4
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-04`
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-014` / `S-036`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**全 88 枚が生成済みである**（2026-09-03。[Issue #17](https://github.com/Festal-KM/SES-Platform/issues/17) = A の決着後に残り 82 枚を生成し、`docs/04` 改訂 5 の `S-046` 分 3 枚を追加した）。**本スプリントの着手条件は満たされている。** 画面の新設・改訂で不足が生じた場合のみ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

🔴 **`CLAUDE.md` §5 の例外であるクリティカルパス CP-2 を通す。** 取引先へ届く送信は**テナント独自ドメインの検証が完了していなければ実行しない**（`BR-71` / [Issue #13](https://github.com/Festal-KM/SES-Platform/issues/13)）ため、送信ドメインの登録・DNS 提示・検証をテナント開設の工程として成立させる。あわせて `packages/connectors` の骨格・**メール送信の単一経路と宛先分類**・取引先企業の招待とパートナーアカウント管理を通す。

🔴 **本スプリントで作るモック実装は `development` / `demo` / E2E でそのまま使う**（`docs/05` §13.2 / §17.5）。テスト専用の別モックを書かない。

## 2. 対応機能 ID

`F-001`（`AC-4` / `AC-5`）/ `F-002`（招待の送達）/ `F-007`（`AC-1`〜`AC-5`）

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-04-01 | `packages/connectors` の共通 IF・キュー定義・モック骨格 | 🔴 `attempts: 2` を送信系キューに渡すと**コンパイルエラー** | `docs/05` §8.1 / §9.1 | M |
| T-04-02 | メール送信の単一経路と `recipientClass` | 🔴 分類が**必須引数**。`Membership` から機械的に導く。既定はモック側 | `A-22` / `docs/03` `program-design` 申し送り 5 | L |
| T-04-03 | SES コネクタ + モック + Webhook 受信（バウンス / 苦情） | `EmailDispatch.dedupeKey` で再試行しても 1 通 | `F-002` / `docs/05` §8.5 | L |
| T-04-04 | `TenantSendingDomain` と `domain.*` ジョブ + 🔴 **送信基盤（環境全体）のクォータ保留** | Easy DKIM の CNAME 3 本 + MAIL FROM の MX / TXT を提示。日次で再確認。🔴 **送信基盤の上限到達時は `HELD_PROVIDER_QUOTA` で保留し `FAILED` にしない。復帰は `send.hold-release`** | `F-001 AC-4` / `F-059 AC-7` / `docs/05` §8.3-Q / §9.4 | L |
| T-04-05 | `requireVerifiedSendingDomain` と `HELD_DOMAIN_UNVERIFIED` | 🔴 **共通ドメインへフォールバックしない**。障害と区別する | `BR-51` / `BR-71` | M |
| T-04-06 | `S-036` 送信ドメインの設定と検証（画面） | 状態は 4 値であって**エラーではない**。DNS 反映待ちを画面で示す | `docs/03` `ui-design` 申し送り 2 / `docs/04` `program-design` 申し送り 8 | M |
| T-04-07 | 取引先企業の登録・招待・停止（`F-007`） | パートナーには自社 1 社以外が一覧にも件数にも現れない | `F-007 AC-1`〜`AC-3` `AC-5` | L |
| T-04-08 | 🔴 `sandbox` の招待リンク画面表示 | `sandbox` で取引先招待メールが外部へ **0 通**。リンクは 1 回限り | `F-007 AC-4` | M |
| T-04-09 | パートナーアカウント管理（`PARTNER_ADMIN`） | 自社配下のみ招待・変更でき、他社と自社（ホスト）は一覧にも出ない | `F-002 AC-4` | M |
| T-04-10 | 環境分離の検証（NFR-ENV-1 の 3 分類） | `development` / `demo` で外部発信 0 件。`sandbox` は分類ごとに分岐 | `BR-45` / `docs/05` §17.4 | M |

## 4. タスク詳細

### T-04-01 `packages/connectors` の共通 IF・キュー定義・モック骨格（M）

- **実装**: `docs/05` §8.1 の共通インタフェース、`packages/connectors/src/queues.ts`、`packages/connectors/src/mock/**`。
- 🔴 **キュー定義は 1 箇所に閉じ、`attempts > 1` を送信系キューに設定できない型にする**（`docs/03` `program-design` 申し送り 7）:
  ```ts
  type ExternalSendQueueOptions = { attempts: 1; backoff?: undefined };   // リテラル 1 固定
  ```
  **キューの抽象化レイヤを作らない**（抽象化すると「自動リトライを禁止できていること」がコードから見えなくなる）。
- 🔴 **外部 API 応答を生のまま保存せず、正規化した内部型に変換してから永続化する**（`CLAUDE.md` §3.4）。
- **静的テスト**: `queue-attempts.test.ts`（`docs/05` §17.2 #6。ソースを AST で走査）。
- **完了の判定**: `attempts: 2` を渡すコードがコンパイルエラーになる型テスト + 静的テスト green。
- ✅ **完了（2026-09-06、コミット `6482da9`）** — `docs/05` §8.1 の共通インタフェースと `packages/connectors/src/queues.ts` / `mock/**` を敷いた。🔴 **送信系キューのオプションを `attempts: 1` のリテラル固定型にし、`attempts: 2` を渡すとコンパイルエラーになる**（キューの抽象化レイヤは作っていない）。外部応答は正規化した内部型に変換してから永続化する。`queue-attempts.test.ts`（ソースの AST 走査）が green。

### T-04-02 メール送信の単一経路と `recipientClass`（L）

- **実装**: `docs/05` §8.2 / `docs/03` `program-design` 申し送り 5 / `docs/02` `program-design` 申し送り 10 / `docs/02` 章 7.6 NFR-ENV-1。
- 🔴 **メール送信の単一経路が `recipientClass` を必須引数に取る。** 呼び出し側に自己申告させない。`resolveRecipientClass(recipientUserId | { invitationId })` が **`Membership` から機械的に導く**。
  - 判定順: **`PlatformUser` → パートナー所属 → テナント所属 → それ以外**。🔴 **パートナー所属の判定をテナント所属より先に置く**（取り違えがそのまま実在の取引先への送信になる）。
  - 分類: ①ホスト所属利用者（招待中の本人を含む）②パートナー所属利用者 ③提案先・エンド企業 ④エンジニア本人 / 分類外＝運営者。
- 🔴 **`sandbox` の実送信は分類 1 と分類外のみ。** 分類 2 / 3 / 4 はモック（[Issue #9](https://github.com/Festal-KM/SES-Platform/issues/9) / [#10](https://github.com/Festal-KM/SES-Platform/issues/10)）。**`development` / `demo` は区別を適用せず全モック。**
- 🔴 **分類が未指定の送信を成立させない**（型で禁止する）。**既定値を置く場合はモック側（分類 3）に倒す** — 分類を省略できると、新しい通知が既定で実送信側に落ちる。
- 🔴 **`email.dispatch` の payload 型を `HostOrPlatformDispatch` に限定し、分類 2 / 3 / 4 を渡せないようにする**（`docs/05` §9.4）。
- **完了の判定**: `resolveRecipientClass` のユニットテスト（4 分類 + 分類外の網羅、判定順の固定）+ 型テスト（分類なしの呼び出しがコンパイルエラー）。
- ✅ **完了（2026-09-06、コミット `cae9182`）** — メール送信の単一経路が `recipientClass` を**必須引数**に取り、`resolveRecipientClass` が `Membership` から機械的に導く（判定順は `PlatformUser` → パートナー所属 → テナント所属 → それ以外で固定）。🔴 **分類なしの呼び出しは型として成立せず、既定値はモック側（分類 3）に倒している。** `email.dispatch` の payload 型を `HostOrPlatformDispatch` に限定し、分類 2 / 3 / 4 を渡せない（`docs/05` §9.4）。`sandbox` の実送信は分類 1 と分類外のみで、`development` / `demo` は区別を適用せず全モック。

### T-04-03 SES コネクタ + モック + Webhook 受信（L）

- **実装**: `packages/connectors/src/email/ses/**` と `mock/**`。`EmailDispatch` / `EmailEvent`。`POST /api/webhooks/ses`（SNS の署名検証。`SubscriptionConfirmation` も処理）。ジョブ `email.dispatch` / `account.mail`。
- 🔴 **`email.dispatch` だけ `attempts: 3` を許す**（宛先が分類 1 / 分類外に限られ `BR-21` の射程外）。それでも **`EmailDispatch.dedupeKey` の `UNIQUE` で冪等化**する（再試行しても 1 通）。
- 🔴 **`account.mail` の平文トークンは payload（Redis）にのみ載せ、DB・ログには載せない**（denylist に `token`）。
- 🔴 **Webhook 受信は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定**（`docs/05` §8.5）。成功・失敗にかかわらず 200 を返す（4xx は再送されないプロバイダがある）。例外は署名検証失敗の 401 のみ。`WebhookDelivery.dedupeKey` の `UNIQUE` + `processedAt` の CAS。
- **バウンス・苦情を `F-059` の監視に載せる**準備として `EmailEvent` に正規化して保存する（監視画面は SP-11）。
- 🔴 **レート上限をアプリ層でガードする**（`CLAUDE.md` §3.4）: **1 テナント 1 日 500 通 / 1 分 30 通**（既定値。`packages/config`。プランごとに上書き可）。**外部 API の 429 に頼らない。** 分次超過は待機、日次超過は停止として区別する（`F-027 AC-2`。表示は SP-10）。
- **完了の判定**: `email.dispatch` の重複起動で 1 通のみ。Webhook の重複配信・順序逆転のフィクスチャテスト。レート上限の結合テスト（501 通目が外部へ発行されない）。
- **ブロッカーではないが確認中**: 🔴 **`EmailDispatch` の真の同時実行** — `UNIQUE(dedupeKey)` は行の重複を防ぐが、**同一行に対して 2 つのワーカーが同時に送信直前へ到達する経路**までは塞いでいない。[Issue #32](https://github.com/Festal-KM/SES-Platform/issues/32) で確認中で、**既定 A（受容）で実装済み**である。B（`EmailDispatch` に排他のための列を足し、DB で 1 実行に絞る）を採る場合は **`docs/05` §3.9 の改訂 → migration が先**（`CLAUDE.md` §8.7）。決着期限は **SP-07 着手前**（`docs/dev-plan.md` §9）。
- ✅ **完了（2026-09-06、コミット `ab7f4e7`）** — `packages/connectors/src/email/ses/**` と `mock/**`、`EmailDispatch` / `EmailEvent`、`POST /api/webhooks/ses`（SNS の署名検証。`SubscriptionConfirmation` も処理）、ジョブ `email.dispatch` / `account.mail`。🔴 **`EmailDispatch.dedupeKey` の `UNIQUE` で再試行しても 1 通**。Webhook は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定し（署名検証失敗の 401 のみ例外）、重複配信・順序逆転をフィクスチャテストで吸収する。バウンス・苦情は `EmailEvent` に正規化して保存（監視画面は SP-11）。レート上限（1 テナント 1 日 500 通 / 1 分 30 通。`packages/config` の設定値）をアプリ層でガードし、分次超過（待機）と日次超過（停止）を区別する。`account.mail` の平文トークンは payload にのみ載せ DB・ログには出さない。`tests/isolation/email-dispatch.test.ts` が green。

### T-04-04 `TenantSendingDomain` と `domain.*` ジョブ + 送信基盤（環境全体）のクォータ保留（L）

- **実装**: `GET/POST /api/settings/sending-domains`（#71）/ `POST .../verify`（#72）。ジョブ `domain.provision` / `domain.verify` / `domain.recheck`（`docs/05` §8.3 / §9.9）。
- **提示するレコード**（`docs/03` §3.2.7 / `docs/03` `ui-design` 申し送り 2）: **Easy DKIM の CNAME 3 本 + Custom MAIL FROM の MX / TXT**。「レコードをコピーする」「検証状態を再確認する」の 2 操作を持つ。
- **状態**: `REGISTERED` / `PENDING` / `VERIFIED` / `FAILED`。🔴 **これは状態であってエラーではない**（`docs/04` `program-design` 申し送り 8）。
- `domain.recheck`（毎日 05:30 JST）が `VERIFIED` の全ドメインを再確認し、外れていれば失効させて `A-005` とテナント管理者に通知する。
- 🔴 **`sandbox` では共通ドメインで動く**（`docs/03` §3.2.7-4）。#72 は `{ state: 'NOT_REQUIRED' }` を返す。
- 🔴 **`sandbox` は「アプリ層の分類 + SES サンドボックス + 環境変数検証」の三重防御**（`docs/03` `program-design` 申し送り 6）。本番と別の AWS アカウントを使い、**SES をサンドボックス状態のままにする**（検証済み宛先にしか送れない）。identity の追加は運営者の手動操作に限定する。
- 🔴 **送信基盤（環境全体）のクォータ到達による保留**（`docs/05` §8.3-Q / §9.4 / `docs/02` 章 7.7「送信基盤（環境全体）の上限到達時の保留と復帰」/ `F-059 AC-7`。**`docs/05` TBD-12 は 2026-09-01 に決着済み**）:
  - 🔴 **`sandbox` 固有の機構ではない。** メール送信基盤（SES アカウント）には**環境全体**で 24 時間ローリングの送信数上限があり（`sandbox` はサンドボックス状態のまま 200 通 / 24h）、**`production` の SES 枠にも同じ機構が効く**。🔴 **テナント単位の日次上限（`F-027` の 1 テナント 500 通 / 日 = `RATE_LIMIT`）とは別の枠であり、DB でも表示でも区別する**（対処する相手が異なる）。
  - **判定関数**: 🔴 **`packages/domain/src/quota/provider.ts` の純粋関数 `decideProviderQuota({ envLimit, provider, localSent24h, now })`**（`docs/05` §8.3-Q ②）。`limit = min(envLimit, provider?.max24h ?? envLimit)` / `consumed = max(localSent24h, provider?.sentLast24h ?? 0)` / `consumed + 1 > limit` なら `HOLD`、そうでなければ `ALLOW` と `headroom`。🔴 **`Date.now` / `process.env` を参照しない**（`docs/05` §17.2 #19-③）。
  - **上限値**: `packages/config` の **`MAIL_PROVIDER_DAILY_QUOTA`**（既定は `development` / `demo` / `sandbox` = 200、`staging` / `production` は**既定なし = 未設定なら起動失敗**）+ `MAIL_PROVIDER_QUOTA_WARN_RATIO`（既定 0.8）。**ハードコードしない。**
  - **入力の取得**: `provider` は **`EmailSender.getQuota()`**（`docs/05` §8.1。SES の `GetAccount`。Redis に 60 秒キャッシュ。**取得失敗は `null` として手元のカウンタで判定を続ける**）、`localSent24h` は Redis ZSET `mail:provider:sent24h`（**単一経路の内側で実送信成功のたびに加算する**ので呼び出し側が忘れられない。モック sink に流した分は加算しない）。
  - 🔴 **判定位置**: `email.dispatch` / `account.mail` の**送信直前・`QUEUED → SENT` の更新より前**（ドメイン判定 → クォータ判定の順）。抵触したら **`UPDATE email_dispatches SET status='HELD_PROVIDER_QUOTA', held_at=now() WHERE id=$1 AND status='QUEUED'` → 外部を呼ばずジョブは正常終了**（throw しない = `attempts: 3` に乗らない。**`FAILED` にしない。`failureReason` を書かない**）。#14 / #5 の応答 `deliveryState` に `'HELD_PROVIDER_QUOTA'` を加える（**利用者に「失敗」と見せない**。`docs/02` 章 7.7-③）。
  - 🔴 **事後の安全網（適用先は `email.dispatch` / `account.mail` に限る）**: 判定をすり抜けて SES が日次枠超過を同期拒否した場合（`Daily message quota exceeded`。**秒間レート超過は別物で §8.7 の再試行に属する**）は `ses.ts` が `ProviderQuotaExceededError` に正規化し、同じ `HELD_PROVIDER_QUOTA` に置く。🔴 **`send.*` には適用しない**（外部呼び出しを 1 回行った以上 `SUBMIT_FAILED` / `SEND_FAILED` に落とす。`BR-22`）。
  - **復帰**: 🔴 **`send.hold-release`（毎 10 分。`docs/05` §9.4）が担う。時刻で判定しない**（SES の枠はローリング 24 時間で固定時刻にリセットされない）。実行のたびに `decideProviderQuota` を再評価し、**`ALLOW` の `headroom` 件だけ `heldAt` / `sendHoldSince` の古い順に復帰させる**（`Proposal` / `Contract` の `PROVIDER_QUOTA` 保留と `EmailDispatch(HELD_PROVIDER_QUOTA)` が**同じ枠を分け合う**）。招待は**平文トークンが残っていない**ため `HELD_DOMAIN_UNVERIFIED` と同じ**トークン再発行手順を共用**する。🔴 **パスワード再設定は再発行せず `failure_reason='EXPIRED'` で閉じる**（T-04-05 で確定。`docs/05` §8.3-Q ④の 3 つの理由。再要求は #5 の明示操作）。それ以外の運用メールは `status='QUEUED', held_at=NULL` への CAS → `email.dispatch` の再 enqueue。🔴 **再 enqueue されたジョブは §8.3-Q の判定を最初から通る**（保留を経たものだけが判定を免れる経路を作らない）。
  - **監視**: 到達・接近と保留件数は **`A-005` 項目 13（`F-059 AC-7`）**、`send.*` の保留は **項目 14（送信保留の理由別内訳）** に出る（**実装は SP-11 の T-11-04**）。🔴 **保留は障害ではないため、失敗ジョブ数・未対応 `SUBMIT_FAILED` / `SEND_FAILED`・ゲート FAIL 率のいずれにも加算しない。**
  - 🔴 **なぜここまで書くか**: `sandbox` の実送信は分類 1（見込み客本人）と分類外に限られる。**枯渇すると `F-054 AC-9`（期限予告が本人に実際に届く）と `F-064 AC-10`（通知されないまま削除が実行される経路が存在しない）が無言で破れる。** SP-10 の T-10-08 / T-10-09 / T-10-12 はメール到達性を前提に完了判定を書いているため、**この保留と復帰が無いとその前提が成立しない。**
- **完了の判定**: `F-001 AC-4` の結合テスト。`domain.provision` の冪等性（既存なら取得）。`domain.recheck` で失効すると `A-005` の対象に載る。🔴 **加えて、`MAIL_PROVIDER_DAILY_QUOTA` を小さく設定した状態で分類 1 のメールを上限 + 1 通起動し、超過分が外部へ発行されず `HELD_PROVIDER_QUOTA`（`heldAt` あり / `failureReason` なし / `FAILED` でない）として記録され、`send.hold-release` が枠の回復後に `headroom` 件だけ復帰させ、モックの `callCount()` が想定どおりになることの結合テスト**（`docs/05` §17.3 #23 の前半。**テスト専用フックを作らず、環境変数の値だけで到達を再現する**）。`decideProviderQuota` の境界値ユニットテスト。
- ✅ **完了（2026-09-06、コミット `8050c69`）** — `TenantSendingDomain` と `#71` / `#72`、`domain.provision` / `domain.verify` / `domain.recheck`（毎日 05:30 JST）。Easy DKIM の CNAME 3 本 + Custom MAIL FROM の MX / TXT を提示し、4 状態（`REGISTERED` / `PENDING` / `VERIFIED` / `FAILED`）を**状態として**返す。`sandbox` では `#72` が `{ state: 'NOT_REQUIRED' }` を返す。🔴 **送信基盤（環境全体）のクォータ到達は `packages/domain/src/quota/provider.ts` の純粋関数 `decideProviderQuota`（`Date.now` / `process.env` を参照しない）で判定し、送信直前・`QUEUED → SENT` の前に `HELD_PROVIDER_QUOTA`（`heldAt` あり / `failureReason` なし）へ CAS して外部を呼ばずジョブを正常終了する** — `FAILED` にも成功にも倒れない。復帰は `send.hold-release`（毎 10 分）が `decideProviderQuota` を再評価し `headroom` 件だけ `heldAt` の古い順に行う（再 enqueue されたジョブは判定を最初から通る）。上限は `MAIL_PROVIDER_DAILY_QUOTA` / `MAIL_PROVIDER_QUOTA_WARN_RATIO`（`packages/config`。ハードコードなし）。`tests/isolation/sending-domain.test.ts` と `tests/isolation/provider-quota-hold.test.ts` が green（**テスト専用フックを作らず環境変数の値だけで到達を再現している**）。🔴 **`A-005` 項目 13 / 14 / 15 の監視画面は SP-11 の T-11-04 に、`send.*` 側の `PROVIDER_QUOTA` 保留は SP-09 の T-09-06 に引き継ぐ**（§6-8 の申し送り②③）。

### T-04-05 `requireVerifiedSendingDomain` と `HELD_DOMAIN_UNVERIFIED`（M）

- **実装**: `docs/05` §6.2 / §8.3 / §10.4 / `docs/03` `program-design` 申し送り 26 / `docs/02` `program-design` 申し送り 14。
- 🔴 **送信ジョブは、外部 API を呼ぶ前にテナントの独自ドメイン検証状態を確認する。**
- 🔴 **未検証のときに共通ドメインへフォールバックしない**（`BR-51`。「成功したように見えて違反している」壊れ方）。
- 🔴 **未検証は `SUBMIT_FAILED` / `SEND_FAILED`（障害）ではなく「設定未了」として区別し、状態を進めない**（`F-022 AC-7` / `F-047 AC-7`）。`Proposal` は `APPROVED` のまま、`Contract` は `DRAFT` のまま。招待は作成されるが `deliveryState='HELD_DOMAIN_UNVERIFIED'`。
- 🔴 **保留は状態ではなく列で表す**（`sendHoldReasonKey` / `sendHoldSince`。`P-A-02`。**`CLAUDE.md` §4.2 の状態機械に状態を追加しない**）。
- `send.hold-release`（毎 10 分）が再判定し、解消していれば同じ `attemptSeq` で再 enqueue する。招待は **HELD 行の CAS → 期限判定 → `Invitation.tokenHash` の再発行 → 新トークンで `account.mail`**（平文トークンは保留中どこにも残っていないため、再発行以外に送る手段が無い）。
- **実行者への表示**: 「送信元ドメインが未検証である」ことと設定すべき DNS レコード。
- **完了の判定**: `F-022 AC-7` / `F-007 AC-5` の結合テスト。E2E #9 の前半（保留が `SUBMIT_FAILED` にならず、検証後に自動復帰する）。
- ✅ **完了（2026-09-06、コミット `1aad052`）** — `requireVerifiedSendingDomain` をガードの呼び順（T-03-04）に組み込み、送信ジョブが外部 API を呼ぶ前に検証状態を確認する。🔴 **未検証時に共通ドメインへフォールバックせず、「設定未了」として状態を進めない**（`Proposal` は `APPROVED` のまま / `Contract` は `DRAFT` のまま / 招待は `deliveryState='HELD_DOMAIN_UNVERIFIED'`）— `SUBMIT_FAILED` / `SEND_FAILED`（障害）と区別される。🔴 **保留は状態ではなく列（`sendHoldReasonKey` / `sendHoldSince`）で表し、`CLAUDE.md` §4.2 の状態機械に状態を追加していない。** `send.hold-release` が再判定し、招待は **HELD 行の CAS → 期限判定 → `Invitation.tokenHash` の再発行**で復帰、**パスワード再設定は再発行せず `failure_reason='EXPIRED'` で閉じる**（`docs/05` §8.3-Q ④）。実行者には未検証である旨と設定すべき DNS レコードを示す。`tests/isolation/sending-domain-hold.test.ts` が green。

### T-04-06 `S-036` 送信ドメインの設定と検証（画面）（M）

- **実装**: `docs/04` `S-036`（Tier 3）。🔴 **設定画面ではなく「開設フローの工程」として設計する**（`docs/02` `ui-design` 申し送り 13）。
- ①テナント開設直後のオンボーディングに DNS 設定の工程を置く ②未完了を「壊れている」ではなく **「取引先へ送信できない状態」として理由と手順とともに示す**（機能を隠さない）③`F-022` / `F-041` / `F-047` / `F-007` の送信導線に到達したときに、何が足りないかがその場で分かる。
- **DNS の反映待ちを画面で示す**（待っている状態を明示する）。
- 送信画面には「送信元ドメイン: `@example.co.jp`（検証済み）」を**事実として常時示す**（`docs/03` `ui-design` 申し送り 2）。
- 文言は `packages/i18n` に集約する（`BR-32`）。
- **完了の判定**: `S-036` の 4 状態の表示テスト + モバイルで破綻しない（Tier 3 だが**遮断しない**。`CLAUDE.md` §13.3）。
- 🔴 **検証の割り当て（読み替えの固定。`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 の前例と同じ扱い）**: §5 のテスト計画が「E2E」に置いた **`S-036` の 4 状態**の実体は **`apps/web/app/(main)/settings/sending-domains/sending-domain-screen.render.test.tsx`**（画面描画）+ **`tests/isolation/sending-domain.test.ts`**（状態遷移と API）である。**`S-036` のモバイル非破綻の検証は `tests/e2e` の `*.mobile.spec.ts` に割り当てる。** テストを新設して名前を計画に合わせるのではなく、実体への読み替えを本記録に固定する（`docs/05` §17.4 の「実装」列と同じ方針）。
- ✅ **完了（2026-09-06、コミット `c693f77`）** — `S-036` を「設定画面」ではなく**開設フローの工程**として実装した（`docs/02` `ui-design` 申し送り 13）。未完了を「壊れている」ではなく **「取引先へ送信できない状態」として理由と手順とともに示し**、DNS の反映待ちを画面で明示する（機能を隠さない）。送信導線には送信元ドメインと検証済みである事実を常時表示する。文言は `packages/i18n` に集約（`BR-32`）。4 状態の表示は上記 `sending-domain-screen.render.test.tsx` が green。✅ **モバイル非破綻の E2E は `tests/e2e/settings.mobile.spec.ts` として追加済み（2026-09-06。`S-036` と `S-014` の 2 ケース。Pixel 5 エミュレーションで描画・横スクロール無し・外向き発信 0 件を固定。全 17 件 PASS）。**

### T-04-07 取引先企業の登録・招待・停止（L）

- **実装**: `GET/POST /api/partner-companies`（#11 / #12）/ `POST .../suspend` `/resume`（#13）/ `POST /api/invitations`（#14 のパートナーロール分）。画面は `S-014`（Tier 3）。
- 🔴 **`#11` の母集団は RLS（C5。`<O>` = `id`）が 1 行に絞る。アプリ側に絞り込みを書かない**（`F-004 AC-1`。API 直叩きでも 0 件）。
- **停止**（`F-007 AC-2`）: 配下アカウントは提案作成・送信・チャット投稿ができなくなる。**既存データは削除しない。**
- 🔴 **`production` では、送信ドメイン未検証のテナントは取引先招待メールを送信できない**（`F-007 AC-5`）。**招待そのものは作成できるが、送達は検証完了後**。
- 登録・招待・停止・再開を `AuditLog` に記録（`F-007 AC-3`）。
- **完了の判定**: `F-007 AC-1`〜`AC-3` / `AC-5` の結合テスト。
- **ブロッカーではないが確認中**: 🔴 **パートナー由来の FK 列を複合 FK（`(tenant_id, partner_company_id)`）にするか** — 単一列 FK のままだと「別テナントの `partner_company_id` を参照する行」を DB が拒否できず、境界の担保がアプリ層の照合に依存する。[Issue #33](https://github.com/Festal-KM/SES-Platform/issues/33) で確認中で、**既定 C（SP-06 着手前に `program-design` が `docs/05` §3.3 へ追記し migration で入れる）**。🔴 **それまで本タスクのアプリ層照合は暫定の防御である**（経路が増えるたびに書き漏れうる）。決着期限は **SP-06 着手前**（`docs/dev-plan.md` §9）。✅ **2026-09-07 に既定 C を実装済み**（`docs/05` §3.3.1 / migration `20260911000000_partner_composite_fk` / `docs/05` §4.7 #14 のカタログ走査）。🔴 **本タスクのアプリ層照合は外していない** —— 役割が「防御の本体」から「一次防御（正しい 404 を返す責務）」へ降格しただけである（`docs/05` §3.3.1「アプリ層照合との関係」）。
- 🔴 **検証の割り当て（読み替えの固定）**: §5 のテスト計画が「E2E」に置いた **`S-014` の招待フロー（`production` / `sandbox` の分岐）**の実体は **`tests/isolation/partner-companies.test.ts`** + **`tests/isolation/sandbox-invite-link.test.ts`**（T-04-08）+ **`apps/web/app/(main)/settings/partner-companies/partner-companies-screen.render.test.tsx`** である。
- ✅ **完了（2026-09-06、コミット `00dda61`）** — `#11` / `#12` / `#13`（`suspend` / `resume`）と `#14` のパートナーロール分、画面は `S-014`。🔴 **`#11` の母集団は RLS（C5。`<O>` = `id`）が 1 行に絞り、アプリ側に絞り込みを書いていない** — パートナーには自社 1 社以外が一覧にも件数にも現れず、API 直叩きでも 0 件（`F-004 AC-1`）。停止は配下アカウントの提案作成・送信・チャット投稿を止めるが**既存データを削除しない**（`F-007 AC-2`）。登録・招待・停止・再開を `AuditLog` に記録（`AC-3`）。🔴 **`production` では送信ドメイン未検証のテナントが取引先招待メールを送達できない**（招待そのものは作成でき、送達は検証完了後。`AC-5`。保留の実装は T-04-05）。

### T-04-08 🔴 `sandbox` の招待リンク画面表示（M）

- **実装**: `#14` の応答を **`SandboxInvitationView` / `ProductionInvitationView` の判別可能な合併**にする（`docs/05` §6.4）。🔴 **`inviteUrl` は `APP_ENV='sandbox'` かつ宛先分類 2 のときだけ返す。`production` ではフィールドごと返さない**（型が違う）。
- 画面（`S-014`）に招待リンクとコピー導線を出す。**`production` では出さない。**
- 🔴 **リンクの有効期限・1 回限りの受諾・受諾後の失効は `production` の招待と同一の規律**（`F-007 AC-4`）。
- **理由**: `sandbox` では取引先招待メールがモックになる（分類 2）ため、これが無いと見込み客がパートナー側の画面を確認できず、`F-054 AC-1` の**パートナースコープ検証も成立しない**。
- **完了の判定**: `F-007 AC-4` の結合テスト（`sandbox` で外部発信 0 通 + リンクから `PARTNER_ADMIN` が受諾・ログインできる + 2 回目の受諾が失敗する）。
- ✅ **完了（2026-09-06、コミット `03d03e9`）** — `#14` の応答を `SandboxInvitationView` / `ProductionInvitationView` の**判別可能な合併**にした（`docs/05` §6.4）。🔴 **`inviteUrl` は `APP_ENV='sandbox'` かつ宛先分類 2 のときだけ返し、`production` ではフィールドごと型に存在しない。** `S-014` に招待リンクとコピー導線を出し、`production` では出さない。有効期限・1 回限りの受諾・受諾後の失効は `production` の招待と同一の規律（`F-007 AC-4`）。`tests/isolation/sandbox-invite-link.test.ts` が green（`sandbox` で外部発信 0 通 + リンクから `PARTNER_ADMIN` が受諾・ログインでき、2 回目の受諾が失敗する）。🔴 **これが `docs/05` §17.4 の `sandbox` ③ の実装であり、T-04-10 は重複して書いていない。**

### T-04-09 パートナーアカウント管理（M）

- **実装**: `PARTNER_ADMIN` が自社配下の `PARTNER_SALES` / パートナー所属 `VIEWER` を招待・変更・無効化できる（`F-002 AC-4`）。
- 🔴 **他社および自社（ホスト）のアカウントは一覧にも件数にも現れない**（C5 / C8。`docs/05` §4.4）。
- 🔴 **`F-002`（自社メンバーの招待）と `F-007`（取引先の招待）を同じ扱いにしない**（`F-001 AC-5`）。前者は共通ドメインでよく、送信ドメインの検証状態に依存しない。
- ロール変更・無効化を `AuditLog` に記録（`F-002 AC-3`）。
- **完了の判定**: `F-002 AC-3` / `AC-4` の結合テスト。
- **ブロッカーではないが確認中**: ⚠️ 🔴 **「パートナー所属の `VIEWER`」は現在のスキーマでは作れない** — `memberships` の CHECK（`(role IN ('PARTNER_ADMIN','PARTNER_SALES')) = (partner_company_id IS NOT NULL)`。`docs/05` §3.3）が禁じているのに、上の実装行と `docs/04` `S-044` / `S-045`・`docs/05` §6.6 #80 はそれを前提に書かれている（`docs/05` §6.7 の ⚠️ 申し送り）。[Issue #34](https://github.com/Festal-KM/SES-Platform/issues/34) で確認中で、**既定 A = 記述の訂正**（CHECK を緩めない）。🔴 **本タスクは既存の CHECK に従い、`PARTNER_ADMIN` が付与できるロールを `PARTNER_ADMIN` / `PARTNER_SALES` の 2 つに限って実装済みである。** 訂正は **`docs/04` `S-044` / `S-045` → `docs/05` §6.6 #80 → 本タスクの文言**の順で行う（`CLAUDE.md` §8.7。**上流を先に直し、スプリントファイルだけを直さない**）。決着期限は **Phase 2（経路 5）着手前**（`docs/dev-plan.md` §9）。
- ✅ **完了（2026-09-06、コミット `2e85ee0`）** — `#83`（`GET /api/members`）/ `#84`（`PUT .../role`）/ `#85`（`POST .../revoke`）を `docs/05` **§6.7** の規律どおりに実装した。🔴 **母集団は `users`（C8 DIRECTORY）ではなく `memberships`（C5）で確定させ、他社および自社（ホスト）のアカウントが一覧にも件数にも現れない**（`F-002 AC-4`）。所属（`partnerCompanyId`）を変更する経路を作らず、付与できるロールは対象の所属側に閉じる。自己管理（422 `MEMBER_SELF_MANAGEMENT`）と最後の `OWNER` の降格・無効化（422 `MEMBER_LAST_OWNER`）を塞ぎ、🔴 **この不変条件を `Serializable` トランザクション + 条件付き UPDATE（CAS）で並行実行時にも守る**（直列化失敗は 409 `CONCURRENT_UPDATE`。サーバ側で自動再試行しない）。無効化は `Membership.revokedAt` と `User.disabledAt` を同一トランザクションで立て、行は 1 件も消さない。監査は業務トランザクションの内側で `membership.role_change` / `membership.revoke` として記録する（変更が起きなかった要求は記録しない）。**`F-002`（自社メンバー）と `F-007`（取引先）を同じ扱いにしていない** — 前者は共通ドメインでよく、送信ドメインの検証状態に依存しない（`F-001 AC-5`）。`tests/isolation/members.test.ts` と `apps/web/app/(main)/settings/partner-companies/members-panel.render.test.tsx` が green。

### T-04-10 環境分離の検証（M）

- **実装**: `docs/05` §17.4 の表をテストに落とす（`tests/isolation/env-separation.test.ts`）。
  - `development` / `demo`: 🔴 **全分類の送信を実行し、外部エンドポイントへの発信が 0 件**。**テストプロセスの外向き通信を遮断**し、外部到達を試みた時点で落ちる。加えてモックの `callCount()` を検証（二重）。🔴 **遮断は E2E の `tests/e2e/harness/network-guard.mjs` と同一実装**（`tests/support/outbound-network-guard.mjs` に 1 箇所化。`docs/05` §17.6 ⑥）。
  - `sandbox` ②: 分類 1 / 分類外（`F-002` / `F-003` / `F-055`）が**実際に送信され**、送信された全通の宛先が**ホスト所属利用者または `PlatformUser` のアドレスのみ**。🔴 **観測点は `SesApi` ポート**（`sandbox` の分類 1 / 分類外は `SesEmailSender` = SES の HTTP API を通るため、MailHog はこの経路上に無い。当初の「MailHog で受信を検証」は SMTP 送信の実装が存在せず成立しないので、`CLAUDE.md` §8.7 に従い `docs/03` §4.17 / `docs/05` §17.4 と併せて実装に合わせて改訂した）。許可集合は DB（`users` / `invitations` / `platform_users`）から導き、テストに書き写さない。🔴 `F-055` のジョブ経路は未実装なので、**黙ってモックに倒れず `PlatformDispatchNotSupportedError` で失敗する**ことを固定する。
  - `sandbox` ③: 分類 2（取引先招待）で外部発信 0 件 + 招待リンク経由での受諾 → 🔴 **T-04-08 の `tests/isolation/sandbox-invite-link.test.ts` が既に担保している。重複して書かない。**
  - `production` の起動検証: モック実装が選ばれたら起動失敗 / 非本番に本番キーがあれば起動失敗 → 🔴 **T-03-12 の `tests/startup/startup-di.test.ts` が web / worker の起動エントリを子プロセスで実際に起動して担保している。重複して書かない。**
- 🔴 **`F-022` / `F-041` / `F-047` / `F-049`（分類 3 / 4）の検証は、それぞれの機能が入るスプリント（SP-09 / SP-15 / SP-17 / SP-18）で追加する。** Phase 1 の本タスクで扱うのは分類 1 / 2 / 分類外。`staging`（各サービスの sandbox エンドポイント以外へ 0 件）は環境の構築時（SP-12）に追加する。
- **完了の判定**: 上記 4 環境の検証が green。
- 🔴 **検証の割り当て（読み替えの固定）**: §5 のテスト計画が「E2E」に置いた **環境分離の 3 分類**の実体は **`tests/isolation/env-separation.test.ts`**（+ `sandbox` ③ = `tests/isolation/sandbox-invite-link.test.ts` / `production` の起動検証 = `tests/startup/startup-di.test.ts`）である。**`docs/05` §17.4 の「実装」列がこの割り当ての出所**であり、同じ検証を E2E に二重で書かない。
- ✅ **完了（2026-09-06、コミット `d331b6d`）** — `docs/05` §17.4 の表を `tests/isolation/env-separation.test.ts` に落とした。`development` / `demo` は全分類の送信を実行して**外部エンドポイントへの発信が 0 件**（テストプロセスの外向き通信を遮断 + モックの `callCount()` の二重検証。🔴 **遮断は E2E の `tests/e2e/harness/network-guard.mjs` と同一実装を `tests/support/outbound-network-guard.mjs` に 1 箇所化**）。`sandbox` ② は🔴 **観測点を `SesApi` ポート**に置き（`SesEmailSender` が SES の HTTP API を通るため MailHog はこの経路上に無い）、送信された全通の宛先が**ホスト所属利用者または `PlatformUser` のみ**であることを DB（`users` / `invitations` / `platform_users`）から導いた許可集合で照合する（テストに書き写さない）。`F-055` のジョブ経路は**黙ってモックに倒れず `PlatformDispatchNotSupportedError` で失敗する**ことを固定した。🔴 **`sandbox` ③ と `production` の起動検証は上記の割り当てのとおり既存テストが担保しており、重複して書いていない。** 分類 3 / 4（`F-022` / `F-041` / `F-047` / `F-049`）は SP-09 / SP-15 / SP-17 / SP-18 に、`staging` は SP-12 に残置。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | `resolveRecipientClass`（4 分類 + 分類外 / 判定順）。SES 応答の正規化。DNS レコードの生成。🔴 **`decideProviderQuota` の境界値**（`provider` が `null` / `min` による丸め / `headroom` の算出。`docs/05` §8.3-Q ②）。 |
| **結合（DB + Redis）** | `EmailDispatch.dedupeKey` の冪等性。`WebhookDelivery` の重複・順序逆転。レート上限（1 日 500 / 1 分 30）。`domain.provision` / `verify` / `recheck`。`requireVerifiedSendingDomain` の保留。招待受諾の CAS。🔴 **`HELD_PROVIDER_QUOTA` の保留と `send.hold-release` による復帰**（`MAIL_PROVIDER_DAILY_QUOTA` を小さくして到達を再現。`FAILED` にならない / 招待はトークン再発行で旧リンクが無効になる / `headroom` を超える分は次回に持ち越す）。 |
| **静的テスト** | `queue-attempts.test.ts`（送信系の `attempts: 1`）。🔴 **`docs/05` §17.2 #19 の hold-release 追補**（①`email.dispatch` / `account.mail` のハンドラが `HELD_PROVIDER_QUOTA` への更新で終わり再 throw・`FAILED` 更新・`failureReason` 書込に到達しない ②`send.hold-release` の走査対象が `{'HELD_DOMAIN_UNVERIFIED','HELD_PROVIDER_QUOTA'}` と一致する ③`packages/domain/src/quota/provider.ts` が `Date.now` / `process.env` を参照しない）。 |
| **E2E** | `S-014` の招待フロー（`production` / `sandbox` の分岐）。`S-036` の 4 状態。環境分離の 3 分類（T-04-10）。<br>🔴 **読み替え（2026-09-06 に固定。実体は §4 の完了記録にある）**: この 3 項目の検証は E2E ではなく **`tests/isolation/*` + `*.render.test.tsx`** で実装されている — `S-014` = `partner-companies.test.ts` + `sandbox-invite-link.test.ts` + `partner-companies-screen.render.test.tsx`（T-04-07 / T-04-08）/ `S-036` の 4 状態 = `sending-domain-screen.render.test.tsx` + `sending-domain.test.ts`（T-04-06）/ 環境分離 3 分類 = `env-separation.test.ts`（T-04-10）。**割り当ての出所は `docs/05` §17.4 の「実装」列**であり、同じ検証を E2E に二重で書かない（`docs/dev-plan.md` §8 の 2026-09-05 T-03-08 の前例と同じ扱い）。🔴 **例外は `S-036` / `S-014` のモバイル非破綻**（`CLAUDE.md` §13.3）で、これのみ **`tests/e2e/settings.mobile.spec.ts`** に割り当て済み（2026-09-06 追加。17/17 PASS）。 |
| **外部 API のモック方針** | 🔴 **`packages/connectors/src/mock/**` を `development` / `demo` / E2E で使う**（`docs/05` §17.5）。Webhook はフィクスチャ（`tests/fixtures/ses/*.json`）を `POST` して受信パイプラインを検証。🔴 **フィクスチャに実データ由来のものを置かない**（`BR-47`）。氏名・メール・トークン・アカウント ID は架空値に置換してからコミットする。 |

## 6. 完了判定

1. `F-001 AC-4` / `AC-5` / `F-007 AC-1`〜`AC-5` / `F-002 AC-3` / `AC-4` が結合テストで green。
2. 🔴 **メール送信の単一経路が `recipientClass` を必須引数に取り、`Membership` から機械的に導く。** 分類なしの呼び出しがコンパイルエラー。
3. 🔴 **送信ドメイン未検証のテナントで、取引先へ届く送信が実行されず、共通ドメインへフォールバックしない。** 未検証が障害（`SUBMIT_FAILED`）と区別される。
4. 🔴 **`sandbox` で取引先招待メールが外部へ 0 通**、代わりに招待リンクが画面に表示され、そこから `PARTNER_ADMIN` が受諾・ログインできる。
5. 送信系キューの `attempts` が 1 であることを静的テストが固定している。
6. `development` / `demo` で外部エンドポイントへの発信が 0 件（ネットワーク遮断 + `callCount()` の二重検証）。
7. 🔴 **送信基盤（環境全体）の上限に到達したとき、送信が実行されず `EmailDispatch.status='HELD_PROVIDER_QUOTA'`（`heldAt` あり）として保留され、`send.hold-release` が枠の回復後に `headroom` 件だけ古い順で復帰させる**（`docs/05` §8.3-Q / §9.4 / `docs/02` 章 7.7 / `F-059 AC-7`）。🔴 **`FAILED` にも `SUBMIT_FAILED` にも成功にも倒れない。** 上限値は `MAIL_PROVIDER_DAILY_QUOTA`（`packages/config`）であり、**`sandbox` 固有ではなく環境全体の機構である**（`production` の SES 枠にも効く）。判定は `packages/domain` の純粋関数 `decideProviderQuota`。
8. **次スプリントへの申し送り**: ①SES 本番アクセス申請（E-1）の承認状況を `docs/dev-plan.md` §8 に追記する。未承認なら SP-12 の本番相当検証を再計画する。②🔴 **`A-005` の監視項目 13 / 14 / 15 の実装は SP-11 の T-11-04 に引き継ぐ**（本スプリントで作るのは判定・保留・復帰まで）。③🔴 **`send.*`（`Proposal` / `Contract`）側の `sendHoldReasonKey='PROVIDER_QUOTA'` 保留は SP-09 の T-09-06 に引き継ぐ** — 本タスクの `decideProviderQuota` を再利用し、**2 実装にしない**。④`F-064 AC-10` の予告の配送確認は SP-10 の T-10-12 に引き継ぐ。⑤🔴 **`EmailDispatch` の `QUEUED` 滞留（送信済み未記録の疑い）の監視は SP-11 の T-11-04 項目 16 に引き継ぐ**（`docs/05` §16.5 に追記済み）。T-04-03 の実装では、**外部への到達を否定できない呼び出しの後に永続化が失敗した場合、ジョブは throw せず正常終了する**（throw すると `attempts: 3` で再実行され、行が `QUEUED` のままなのでもう 1 通送る = `BR-21` の直接違反）。該当は ①送信成功後の `QUEUED → SENT` / `MOCKED` の記録失敗（戻り値 `SENT_UNRECORDED`）②`UNKNOWN`（応答不明。タイムアウト・**送信経路の 5xx**）の確定 `QUEUED → FAILED` の書込失敗（戻り値 `FAILED{ recorded: false }`）の 2 つで、**どちらも失敗ジョブ数には現れない**。行の状態（`QUEUED` のまま `sent_at` が無い）だけが唯一のシグナルである。
   - ✅ **①を確認済み（2026-09-06）。E-1 は未承認のままである** — AWS Support ケース `178832016000877` が再審査中で、訂正返信の送信がユーザー操作待ち（[Issue #19](https://github.com/Festal-KM/SES-Platform/issues/19)）。🔴 **`docs/dev-plan.md` §8（2026-09-06 の行）/ §5.1 / §6.4 R-02 に現況として記録した。** 🔴 **条件付き判断: 未承認のまま続く場合、SP-12 の本番相当検証のうち実 SES 送信を要する項目を再計画する。** **他のタスクはブロックされない** — 送信ドメイン検証とモック経路は本スプリントで先行済みであり、開発と E2E は `packages/connectors/src/mock/**` で止まらない（`docs/05` §13.2）。

---

**SP-04 の状態（2026-09-06）**: T-04-01〜T-04-10 の**全 10 タスクが完了**（§4 の各タスクの ✅ 行）。主な成果は 7 つ — ①`packages/connectors` の共通 IF とキュー定義（🔴 送信系は `attempts: 1` のリテラル固定型）②メール送信の**単一経路と宛先分類**（`recipientClass` が必須引数。`Membership` から機械的に導く）③SES コネクタ + モック + Webhook 受信（`dedupeKey` の `UNIQUE` で再試行しても 1 通）④送信ドメイン検証（`TenantSendingDomain` / `domain.*` ジョブ / `S-036`）と🔴 **送信基盤クォータの保留・復帰**（`HELD_PROVIDER_QUOTA` / `decideProviderQuota` / `send.hold-release`）⑤取引先企業の登録・招待・停止と `PARTNER_ADMIN` の配下管理（`#83`〜`#85`。`docs/05` §6.7）⑥🔴 `sandbox` の招待リンク画面表示（取引先招待メールが外部へ 0 通）⑦環境分離の検証（`docs/05` §17.4 の 3 分類）。本スプリントで生じた確認中の論点は 3 件で、いずれも**既定値で実装済み・ブロッカーではない** — [Issue #32](https://github.com/Festal-KM/SES-Platform/issues/32)（`EmailDispatch` の真の同時実行。既定 A = 受容。T-04-03）/ [Issue #33](https://github.com/Festal-KM/SES-Platform/issues/33)（パートナー FK 列の複合 FK 化。既定 C。T-04-07 のアプリ層照合は暫定防御）/ [Issue #34](https://github.com/Festal-KM/SES-Platform/issues/34)（パートナー所属 `VIEWER` の矛盾。既定 A = 記述訂正。T-04-09 は 2 ロール限定で実装済み）。**`docs/dev-plan.md` §9 に対応表の行がある。** 後続へ引き継ぐ残件は ①**E-1（SES 本番アクセス）が未承認**（上記 8-①。未承認が続けば SP-12 の実 SES 送信を要する項目を再計画）②は解消済み（`tests/e2e/settings.mobile.spec.ts`、2026-09-06）③**§6-8 の申し送り②〜⑤**（SP-11 T-11-04 / SP-09 T-09-06 / SP-10 T-10-12）。
