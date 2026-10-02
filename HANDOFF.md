# HANDOFF.md — 作業の引き継ぎ

🔴 **作業を始める前に、このファイルを最初に読む。** `CLAUDE.md` が一次資料（仕様・ハードルール）で、このファイルは**いま何が未完で、何に気をつけるか**を記録する。

> **最終更新**: 2026-10-02 / HEAD = `e0cbada` / ブランチ = `main`
> **更新の作法**: 作業の節目（タスク完了・判断の確定・事故の発覚）でここを更新する。🔴 **終わった項目は消さず「✅ 完了（日付）」に書き換える** —— 消すと「なぜそうしたか」が失われ、同じ議論が再発する（`CLAUDE.md` §9 と同じ作法）。

---

## 1. 🔴 いま最優先で直すもの

| # | 内容 | 状態 |
|---|---|---|
| 1 | ✅ **完了（2026-10-02。`1d5e079`）** —— **CI が赤。`GET /api/home` が実 DB で 500 を返していた**（`tests/isolation/home-action-queue.test.ts` の 25 件中 **23 件が `expected 500 to be 200`**）。🔴 **当初の見立て（`summary.ts` の `db.engineerShare.count` が RLS / `shared_scope` と衝突）は外れだった。** 真因は `T-22-09` が `GET /api/home` に**起動時 DI の参照**（`sendingDomainRuntime()` = `操作` 列の不能条件 ④）を足したこと。分離テストには `apps/web/instrumentation.ts` が無いため `ensureDbConfigured()` → `initializeRuntimeConfig(process.env)` が走り、`APP_ENV` 不在の `EnvValidationError` で 500 になっていた —— **DB も RLS も `count` も無関係で、ハンドラ本体に 1 行も入っていなかった**。直し方は `vi.mock` で起動時 DI をテスト側が注入する（既存 16 ファイルと同じ作法）。🔴 **環境変数を設定して通す直し方は採れない** —— `ensureDbConfigured()` が `configureTenantDb()` も行うため、`beforeAll` が指した Testcontainers の接続が別 URL に差し替わり、**検証対象の母集団が静かに入れ替わる**（今回より悪い壊れ方）。プロダクションコードは 1 行も触っていない | **✅ 完了** |
| 2 | 🔴 **CI がまだ赤。E2E が 2 件落ちている**（run `36967915211` / HEAD `e0cbada`。61 passed / **2 failed** / 4 did not run）。🔴 **どちらも `T-22-09` の回帰で、どちらも情報境界の安全網そのもの**。① `tests/e2e/anonymous-share.spec.ts:1098` —— `HOST_HOME_ACTION_ROW_ALLOWED_KEYS`（同ファイル 227 行）が 8 キーのままで、`T-22-09` が `状態` 列 / `操作` 列で足した `stateBadge` / `entity` / `state` / `action` の 4 キーを知らない（**経路 4 の検査**）。② `tests/e2e/isolation.spec.ts:518` —— `#9` の `blocks` が `SUMMARY` を足して 2 本になったのに、519〜521 行が `blocks[0]` を要対応キューだと決め打ちしている（**「パートナー A1 に A2 のものが 1 件も現れない」の検査**）。🔴 **許可リストを広げるのは安全網を自分で緩める作業である** —— `toEqual` を `toContain` にしない / 走査の深さを下げない / 値の検査（`expectNoForbidden`）に触らない / **キーごとに「なぜ身元を運べないか」を型で確かめてコメントに残す**。`T-22-10` のエージェントに引き渡した（同じ E2E ファイルを触る予定のため並行編集を避けた） | **対応中** |

🔴 **500 を握りつぶして 200 にする直し方は禁止**（上記も握りつぶしていない。`expect(200)` はそのまま、指標の削減も `SummaryStrip` の縮小もしていない）。

🔴 **`#2` が片付くまで CI は赤のままである。** 次の着手は §2.2 の `T-22-10`（ホームの要対応キューに `Drawer`）＝ 段③ の締めで、`#2` はその前段として同じエージェントが直している。

🔴 **`#1` と `#2` の両方が「ユニットは緑、CI でしか落ちない層」だったこと自体が教訓である**（§6 の 10 件目）。`#1` は分離テスト（Testcontainers）、`#2` は E2E（Playwright）—— **どちらもこの開発機では重く、ローカルで習慣的に回していなかった。** 🔴 **境界領域で API の応答の形を変えたら、`tests/isolation/` と `tests/e2e/` の該当ファイルを名指しで回す**（分離 1 ファイルは 26 秒、E2E 2 ファイルも数分）。

---

## 2. いまの開発フェーズ

**Phase 1（MVP）のコードは完成している。** そのうえで **UI/UX の全面刷新（`SP-22`）** を進めている。

### 2.1 Phase 1 の残り（SP-12）— いずれも**人間の作業待ち**

| タスク | 内容 | ブロッカー |
|---|---|---|
| `T-12-09` | 本番 / `sandbox` の AWS アカウント分離 + GuardDuty のスキャン所要時間の実測 | 人間の AWS 操作 |
| `T-12-11` | 第 1 回リリースの準備 | [#74](https://github.com/Festal-KM/SES-Platform/issues/74) の 3 件（SES 本番アクセス申請の返答 / Anthropic の API キー / AWS アカウント） |

🔴 **リリースの時点は [#81](https://github.com/Festal-KM/SES-Platform/issues/81) で未決**。既定は「`SP-22` の段①〜③ の後」。

### 2.2 UI/UX 刷新（`SP-22`。5 段 15 タスク）

| 段 | タスク | 状態 |
|---|---|---|
| ① 外枠・トークン・部品 | `T-22-01` トークン + 既存 15 プリミティブ | ✅ `81e64f1` |
| | `T-22-02` 安全網（静的検査 + ラチェット + testid 凍結） | ✅ `c24009b` |
| | `T-22-03` overlay 6 種（Radix）+ `@ses/ui/client` | ✅ `5fec0d6` |
| | `T-22-04` `DataTable` / `PageBody` / 表示系 10 種 | ✅ `8b3fc87` |
| | `T-22-05` **App Shell**（レビュー 1 回 → 指摘 11 件回収） | ✅ `31bd0c7` / `e2e4dee` |
| ② 一覧 | `T-22-06` `S-005` / `S-010` / `S-019` + 列表示切替 | ✅ `f71612c` / `d30cea5` |
| | `T-22-07` `S-015` / `S-016` / `S-041`（レビュー 1 回 → **APPROVED**） | ✅ `1a55389` |
| | `T-22-08` `A-002` / `A-005` / `A-006` | ✅ `276e6fc` |
| ③ ホーム | `T-22-09` **ホームの Dashboard 化**（レビュー 1 回 → 指摘回収済み） | ✅ `1ad779d` / `f2095d8` / `1d5e079`（§1 の CI 赤を解消） |
| | `T-22-10` 要対応キューの行から `Drawer`（**レビュー 1 回が必要**） | **未着手** |
| ④ 承認・判断 | `T-22-11` `S-021` / `S-020` / `S-018` / `S-023` / `S-024`（レビュー 1 回） | **未着手** |
| | `T-22-12` 詳細・編集・取込（`S-006`〜`S-009` / `S-011`〜`S-014` / `S-017` / `S-022`）（レビュー 1 回） | **未着手** |
| | `T-22-13` 認証と設定（`S-001` / `S-002` / `S-046` / `S-035` / `S-036` / `S-038` / `S-042`） | **未着手** |
| ⑤ 管理平面 | `T-22-14` `A-001` / `A-003` / `A-004` / `A-010` / `A-012` / `A-014` / `/admin`（レビュー 1 回） | **未着手** |
| | `T-22-15` 締め（🔴 **許可リストが空 / 全検査が無条件 green / 全数 E2E / 実機確認 / 完了記録**） | **未着手** |

**残っている直書きの量**（ラチェットの許可リスト）: 段④⑤ で **231 エントリ**。段①②③ は**すべて空**（= 違反 0 件）。

### 2.3 デモ環境

**https://web-production-9a8f44.up.railway.app**（`APP_ENV=demo`。🔴 外部 API は 6 つとも全モック）

| 用途 | アカウント | 2FA |
|---|---|---|
| まず画面を見る | `sales-1@demo-alpha.example` | 不要 |
| 取引先側 | `partner-2-sales@demo-alpha.example` | 不要 |
| 管理者の設定 | `admin@demo-alpha.example` | 要 |
| 運営者コンソール | `platform-owner@seed-isolation.test` | 要 |

パスワードと全 22 アカウントは `docs/DEV-ACCOUNTS.md`。デプロイは `railway up --service web`（`--service worker` も同様）。

---

## 3. 🔴 これを知らないと必ず詰まること

### 3.1 ビルドとテスト

| 罠 | 内容 |
|---|---|
| 🔴 **`NODE_ENV` を持つシェルでビルドしない** | `NODE_ENV=development` があると `next build` が `/_global-error` の事前生成で `TypeError: Cannot read properties of null (reading 'useContext')` で落ちる（事前生成のワーカーだけが React の development 版を読み、React が 2 つ同居する）。`apps/web/next.config.ts` の門番が変数名を名指しして止める。**必ず `env -u NODE_ENV pnpm --filter @ses/web run build`** |
| 🔴 **`packages/ui` を変えたら `pnpm --filter @ses/ui run build`** | `apps/web` は `dist` を参照する。忘れると変更が反映されない |
| 🔴 **`packages/i18n` にキーを足したら `npx tsc -p packages/i18n/tsconfig.json`** | 忘れると `t()` が `undefined` を返してテストが落ちる |
| 🔴 **`tailwind.css` の `@source '../../../packages/ui/src'` を消さない** | 消すと `@ses/ui` のスタイルが**テストは緑のまま見た目だけ**消える（実測の記録が同ファイルにある） |
| **分離テストは専用の config** | `npx vitest run -c vitest.isolation.config.ts <file>`（既定の `vitest.config.ts` は `tests/isolation/**` を除外している） |
| **テストの基準値**（2026-10-02 時点） | `tests/static/` **1326** / `apps/web` **2586** / `packages` 2393 / `packages/i18n` 25 / 分離 94 ファイル / E2E 14 spec 71 ケース |

### 3.2 この開発機の制約

- 🔴 **メモリの空きが 2〜3 GB しかない。** 別プロダクト（Dify）のコンテナが 16 本動いている（`docker-*` / `sns-*`。**触らないこと**）。本プロジェクトのコンテナは `ses-postgres` / `ses-redis` / `ses-s3mock` / `ses-clamav` / `ses-mailhog` の 5 本。
- したがって **Playwright（`pnpm test:e2e`）と `tests/isolation` の全数はローカルで回せない。** **CI で検証する**（1 周 20 分程度）。
- 長いコマンドはバックグラウンドで実行し、メモリ監視に止められたら**再実行せず CI に委ねる**。

### 3.3 情報境界（これを壊すと取引が切れる）

`CLAUDE.md` §3.1 が一次資料だが、**この刷新で実際に壊れていた / 壊しかけた箇所**を記録する:

- 🔴 **行の高さが内容量で変わると、それ自体が開示項目になる。** `S-016` のスキル列が `sm`〜`lg` で折り返し、**スキル 1 件の候補と 8 件の候補で行の高さが変わっていた** = 匿名 5 項目に加えて「経歴の量」という 6 つ目の開示項目（`1a55389` で修正）。
- 🔴 **「件数」は他社情報の示唆になりうる。** 取引先に出すのは**期限**であって件数ではない（サイドバーの提案依頼バッジ / `SummaryStrip`）。
- 🔴 **ロール別の出し分けは DOM から取り除く。** グレーアウト（`disabled` / `aria-disabled` / `opacity`）で残すのは分離の後退（`BR-44`）。
- 🔴 **ホームに氏名を出さない。** 60 秒ポーリングで `engineer.view` の監査ログが毎分積まれる（`BR-27`）。
- 🔴 **`Drawer` に台帳のエンジニア詳細とスキルシートを含めない。** 一覧をスクロールするだけで監査ログが膨張する。

### 3.4 安全網（刷新の土台。壊すと刷新そのものが成り立たない）

| 仕掛け | 何を守るか |
|---|---|
| `tests/static/support/testid-baseline.ts` | 🔴 **`data-testid` の凍結**（完全一致 1,019 / 接頭辞 210）。`FROZEN_EXACT` 自体を編集すれば緑になる穴が**実在した**ので、別ファイルのベースラインを包含することを検査する形にした。**凍結が編集できるなら凍結ではない** |
| `tests/static/support/i18n-key-baseline.ts` | 文言キーの凍結（2,571 件）。🔴 **値は比較しない**（値は変えてよい） |
| `tests/static/support/ui-ratchet-{baseline,allowlist}.ts` | 🔴 直書きの許可リストと **4 つのラチェット**: ①未使用なら落ちる ②行数が増えたら落ちる ③`baseline` の部分集合でなければ落ちる（新しいファイルを足せない）④段ごとの除外を強制 |
| `tests/static/sidebar-form-css-order.test.ts` | 🔴 **同特異度のクラスの勝敗は生成 CSS の順序だけが決める。** Tailwind のバリアント順が変わると**テストは緑のままサイドバーの形態や行の選択表示が反転する** |
| `tests/static/home-drawer-no-ledger.test.ts` | 台帳への到達禁止。🔴 例外は **2 系統だけ**（`action-queue-read.ts` の取引先の枝 / `summary.ts` の `count` のみ）。**別名束縛と分割代入は例外の対象外**（一度別名に入ると呼び出し形を追えない。この穴が実在した） |

🔴 **刷新の不変条件**: **`data-testid` と文言キーを変えない（値は変えてよい）。** これにより既存の **E2E 71 ケース / render 41 本 / 静的 1326 件**がそのまま回帰検出器になる。変える場合は安全網を失うので、必ず理由を記録する。

### 3.5 デザインシステム

- トークンは **`apps/web/app/tailwind.css` の `@theme static` 1 箇所**（色 27 / 文字 6 / radius 2）。🔴 **`--breakpoint-*` を宣言しない**（独自ブレークポイント禁止。`CLAUDE.md` §13.3）。🔴 **spacing / shadow は宣言しない**（Tailwind 既定を使う）。
- 🔴 **色・サイズ・状態は `variant` / `size` として `packages/ui` が持つ**。`className` は余白・幅・表示の調整だけ（`cn()` は `twMerge` だが、§7.4 の意味を 1 箇所に閉じるため）。
- 🔴 **`cn()` の `extendTailwindMerge` にトークン名を登録する。** 未登録だと `cn('text-cell','text-fg')` が `text-cell` を**黙って捨てる**。
- 🔴 **アイコンは `packages/ui/src/icons.ts` の閉じた写像だけ**（`lucide-react` の import は 1 本。写像に無い名前は型エラー = 比喩アイコンを書けない）。
- 幅は **3 クラス**（`full` / `split` / `prose`）。🔴 **画面ごとの `max-w-*` は禁止**（これが 1920px の死んだ余白の原因だった）。
- `@ses/ui` は **`"."`（サーバ）と `"./client"`（Radix 系）の 2 バレル**。🔴 **`'use client'` は `./client` 側の部品ファイルだけ**（主バレルに付けると主平面の全画面がクライアントへ移る）。

---

## 4. 人間の判断を待っている Issue

🔴 **すべて既定値を置いてあり、回答を待って作業は止めていない**（`CLAUDE.md` §8.6）。

### 4.1 UI 刷新に直結（優先度高）

| # | 内容 | 既定 |
|---|---|---|
| [#79](https://github.com/Festal-KM/SES-Platform/issues/79) | ブランド色の階調 / ダークテーマの可否 | `indigo-700` / 対応しない |
| [#80](https://github.com/Festal-KM/SES-Platform/issues/80) | サイドバーの群名 / ホームの指標 / `focus-visible` の共通化 | 本書の 4 語 / 5 指標 / 許容する |
| [#83](https://github.com/Festal-KM/SES-Platform/issues/83) | 🔴 **`docs/04` §7.1 と §S-016 が矛盾**（候補検索は `xl` で「8 列 + 右パネル」が成立しない。**1680px 以上で初めて成立する**） | §7.1 を格下げし横スクロールを正式な劣化とする |
| [#82](https://github.com/Festal-KM/SES-Platform/issues/82) | `docs/04` §3.1 のサイドバー表が §S-014 と食い違う | 表の側を実装に合わせる |
| [#78](https://github.com/Festal-KM/SES-Platform/issues/78) | 設計ドキュメントの行数上限が実態に合っていない（`docs/04` 3,021 / 上限 2,400。`docs/05` 7,785 / 上限 3,800） | 3,200 / 8,000 に引き上げ |
| [#81](https://github.com/Festal-KM/SES-Platform/issues/81) | 第 1 回リリースを `SP-22` のどこに置くか | 段①〜③ の後 |
| [#77](https://github.com/Festal-KM/SES-Platform/issues/77) | 刷新の方針（**記録。回答待ちではない**） | — |

### 4.2 リリースに直結

| # | 内容 |
|---|---|
| [#74](https://github.com/Festal-KM/SES-Platform/issues/74) | 🔴 **第 1 回リリースに必要な人間の作業 3 件**（コード側は完了。この 3 件がリリース日を決めている） |
| [#19](https://github.com/Festal-KM/SES-Platform/issues/19) | SES 本番アクセス申請に使う共通ドメイン |
| [#12](https://github.com/Festal-KM/SES-Platform/issues/12) | 席単価とプラン別 AI クォータの初期値 |
| [#25](https://github.com/Festal-KM/SES-Platform/issues/25) | `main` ブランチ保護（GitHub Free の非公開リポジトリでは使えない） |
| [#84](https://github.com/Festal-KM/SES-Platform/issues/84) | 🔴 **想定外例外（非 `AppError`）がサーバ側にどこにも記録されない** —— 本番で 500 が出ても原因を追う手段が無い。素朴に `console.error(err)` を足すと例外本文の PII / 単価が漏れる（`CLAUDE.md` §3.2 / §3.5）ため**マスキング方針込みの判断**が要る。既定は「型・コード・スタックのみ出し `err.message` は出さない」。[#74](https://github.com/Festal-KM/SES-Platform/issues/74) の Sentry 導入と同じ判断の中で決めるのが自然 |

### 4.3 その他（31 件）

`gh issue list --repo Festal-KM/SES-Platform --state open` で一覧できる。`decision-needed` = 判断が要る / `assumption` = 既定値で進むが異論を募る。

---

## 5. 先送りにした課題（忘れないための記録）

| 内容 | どこに記録があるか |
|---|---|
| **一覧の並び替えが無い** —— 既存 API に `?sort=` が無く、付けると API の変更になる。`docs/04` §5-13 は並び替えを求めている | `T-22-06` のコミット本文 |
| **`DataTable` に 3 つの口が無い** —— ①行の選択 ②行の直下の詳細行 ③名称セルの行内操作。このため `S-015` / `S-016` / `S-041` / `A-005` / `A-006` は `Table` プリミティブのまま | `T-22-07` / `T-22-08` のコミット本文、`docs/05` §2.3.5 への追記提案 |
| **`A-006` の 2 行ヘッダ**（席数 / 利用中 / 有効）が器で表現できない（`header` が `string` 固定） | `T-22-08` のコミット本文 |
| 🔴 **`capabilities.ts` が `role !== 'VIEWER'` の 1 行** —— `T-16-12` が `PARTNER_VIEWER` を入れた時点で `RESPOND` が有効と判定される。`page-trail.ts` は `endsWith('VIEWER')` で判定しており **2 つの UI ロール表が食い違う** | `apps/web/lib/home/capabilities.ts` のコメント |
| **本番の初期 `PlatformUser` を作る経路が無い** —— リリースのスモークテストがブロックされる | `SP-12` の申し送り |
| **Sentry SDK が未インストール**（環境変数だけ検証している） | 同上 |
| **`AWS_ACCOUNT_ID` が production で突き合わされていない** | 同上 |
| **eslint 10.x への更新**（major。設定の互換性があるため別タスク） | `4f1eb78` のコミット本文 |
| **ワイヤーフレームの再生成**（`S-003` / `S-005` / `S-021` の 3 枚。🔴 **画像生成は 1 枚ごとに課金**） | `docs/04` の `designer` 申し送り 17 |

---

## 6. この刷新の過程で見つかった実害（品質の棚卸しとして残す）

**UI の作業が結果的に欠陥の洗い出しになった。** 同じ種類を次も見つけるために記録する。

| # | 内容 | 教訓 |
|---|---|---|
| 1 | **匿名候補の行の高さがスキル件数で変わっていた** | 🔴 **見た目の性質が情報になる**。開示項目の数え方に「高さ」「並び順」「件数」も含める |
| 2 | **監査ログの検索条件が水和前に消える** —— 制御された入力に React が空を書き戻す。移動中の営業が開いた直後に日付を入れると失われる | E2E の失敗が**実害のあるバグ**を指していることがある。「テストの都合」で片付けない |
| 3 | **台帳への到達を禁じる検査が、分割代入で書けば緑のまま破れた** | 🔴 **例外の判定は「許す形」を列挙する**。`method === null` のような「指定が無ければ通す」は穴になる |
| 4 | **`global-error` が CSS を読んでいなかった** —— ルートレイアウトを置き換えるため親の import が効かない。アプリが一番壊れているときに素の HTML | 「置き換える」部品は親の前提を 1 つも引き継がない |
| 5 | **認証解決が全ページで 2 回走っていた** | 外枠を足すと「各ページが既にやっていること」と二重になる |
| 6 | **Next.js の critical 脆弱性**（本番経路） | `pnpm audit` の赤を「依存の話」として後回しにしない |
| 7 | 🔴 **E2E が 6 日間動いていなかった** —— MinIO のイメージが全レジストリで匿名取得不可になり、E2E ジョブが**起動前に落ちていた**。その間に外枠と動線を 2 本入れていた | 🔴 **CI の赤を「いつもの赤」にしない。** どのジョブがどの理由で落ちているかを毎回見る。ローカルはイメージがキャッシュ済みで通るため**気づけない** |
| 8 | **`docs/04` の節番号の誤記**（主平面の表を §3.3 = 管理平面と書いていた） | 🔴 **タスク文に節番号を写すときは、その節を 1 回開いて確かめる。** 実装エージェントは指示された節を読む |
| 9 | **外枠がサイドバー 224px を足したことで `S-016` の分割レイアウトが成立しなくなった** | 上流の幅の条文は、後から入る共通外枠を織り込んでいないことがある |
| 10 | 🔴 **`T-22-09` がユニットだけ緑の状態でマージされた** —— 追加した `sendingDomainRuntime()` の import が分離テストを 23 件落とし、**さらに `#9` の応答の形を変えたことで E2E も 2 件落としていた**（経路 4 の許可リストと「A1 に A2 が現れない」の検査。2026-10-02 に発覚）。**分離スイートも E2E も CI でしか回らない**ため、どちらも気づかなかった。しかも 500 の理由がログに残らず（→ [#84](https://github.com/Festal-KM/SES-Platform/issues/84)）、原因の見立てを 1 度外した（`summary.ts` の `count` と RLS を疑ったが、ハンドラ本体に 1 行も入っていなかった） | 🔴 **境界領域のタスクで route の import が 1 つ増えたら、該当する `tests/isolation/` の 1 ファイルだけでも回す**（本件は 26 秒）。🔴 **「ユニットが全部緑」は実 DB の保証ではない。** モックが踏まない経路（起動時 DI / RLS / GUC）はユニットでは原理的に落ちない |

---

## 7. 作業の進め方（このプロジェクト固有）

- **1 タスク = 1 回の `/iterate`。** 複数タスクをまとめて渡さない。
- **レビューはリスク基準**（`CLAUDE.md` §8.3）。境界（DB / RLS / 越境 / AI / 外部送信 / 状態機械 / 管理平面）に触るタスクは **`code-reviewer` 1 回だけ**で、🔴 **再レビューはしない**（指摘の修正はオーケストレーターが対象テストで機械確認する）。UI のみ / 文言 / docs / テストのみは**レビュー省略**。
- **コミットはオーケストレーター（メインのセッション）が行う。** サブエージェントはコミットしない。
- 🔴 **サブエージェントに `git stash` / `git checkout -- <file>` / `git restore` を使わせない**（並走しているエージェントの編集を消した事故が実際にあった）。
- **人間への質問は GitHub Issue に起票する。チャットで聞かない**（`CLAUDE.md` §8.6）。🔴 **必ず既定値を置き、回答を待って作業を止めない。**
- **仕様の追加・変更が出たら、実装の前に上流ドキュメントを直す**（`CLAUDE.md` §8.7）。下流だけ直すと、次にエージェントを回した瞬間に古い記述で上書きされる。
- **コミットメッセージには「なぜそうしたか」を書く。** このプロジェクトの判断の多くはコミット本文にしか残らない場所がある。

### コミットの trailer

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017gd8pEqXToQcMoFrnqRr7H
```

---

## 8. よく使うコマンド

```bash
# ビルド（🔴 NODE_ENV を外す）
env -u NODE_ENV pnpm --filter @ses/web run build

# テスト
npx vitest run tests/static/ --maxWorkers=1          # 1326 passed
npx vitest run apps/web --maxWorkers=1               # 2586 passed
npx vitest run -c vitest.isolation.config.ts <file>  # 分離（1 ファイルずつ）
pnpm test:e2e                                        # 🔴 ローカルでは回せない（メモリ）

# 依存の監査（CI と同じコマンド）
pnpm audit --audit-level high

# デモへデプロイ
railway up --service web
railway up --service worker

# CI
gh run list --limit 3 --json headSha,status,conclusion --jq '.[] | "\(.headSha[0:7]) \(.status) \(.conclusion // "-")"'
gh run view <id> --log-failed
```
