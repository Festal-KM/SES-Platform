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

### T-04-02 メール送信の単一経路と `recipientClass`（L）

- **実装**: `docs/05` §8.2 / `docs/03` `program-design` 申し送り 5 / `docs/02` `program-design` 申し送り 10 / `docs/02` 章 7.6 NFR-ENV-1。
- 🔴 **メール送信の単一経路が `recipientClass` を必須引数に取る。** 呼び出し側に自己申告させない。`resolveRecipientClass(recipientUserId | { invitationId })` が **`Membership` から機械的に導く**。
  - 判定順: **`PlatformUser` → パートナー所属 → テナント所属 → それ以外**。🔴 **パートナー所属の判定をテナント所属より先に置く**（取り違えがそのまま実在の取引先への送信になる）。
  - 分類: ①ホスト所属利用者（招待中の本人を含む）②パートナー所属利用者 ③提案先・エンド企業 ④エンジニア本人 / 分類外＝運営者。
- 🔴 **`sandbox` の実送信は分類 1 と分類外のみ。** 分類 2 / 3 / 4 はモック（[Issue #9](https://github.com/Festal-KM/SES-Platform/issues/9) / [#10](https://github.com/Festal-KM/SES-Platform/issues/10)）。**`development` / `demo` は区別を適用せず全モック。**
- 🔴 **分類が未指定の送信を成立させない**（型で禁止する）。**既定値を置く場合はモック側（分類 3）に倒す** — 分類を省略できると、新しい通知が既定で実送信側に落ちる。
- 🔴 **`email.dispatch` の payload 型を `HostOrPlatformDispatch` に限定し、分類 2 / 3 / 4 を渡せないようにする**（`docs/05` §9.4）。
- **完了の判定**: `resolveRecipientClass` のユニットテスト（4 分類 + 分類外の網羅、判定順の固定）+ 型テスト（分類なしの呼び出しがコンパイルエラー）。

### T-04-03 SES コネクタ + モック + Webhook 受信（L）

- **実装**: `packages/connectors/src/email/ses/**` と `mock/**`。`EmailDispatch` / `EmailEvent`。`POST /api/webhooks/ses`（SNS の署名検証。`SubscriptionConfirmation` も処理）。ジョブ `email.dispatch` / `account.mail`。
- 🔴 **`email.dispatch` だけ `attempts: 3` を許す**（宛先が分類 1 / 分類外に限られ `BR-21` の射程外）。それでも **`EmailDispatch.dedupeKey` の `UNIQUE` で冪等化**する（再試行しても 1 通）。
- 🔴 **`account.mail` の平文トークンは payload（Redis）にのみ載せ、DB・ログには載せない**（denylist に `token`）。
- 🔴 **Webhook 受信は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定**（`docs/05` §8.5）。成功・失敗にかかわらず 200 を返す（4xx は再送されないプロバイダがある）。例外は署名検証失敗の 401 のみ。`WebhookDelivery.dedupeKey` の `UNIQUE` + `processedAt` の CAS。
- **バウンス・苦情を `F-059` の監視に載せる**準備として `EmailEvent` に正規化して保存する（監視画面は SP-11）。
- 🔴 **レート上限をアプリ層でガードする**（`CLAUDE.md` §3.4）: **1 テナント 1 日 500 通 / 1 分 30 通**（既定値。`packages/config`。プランごとに上書き可）。**外部 API の 429 に頼らない。** 分次超過は待機、日次超過は停止として区別する（`F-027 AC-2`。表示は SP-10）。
- **完了の判定**: `email.dispatch` の重複起動で 1 通のみ。Webhook の重複配信・順序逆転のフィクスチャテスト。レート上限の結合テスト（501 通目が外部へ発行されない）。

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
  - **復帰**: 🔴 **`send.hold-release`（毎 10 分。`docs/05` §9.4）が担う。時刻で判定しない**（SES の枠はローリング 24 時間で固定時刻にリセットされない）。実行のたびに `decideProviderQuota` を再評価し、**`ALLOW` の `headroom` 件だけ `heldAt` / `sendHoldSince` の古い順に復帰させる**（`Proposal` / `Contract` の `PROVIDER_QUOTA` 保留と `EmailDispatch(HELD_PROVIDER_QUOTA)` が**同じ枠を分け合う**）。招待・パスワード再設定は**平文トークンが残っていない**ため `HELD_DOMAIN_UNVERIFIED` と同じ**トークン再発行手順を共用**する。それ以外の運用メールは `status='QUEUED', held_at=NULL` への CAS → `email.dispatch` の再 enqueue。🔴 **再 enqueue されたジョブは §8.3-Q の判定を最初から通る**（保留を経たものだけが判定を免れる経路を作らない）。
  - **監視**: 到達・接近と保留件数は **`A-005` 項目 13（`F-059 AC-7`）**、`send.*` の保留は **項目 14（送信保留の理由別内訳）** に出る（**実装は SP-11 の T-11-04**）。🔴 **保留は障害ではないため、失敗ジョブ数・未対応 `SUBMIT_FAILED` / `SEND_FAILED`・ゲート FAIL 率のいずれにも加算しない。**
  - 🔴 **なぜここまで書くか**: `sandbox` の実送信は分類 1（見込み客本人）と分類外に限られる。**枯渇すると `F-054 AC-9`（期限予告が本人に実際に届く）と `F-064 AC-10`（通知されないまま削除が実行される経路が存在しない）が無言で破れる。** SP-10 の T-10-08 / T-10-09 / T-10-12 はメール到達性を前提に完了判定を書いているため、**この保留と復帰が無いとその前提が成立しない。**
- **完了の判定**: `F-001 AC-4` の結合テスト。`domain.provision` の冪等性（既存なら取得）。`domain.recheck` で失効すると `A-005` の対象に載る。🔴 **加えて、`MAIL_PROVIDER_DAILY_QUOTA` を小さく設定した状態で分類 1 のメールを上限 + 1 通起動し、超過分が外部へ発行されず `HELD_PROVIDER_QUOTA`（`heldAt` あり / `failureReason` なし / `FAILED` でない）として記録され、`send.hold-release` が枠の回復後に `headroom` 件だけ復帰させ、モックの `callCount()` が想定どおりになることの結合テスト**（`docs/05` §17.3 #23 の前半。**テスト専用フックを作らず、環境変数の値だけで到達を再現する**）。`decideProviderQuota` の境界値ユニットテスト。

### T-04-05 `requireVerifiedSendingDomain` と `HELD_DOMAIN_UNVERIFIED`（M）

- **実装**: `docs/05` §6.2 / §8.3 / §10.4 / `docs/03` `program-design` 申し送り 26 / `docs/02` `program-design` 申し送り 14。
- 🔴 **送信ジョブは、外部 API を呼ぶ前にテナントの独自ドメイン検証状態を確認する。**
- 🔴 **未検証のときに共通ドメインへフォールバックしない**（`BR-51`。「成功したように見えて違反している」壊れ方）。
- 🔴 **未検証は `SUBMIT_FAILED` / `SEND_FAILED`（障害）ではなく「設定未了」として区別し、状態を進めない**（`F-022 AC-7` / `F-047 AC-7`）。`Proposal` は `APPROVED` のまま、`Contract` は `DRAFT` のまま。招待は作成されるが `deliveryState='HELD_DOMAIN_UNVERIFIED'`。
- 🔴 **保留は状態ではなく列で表す**（`sendHoldReasonKey` / `sendHoldSince`。`P-A-02`。**`CLAUDE.md` §4.2 の状態機械に状態を追加しない**）。
- `send.hold-release`（毎 10 分）が再判定し、解消していれば同じ `attemptSeq` で再 enqueue する。招待は **HELD 行の CAS → 期限判定 → `Invitation.tokenHash` の再発行 → 新トークンで `account.mail`**（平文トークンは保留中どこにも残っていないため、再発行以外に送る手段が無い）。
- **実行者への表示**: 「送信元ドメインが未検証である」ことと設定すべき DNS レコード。
- **完了の判定**: `F-022 AC-7` / `F-007 AC-5` の結合テスト。E2E #9 の前半（保留が `SUBMIT_FAILED` にならず、検証後に自動復帰する）。

### T-04-06 `S-036` 送信ドメインの設定と検証（画面）（M）

- **実装**: `docs/04` `S-036`（Tier 3）。🔴 **設定画面ではなく「開設フローの工程」として設計する**（`docs/02` `ui-design` 申し送り 13）。
- ①テナント開設直後のオンボーディングに DNS 設定の工程を置く ②未完了を「壊れている」ではなく **「取引先へ送信できない状態」として理由と手順とともに示す**（機能を隠さない）③`F-022` / `F-041` / `F-047` / `F-007` の送信導線に到達したときに、何が足りないかがその場で分かる。
- **DNS の反映待ちを画面で示す**（待っている状態を明示する）。
- 送信画面には「送信元ドメイン: `@example.co.jp`（検証済み）」を**事実として常時示す**（`docs/03` `ui-design` 申し送り 2）。
- 文言は `packages/i18n` に集約する（`BR-32`）。
- **完了の判定**: `S-036` の 4 状態の表示テスト + モバイルで破綻しない（Tier 3 だが**遮断しない**。`CLAUDE.md` §13.3）。

### T-04-07 取引先企業の登録・招待・停止（L）

- **実装**: `GET/POST /api/partner-companies`（#11 / #12）/ `POST .../suspend` `/resume`（#13）/ `POST /api/invitations`（#14 のパートナーロール分）。画面は `S-014`（Tier 3）。
- 🔴 **`#11` の母集団は RLS（C5。`<O>` = `id`）が 1 行に絞る。アプリ側に絞り込みを書かない**（`F-004 AC-1`。API 直叩きでも 0 件）。
- **停止**（`F-007 AC-2`）: 配下アカウントは提案作成・送信・チャット投稿ができなくなる。**既存データは削除しない。**
- 🔴 **`production` では、送信ドメイン未検証のテナントは取引先招待メールを送信できない**（`F-007 AC-5`）。**招待そのものは作成できるが、送達は検証完了後**。
- 登録・招待・停止・再開を `AuditLog` に記録（`F-007 AC-3`）。
- **完了の判定**: `F-007 AC-1`〜`AC-3` / `AC-5` の結合テスト。

### T-04-08 🔴 `sandbox` の招待リンク画面表示（M）

- **実装**: `#14` の応答を **`SandboxInvitationView` / `ProductionInvitationView` の判別可能な合併**にする（`docs/05` §6.4）。🔴 **`inviteUrl` は `APP_ENV='sandbox'` かつ宛先分類 2 のときだけ返す。`production` ではフィールドごと返さない**（型が違う）。
- 画面（`S-014`）に招待リンクとコピー導線を出す。**`production` では出さない。**
- 🔴 **リンクの有効期限・1 回限りの受諾・受諾後の失効は `production` の招待と同一の規律**（`F-007 AC-4`）。
- **理由**: `sandbox` では取引先招待メールがモックになる（分類 2）ため、これが無いと見込み客がパートナー側の画面を確認できず、`F-054 AC-1` の**パートナースコープ検証も成立しない**。
- **完了の判定**: `F-007 AC-4` の結合テスト（`sandbox` で外部発信 0 通 + リンクから `PARTNER_ADMIN` が受諾・ログインできる + 2 回目の受諾が失敗する）。

### T-04-09 パートナーアカウント管理（M）

- **実装**: `PARTNER_ADMIN` が自社配下の `PARTNER_SALES` / パートナー所属 `VIEWER` を招待・変更・無効化できる（`F-002 AC-4`）。
- 🔴 **他社および自社（ホスト）のアカウントは一覧にも件数にも現れない**（C5 / C8。`docs/05` §4.4）。
- 🔴 **`F-002`（自社メンバーの招待）と `F-007`（取引先の招待）を同じ扱いにしない**（`F-001 AC-5`）。前者は共通ドメインでよく、送信ドメインの検証状態に依存しない。
- ロール変更・無効化を `AuditLog` に記録（`F-002 AC-3`）。
- **完了の判定**: `F-002 AC-3` / `AC-4` の結合テスト。

### T-04-10 環境分離の検証（M）

- **実装**: `docs/05` §17.4 の表をテストに落とす。
  - `development` / `demo`: 🔴 **全分類の送信を実行し、外部エンドポイントへの発信が 0 件**。**テストコンテナのネットワークを外向き遮断**し、外部到達を試みた時点で落ちる。加えてモックの `callCount()` を検証（二重）。
  - `sandbox` ②: 分類 1 / 分類外（`F-002` / `F-003` / `F-055`）が**実際に送信され**、送信された全通の宛先が**ホスト所属利用者または `PlatformUser` のアドレスのみ**（MailHog で受信を検証）。
  - `sandbox` ③: 分類 2（取引先招待）で外部発信 0 件 + 招待リンク経由での受諾。
  - `production` の起動検証: モック実装が選ばれたら起動失敗 / 非本番に本番キーがあれば起動失敗。
- 🔴 **`F-022` / `F-041` / `F-047` / `F-049`（分類 3 / 4）の検証は、それぞれの機能が入るスプリント（SP-09 / SP-15 / SP-17 / SP-18）で追加する。** Phase 1 の本タスクで扱うのは分類 1 / 2 / 分類外。
- **完了の判定**: 上記 4 環境の検証が green。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット** | `resolveRecipientClass`（4 分類 + 分類外 / 判定順）。SES 応答の正規化。DNS レコードの生成。🔴 **`decideProviderQuota` の境界値**（`provider` が `null` / `min` による丸め / `headroom` の算出。`docs/05` §8.3-Q ②）。 |
| **結合（DB + Redis）** | `EmailDispatch.dedupeKey` の冪等性。`WebhookDelivery` の重複・順序逆転。レート上限（1 日 500 / 1 分 30）。`domain.provision` / `verify` / `recheck`。`requireVerifiedSendingDomain` の保留。招待受諾の CAS。🔴 **`HELD_PROVIDER_QUOTA` の保留と `send.hold-release` による復帰**（`MAIL_PROVIDER_DAILY_QUOTA` を小さくして到達を再現。`FAILED` にならない / 招待はトークン再発行で旧リンクが無効になる / `headroom` を超える分は次回に持ち越す）。 |
| **静的テスト** | `queue-attempts.test.ts`（送信系の `attempts: 1`）。🔴 **`docs/05` §17.2 #19 の hold-release 追補**（①`email.dispatch` / `account.mail` のハンドラが `HELD_PROVIDER_QUOTA` への更新で終わり再 throw・`FAILED` 更新・`failureReason` 書込に到達しない ②`send.hold-release` の走査対象が `{'HELD_DOMAIN_UNVERIFIED','HELD_PROVIDER_QUOTA'}` と一致する ③`packages/domain/src/quota/provider.ts` が `Date.now` / `process.env` を参照しない）。 |
| **E2E** | `S-014` の招待フロー（`production` / `sandbox` の分岐）。`S-036` の 4 状態。環境分離の 3 分類（T-04-10）。 |
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
