// apps/web/lib/shell/app-version.ts
// 🔴 **版表記の唯一の出所**（サイドバー下端。✅ 2026-10-13 / Issue #93 = B）。
//
// 🔴 **文字列を手で書かない。** デザインシステム v1.0 §3.1 は `SES Hub Ver 1.0.0` と例示しているが、
//    画面に書いた版は**更新を忘れた瞬間に嘘になる**（Issue #93 の本文に挙げた懸念そのもの）。
//    したがって `apps/web/package.json` の `version` を 1 つの出所として読む。
// 🔴 **`packages/i18n` に置かない** —— これは文言ではなく**事実の値**である（翻訳の対象ではない）。
import pkg from '../../package.json';

/** 例: `Ver 0.0.0`。🔴 `package.json` を上げれば画面も変わる。 */
export const APP_VERSION_LABEL = `Ver ${pkg.version}`;
