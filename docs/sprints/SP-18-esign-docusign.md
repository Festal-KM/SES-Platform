# SP-18 esign-docusign — DocuSign BYO 接続・Connect Webhook・締結追跡

> **Phase**: 3 / **前提**: SP-17 / **後続**: SP-19
> ⚠️ **本ファイルは主要タスクの見出しまでの粗い計画である。** タスク単位の受け入れ基準は Phase 2 完了時の再計画で書く（`docs/dev-plan.md` §3.4）。
> **一次資料**: `docs/01` `BR-70` `BR-51` `BR-25` / `docs/02` `F-049` / `docs/03` §3.1（電子署名。全面）/ §4.4 / §4.11 / `docs/04` `S-037` `S-026` / `docs/05` §6.10 / §8.4〜§8.6 / §12.3
> 🔴 **ワイヤーフレーム（着手条件）**: 画面を伴うタスク（`S-037` / `S-026`）は、**対象画面の `docs/wireframes/{S-xxx|A-xxx}-*/` に画像が存在すること**を着手条件とする（`docs/dev-plan.md` §5 E-15 / §6.4 R-11）。**85 枚中 3 枚のみ生成済み**であり、無ければ `node scripts/generate-wireframes.mjs --screen <ID>` で当該 1 枚だけを生成する（🔴 **`--force` での全画面再生成は課金が発生するため行わない**）。

---

## 1. 目的

**電子署名を BYO 方式（テナントが自社の DocuSign アカウントを接続する）で実装する**（[Issue #11](https://github.com/Festal-KM/SES-Platform/issues/11) で 2026-09-01 に決定）。運営者の 1 アカウントから全テナント分を送る方式では**送信元名義をテナント別に分けられず `BR-51` を満たせない**ため、この方式が唯一の選択肢である。

🔴 **電子署名は「接続したテナントのみのオプション機能」である。** 未接続でも契約書はメール添付で送れる（SP-17 で成立済み）。

## 2. 対応機能 ID

`F-049`（電子署名依頼と締結状態の追跡）

## 3. 事前確認（着手前）

🔴 **E-7: DocuSign の Go-Live 申請を、本スプリントの前半に出す**（`docs/dev-plan.md` §5 / `docs/03` `pm` 申し送り 2）。

- 「Pending Approval 到達後 3 営業日以内に昇格」とされるが **二次情報**（`U-21`）。落ちると再申請のたびに営業日が積み上がる。
- 🔴 **Phase 3 の最終週に申請する計画にしない。**
- 開発は `packages/connectors/src/mock/` の DocuSign モックで進める。**Go-Live の承認を実装の完了条件にしない。**

**第二コネクタ（クラウドサイン）は実装しない**（`Q-T-9` / `docs/05` TBD-17）。`EsignProvider` のインタフェースと `CLIENT_ID` 枝を型・スキーマに残すのみ。

## 4. 主要タスク（見出し）

| ID | 主要タスク | 工数 | 要点 |
|---|---|---|---|
| T-18-01 | `EsignProvider` のインタフェースと DocuSign 実装 | L | 🔴 **`connect` は `{ kind:'OAUTH_AUTH_CODE' } \| { kind:'CLIENT_ID' }` の判別可能な合併**（第二コネクタの差し替え余地）。**プロバイダ差異を `EsignProvider` の内側に閉じ、ドメイン層に漏らさない** |
| T-18-02 | 🔴 **OAuth 接続（Authorization Code Grant）と `S-037`** | L | 🔴 **`scope=signature extended` を必ず要求する**（忘れると 30 日で接続が黙って切れる。テストで固定する）。🔴 **`state` は ctx の `tenantId` / `userId` で再計算して照合する**（リクエストの `state` からテナントを決めない）。`nonce` は Redis で 1 回限り消費 |
| T-18-03 | 資格情報の暗号化と非開示 | M | 🔴 **保存するのはリフレッシュトークン / `accountId` / `baseUri` / `provider`。アクセストークンは永続化せずプロセス内キャッシュ**（8 時間。残 30 分で更新）。🔴 **AES-256-GCM。AAD に `tenant_id` + カラム名。運営者にも復号して見せない**（列レベル `GRANT` から外す。`BR-25` / `BR-40`） |
| T-18-04 | 署名依頼の送信（`via='ESIGN'`） | L | 🔴 **1 契約につき 1 リクエスト。再送は人間の明示操作のみ**（`BR-24` / `F-027 AC-3`）。🔴 **トークンの更新は「送信リクエストを投げる前」に閉じ、投げた後の 401 は `SEND_FAILED` に確定させる** |
| T-18-05 | 🔴 **双方署名を 1 エンベロープの複数署名者で表現** | M | 🔴 **`Contract` の状態を増やさない**（`CLAUDE.md` §4.2）。**`UNDER_REVIEW` = いずれか未署名 / `EXECUTED` = 全署名完了。** 「誰が署名済みか」は `ContractDocument` の署名状態として持つ。署名順は `routingOrder`（既定は自社 → 取引先） |
| T-18-06 | Connect Webhook の受信と検証 | L | 🔴 **HMAC-SHA256（`X-Docusign-Signature-{n}` / Base64 / **整形前の生ボディ**）を必ず検証する。** SIM（JSON）モデルを使い Aggregate モデルを使わない。**1 秒以内に 200 を返し、処理はジョブに積む** |
| T-18-07 | 🔴 **Webhook のペイロードで状態を確定させない** | M | 🔴 **必ず API でエンベロープの状態を再照会してから `Contract` を遷移させる**（遅延配信・順序逆転で古い状態が上書きしうる）。受信は冪等（`UNIQUE(provider, external_event_key)`）。🔴 **`SendAttempt` の DB 制約を唯一の防御線とする前提を変えない**（冪等性キーが一次情報で確認できていないため。`U-20`） |
| T-18-08 | 締結状態の同期と未着の監視 | M | `esign.status-sync`（毎日 05:00 JST。Webhook 欠落の保険）。`A-005` に「電子署名の未着（`UNDER_REVIEW` の長期滞留）」を追加する |
| T-18-09 | 接続解除と接続無効化の扱い | M | `DELETE` は Connect 設定の削除 + `invalidatedAt`。🔴 **送付中の契約は DocuSign 側で進行し続ける旨を `S-037` が示す** |

## 5. `S-037` の設計要点（`docs/03` `ui-design` 申し送り 1）

- 🔴 **API キーを貼り付けるフォームではない。** 「DocuSign に接続する」ボタン → DocuSign の同意画面 → 戻り、の **3 ステップ**。
- 🔴 **接続済みの表示に、接続した DocuSign アカウント名と接続日時を出す**（**誰のアカウントで送られるのかを、送信前に確認できるようにする**ため）。
- 🔴 **未接続テナントでは `F-049` の導線が出ず、代わりに接続画面へ誘導する。** `Contract` は `DRAFT` のまま `SENDING` に進めない。**「壊れている」ではなく「未接続」として理由とともに示す。**
- 🔴 **`F-049` は独自ドメインの検証を前提としない** — メールを送るのは電子署名サービス側でありテナントのメール送信基盤を通らないため（`F-001 AC-4` の 🔴 / `F-049 AC-8`）。

## 6. テスト計画（方針）

- **ユニット**: `buildAuthorizeUrl()` に `scope=signature%20extended` が含まれる（🔴 **`docusign-scope.test.ts`。`docs/05` §17.2 #19**）。HMAC 検証（整形前の生ボディ）。
- **結合**: `state` / `nonce` の 1 回限り消費。トークンの暗号化と復号（AAD 不一致で失敗）。Webhook の重複・順序逆転・遅延配信で古い状態が上書きされない。401 が `SEND_FAILED` に確定する。
- **静的テスト**: `queue-attempts.test.ts`（`send.contract` の `attempts: 1`）/ `contract-resend-human-only.test.ts`（#16）/ 資格情報が `app_platform` の `GRANT` に無いこと。
- **E2E**: 🔴 **#22** — 接続済みテナントで `via='ESIGN'` の envelope が 1 通、署名者 2 名、**HOST 署名後も `UNDER_REVIEW` のまま `signers` だけ更新、全員署名で `EXECUTED`**。未接続テナントで `S-037` へ誘導される。
- **外部 API のモック**: 🔴 **`packages/connectors/src/mock/esign/**` を E2E と結合で同一実装として使う。** Webhook はフィクスチャ（`tests/fixtures/docusign/*.json`。**架空値に置換してからコミットする**）。

## 7. 完了判定（方針）

1. `F-049` の全 AC が green。
2. 🔴 **署名依頼が 1 契約 1 リクエストで、自動再送が存在しない。**
3. 🔴 **`scope=signature extended` が要求されている**（テストで固定）。
4. 🔴 **Webhook の HMAC 署名を検証し、かつペイロードで状態を確定させず API で再照会している。** 受信が冪等。
5. 🔴 **資格情報が暗号化され、ログ・エラー・監査ログ・通知・LLM のいずれにも現れず、運営者にも復号して見せない。**
6. 🔴 **双方署名で `Contract` の状態が増えていない**（`UNDER_REVIEW` / `EXECUTED` の 2 状態で表す）。
7. 🔴 **未接続テナントで `F-049` の導線が出ず、`Contract` が `SENDING` に進まない。** それでも `via='EMAIL'` で ⑤ 契約が完了する（SP-17 の成果を壊していない）。
8. **申し送り**: DocuSign Go-Live の承認状況を `docs/dev-plan.md` §8 に追記する。
