// tests/static/support/ui-ratchet-allowlist.ts
// 🔴 **UI 刷新の許可リスト（`docs/05` §17.7.2 ①）。** ファイル単位 + 理由 + どの段で外すか。
//
// ============================================================================
// このファイルの編集の仕方
// ============================================================================
// 🔴 **削るだけである。**
//   - 段② が `S-005` を刷新したら、`S-005` のファイルをここから削る（`SP-22` §4.1 の表）。
//     削り忘れれば ② の「未使用の許可が残っていない」で落ちる —— **掃除の完了は機械が確かめる**。
//   - 🔴 **足せない。** キーは `ui-ratchet-baseline.ts` の部分集合でなければならず（④）、
//     baseline は 2026-09-30 の実体で凍結されている。
//   - 段は `SECTION_4_1_STAGES`（`SP-22` §4.1 の写し）と一致しなければ落ちる（①）。
// 🔴 **対象は「ファイル」であって「クラス」ではない**（`docs/05` §17.7.2）。「この色だけは許す」を
//    作らないため。恒久例外は `AppShell` の `pb-24` の 1 件だけで、それは
//    `ui-spacing-scale.test.ts` の `PERMANENT_SPACING_EXCEPTION` に理由つきで置く。
//
// ✅ 🔴 **段⑤（最終。管理平面 `/admin` + `app/_components/**` + `S-038` のメーター。2026-10-03）で
//    外したもの**: **62 エントリ = 許可リストの全部**である。🔴 **これで 6 本すべての
//    許可リストが空になり、(a)(b)(c)(f)(g)(j)(k) の 7 検査が「許可リスト無しで」無条件 green に
//    なった**（`SP-22` §4.1 段⑤ / `T-22-15` の完了条件の 1 つ目）。
//
//    内訳（対象 21 ファイル）:
//      - 管理平面 `apps/web/app/admin/**` の **58**（`A-001` / `A-003` / `A-004` / `A-010` /
//        `A-012` / `A-014` / `/admin` のホーム / 平面帯 / 横並びタブ / 主体表示）
//      - `apps/web/app/_components/**` の **3**（`auth-shell.tsx` の `max-w-sm` /
//        `otpauth-qr.tsx` の `max-w-68` と `bg-white`）
//      - `apps/web/app/(main)/settings/usage/usage-screen.tsx` の **1**（`S-038` のメーターの塗り幅）
//
//    🔴 **どう外したか（検査を緩めた箇所は 1 つも無い）**:
//      ① **`S-038` のメーターの塗り幅** —— `packages/ui` に **`Meter`（`docs/04` §5-13 の
//         26 部品目）** を新設して移した。塗りの幅は**データ由来の割合**であり、寸法を持てる層は
//         部品だけである（検査 (c) が `apps/web/app/**` を射程にし `packages/ui` を外しているのは
//         そのため）。**`A-004`（運営者の利用量）も同じ 1 実装を使う** ——
//         2 つ目が生えないことは `ui-primitive-single-impl.test.ts` の `SINGLE_IMPL_COMPONENTS`
//         （`Meter` を追加）が機械で止める。
//      ② **認証カードの `max-w-sm` と QR の `max-w-68`** —— `packages/ui` の
//         `lib/fixed-width-classes.ts`（`AUTH_CARD_WIDTH_CLASSES` / `QR_FIGURE_CLASSES`）へ移した。
//         🔴 **`PageWidthClass` に 4 つ目を足していない**（型は `full` / `split` / `prose` の
//         3 値のまま）。**値も 1px も変えていない**（`auth-shell.render.test.tsx` が `max-w-sm` の
//         実在を固定している）。「中央寄せのカード」を幅クラスへ昇格させるのは `docs/04` §7.1 の
//         改訂（= 人間の判断。`CLAUDE.md` §8.6）であり、**そこは先取りしていない**。
//      ③ **`bg-white`** → `bg-bg`（`--color-bg: var(--color-white)`。**値は同じ白**）。
//         面（`bg-surface`）は使っていない（面を持てるのは `packages/ui` の部品だけ）。
//      ④ **管理平面の平面帯の濃紺（`bg-slate-800` / `text-slate-50`）** → 無彩色の淡い帯
//         （`bg-bg-inset` + `border-b` + `text-fg`）。🔴 **`docs/04` §7.9 は「濃色の面は
//         サイドバー 1 部品だけ」と定めており**、2 つ目の濃色の面を増やすには §7.9 の改訂が要る。
//         §3.3-1 は「**色でなく『帯という構造の有無』で区別する**」と定めているので、
//         帯そのものは 1 文字も変えていない（経緯は `app/admin/layout.tsx` 冒頭）。
//      ⑤ **`hover:underline`（検査 (j)）** → `packages/ui` の共通語
//         （`SECONDARY_LINK_CLASSES` / `FOCUS_RING_CLASSES` / `TRANSITION_CLASSES`）。
//      ⑥ **`max-w-3xl` / `max-w-5xl` / `max-w-6xl` / `max-w-xl`（検査 (c)(k)）** →
//         `PageBody` の幅 3 クラス。🔴 **`widthClass` は 1 画面に 1 回**なので、
//         `A-003` / `A-010` / `A-012` は**器を 1 つに畳み、分岐は中身だけ**にした。
//
//    ⚠️ **検出器にかからない書き方（変数名を変えて `width` の語を消す / `transform: scaleX()` /
//       `w-68` に逃げる / 許可リストの行を残す）は 1 つも使っていない** —— それは検査を
//       無効にすることと同じである（段④ が同じ理由でこの 1 件を残した）。
//
// ✅ **段④ の第 4 弾（設定まわり・スキル辞書・認証。2026-10-03）で外したもの**:
//    `settings/**` の **31** / `skills/**` の **5** / `(auth)/**` の **22** / `_shared/**` の **4**
//    = **計 61 エントリ**（対象 24 ファイル。
//    検査別の内訳は **(a) 色 19 / (c) 幅 10 / (f) spacing 3 / (g) 文字サイズ 19 / (k) 幅クラス 10**）。
//    🔴 この弾の時点で `apps/web/app/(main)/**` の許可は (c) の 1 件だけになり、
//    `app/_components/**` の 3 件と管理平面の 58 件とあわせた **62 件が段⑤ に残った**
//    （上の ✅ がその 62 件の処理である）。
//
// ✅ **段④ の第 3 弾（提案まわり。2026-10-03）で外したもの**: `proposals/**` と
//    `proposal-requests/**` の **17 ファイル**
//    （`proposal-requests/{page,proposal-request-screen}.tsx` /
//    `proposal-requests/[id]/{page,not-found,proposal-request-respond-screen}.tsx` /
//    `proposals/[id]/{page,not-found,proposal-detail-screen}.tsx` /
//    `proposals/[id]/approve/{page,not-found,proposal-approval-screen}.tsx` /
//    `proposals/[id]/edit/{page,not-found}.tsx` /
//    `proposals/[id]/interview/{page,not-found,proposal-interview-screen}.tsx` /
//    `proposals/_editor/proposal-editor.tsx` / `proposals/new/page.tsx` /
//    `proposals/send-failures/{page,error,loading,send-failure-screen}.tsx`）を
//    (a) 15 / (c) 15 / (f) 5 / (g) 15 / (k) 8 = **計 58 エントリ**削除した。
//    🔴 **これで `proposals/**` と `proposal-requests/**` の許可は 0 件である**
//    （`grep "(main)/proposal" ` で残るのは本コメントだけ）。
//    ⚠️ `proposals/(list)/**`（`S-019`）は **`T-22-06` の時点で既に 0 件**であり、本弾で削るものは
//       無かった（本弾では `S-019` の状態バッジを `StatusBadge` に寄せただけである）。
//
// ✅ **段④ の第 2 弾（人材管理。2026-10-03）で外したもの**: `engineers/**` の 10 ファイル
//    （`engineers/[id]/{page,detail-section,engineer-proposal-sections,not-found}.tsx` /
//    `engineers/[id]/edit/{page,not-found}.tsx` /
//    `engineers/[id]/skill-sheets/{page,skill-sheet-screen}.tsx` /
//    `engineers/_form/engineer-form.tsx` / `engineers/new/page.tsx`）を
//    (a) 8 / (c) 7 / (g) 8 / (k) 4 = **計 27 エントリ**削除した。
//    🔴 **これで `engineers/**` の許可は 0 件である**（`grep "(main)/engineers/" ` で残るのは本コメントだけ）。
//    ⚠️ `engineer-shares/**` は **`T-22-07` の時点で既に 0 件**であり、本弾で削るものは無かった。
//    ⚠️ `S-007` / `S-008` でやったのは**トークンの置き換えと幅クラスの移設だけ**であり、
//       画面の構成（セクション・列・導線）は 1 つも変えていない（刷新そのものは `T-22-12`）。
//
// ✅ **段④ の第 1 弾（案件管理。2026-10-03）で外したもの**: `projects/**` の 9 ファイル
//    （`projects/[id]/{page,project-detail-screen,not-found}.tsx` /
//    `projects/[id]/edit/{page,not-found}.tsx` /
//    `projects/[id]/visibility/{page,visibility-screen}.tsx` /
//    `projects/_form/project-form.tsx` / `projects/new/page.tsx`）を
//    (a)(c)(f)(g)(k) の 5 本から**計 23 エントリ**削除した。
//    🔴 **これで `projects/**` の許可は 0 件である**（`grep "projects/" ` で残るのは本コメントだけ）。
//    ⚠️ `S-011` / `S-012` / `S-013` でやったのは**トークンの置き換えと幅クラスの移設だけ**であり、
//       画面の構成（セクション・列・導線）は 1 つも変えていない（刷新そのものは `T-22-12`）。
//
// ✅ **`T-22-09`（段③ = ホーム）で外したもの**: `S-003` / `S-004` の 3 ファイル
//    （`(main)/page.tsx` / `_home/home-sections.tsx` / `_home/action-queue-section.tsx`）を
//    (a)(c)(g)(j)(k) の 5 本から**計 7 エントリ**削除した。🔴 **これで段③ の項目は 6 本すべて空である。**
//    `lib/home/**` は `.ts` であり、クラス名を走査する 5 検査の対象（`.tsx`）ではないため元から載っていない。
//
// ✅ **`T-22-08`（段② の一覧 ③ = 段② の締め）で外したもの**: `A-002` / `A-005` / `A-006` の 8 ファイル
//    （`admin/tenants/{page,admin-tenants-list}.tsx` /
//    `admin/monitoring/{page,admin-monitoring-view,admin-monitoring-items}.tsx` /
//    `admin/audit-logs/{page,admin-audit-logs-view,admin-audit-logs-results}.tsx`）を
//    (a)(c)(g)(j)(k) の 5 本から**計 27 エントリ**削除した。🔴 **これで段② の項目は 6 本すべて空である。**
//
// ✅ **`T-22-07`（段② の一覧 ②）で外したもの**: `S-015` / `S-016` / `S-041` の 7 ファイル
//    （`audit-logs/{audit-log-detail,audit-logs-view,page}.tsx` /
//    `engineer-shares/{engineer-share-screen,page}.tsx` /
//    `projects/[id]/candidates/{candidate-screen,page}.tsx`）を
//    (a)(c)(f)(g)(j)(k) の 6 本から削除した。段② の残りは `A-002` / `A-005` / `A-006`（`T-22-08`）である。
//
// ✅ **`T-22-06`（段② の一覧 ①）で外したもの**: `S-005` / `S-010` / `S-019` の 12 ファイル
//    （`engineers/(list)/{error,loading,page}.tsx` + `engineers/engineer-ledger-screen.tsx` /
//    `projects/(list)/{error,loading,page}.tsx` + `projects/project-list-screen.tsx` /
//    `proposals/(list)/{error,loading,page,proposal-list-screen}.tsx`）を
//    (a)(c)(f)(g)(j)(k) の 6 本から削除した。段② の残りは `S-015` / `S-016` / `S-041`（`T-22-07`）と
//    `A-002` / `A-005` / `A-006`（`T-22-08`）である。
import type { AllowEntry } from './ui-ratchet.js';

/**
 * (a) 色の直書き — 着手時 93 ファイル / 1007 行。
 * 🔴 段が進むごとに削る。空になった時点で (a) 色の直書き は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_A: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

/**
 * (b) プリミティブの二重実装（③）— 着手時 1 ファイル / 1 行。
 * ✅ **`T-22-05` で空になった。** `AppShell` は `packages/ui/src/components/app-shell.tsx` に在り、
 *    `apps/web/app/(main)/_shell/` に残っているのは**値の組み立てだけ**（`main-shell.tsx` /
 *    `page-heading.tsx`）である。🔴 **これで (b) は無条件 green である**（`SP-22` §4.1 段①）。
 *    以後、画面側に `AppShell` / `PageHeader` / `DataTable` / `Drawer` / `EmptyState` / `Skeleton` /
 *    `Toast` / `StatusBadge` を**宣言**するソースは 1 つも作れない。
 */
export const UI_RATCHET_ALLOWLIST_B: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([]);

/**
 * (c) 画面の幅指定 — 着手時 67 ファイル / 78 行。
 * 🔴 段が進むごとに削る。空になった時点で (c) 画面の幅指定 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_C: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

/**
 * (f) spacing 7 段 — 着手時 19 ファイル / 26 行。
 * 🔴 段が進むごとに削る。空になった時点で (f) spacing 7 段 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_F: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

/**
 * (g) 文字サイズ 6 トークン — 着手時 90 ファイル / 667 行。
 * 🔴 段が進むごとに削る。空になった時点で (g) 文字サイズ 6 トークン は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_G: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

/**
 * (j) 8 状態のバリアント — 着手時 18 ファイル / 30 行。
 * 🔴 段が進むごとに削る。空になった時点で (j) 8 状態のバリアント は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_J: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

/**
 * (k) 幅クラスの網羅 — 着手時 43 ファイル / 43 行。
 * 🔴 段が進むごとに削る。空になった時点で (k) 幅クラスの網羅 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_K: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 🔴 **空である**（段① 〜 段⑤ ですべて外した）。`describeRatchetInvariants` の ②（未使用の
  //    許可が残っていない）と、各検査の本体（許可リスト外に違反が 0 件）が**無条件**で成立する。
  // 🔴 **ここに行を足せない**（④ が凍結集合の部分集合であることを要求し、凍結は 2026-09-30 の実体で
  //    止まっている）。新しい画面は最初から semantic トークン / 7 段 / 6 トークン /
  //    `PageBody` の幅 3 クラスで書く。
]);

