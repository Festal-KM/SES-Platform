# SP-21 ui-foundation — Tailwind CSS + shadcn/ui への移行完了と既存 20 画面の整形

> **Phase**: 1（MVP）の実行順の中に差し込む / **前提**: SP-07 / **後続**: SP-08
> 🔴 **番号は 21 だが、実行順は SP-07 の直後（SP-08 の画面タスク着手前）である。** `CLAUDE.md` §8.8 の「削除せず欠番にして参照を安定させる」に従い、既存 SP-08〜SP-20 を振り直さずに採番した結果である（`docs/dev-plan.md` §3.2.1 / `PM-A-09`）。**実行順の一次資料は `docs/dev-plan.md` §4.1 のグラフと §5.1 のタイムラインである。**
> 🔴 **本スプリントは第 1 回リリース（Phase 1 完了 = SP-12 の後。[Issue #46](https://github.com/Festal-KM/SES-Platform/issues/46)）の必須事項である。** 素の CSS のまま顧客が触る画面を出さない（`docs/dev-plan.md` §6.4 R-13。完了の確認は `T-12-11` の受け入れ基準 ⑦）。
> ✅ **受け入れ基準を確定した（2026-09-10。改訂 1）。** [Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43) に人間の回答「**はやく導入して進めなさい**」が届き、**着手が「次」から「最優先」になった**ため、着手直前としていた詳細化をここで済ませた。🔴 **§4 の各タスクの受け入れ基準は、2026-09-10 時点の `apps/web` の実体（§3.1 のインベントリ）に基づいて書いてある。** 実体が動いたら（他タスクが画面を足した等）**着手時にインベントリを取り直す**（数値は §3.1 に更新する。受け入れ基準の考え方は変わらない）。
> **一次資料**: `CLAUDE.md` §2（UI = Tailwind CSS + shadcn/ui。**確定事項**）/ §2.1（依存方向）/ §3.5（文言は `packages/i18n`）/ §13（マルチデバイス）/ [Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43) / `docs/04`（`S-xxx` / `A-xxx` の画面定義と Tier）/ `docs/dev-plan.md` §3.2.1

---

## 1. 目的

🔴 **`CLAUDE.md` §2 が確定事項として定める UI 基盤（Tailwind CSS + shadcn/ui）への移行を完了させ、SP-03〜SP-07 で手書き CSS のまま作った 20 画面を移す。** これは新機能ではなく、**確定事項と実装の差分の解消**である（[Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43)）。

⚠️ **「導入」ではなく「移行の完了」である。** Tailwind v4 と `packages/ui`（`Button` / `Card` / `cn`）は **T-03-06 で既に入っている**（§3.1）。残っているのは、①画面が使う手書き CSS（`globals.css` の `.ses-*` 約 30 セレクタ）②`layout.tsx` が「Tailwind を先に読み、`globals.css` を後勝ちさせる」ことで**見た目を敢えて変えずに温存している暫定**、の 2 つである。

🔴 **いま行う理由は 3 つある。** ①**画面数が少ないうちに入れるほど移行コストが小さい**（SP-08 以降で `S-015`〜`S-018` を手書き CSS で作ると、そのぶんやり直しが増える）②**第 1 回リリースが Phase 1 完了時点になったため、リリース前に必ず終わっていなければならない**（[Issue #46](https://github.com/Festal-KM/SES-Platform/issues/46)）③**人間から「はやく導入して進めなさい」と指示があった**（2026-09-10。[Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43)）。

## 2. 対応機能 ID

**無し（横断。機能 ID を持たない）。** 🔴 **本スプリントは挙動を変えない。** 既存画面の受け入れ基準（`F-001`〜`F-020` 系の AC）は移行後も同じテストで満たされ続けることが要件である。

## 3. 着手条件

| # | 条件 | 状態 |
|---|---|---|
| 1 | [Issue #43](https://github.com/Festal-KM/SES-Platform/issues/43) の配置（SP-07 の後に UI 基盤を差し込む）が覆っていないこと | ✅ **決着（2026-09-10。人間の回答「はやく導入して進めなさい」）。** 配置はそのまま、**優先度が最上位に上がった** |
| 2 | ワイヤーフレーム画像が全 88 枚生成済みであること | ✅ 2026-09-03 に完了（`docs/dev-plan.md` §5 E-15）。**移行対象 20 画面の画像はすべて存在する** |
| 3 | 🔴 **`apps/**` を編集する他タスクとの並走状況を確認すること** | ✅ **2FA の QR 対応は完了・コミット済み（2026-09-10 / `68f2fc2`）** —— 並走しない。🔴 **`T-07-11`（ワーカーの起動配線）とは並走してよい**（触る範囲が重ならない。`docs/dev-plan.md` §4.1）。**着手時に `git status` が clean であることを確認する**（本スプリントは 40 近いファイルに触れるため、未コミット差分と混ざると切り分けができなくなる） |

### 3.1 移行対象の現況インベントリ（2026-09-10 実測）

🔴 **「素の HTML に近い」は正確ではない。実体は「Tailwind が入口だけ入っており、画面は手書き CSS のまま」である。** 受け入れ基準はこの現況を前提に書いてある。

| # | 項目 | 実測値 | 意味 |
|---|---|---|---|
| 1 | Tailwind CSS | ✅ **導入済み（v4）**。`apps/web/app/tailwind.css` = `@import 'tailwindcss';`、`devDependencies` に `tailwindcss` / `@tailwindcss/postcss`（T-03-06 が導入） | 🔴 **本スプリントは「導入」ではなく「移行の完了」である** |
| 2 | 読み込み順 | `apps/web/app/layout.tsx` が **`tailwind.css` → `globals.css` の順**に読み、**後勝ちで手書き CSS を優先**させている（T-03-06 の暫定。「既存ページの見た目を変えない」ため） | 🔴 **この暫定の解消が本スプリントの終点である**（T-21-07） |
| 3 | 手書き CSS | `apps/web/app/globals.css` に **`.ses-*` 系 約 30 セレクタ**。参照している `.tsx` は **38 ファイル** | 移行対象の本体 |
| 4 | インライン `style=` | **0 件**（`apps/web/app/**`） | 🔴 **クラスと CSS だけを直せばよい。** JSX の構造を触る理由が無い |
| 5 | `packages/ui`（`@ses/ui`） | ✅ **存在する**。`Button` / `Card`（+ `CardContent` ほか）/ `cn` のみを export（shadcn/ui の最小取り込み。`class-variance-authority` を使わない版）。`apps/web` の依存に入っている | 🔴 **新設ではなく拡充である** |
| 6 | 依存方向の守り | `eslint.config.mjs` の `PACKAGE_ZONES` に `packages/ui` のゾーンがあり `@ses/db` / `@ses/ai` / `@ses/connectors` を禁止。`tests/static/package-zone-coverage.test.ts` が登録漏れを検査 | 🔴 **既存の守りを緩めない**（`tests/static/client-db-boundary.test.ts` の前提） |
| 7 | 移行対象の画面 | **20 画面**。`S-001` / `S-003`〜`S-014` / `S-035` / `S-036` / `S-041` / `S-046` / `A-001`〜`A-003`（`S-002` は `S-001` の 2FA ウィザードとして同一画面に含まれる） | Tier は §3.2 |
| 8 | `data-testid` | **589 箇所 / 43 ファイル**（実装 + テスト側の参照）。**テンプレートリテラルの動的 testid を含む**（例: `engineer-list-row-${row.id}`） | 🔴 **壊すと回帰検知そのものが消える**（T-21-01 の安全網） |
| 9 | 既存テスト | `*.render.test.tsx` **13 本** / `tests/static/**` **26 本** / `tests/isolation/**` **51 files** / **E2E 35**（desktop 23 + mobile 12） / startup 14 / unit 193 files | **成功の判定はここが 1 件も落ちないこと** |
| 10 | 2FA の QR | `apps/web/app/_components/otpauth-qr.tsx`（2026-09-10 / `68f2fc2`）。**インライン `<svg>`**。寸法は `globals.css` の `.ses-otpauth-qr`（`display:block` / `width:100%` / `max-width:17rem` / `height:auto`）に依存 | 🔴 **整形で潰さない**（T-21-04 の⑤） |
| 11 | 非本番バナー（`F-028` / `S-043`） | **まだ無い。** `layout.tsx` に「T-10-05 の担当であり、ここには置かない」と明記されている | 🔴 **本スプリントで作らない。** 差し込める構造を壊さないだけ（T-21-03 の③） |
| 12 | サインインの経路 | **E2E 35 本すべてが UI 経由でサインインする**（`tests/e2e/support/sessions.ts`。`signin-email` / `signin-password` / `signin-2fa-code` の testid を使う） | 🔴 **`S-001` / `A-001` の testid を 1 つでも壊すと E2E が全滅する** |

### 3.2 画面ごとの Tier（`docs/04` の画面一覧より。移行後も変えない）

| Tier | 画面 | 移行で守ること |
|---|---|---|
| **T1**（モバイル完結） | `S-001` / `S-003` / `S-004` / `S-046` | 🔴 **モバイルで操作まで完結する。省略もデスクトップ誘導もしない** |
| **T2**（モバイル閲覧可） | `S-005` / `S-006` / `S-010` / `S-011` | 🔴 **判断材料を隠さない**（折りたたんでよいのは補助情報のみ） |
| **T3**（デスクトップ主体） | `S-007` / `S-008` / `S-009` / `S-012` / `S-013` / `S-014` / `S-035` / `S-036` / `S-041` / `A-001`〜`A-003` | 🔴 **劣化は許容するが遮断しない。** モバイルで「非表示」にしない |

## 4. タスク一覧

| ID | 概要 | 受け入れ基準（要旨） | 工数 |
|---|---|---|---|
| T-21-01 | **Tailwind の設定確定と移行の安全網** | 🔴 独自ブレークポイント 0 件 + **testid インベントリの凍結**（削除・改名で落ちる） | M |
| T-21-02 | **`packages/ui` の拡充（shadcn/ui の取り込み）** | 画面が要るプリミティブが `@ses/ui` に揃い、**依存方向と文言の規律を崩さない** | M |
| T-21-03 | **共通レイアウトと管理平面の帯の移行** | 🔴 **役割別ナビの出し分けが変わらない**。平面帯が維持される。**非本番バナーのスロットを塞がない** | M |
| T-21-04 | **主平面 16 画面の移行** | 🔴 **差分は見せ方に限る**（testid / 文言 / RSC 境界 / QR を壊さない） | L |
| T-21-05 | **管理平面 3 画面の移行** | 🔴 **表示項目の集合を増やさない**（`BR-40`）。Tier 3 でも遮断しない | M |
| T-21-06 | **モバイル Tier の再検証** | 🔴 **モバイル E2E 12 本が green、判定を緩めない**。T1 が操作まで完結する | M |
| T-21-07 | **手書き CSS の撤去と回帰の確認** | 🔴 **`.ses-*` の className が 0 件**。全テスト green（本数が減っていない）。CI green | S〜M |

🔴 **順序は T-21-01 → T-21-02 → T-21-03 → T-21-04 / T-21-05 → T-21-06 → T-21-07。** 基盤（設定・安全網・共有コンポーネント・レイアウト）を先に置く（`docs/dev-plan.md` §4.3 の「DB → 外部連携 → API → UI → E2E」を UI 内部にも当てはめた形）。🔴 **T-21-01 の安全網を置く前に画面へ触れない** —— 先に触ると「何が壊れたか」を機械的に言えなくなる。

## 5. タスク詳細（受け入れ基準）

🔴 **本スプリントを貫く 1 つの規律**: **挙動を変えない。** 変えてよいのは `className` / CSS ファイル / **見た目のためのラッパ要素の追加**だけである。🔴 **`data-testid` の値・`t()` の呼び出し・フォームの `name` / `id` / `aria-*` / 要素の並び（タブ順）・ルーティング・API 呼び出しを変えない。** 「ついでに直す」を認めない —— 整形と挙動変更が同じコミットに混ざると、**E2E が落ちたときにどちらが原因か切り分けられない**。

### T-21-01 Tailwind の設定確定と移行の安全網（M）

- **実装**: `apps/web/app/tailwind.css` / PostCSS 設定 / `tests/static/tailwind-breakpoints.test.ts`（新設）/ `tests/static/testid-inventory.test.ts`（新設）。
- **受け入れ基準**:
  1. 🔴 **ブレークポイントの独自定義が 0 件である**（`CLAUDE.md` §13.3「Tailwind CSS の既定に従う。独自定義しない」）。静的テストが次を検査する: ①CSS に `--breakpoint-*` の宣言・上書きが無い（Tailwind v4 は `@theme` でこれを行う）②`apps/web/**/*.tsx` と `packages/ui/**/*.tsx` の `className` に **任意値の画面幅バリアント（`min-[…]:` / `max-[…]:`）が現れない** ③使ってよい接頭辞は `sm:` / `md:` / `lg:` / `xl:` / `2xl:` だけである。
  2. 🔴 **`packages/ui` のソースが Tailwind のコンテンツ検出対象に入っており、`@ses/ui` 由来のクラスが本番ビルドで削除されない。** 判定は **`pnpm --filter @ses/web build` の出力 CSS に `@ses/ui` のコンポーネントが使うクラス（例: `bg-slate-900`。`packages/ui/src/components/button.tsx`）が含まれること**。⚠️ **Tailwind v4 の自動コンテンツ検出は `node_modules` を除外する。** pnpm workspace のシンボリックリンク越しの `packages/ui` は拾われないことがあり、**その場合スタイルが本番だけ消える**（`next dev` では気づけない）。**「ローカルで見えている」を根拠にしない。**
  3. 🔴 **`data-testid` インベントリを凍結する。** `apps/web/**/*.tsx`（`*.test.tsx` を除く）から `data-testid` の値を機械的に抽出し（テンプレートリテラルは**静的な接頭辞**で拾う。例 `` `engineer-list-row-${row.id}` `` → `engineer-list-row-`）、現在の集合を静的テストに固定する。**削除・改名があれば落ちる。追加は許す。** 🔴 **これを最初に置く理由**: E2E 35 本と `*.render.test.tsx` 13 本が testid で要素を掴んでおり、**整形で 1 つ落とすとその画面の回帰検知が静かに消える**（テストは「要素が無い」で落ちるとは限らず、条件分岐の下流で通ってしまう経路がある）。**サインインの testid が壊れれば E2E は 35 本すべてが落ちる**（§3.1-12）。
  4. この時点で**見た目は 1px も変わっていない**こと。既存テストが全て green（安全網だけを置いたコミットである）。
- **完了の判定**: 上記 1〜4 + CI green。🔴 **本タスクが green になるまで T-21-03 以降の画面に触れない。**

### T-21-02 `packages/ui` の拡充（shadcn/ui の取り込み）（M）

- **実装**: `packages/ui/src/components/**` と `packages/ui/src/index.ts`。**新設ではなく拡充である**（§3.1-5）。
- **受け入れ基準**:
  1. 🔴 **20 画面の移行に要る共通プリミティブが `@ses/ui` から export され、`apps/web` がそれを使っている。** 出発点は `Input` / `Label` / `Select` / `Textarea` / `Table`（+ 行・セル）/ `Badge` / `Alert` / `Field`（ラベル + 入力 + エラーの組）。**過不足は実装時に調整してよい**が、🔴 **同じ見た目のローカル実装を画面側に 2 つ作らない**（作った瞬間に「片方だけ直る」状態が生まれる）。
  2. 🔴 **依存方向を崩さない**（`CLAUDE.md` §2.1）: `packages/ui` から `apps/*` への import が 0 件。`@ses/db` / `@ses/ai` / `@ses/connectors` を import しない（`eslint.config.mjs` の `PACKAGE_ZONES` の `packages/ui` ゾーン + `tests/static/package-zone-coverage.test.ts`）。🔴 **この禁止は `tests/static/client-db-boundary.test.ts` が「他パッケージへ深追いしない」と決めている前提そのものである**（T-04-06 の P0 再発防止）。**緩めない。**
  3. 🔴 **`'use client'` を必要なコンポーネントだけに付ける。** 状態・イベントハンドラを持たないもの（`Card` / `Badge` / `Table` の器など）はサーバコンポーネントのままにする。**すべてに付けると、サーバ側で描いていた画面が丸ごとクライアントバンドルへ移る。**
  4. 🔴 **`packages/ui` に文言を持たせない**（`CLAUDE.md` §3.5 / `BR-32`）。日本語の固定文言を含む文字列リテラルが 0 件であること（コメントを除く）。**文言は呼び出し側が `packages/i18n` から渡す。**
  5. すべてのコンポーネントが `className` を受け取り `cn()` で合成できる（上書きできないと、結局ローカル実装が生える）。
  6. 既存テストが全て green。**この時点で画面はまだ移行していなくてよい。**
- **完了の判定**: 上記 1〜6 + CI green。

### T-21-03 共通レイアウトと管理平面の帯の移行（M）

- **対象**: `apps/web/app/layout.tsx` / `apps/web/app/admin/layout.tsx` / `(main)` のヘッダとナビゲーション / `globals.css` のレイアウト系クラス（`.ses-auth-layout` / `.ses-plane-band` ほか）。
- **受け入れ基準**:
  1. 🔴 **管理平面の「平面帯」（`.ses-plane-band`。`docs/04` §A-001）が視覚的に維持される。** **主平面と管理平面が一目で見分けられなくなると、代理閲覧・停止操作の誤爆を防ぐ前提が崩れる**（Phase 2 の `F-060` が乗る土台である）。
  2. 🔴 **役割別ナビゲーションの出し分けが 1 つも変わらない**（ホスト / 取引先 / `VIEWER` / 運営者）。**リンクの集合が増減しないこと**を `*.render.test.tsx`（`home-sections.render.test.tsx` ほか）と `tests/e2e/isolation.spec.ts` で確認する。🔴 **見えてはいけない導線を「CSS で隠れているだけ」の状態にしない** —— DOM から取り除く。`hidden` / `display:none` に置き換えたら、それは分離の後退である（`CLAUDE.md` §3.1 / `F-004`）。
  3. 🔴 **非本番バナー（`F-028` / `S-043`）は本スプリントで作らない**（担当は SP-10 の `T-10-05`。§3.1-11）。🔴 **ただし「最上部への固定表示を後から差し込める構造」を壊さない** —— `app/layout.tsx` の `body` 直下に 1 スロットを空けたまま渡す。**ここを詰めると T-10-05 がレイアウトの作り直しから始まる**（`CLAUDE.md` §11.1 は「本番でないことを UI に常時表示する」を求めている）。
  4. `globals.css` のレイアウト系クラスが Tailwind ユーティリティまたは `@ses/ui` に置き換わり、🔴 **`layout.tsx` の「Tailwind → `globals.css` の後勝ち」という暫定（§3.1-2）の解消に向かっていること。** **完全な撤去は T-21-07 が判定する。**
  5. E2E 35 本が green（**サインイン経路を通るため、ここが壊れると全滅する**）。
- **完了の判定**: 上記 1〜5 + CI green。

### T-21-04 主平面 16 画面の移行（L）

- **対象**: `S-001`（サインイン + 2FA ウィザード）/ `S-003` `S-004`（ホーム）/ `S-005`〜`S-009`（エンジニア台帳・詳細・登録編集・スキルシート・スキル辞書）/ `S-010`〜`S-013`（案件一覧・詳細・登録編集・公開範囲）/ `S-014`（取引先企業）/ `S-035`（組織設定）/ `S-036`（送信ドメイン）/ `S-041`（監査ログ）/ `S-046`（パスワード再設定）。
- 🔴 **1 タスクで 16 画面に触れるが、`/iterate` の中では画面単位でコミットを分けてよい。** ただし**完了の判定は 16 画面すべてに対して行う**（半分だけ Tailwind の状態で止めると、`globals.css` を撤去できず T-21-07 に進めない）。
- **受け入れ基準**:
  1. 🔴 **差分は「見せ方」に限る**（§5 冒頭の規律）。変えてよいのは `className` / CSS / ラッパ要素の追加だけ。🔴 **`data-testid` の値・`t()` の呼び出し・`name` / `id` / `aria-*` / 要素の並びを変えない。**
  2. 🔴 **testid インベントリ（T-21-01 の③）が green**（削除・改名 0 件）。
  3. 🔴 **文言のハードコーディングを新たに作らない**（`CLAUDE.md` §3.5）。判定: **ファイル単位で `t(` の呼び出し数が移行前より減っていないこと**（移行前のインベントリと突き合わせる）。⚠️ **減っていたら、その画面のどこかが日本語の直書きに置き換わっている。**
  4. 🔴 **RSC の境界を壊さない**（T-06-01 / T-04-06 で実際に起きた 2 つの壊れ方）:
     - ①**`'use client'` を宣言したモジュールから辿れる「値 import」の閉包に `@ses/db` を入れない**（`tests/static/client-db-boundary.test.ts` が green）。⚠️ **共通化のために定数をサーバ側モジュールから値 import すると、モジュールごとクライアントバンドルへ入り、ブラウザで throw する**（実測: `sqltag is unable to run in this browser environment`）。**型だけを使う場合は `import type` にする。**
     - ②**`loading.tsx` / `error.tsx` を「その画面だけ」を包む位置から動かさない**（`tests/static/route-boundaries.test.ts` が green）。🔴 **見た目の共通化のために親セグメントへ引き上げない** —— 子ルートの `redirect()` が 307 でなくなり（シェルが先に flush される）、**取引先がホスト専用画面からホームへ戻される挙動が JS 待ちになって `tests/e2e/isolation.spec.ts` が落ちる**（実測）。
  5. 🔴 **2FA の QR（`apps/web/app/_components/otpauth-qr.tsx`。2026-09-10 / `68f2fc2`）を潰さない**:
     - ①**インライン `<svg>` のまま**にする。🔴 **`<img>` / 外部 QR 生成 API / CDN / `dangerouslySetInnerHTML` に置き換えない** —— `otpauth://` URL は TOTP のシークレットを含み、外部へ渡すことは**シークレットの第三者送信**にあたる（`CLAUDE.md` §3.5 / §7）。
     - ②`shapeRendering="crispEdges"` を保つ（外すとモジュール境界がぼけて読み取り精度が落ちる）。
     - ③🔴 **`.ses-otpauth-qr` が与えていた寸法（`display:block` / `width:100%` / `max-width:17rem` / `height:auto`）と同等を Tailwind 側で与える。** **`globals.css` を消して寸法指定だけ落とすと、SVG が親いっぱいに伸びるか潰れて読めなくなる**（`viewBox` だけでは幅が決まらない）。
     - ④`apps/web/app/_components/otpauth-qr.render.test.tsx` が green。⑤**符号化できないときに何も描かない**現在の挙動を変えない（`CLAUDE.md` §13.3「劣化はさせても遮断はしない」）。
  6. 既存の `*.render.test.tsx` **13 本**と `tests/isolation/**` **51 files** が **1 件も落ちない**。
  7. 🔴 **`S-013`（公開範囲）と `S-008`（スキルシート）で、出してはならないものを新たに描画しない** —— 取引先向けの射影（`PartnerProjectDetailView` に商流情報のフィールドが無い）や `CLEAN` 以外の共有導線を、整形のついでに増やさない。**表示項目の集合を変えない。**
- **完了の判定**: 上記 1〜7 + CI green。

### T-21-05 管理平面 3 画面の移行（M）

- **対象**: `A-001`（運営者サインイン + 2FA）/ `A-002`（テナント一覧）/ `A-003`（テナント詳細）+ テナント作成フォーム。
- **受け入れ基準**:
  1. T-21-04 の①〜⑤と同じ規律（testid / 文言 / RSC 境界 / QR。**`A-001` の 2FA ウィザードも同じ `OtpauthQr` を使う**）。
  2. 🔴 **平面帯が常時見える**（T-21-03 の①と対）。**運営者コンソールであることが、どの画面でも一目で分かる。**
  3. 🔴 **Tier 3 だがモバイルで遮断しない**（`CLAUDE.md` §13.3）。表の横スクロールは `overflow-x-auto` の**内側**に閉じ、`document.documentElement` の横溢れを出さない（判定は T-21-06）。
  4. 🔴 **表示項目の集合を増やさない**（`BR-40` / `CLAUDE.md` §10.5）。**運営者に見せてはならないもの（エンジニアの氏名・連絡先・スキルシート本文・チャット本文・トークン平文）を、整形の過程で「ついでに」出さない。** 運営者に要るのは件数・状態・エラーであって内容ではない。
  5. `tests/static/admin-tenants-read-only.test.ts` / `tests/static/platform-plane-boundary.test.ts` が green（**管理平面が既定 read-only であることを崩していない**）。
- **完了の判定**: 上記 1〜5 + CI green。

### T-21-06 モバイル Tier の再検証（M）

- **受け入れ基準**:
  1. 🔴 **Tier 1（`S-001` / `S-003` / `S-004` / `S-046`）がモバイルで操作まで完結する**（`CLAUDE.md` §13.2）。**デスクトップ誘導・機能の省略が 1 つも無い。**
  2. 🔴 **Tier 2（`S-005` / `S-006` / `S-010` / `S-011`）で判断材料を隠さない**（§13.3）。折りたたんでよいのは補助情報だけであり、**一覧の識別に要る列・詳細の要件・状態は畳まない**。
  3. 🔴 **Tier 3 をモバイルで「非表示」にしない。** `sm:` 未満で本文コンテナごと消えるユーティリティ（`hidden sm:block` を画面の器に当てる等）を作らない。**劣化は許容するが遮断はしない。**
  4. 🔴 **既存のモバイル E2E 12 本が 1 件も落ちない**（`audit-k7.mobile` 2 / `home.mobile` 2 / `projects.mobile` 5 / `settings.mobile` 3）。🔴 **判定を緩めない** —— `tests/e2e/support/assertions.ts` の `expectNoHorizontalOverflow` の **1px 許容を広げない**、`expectNoHiddenCountHints` のパターンを減らさない。**「移行で溢れたので閾値を上げた」は、このスプリントが防ごうとしている壊し方そのものである。**
  5. 🔴 **モバイル E2E を新規に増やさない**（本スプリントは挙動を変えない）。⚠️ **ただし `S-046`（パスワード再設定。Tier 1）はモバイル E2E も `*.render.test.tsx` も持たない** —— `S-001` / `A-001` は全 E2E がサインイン経路で通るため実質的に検証されるが、`S-046` は通らない。**この 1 画面だけはモバイル幅（375px）での手動確認のスクリーンショットを完了記録に残す。** 🔴 **「テストが無い＝確認しない」にしない。**
  6. **`docs/04` の Tier 割り当て（§3.2）が 1 件も変わっていない。** 変えたくなった場合は `docs/04` の改訂が先である（`CLAUDE.md` §8.7。**本スプリントで変えてはならない**）。
- **完了の判定**: 上記 1〜6 + CI green + `S-046` のスクリーンショット。

### T-21-07 手書き CSS の撤去と回帰の確認（S〜M）

- **受け入れ基準**:
  1. 🔴 **`apps/web/**/*.tsx` に `.ses-` で始まる `className` が 0 件である。** 🔴 **残っているものがあれば、その CSS が消えた瞬間に無言で崩れる**（テストは落ちない。見た目だけが壊れる）。
  2. 🔴 **`apps/web/app/globals.css` からコンポーネント単位のクラス（`.ses-*` 約 30 セレクタ）が消えている。** **残してよいのはベース（`:root` の色変数 / `html, body` のフォントと行間 / `box-sizing`）だけ**であり、それも Tailwind の `@theme` / base に寄せられるなら寄せる。🔴 **残す場合はファイル冒頭に「なぜ残すか」と撤去の見通しを書く**（無言で残さない）。
  3. 🔴 **`layout.tsx` の「Tailwind → `globals.css` の後勝ち」という暫定（§3.1-2）が解消され、その旨のコメントが実態に合わせて直っている。** **コメントだけ古い状態を残さない**（次に読む人が「まだ暫定なのか」を判断できなくなる）。
  4. 🔴 **全テストが green で、かつ本数が減っていない**: unit **193 files 以上** / isolation **51 files 以上** / static **26 本 + 本スプリントの 2 本** / E2E **35**（desktop 23 + mobile 12） / startup 14。🔴 **テストを削って・skip して・緩めて通していないこと**（移行のためにテストを緩めない）。
  5. ⚠️ **`tests/isolation/**` は `dist` 越しに走る。** 実行前に **`pnpm -r build` を挟む**（`docs/05` §11.13 ④。挟まないと防御を壊しても緑のままになる）。**完了記録には「ビルドを挟んだ実行である」ことまで書く。**
  6. 🔴 **CI が green**（[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の**運用 C**。run 番号を記録する。**「CI があるから守られている」と読み替えない**。`docs/dev-plan.md` §6.4 R-05）。
  7. **完了記録に残すもの**: ①移行前後の **testid インベントリの差分（削除 0）** ②`t(` 呼び出し数の差分（減少 0）③**主要 6 画面（`S-001` / `S-003` / `S-005` / `S-011` / `S-041` / `A-002`）× desktop / mobile のスクリーンショット** ④CI の run 番号 ⑤`S-046` のモバイル確認（T-21-06 の⑤）。
  8. **申し送り**: 本スプリントの完了を `docs/dev-plan.md` §8 に記録し、🔴 **`T-12-11` の受け入れ基準 ⑦（第 1 回リリースの条件）から参照できるようにする。**
- **完了の判定**: 上記 1〜8。

## 6. テスト計画（方針）

- 🔴 **振る舞いのテストは 1 本も書かない。** 本スプリントの成功は「**既存のテストが 1 件も落ちないこと**」で測る。**移行のためにテストを緩めない**（緩めた瞬間に、このスプリントが防ごうとしている回帰が素通りする）。
- 🔴 **新設してよいのは「移行の安全網」2 本だけである**（いずれも T-21-01）:
  | 新設するテスト | 何を固定するか | なぜ要るか |
  |---|---|---|
  | `tests/static/testid-inventory.test.ts` | `data-testid` の値（動的なものは静的接頭辞）の集合。**削除・改名で落ちる。追加は通す** | 🔴 **E2E 35 本と `*.render.test.tsx` 13 本が testid で要素を掴んでいる。** 1 つ落とすと回帰検知が静かに消え、**サインインの testid なら E2E が全滅する** |
  | `tests/static/tailwind-breakpoints.test.ts` | `--breakpoint-*` の宣言が無いこと / 任意値の画面幅バリアント（`min-[…]:` / `max-[…]:`）が無いこと | 🔴 `CLAUDE.md` §13.3 の「独自定義しない」を、**レビューの目視ではなく機械で**守る |
- **既存の静的テスト（緩めない）**: `package-zone-coverage`（`packages/ui` のゾーン登録）/ `client-db-boundary`（`'use client'` からの値 import に `@ses/db` が現れない）/ `route-boundaries`（`loading.tsx` / `error.tsx` の位置）/ `admin-tenants-read-only` / `platform-plane-boundary`。
- **ユニット / 結合**: 既存の `*.render.test.tsx`（13 本）と `tests/isolation/**`（51 files）をそのまま使う。⚠️ **isolation は `pnpm -r build` を挟んでから実行する**（`docs/05` §11.13 ④）。
- **E2E**: 既存の desktop 23 + mobile 12 をそのまま使う。🔴 **`.claude/agents/e2e-tester.md` シナリオ #14（モバイルの承認フロー）は Phase 1 の `F-021` 実装が前提であり、本スプリントの時点では存在しない**（`home.mobile.spec.ts` の冒頭注記のとおり、承認画面は SP-09 で作られる）。**本スプリントが守るのは「今あるモバイル 12 本を落とさないこと」であり、#14 を先取りして書かない。**
- **外部 API のモック**: 変更しない（本スプリントは外部連携に触れない）。**送信が 0 件であることの検証（`outbound.assertNone()`）も既存のまま。**

## 7. 完了判定

🔴 **次をすべて満たしたときのみ本スプリントを完了とする。1 つでも欠ければ `PHASE_INCOMPLETE`。**

| # | 条件 | 証跡 |
|---|---|---|
| 1 | 🔴 **ブレークポイントが Tailwind の既定のままである**（独自定義 0 件） | `tests/static/tailwind-breakpoints.test.ts` |
| 2 | 🔴 **`@ses/ui` のクラスが本番ビルドで消えない** | `pnpm --filter @ses/web build` の出力 CSS の確認記録（T-21-01 の②） |
| 3 | 🔴 **`data-testid` の削除・改名が 0 件** | `tests/static/testid-inventory.test.ts` + 移行前後の差分 |
| 4 | 🔴 **20 画面がすべて移行済みで、`*.render.test.tsx` 13 本 / `tests/isolation/**` 51 files / E2E 35（desktop 23 + mobile 12）が green** | CI run 番号（**ビルドを挟んだ実行であること**を明記） |
| 5 | 🔴 **共有コンポーネントが `packages/ui` にあり、依存方向（`apps/*` → `packages/*` の一方向）と `@ses/db` 禁止が崩れていない** | `package-zone-coverage` / `client-db-boundary` |
| 6 | 🔴 **RSC の境界が壊れていない**（`'use client'` からの値 import / `loading.tsx`・`error.tsx` の位置） | `client-db-boundary` / `route-boundaries` |
| 7 | 🔴 **Tier 割り当てが崩れていない** —— T1 がモバイルで操作まで完結し、T3 をモバイルで非表示にしていない | モバイル E2E 12 本 + `S-046` のスクリーンショット |
| 8 | 🔴 **2FA の QR が潰れていない**（インライン SVG のまま / 寸法が保たれている / 外部へ出していない） | `otpauth-qr.render.test.tsx` + サインイン画面のスクリーンショット |
| 9 | 🔴 **文言が `packages/i18n` から供給されたままである**（`t(` の呼び出し数がファイル単位で減っていない） | 移行前後のインベントリ差分 |
| 10 | 🔴 **`.ses-` の className が 0 件で、`globals.css` のコンポーネントクラスが撤去され、`layout.tsx` の暫定コメントが実態に合っている** | T-21-07 の①〜③ |
| 11 | 🔴 **表示項目の集合が増えていない**（特に管理平面。`BR-40`） | `admin-tenants-read-only` / `platform-plane-boundary` + T-21-05 の④ |
| 12 | **CI が green** | run 番号（[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の運用 C。**「CI があるから守られている」と読み替えない**） |
| 13 | **申し送り**: 完了を `docs/dev-plan.md` §8 に記録し、**`T-12-11` の受け入れ基準 ⑦から参照できる** | `docs/dev-plan.md` §8 の行 |

---

## 8. 完了記録（2026-09-11。`MODE: REVIEW` / `TARGET: SP-21` で確認）

### 8.1 タスクの完了（7 / 7）

| タスク | 完了日 | コミット | CI run | 主な成果 |
|---|---|---|---|---|
| T-21-01 | 2026-09-10 | `5ab225a` | `34440590156` | Tailwind の設定確定と移行の安全網。**`@source '../../../packages/ui/src'`**（本番ビルドでの消失の解消）/ `Button` の基底復旧 / `tests/static/testid-inventory.test.ts`（**415 エントリ = 完全一致 + 静的接頭辞**）/ `tests/static/tailwind-breakpoints.test.ts` |
| T-21-02 | 2026-09-10 | `ae5825c` | `34443666743` | `@ses/ui` の拡充 8 種（`Input` / `Label` / `Select` / `Textarea` / `Table` / `Badge` / `Alert` / `Field`）+ `cn()` の規約確定（**競合解決をしないため、競合する上書きは prop にする**） |
| T-21-03 | 2026-09-10 | `1820c9e`（CI success。**run 番号は未記録**） | — | 共通レイアウトと管理平面の帯を Tailwind へ。**基底タイポグラフィ（色 / 行間 / フォント）を `tailwind.css` の `@theme` と `@layer base` へ移設**（読み込み順の暫定を解消可能にした） |
| T-21-04 | 2026-09-10 | `7864b36` | `34457036133` | 主平面 16 画面 + `S-002` の移行（**37 ファイル**）。`Checkbox` / `link-classes` を新設 |
| T-21-05 | 2026-09-10 | `baa1191` | `34460761427` | 管理平面 3 画面の移行 + `Radio` 新設。🔴 **`.ses-*` の className が 0 件になった** |
| T-21-06 | 2026-09-11 | `dc985d3` | （**run 番号は未記録**） | モバイル Tier の再検証（**モバイル E2E 12 本 green** / `S-046` のモバイル 375px スクリーンショット 5 状態） |
| T-21-07 | 2026-09-11 | `75d1634` | 🔴 **`34553246355`（E2E 35 passed）** | `globals.css` の撤去。**スタイルシートが `apps/web/app/tailwind.css` の 1 本だけになった** |

⚠️ **T-21-03 / T-21-06 の CI run 番号が記録されていない**（コミットの CI は success）。**次スプリント以降は 7 タスクすべてで run 番号を残す**（`docs/dev-plan.md` §6.4 R-05 の運用 C は run 単位の確認を求めている。番号が無いと「いつ何が緑だったか」を後から復元できない）。**最終状態の担保は `34553246355` であり、本スプリントの完了判定はこれで足りる。**

### 8.2 §7 の完了判定 13 項目の検証結果（全 OK）

| # | 条件 | 判定 | 証跡（確認した実体） |
|---|---|---|---|
| 1 | ブレークポイントが既定のまま | OK | `tests/static/tailwind-breakpoints.test.ts`（`--breakpoint-*` 宣言 / 任意値バリアント / 既定外接頭辞 / 手書き `@media` の 4 検査 + fixtures による誤検知の対照） |
| 2 | `@ses/ui` のクラスが本番ビルドで消えない | OK | `apps/web/app/tailwind.css:53` の `@source` + 同ファイル冒頭に**着手時の実測**（`hover:bg-slate-700` ほか 0 件 → 追加後 1 件）。静的検査は同テストの「コンテンツ検出」ブロック |
| 3 | `data-testid` の削除・改名 0 件 | OK | `tests/static/testid-inventory.test.ts`（`FROZEN_EXACT` + `FROZEN_PREFIXES` + `UNRESOLVED_ALLOWLIST`。**削除・改名で落ち、追加は通す**）。移行前後で集合一致 |
| 4 | 20 画面が移行済みで render 13 / isolation / E2E 35 が green | OK | `*.render.test.tsx` **13 本**実在 / `tests/isolation/**` **53 files**（51 から減っていない）/ E2E **35**（desktop 23 = `isolation` 19 + `audit-k7` 3 + `projects` 1、mobile 12 = `audit-k7.mobile` 2 + `home.mobile` 2 + `projects.mobile` 5 + `settings.mobile` 3）。🔴 **ビルドを挟んだ実行である**（`.github/workflows/ci.yml` が `build` → `lint` → `typecheck` → `test:unit` → `test:isolation` → `typecheck:e2e` → `test:e2e` を 1 ジョブ直列で回す。`pnpm run test:isolation` 単体はビルドしないため、この順序が `docs/05` §11.13 ④ の要求を満たしている）。**run `34553246355` green** |
| 5 | 共有コンポーネントが `packages/ui` にあり依存方向が崩れていない | OK | `packages/ui/src/index.ts`（12 コンポーネント + `cn` + `link-classes`）/ `eslint.config.mjs` の `PACKAGE_ZONES` に `packages/ui` ゾーン / `packages/ui/src/**` に `apps/` `@ses/db` `@ses/ai` `@ses/connectors` の import 0 件 |
| 6 | RSC の境界が壊れていない | OK | `tests/static/client-db-boundary.test.ts` / `tests/static/route-boundaries.test.ts` が在り CI green。`packages/ui` に `'use client'` ディレクティブ 0 件（**サーバのまま描ける設計を維持**） |
| 7 | Tier 割り当てが崩れていない | OK | モバイル E2E 12 本 green + `tests/e2e/screenshots/S-046-mobile375-*.png` **5 状態**（request / validation-error / confirm / complete / invalid-link）。`docs/04` の Tier は 1 件も変更していない |
| 8 | 2FA の QR が潰れていない | OK | `apps/web/app/_components/otpauth-qr.tsx`（インライン `<svg>` / `shapeRendering="crispEdges"` / 旧 `.ses-otpauth-qr` の 4 宣言を `block w-full max-w-68 h-auto` + `bg-white` へ 1 対 1 で移設 / 符号化不能時は何も描かない）+ `otpauth-qr.render.test.tsx` + `S-001` のスクリーンショット |
| 9 | 文言が `packages/i18n` から供給されたまま | OK | `t(` のファイル単位の減少 **0 件**（合計 **883 → 883**）。補助確認として、`apps/web/app/**/*.tsx` の JSX 直下に日本語テキストが現れない（唯一の一致は render テストの期待値文字列） |
| 10 | `.ses-` の撤去と `layout.tsx` のコメント整合 | OK | `apps/web/**/*.tsx` の `className` に `.ses-` **0 件**（一致するのは移設の経緯を書いたコメントと `skill-aliases-*` の testid のみ）/ `apps/web/app/globals.css` は**存在しない** / `apps/web/app/*.css` は `tailwind.css` の 1 本 / `layout.tsx:5-13` が「暫定は解消済みであり経過状態はもう無い」と実態どおりに書かれている |
| 11 | 表示項目の集合が増えていない | OK | `tests/static/admin-tenants-read-only.test.ts` / `tests/static/platform-plane-boundary.test.ts` が在り CI green |
| 12 | CI が green | OK | run **`34553246355`**（E2E 35 passed）。🔴 **[Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の運用 C の確認記録として残す** —— 機械的強制は未達であり「CI があるから守られている」と読み替えない（`docs/dev-plan.md` §6.4 R-05） |
| 13 | 申し送りが `docs/dev-plan.md` §8 にあり `T-12-11` ⑦ から参照できる | OK | `docs/dev-plan.md` §8 の 2026-09-11 の行 / `docs/sprints/SP-12-phase1-hardening.md` T-12-11 ⑦ からの参照 |

🔴 **静的テストは 26 本 + 本スプリントの 2 本 = 28 本以上という条件に対し、実体は 30 本である**（SP-07 の T-07-10 までで 2 本増えている）。**減っていない。**

### 8.3 🔴 移行のついでに直った実バグ 3 件（**移行前から壊れていたもの**）

🔴 **本スプリントは「挙動を変えない」整形作業だったが、整形の過程で、移行前から壊れていた 3 件が見つかり直った。** **いずれもテストが落ちない壊れ方であり、見た目だけが壊れていた。**

| # | 何が壊れていたか | 見つけたタスク | 原因 | なぜテストで捕まらなかったか |
|---|---|---|---|---|
| 1 | 🔴 **`@ses/ui` のスタイルが本番ビルドでだけ丸ごと消えていた** | T-21-01 | Tailwind v4 の自動コンテンツ検出は起点が `process.cwd()`（= `apps/web`）で `node_modules/` と `dist/` を除外するため、**pnpm のシンボリックリンク越しの `packages/ui` が走査対象外**だった。**10 画面のボタンからホバー・フォーカス・無効状態の見た目が消えていた。** `@source` の明示で解決 | DOM も testid も文言も正しい。**消えるのは CSS だけ**であり、`next dev` でも同じ作業ディレクトリで起きるため「ローカルで見えている」が根拠にならない |
| 2 | 🔴 **`Button` が upstream から `whitespace-nowrap` / `shrink-0` を落として取り込まれていた** | T-21-01 | shadcn/ui の取り込み時に 2 語が欠落。**38px 幅・98px 高のボタン（ラベルが 1 文字ずつ 6 行）** になっていた | 🔴 **最初から壊れていたのに、縦に伸びた当たり判定が Playwright のクリック位置ずれを吸収して E2E が通っていた。** 🔴 **壊れた見た目が、テストを通す方向に働いていた**（§8.5 の検出器の動機そのもの） |
| 3 | 🔴 **`A-014` のラジオが帯いっぱいに伸びていた** | T-21-05 | `globals.css` の `width:auto` の例外が `input[type='checkbox']` **だけ**を対象にしていた。レビュアーが実測で再現（**移行前 736px × 13px / 移行後 16px × 16px**）。**2 つ目の選択肢の当たり判定が 1 つ目の選択肢のテキストの真下**に来ていた | ラジオは存在し、値も送信できるため、DOM ベースの検査では正しく見える |

### 8.4 レビューで差し戻した実バグ 2 件（T-21-04。いずれも修正済み）

🔴 **どちらも「打ち消せない値を基底クラスに焼き込む」という同じ形である。** `cn()` は競合するクラス名を解決しないため（`packages/ui/src/lib/cn.ts` の規律）、**基底に入れた語は呼び出し側の `className` では上書きできない。**

1. **`<tr className="align-top">` の削除** —— 「`vertical-align` は継承されないので死んだ語」と判断して消したが、**UA スタイルシートの `td, th { vertical-align: inherit }` により行から伝播しており、実際に効いていた**。`S-008`（版一覧）と `S-036`（DNS レコード表）で「行を横に読む」作業が崩れていた。→ **`TableRow` / `TableCell` / `TableHead` に `align` prop を追加し、基底から `align-middle` を除去**（`packages/ui/src/components/table.tsx` に実測の 4 通りの表を残した）。
2. **`SECONDARY_LINK_CLASSES` への `mt-4` の焼き込み** —— `flex items-center` の行で**隣のボタンに対して中心が 8px 下にずれ**、`<nav className="mt-4">` の中では**上余白が 32px に二重化**していた。→ **`SECONDARY_LINK_CLASSES` / `SECONDARY_LINK_STACKED_CLASSES` の 2 定数に分割し、呼び出し 38 箇所を文脈で振り分けた。**

### 8.5 🔴 検査式についての発見（T-21-06）— **常設化は次スプリントへ申し送る**

T-21-01 のレビューが申し送った検査式

```js
el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1
```

は、🔴 **§8.3-2（38px 幅・98px 高のボタン）の実害を検出できない。** この式が捉えるのは「枠から溢れて切れている」状態だが、**ラベルは 1 文字ずつ折り返って枠の中に収まっていた**（箱が縦に伸びた）ため `scrollWidth == clientWidth` になる。🔴 **和文は文字単位で改行できるので、この壊れ方では溢れが発生しない。**

代わりに **折り返しそのものを測る判定**で 199 要素を走査し、**4 判定すべて 0 件**だった。

| 判定 | 内容 |
|---|---|
| `wrapped-short-label` | 行ボックス数 3 以上かつラベル 24 文字以内 |
| `one-char-per-line` | 行数 2 以上かつ 1 行 2 文字以下 |

⚠️ **常設化は本スプリントでは見送った** —— §6 の「新設してよいのは安全網 2 本だけ」に抵触し、かつ**初回計測で偽陽性 4 件**が出ており、未調整のまま 12 spec に配線すると既存テストが落ちうるため。🔴 **持ち主を `T-08-11` として起票した**（`docs/sprints/SP-08-anonymous-share.md`）。**無主にしない。**

### 8.6 🔴 `docs/04` §S-005 との既存の食い違い 1 件（**SP-21 由来ではない。`T-05-09` からの差分**）

`docs/04:564` §S-005「デバイス別」はモバイルを「**1 行 = 氏名 + 稼働可能時期 + 主要スキル 2 件の 3 行構成**」と書いているが、実装は同じ 3 項目を **3 列のテーブル**で出し、スキルは上位 3 件 + `+N` である（`apps/web/app/(main)/engineers/engineer-ledger-screen.tsx:4-14` に「一覧はカードで並べない」の理由が記録済み。**根拠は `docs/04` §11-2 であり、`docs/04` の内部で食い違っている**）。

**項目は一致しており Tier（T2）も変わらないため、本スプリントの受け入れ基準には抵触しない。** 🔴 **ただし文書と実装が食い違ったままである。** 🔴 **持ち主を `T-08-10` として起票した**（`CLAUDE.md` §8.7 により**上流（`docs/04`）の改訂が先**。**`T-08-05` が同じ `S-005` に匿名候補を混在させるため、それより前に決着させる**）。

### 8.7 ⚠️ 検証環境について（正直に残す）

🔴 **`T-21-07` の検証で、`pnpm test:isolation` と Playwright E2E は「ローカルで完走できていない」。** 空きメモリ 13.84GB 中 0.68GB（無関係な Docker コンテナ 19 本が稼働していたための環境要因）。**「ローカルで回した」とは書かない。**

🔴 **担保は CI である** —— `.github/workflows/ci.yml` が `build → lint → typecheck → test:unit → test:isolation → typecheck:e2e → test:e2e` を **1 ジョブ直列**で回し、**run `34553246355` が green**（E2E 35 passed）。**§7 #4 / #5 が要求する「ビルドを挟んだ実行」はこの run が満たす**（`pnpm run test:isolation` 自体はビルドしないため、build ステップの先行が要件である）。⚠️ **これは [Issue #25](https://github.com/Festal-KM/SES-Platform/issues/25) の運用 C そのものであり、「CI があるから守られている」と読み替えない。**

### 8.8 申し送り（次スプリント / リリース判定へ）

1. 🔴 **`T-08-10`**（`docs/04` §S-005 の食い違い解消）: **`T-08-05` より前**に実施する。
2. 🔴 **`T-08-11`**（ラベル折り返し検出器の常設化）: `tests/e2e/support/assertions.ts` に `expectNoBrokenLabels(source, page)` を足し、**既存 12 spec から呼ぶ**（テスト本数は増えない）。🔴 **申し送りの `scrollWidth`/`scrollHeight` の式だけを移植してはならない**（§8.5。**その式は §8.3-2 を検出できない**）。
3. **`T-10-05`**（非本番バナー）: `apps/web/app/layout.tsx:36` の `ENVIRONMENT_BANNER_SLOT` を `<EnvironmentBanner />` に置き換えるだけでよい。**スロットは空けたまま渡してある。**
4. 🔴 **2 本目の CSS を足さない / `packages/ui` に文言を持たせない / 基底に打ち消せない値を焼き込まない**（§8.4）。以後の画面タスクはこの 3 つを前提にする。
5. **第 1 回リリース**: 本スプリントの完了は `T-12-11` の受け入れ基準 ⑦ と SP-12 §6 の完了判定 13 の証跡である。
