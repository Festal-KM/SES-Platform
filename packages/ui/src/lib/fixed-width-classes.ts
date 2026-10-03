// packages/ui/src/lib/fixed-width-classes.ts
// 🔴 **「画面の幅ではない実寸」を 1 箇所に持つ**（SP-22 段⑤ = `T-22-14`）。
//
// ============================================================================
// なぜこのファイルが要るのか
// ============================================================================
// 検査 (c)（`tests/static/ui-screen-width.test.ts`）は **`apps/web/app/**` に `max-w-*` が
// 1 件も無いこと**を求め、`packages/ui/src/**` を射程から外している。これは
// 「寸法を持てるのは部品だけ」という規律であり（`components/page-body.tsx` 冒頭の
// 🔴「任意寸法はこのファイルの中だけに存在する」/ `docs/05` §2.3.4）、
// **`apps/web/app/_components/**` に残っていた 2 つの実寸**もその規律に従って
// ここへ移す（段⑤ の対象。移設前は `ui-ratchet-allowlist.ts` の (c) に載っていた）。
//
// 🔴 **これは `PageWidthClass`（`docs/04` §7.1 の 3 クラス = `full` / `split` / `prose`）に
//    4 つ目を足すものではない。** 型は 3 値のままであり、**値も 1px も変えていない**
//    （`max-w-sm` = 24rem / `max-w-68` = 17rem。移設のみ）。
//    「中央寄せのカード」を幅クラスに昇格させるには `docs/04` §7.1 の改訂（= 人間の判断。
//    `CLAUDE.md` §8.6）が要る —— **本ファイルはその判断を先取りしない。**
//
// 🔴 **2 つだけである。増やさない。** 新しい実寸が要るということは、置かれる要素が
//    「画面の幅」でも「部品の寸法」でもない第 3 のものになったという意味であり、
//    そのときは `docs/04` §7.1 / §7.9 の改訂を経る（`lib/control-classes.ts` の
//    `CONTROL_HEIGHT_CLASSES` や `icons.ts` の 2 段と同じ扱い）。
//
// 🔴 **ここは「部品」ではない**（`docs/04` §5-13 のカタログに行を足さない）。
//    `lib/link-classes.ts` / `lib/state-classes.ts` / `lib/control-classes.ts` /
//    `lib/surface-classes.ts` と同じ **クラス定数のモジュール**である。

/**
 * 認証 5 画面（`S-001` / `S-002` / `S-046` / `A-001`）の**中央寄せカード**の実寸（24rem = 384px）。
 *
 * 🔴 **`AppShell` の外側であり、サイドバーの柱が無い。** `docs/04` §7.1 がクラス C に
 *    「中央寄せにしない」と定めた根拠は「柱が左にある構造で視線の起点が画面ごとに動く」
 *    ことであり、柱が無いこの画面には当てはまらない（`apps/web/app/_components/auth-shell.tsx` 冒頭）。
 * 🔴 **この語が消えると入力欄が `prose` の 720px まで伸びる**（`auth-shell.render.test.tsx` が固定）。
 */
export const AUTH_CARD_WIDTH_CLASSES = 'w-full max-w-sm';

/**
 * 2 要素認証の登録ウィザードが出す QR の実寸（上限 17rem = 272px）。
 *
 * 🔴 **画面の幅ではなく図版の寸法である。** `viewBox` だけでは幅が決まらず、寸法指定を
 *    落とすと SVG は親いっぱいに伸びるか潰れて**読み取れなくなる**
 *    （`apps/web/app/_components/otpauth-qr.tsx` 冒頭の移設表）。
 * 🔴 `w-full` と対で持つ（狭い画面でカラムからはみ出さない）/ `h-auto` で縦横比を
 *    `viewBox` に従わせる（潰さない）/ `block` は `<svg>` の既定が inline であるため。
 */
export const QR_FIGURE_CLASSES = 'block h-auto w-full max-w-68';
