# SP-02 schema-isolation — 全 56 表・RLS C0〜C9・分離の機械検証

> **Phase**: 0（基盤） / **前提**: SP-01（二重防御の実証・DB ロール・`withTenant`） / **後続**: SP-03
> **一次資料**: `docs/05` §3（56 表 + ビュー 4 本）/ §4.4（RLS C0〜C9）/ §4.4.1（継承トリガ）/ §4.5 / §4.6 / §4.7（機械検証）/ §4.9（経路 5 の射影）/ §13.6（シード）
> **完了確認**: `MODE: REVIEW` / `TARGET: SP-02`

---

## 1. 目的

`docs/05` §3 の**全 56 表**と経路 5 の**射影ビュー 4 本**を敷き、`docs/05` §4.4 の**ポリシークラス C0〜C9** を全表に割り当てる。そのうえで 🔴 **「分離機構が有効であること自体」を機械検証する**（`docs/05` §4.7。カタログ走査 13 本 + 二重防御 10 件）。RLS が無効化されてもアプリは正常に動くため、**機能テストでは気づけない**。

🔴 **経路 5（`F-065` / `F-066`）の当事者列・C9・射影ビュー・分離テストは、画面が Phase 2 / 3 であっても本スプリント（Phase 0）に入れる。** 後から列を足して既存行を埋め直すと、**埋め漏れがそのまま情報境界の穴になる**（`docs/03` §4.3.2-5 / `docs/03` `pm` 申し送り 12）。

## 2. 対応機能 ID

`F-004`（二重の情報境界の強制）。**`AC-1`〜`AC-5` の DB 側の担保が本スプリントの範囲**（API / 画面側の担保は SP-03 以降）。あわせて `F-065` / `F-066` の**行と列の絞り込み**（API とビューの公開は Phase 2 / 3）。

## 3. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 対応 | 工数 |
|---|---|---|---|---|
| T-02-01 | テナント・利用者・境界の表（§3.3） | `Tenant` の 5 状態、`Membership.partnerCompanyId`、`Invitation`、`TwoFactorCredential` が定義され migrate が通る | `F-001` `F-002` `F-003` | M |
| T-02-02 | ① 集める / 案件・公開範囲・匿名共有の表（§3.4 / §3.5） | `Engineer` 系 5 表 + `Project` 系 3 表 + `MatchCandidate` + `EngineerShare`。**オーナー列を持つ** | `F-008`〜`F-017` | L |
| T-02-03 | 提案・提案依頼・品質ゲートの表（§3.6） | `Proposal` 7 状態 + `EngineerSnapshot` / `ProposalEvent` / `ReviewGate` / `ProposalRequest`。`ReviewGate.execution` の HELD 部分 UNIQUE | `F-018`〜`F-025` | L |
| T-02-04 | 🔴 チャット・契約・稼働の表 + **当事者列**（§3.7） | `assignments` / `contracts` / `contract_documents` / `orders` が **作成時から** `counterpartyPartnerCompanyId` を持つ | `F-038` `F-042` `F-047` `F-065` `F-066` | L |
| T-02-05 | 横断・外部連携・管理平面の表（§3.8〜§3.10） | `AuditLog` の**月次レンジパーティション**、`UsageCounter`（金額 + 件数）、`SendAttempt` の 2 本の UNIQUE | `F-005` `F-026` `F-055`〜`F-063` | L |
| T-02-06 | RLS ヘルパ関数とポリシークラス C0〜C8 の適用 | 全 52 表が操作ごとにクラス割当済み。`USING (true)` が 1 件も無い | `F-004 AC-1`〜`AC-3` | L |
| T-02-07 | 🔴 C9（経路 5）と射影ビュー 4 本 + `PartnerScopeDb` 型 | ビューは `security_invoker=true`。列集合が `BR-66` の許可列と一致。書込ポリシーが無い | `F-065` `F-066` / `BR-66`〜`BR-68` | L |
| T-02-08 | オーナー列 / 当事者列の継承・freeze トリガ | 子は親の値で必ず上書き。根は `BEFORE UPDATE` で不変。親が見えなければ `RAISE` | `docs/05` §4.4.1 | M |
| T-02-09 | 🔴 **分離機構の機械検証（カタログ走査 13 本）** | テーブル名を列挙しない。除外は 4 表 + `_prisma_migrations` のみ | `F-004` / K-1 / K-2 | L |
| T-02-10 | 🔴 **二重防御テスト 10 件 + `seed:isolation`** | 2 テナント × 2 パートナー。**各社が当事者の稼働 / 契約 / 発注を 1 件ずつ**含む | `CLAUDE.md` §5 Phase 0 | L |

## 4. タスク詳細

### T-02-01 テナント・利用者・境界の表（M）

- **参照**: `docs/05` §3.1（共通規約）/ §3.3。
- **実装するもの**: `Tenant`（`TenantLifecycleState` = `SANDBOX` / `ACTIVE` / `SUSPENDED` / `CLOSING` / `PURGED` の 5 状態がすべて。`AppEnvKind`）、`User`、`Membership`、`PartnerCompany`、`Invitation`、`TwoFactorCredential`、`TenantSendingDomain`。
- 🔴 **共通規約を全表で守る**（§3.1）: 主キーは `uuid(7)`、`@@map` で snake_case 複数形、日時は `Timestamptz(3)`、**複合インデックスは `tenant_id` を必ず先頭列に置く**、金額は `Decimal(12,2)`（AI コストのみ `Decimal(12,6)`）、暗号化列は `...Encrypted`、**業務データは論理削除しない**。
- 🔴 **列挙は Prisma DSL では `String` で宣言する（Prisma の `enum` キーワードは使わない）。** enum 宣言はクエリエンジンがバインドパラメータへ `::"EnumName"` キャストを付与し、DB 側が `TEXT` だと実行時 `42704` で全書き込みが失敗する（2026-09-03 実測。`docs/05` §3.1）。許容値はコメントで明記し、DB 側の `TEXT + CHECK` はマイグレーションで手書きする（列挙値追加でテーブルロックを起こさないため）。**TS 側は単一出所の定数配列から型を導出し、CHECK の値集合との一致を静的テストで検証する**（`docs/05` §17.2）。
- 🔴 **`users` に `platform` / `is_admin` / `is_operator` を含む列名を作らない**（`BR-36`。`docs/05` §17.2 #13 が検査する）。
- **完了の判定**: `prisma migrate` が通り、`platform-user-no-flag.test.ts` が green。
- **T-01-07 からの申し送り（2026-09-03、code-reviewer 指定）**:
  ① `TenantLifecycleState` が `packages/db/src/context.ts:13` と `packages/domain/src/state/tenant.ts:17` に二重定義されており、T-02-01 の Prisma enum で 3 重になる。**T-02-01 で単一の出所へ一本化する**（`packages/db` → `@ses/domain` の依存は CLAUDE.md §2.1 / docs/05 §2.2 で禁止されておらず ESLint も許可。逆向きは禁止）。
  ② `tests/static/domain-purity.test.ts` は引数付き `new Date(<リテラル>)` / `Date.UTC()` も違反にするため、domain のユニットテストで固定日時が必要になっても**検査関数を弱めて解決しない**こと（緩めるなら `*.test.ts` 限定・リテラル引数限定として範囲を明示）。

### T-02-02 ① 集める / 案件・公開範囲・匿名共有の表（L）

- **参照**: `docs/05` §3.4 / §3.5。
- **実装するもの**: `Skill`（グローバル。射程外の 4 表の 1 つ）/ `SkillAlias` / `Engineer` / `EngineerSkill` / `SkillSheet` / `SkillSheetExtraction` / `FileScanResult` / `Project` / `ProjectRequirement`（必須 / 尚可の区分を持つ）/ `ProjectVisibility` / `MatchCandidate` / `EngineerShare`。
- 🔴 **オーナー列**: `engineers` / `engineer_skills` / `skill_sheets` / `skill_sheet_extractions` は `ownerPartnerCompanyId`、`engineer_shares` は `partnerCompanyId`（`docs/05` §4.4 C3）。**根は `engineers`、他は子として継承**（トリガは T-02-08）。
- 🔴 **`ProjectRequirement` は必須 / 尚可を別区分として保持する**（`F-013 AC-1`。整合層の照合とマッチングの足切りが区分を参照する）。
- 🔴 **`Project` はエンド企業名・内部単価を「公開範囲の外に出さない項目」として保持する**（`F-013 AC-2`。射影は SP-06 の `PartnerProjectView`）。
- **完了の判定**: migrate が通る。`ProjectRequirement.kind` が `MUST` / `NICE` の 2 値で `CHECK` されている。

### T-02-03 提案・提案依頼・品質ゲートの表（L）

- **参照**: `docs/05` §3.6 / §9.3 / §11。
- **実装するもの**: `Proposal`（`CLAUDE.md` §4.2 の全状態。`contentHash` / `sendHoldReasonKey` / `sendHoldSince` を持つ）/ `EngineerSnapshot` / `ProposalEvent` / `ReviewGate` / `ProposalRequest`（`REQUESTED` / `ACCEPTED` / `DECLINED` / `WITHDRAWN_BY_HOST` / `EXPIRED`）。
- 🔴 **`ReviewGate.execution`**（`RUNNING` / `DONE` / `HELD_AI_COST_LIMIT`）と、**HELD 行の部分 UNIQUE**（`docs/05` `P-A-16` / §9.3）。**これは状態機械の状態ではなく実行の属性である**（`CLAUDE.md` §4.2 の 5 状態機械に状態を 1 つも追加しない）。
- 🔴 **`ReviewGate` は `(targetType, targetId, contentHash)` を持つ**（`F-020 AC-3` の再現性と §11.5 の再検証の根拠）。`targetType` に `CONTRACT_DOCUMENT` を含める（[Issue #15](https://github.com/Festal-KM/SES-Platform/issues/15)）。
- 🔴 **`ProposalRequest` の辞退理由をホスト側の射影に出さない**列設計にする（`BR-57`。DTO の分離は SP-08）。
- **完了の判定**: migrate が通る。`Proposal` / `ProposalRequest` の状態が `CLAUDE.md` §4.2 の列挙と 1 対 1 であることを型テストで固定する。

### T-02-04 🔴 チャット・契約・稼働の表 + 当事者列（L）

- **参照**: `docs/05` §3.7 / §3.1（当事者列）/ `docs/03` §4.3.2-5 / `docs/03` `pm` 申し送り 12。
- **実装するもの**: `ChatThread` / `ThreadParticipant` / `Message` / `Contract`（7 状態）/ `ContractDocument` / `ContractTemplate` / `Order` / `Assignment` / `ExtensionReview`。
- 🔴 **当事者列は、それぞれのテーブルを作る時点で入れる。** `assignments` / `contracts` / `contract_documents` / `orders` の 4 表だけが `counterpartyPartnerCompanyId String? @db.Uuid`（`null` = 自社エンジニア / 相手方がパートナーでない）を持つ。**後から足して既存行を埋め直さない。**
- 🔴 **当事者列を持つ表を増やすことは経路 5 の対象を増やすことであり、人間の承認事項**（`CLAUDE.md` §8.6）。T-02-09 のテストが「4 表以外に増えていたら FAIL」で固定する。
- 🔴 **`ExtensionReview` には当事者列を持たせない**（ホスト内部の検討内容は経路 5 の対象外。`BR-67`）。
- **画面と API は Phase 2 / 3**（`S-029` / `S-030` / `S-044` は SP-16、`S-025`〜`S-028` / `S-045` は SP-17〜19）。本スプリントは**スキーマと分離だけ**。
- **完了の判定**: migrate が通る。当事者列が 4 表のみに存在することを T-02-09 のテストが確認する。

### T-02-05 横断・外部連携・管理平面の表（L）

- **参照**: `docs/05` §3.8 / §3.9 / §3.10 / `docs/03` §8.3 / `docs/03` `program-design` 申し送り 14・30。
- **実装するもの**: `Task` / `Notification` / `AiUsage` / `AuditLog` / `UsageCounter` / `SendAttempt` / `EmailDispatch` / `EmailEvent` / `WebhookDelivery` / `SchedulerRun` / `TenantMonthlyCost` / `BillingMeterSubmission` / `Announcement` / `DataExportRequest` / `TenantPurgeRun` / `PlatformUser` / `Plan` / `Subscription` / `ImpersonationSession` / `TenantEsignConnection` / `TenantRoleApprovalMode` / `TenantRoleModel` / `TenantMatchWeight`。
- 🔴 **`AuditLog` は `created_at` の月次レンジパーティショニングを Phase 1 から入れる**（`docs/03` `program-design` 申し送り 14 / `T-A-11`）。`BR-28` により閲覧のたびに 1 行増え、100 テナントで年間約 1 億行になる。**後から入れるのは高くつく。**
- 🔴 **`UsageCounter` は「金額」と「単位別の件数（4 単位）」の両方を持ち、片方から他方を導出しない**（`docs/03` `program-design` 申し送り 30 / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。**Phase 3 で件数に切り替える計画にしない** — Phase 1〜2 の件数が永久に分からなくなる。
- 🔴 **`Plan` は 2 種類の上限を持つ** — 内部指標の金額上限と、利用者向けの単位別件数上限。判定は独立に評価する。
- 🔴 **`SendAttempt` に `UNIQUE(entity_type, entity_id, attempt_seq)` と `UNIQUE(idempotency_key)` の 2 本**を張る（`docs/03` `program-design` 申し送り 3。K-5 の防御線）。
- 🔴 **`TenantRoleApprovalMode` に `CHECK (role <> 'gate-inspector')`**（`CLAUDE.md` §12.4。設定項目自体を作らせない）。
- 🔴 **`AiUsage` はロール識別子を NOT NULL にする**（`F-026 AC-2`。欠損すると `F-063` のロール別原価が成立しない）。
- **完了の判定**: migrate が通る。`audit.create-partitions` 相当の初期パーティションが作られる。`SendAttempt` の 2 本の UNIQUE が `pg_indexes` に存在する。

### T-02-06 RLS ヘルパ関数とポリシークラス C0〜C8 の適用（L）

- **参照**: `docs/05` §4.4（クラス定義と適用テーブルの表）/ §4.4.2。
- **実装するもの**:
  - ヘルパ関数 `app_tenant_id()` / `app_partner_id()` / `app_is_host()` / `app_actor_user_id()`（すべて `SECURITY INVOKER` / `STABLE`）。
  - **C0 SYSTEM_ONLY**（`scheduler_runs` / `webhook_deliveries` / `email_events` / `impersonation_sessions`）+ `withSystemScope()`。
  - **C1 TENANT_ALL** / **C2 HOST_ONLY** / **C3 OWNER_SCOPED** / **C4 VISIBILITY（経路 1）** / **C5 PARTY（経路 2 / 4）** / **C6 THREAD（経路 3）** / **C7 SELF** / **C8 DIRECTORY**。
  - §4.4.2 の**行由来コンテキスト 3 関数**（`withInvitationToken` / `withInvitationAccept` / `withPasswordReset*`）と `withAuthLookup`。🔴 **`systemTenantCtx` を `apps/web` に開放しない**（HTTP 経路が認証を迂回できるため）。
- 🔴 **`WITH CHECK` の既定は `USING` と同じ式**。ただし `engineers` / `memberships` / `engineer_shares` / `users` の 4 表は C3 の式に絞る（自分の所属としてしか書けない）。
- 🔴 **越境の判断をアプリの `if` に一切書かない。** `ProjectVisibility` / `ThreadParticipant` / `EngineerShare` の**行の有無がそのまま見える / 見えない**になる。
- **完了の判定**: T-02-09 のカタログ走査で「ポリシーが 0 件の表」と「`app_tenant` に権限がありながら `app_tenant_id()` を参照しないポリシー」が 0 件。
- **T-02-02 からの申し送り（2026-09-03、code-reviewer 指定）**: `SkillAlias` の C1 ポリシー（`SELECT` は `OR tenant_id IS NULL`）を書く際、`withTenant`（第 2 防御）はグローバル行を無条件で除外する既知の gap がある（`packages/db/src/scope-injection.ts` の `TENANT_KEY_OVERRIDES` 直後の known-gap コメント参照）。読み取り注入の緩和方式をここで設計判断すること。

### T-02-07 🔴 C9（経路 5）と射影ビュー 4 本（L）

- **参照**: `docs/05` §4.4 C9 / §4.9 / `CLAUDE.md` §3.1-5 / `BR-65`〜`BR-69`。
- **実装するもの**:
  - **C9 COUNTERPARTY_READ**: `SELECT` のみ。`<T> = app_tenant_id() AND NOT app_is_host() AND <C> = app_partner_id()`。🔴 **`INSERT` / `UPDATE` / `DELETE` のパートナー向けポリシーを書かない**（`BR-68`）。
  - `contract_documents` は 🔴 **`AND signed_at IS NOT NULL` を AND する**（署名済み最終版のみ。ドラフト版は行として存在しない。`F-066 AC-2`）。
  - 🔴 **`extension_reviews` にパートナー読み取りのポリシーを一切書かない**（`BR-67`）。
  - **射影ビュー 4 本**（`partner_assignments_v` / `partner_contracts_v` / `partner_contract_documents_v` / `partner_orders_v`）を `WITH (security_invoker = true)` で作る。列集合は `docs/05` §4.9 の**許可列の一覧と 1 対 1**。🔴 **`updated_at` / `created_at` は 4 本のいずれにも置かない**。
  - `partner_assignments_v` は 🔴 **`LEFT JOIN projects`**（`INNER JOIN` / `CASE` では未公開案件の稼働行ごと消えて `F-065 AC-1` を落とす）。`extension_review_open` は `state = 'EXTENSION_REVIEW'` の導出であり **`extension_reviews` を参照しない**。
  - `GRANT SELECT` は `app_tenant` のみ。🔴 **`app_platform` / `app_platform_write` に GRANT しない**（`BR-40`）。
  - `packages/db` に `PartnerScopeDb` 型と `withPartnerScope(ctx, target, fn)` を置く。🔴 **`TenantDb` から `assignment` / `contract` / `contractDocument` / `order` / `extensionReview` のデリゲートを外す**（型で到達不能にする。§4.3-6）。素の拡張越しに呼ぶと `PartnerBaseTableAccessError` を throw する。
- 🔴 **列の絞り込みを「取得後のフィルタ」で実装しない。** ビューに無い列は SQL として取得できず、Prisma のモデルにも現れない（`docs/02` `program-design` 申し送り 13-④）。
- **API と画面は Phase 2 / 3**（#80 は SP-16、#81 / #82 は SP-19）。
- **完了の判定**: T-02-09 のビュー列テストと T-02-10 の #8〜#10 が green。

### T-02-08 オーナー列 / 当事者列の継承・freeze トリガ（M）

- **参照**: `docs/05` §4.4.1 / `P-A-11`。
- **実装するもの**:
  - `inherit_owner_partner_company(parent_table, fk)` — 🔴 **`NEW.owner_partner_company_id` を親の値で必ず上書きする**（呼び出し側の指定値を採用しない）。**親が見つからない（RLS で見えない）なら `RAISE EXCEPTION`**。
  - `freeze_owner_partner_company()` — 根の 4 表（`users` / `engineers` / `proposals` / `tasks`）の `BEFORE UPDATE` で不変にする。
  - 子表 7 つ（`engineer_skills` / `skill_sheets` ← `engineers`、`skill_sheet_extractions` ← `skill_sheets`、`engineer_snapshots` / `proposal_events` ← `proposals`、`messages` ← `chat_threads`、`review_gates` ← `CASE`）。
  - **当事者列にも同じ規律**（根 = `contracts`、子 = `assignments` / `contract_documents` / `orders`）。
  - 🔴 **宣言を `COMMENT`（`owner-column: root` / `owner-column: child of P(fk)`）で持たせる。** T-02-09 のテストが宣言と実体の一致だけを見る（表を列挙しない）。
- **完了の判定**: 継承・freeze のトリガテスト（偽装した値を INSERT しても親の値で上書きされる / 更新しようとすると RAISE）。

### T-02-09 🔴 分離機構の機械検証（カタログ走査 13 本）（L）

- **参照**: `docs/05` §4.7 / §17.2 #1 / #2 / #4 / #5。**そのままテストに落とす。**
- **実装するテスト**（`tests/isolation/rls-enforced.test.ts` ほか）:
  1. 全業務テーブルで RLS が**有効かつ FORCE** されている
  2. 全表にポリシーが 1 つ以上ある
  3. `app_tenant` に権限がある表は、適用される全ポリシーの式が `app_tenant_id()` を参照する（`USING (true)` の類が必ず落ちる）
  4. `app_tenant` に権限が無い表は `app_platform` / `app_platform_write` のいずれかに権限がある（孤児表の検出）
  5. 4 ロール + `app_share_probe` + `app_assignment_owner_probe` が `BYPASSRLS` を持たない
  6. `app_platform` が業務テーブルに `INSERT/UPDATE/DELETE` 権限を持たない
  7. §5.7 の非開示列が `app_platform` に GRANT されていない
  8. Prisma 拡張の対象モデル一覧が、除外 4 モデル以外のすべてを含む
  9. オーナー列が root / child の宣言を持ち、宣言に応じたトリガがある
  10. `app_share_probe` の権限は `engineer_shares` の 3 列の `SELECT` だけ、`app_assignment_owner_probe` の権限は `engineers` の 3 列の `SELECT` だけ（`role_column_grants` / `role_table_grants` を migrator 接続で走査。§4.4.1）
  11. **当事者列も root / child の宣言と対応するトリガを持ち、持つ表が 4 表以外に増えていたら FAIL**
  12. **経路 5 の 4 表に、パートナー文脈で真になり得る書込ポリシーが無く、`extension_reviews` にパートナー文脈で真になる `SELECT` ポリシーも無い**
  13. **射影ビュー 4 本が `security_invoker=true` で、列集合が §4.9 の許可列と一致し、依存する表が基底 4 表 + `projects` + `project_visibilities` 以外に無い**
- 🔴 **テーブル名を列挙しない。除外リストは「4 表（`platform_users` / `plans` / `subscriptions` / `skills`）+ `_prisma_migrations`」だけ**であり、**必ず「全部から 4 つを引く」向きで書く**。新規テーブルは既定で検査対象に入る。
- 🔴 **除外リストを広げて通すのは、このテストが防ごうとしている壊し方そのものである。** 新規テーブルが落ちたら §4.4 のクラスを 1 つ選んでポリシーを書く。
- **完了の判定**: 13 本すべてが green。CI（T-01-08）で毎回走る。

### T-02-10 🔴 二重防御テスト 10 件 + `seed:isolation`（L）

- **参照**: `docs/05` §4.7 の表（#1〜#10）/ §13.6（シード）/ `docs/03` §4.19。
- **`seed:isolation` の内容**（`packages/db/seed/presets/isolation.ts`）:
  - **2 テナント × 2 パートナー**（`CLAUDE.md` §5 Phase 0）。
  - 🔴 **各パートナーが当事者の `Assignment` / `Contract` / `Order` を 1 件ずつ含め、同一案件に両社の稼働を置く**（§4.7 #8〜#10 / §17.3 #21 の母集団）。
  - 🔴 **DB に直接 INSERT せず、`packages/domain` の `transition()` を通して状態を進める**（不整合な状態を作らない）。
  - 固定シードの疑似乱数（`seedrandom`）。`reset()` → `seed()` の 2 段階で冪等。
  - 🔴 **`APP_ENV ∈ {demo, development}` のときのみ実行できる**（`F-053 AC-6`。`packages/config` の検証で拒否）。
- **実装するテスト 10 件**（`docs/05` §4.7 の表をそのまま）: #1 拡張無効化 / #2 `SET LOCAL` 未発行 / #3 RLS `DISABLE` / #4 パートナー文脈で他パートナーの `Engineer` / `Proposal` / `Message` / 匿名候補 / #5 ホスト文脈で他パートナーの `Engineer` / #6 `withSharedCandidateScope` の外で `app.shared_scope` を立てる / #7 ホスト文脈で `engineer_shares` を直接 `SELECT` / #8 **パートナー文脈で他社が当事者の 4 表を一覧・`COUNT`・ID 直指定・ビュー越しに取る → 0 件 / 404、`total` が変わらない** / #9 **基底表の `SELECT *` はコンパイルエラー + 実行時 throw、ビューの応答に `unit_price`（ホスト販売）/ `internal_unit_price` / `end_client_name` / `summary` / `facts` / `note` が 1 つも無い** / #10 **経路 5 の 4 表への `INSERT` / `UPDATE` / `DELETE` が 0 件更新**。
- **完了の判定**: 10 件すべてが green。`pnpm seed --preset=isolation --reset` が冪等に再実行できる。
- **T-01-04 からの申し送り（2026-09-02、code-reviewer 指定）**: 子リレーションを持つ表を追加する際、**ネスト create の `tenantId` は Prisma 拡張では検査されず RLS の `WITH CHECK` が唯一の防御**（`packages/db/src/extension.ts` の known-gap コメント参照。対向 FK がテナントキーでないため DMMF 逆方向走査も検知しない）。isolation テストに「ネスト create で他テナント `tenantId` を注入 → RLS が拒否」の probe を追加すること。

## 5. テスト計画

| 層 | 内容 |
|---|---|
| **ユニット（Vitest）** | Prisma DMMF の走査（拡張の対象モデル / `TenantDb` の型テスト）。`platform-user-no-flag` の列名走査。 |
| **結合（Testcontainers + PostgreSQL）** | 🔴 **本スプリントの中心。** T-02-09 のカタログ走査 13 本 + T-02-10 の二重防御 10 件。継承・freeze トリガのテスト。パーティションの作成。`SendAttempt` の UNIQUE。 |
| **E2E** | 本スプリントでは作らない（画面が無い）。**Phase 0 の成功条件の E2E は SP-03 の T-03-11**。 |
| **外部 API のモック方針** | 本スプリントは外部 API を叩かない。 |

## 6. 完了判定

1. `prisma migrate deploy` で**全 56 表 + ビュー 4 本**が作られ、`docs/05` §3.2 の一覧と 1 対 1（**19 の実装テーブル以外を勝手に足していない**）。
2. 🔴 **T-02-09 のカタログ走査 13 本がすべて green**。除外リストが「4 表 + `_prisma_migrations`」から広がっていない。
3. 🔴 **T-02-10 の二重防御 10 件がすべて green**。特に **#8 / #9 / #10（経路 5）**が含まれている。
4. 当事者列が `assignments` / `contracts` / `contract_documents` / `orders` の 4 表**のみ**に存在し、`extension_reviews` に無い。
5. 射影ビュー 4 本が `security_invoker=true` で、列集合が `BR-66` の許可列と一致する。
6. `pnpm seed --preset=isolation` が 2 テナント × 2 パートナー + 各社当事者レコードを冪等に投入できる。
7. CI で 2 / 3 が毎回走る。
