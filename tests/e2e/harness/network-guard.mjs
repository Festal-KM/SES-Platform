// tests/e2e/harness/network-guard.mjs
// 🔴 docs/05 §17.6 globalSetup の ⑥「外向きネットワークの遮断を確認」/ §17.4
//    「実エンドポイントへの発信が 0 件であることを確認する」の**アプリプロセス側の入口**。
//
// アプリのプロセスに `node --import <このファイル>` で**アプリコードより先に**読み込ませ、
// ループバック以外への発信をその場で失敗させる。docs/05 §17.4 は「コンテナのネットワークを
// 外向き遮断（`--network none` 相当）」と書いているが、E2E ではアプリをホスト上のプロセスとして
// 起動する（DB は Testcontainers が割り当てた 127.0.0.1 のランダムポートにある）ため、
// プロセス境界で同じ効果を作る。
//
// 🔴 「モックが呼ばれたこと」ではなく「外に出ていないこと」を見るための仕掛けである。
//    APP_ENV=development ではコネクタがすべてモックに解決される（`resolveConnectorSelection`）が、
//    それは**実装が正しい前提**の検証にすぎない。ここは実装が誤っていても発信を止める。
//
// 🔴 遮断そのものの実装は `tests/support/outbound-network-guard.mjs` に 1 箇所化してある
//    （T-04-10）。結合テスト（`tests/isolation/env-separation.test.ts`）が同じコードで
//    `development` / `demo` / `sandbox` の外部発信 0 件を確かめるためであり、**判定を
//    書き分けない**ことがそのまま「どちらの green も同じ根拠を持つ」ことになる。
//    本ファイルの責務は「起動時に 1 回入れて、自己診断し、目印を出す」だけである。
import process from 'node:process';

import {
  installOutboundNetworkGuard,
  isOutboundBlocked,
  OutboundNetworkBlockedError,
} from '../../support/outbound-network-guard.mjs';

export { OutboundNetworkBlockedError };

/**
 * globalSetup がこの行を待って「遮断が有効である」ことを確認する。
 * 🔴 目印は**起動のたびに globalSetup が生成した値**を環境変数で受け取る。
 *    文字列リテラルを 2 箇所に書くと、片方を変えたときに「待っているのに永久に来ない」
 *    という分かりにくい失敗になる。未設定なら起動を失敗させる（黙って素通りさせない）。
 */
const READY_MARKER = process.env.SES_E2E_GUARD_MARKER;

// 🔴 アプリのプロセスでは**外さない**（復元関数を捨てる）。プロセスの寿命 = 遮断の寿命である。
installOutboundNetworkGuard();

if (!isOutboundBlocked()) {
  process.stderr.write('[e2e-network-guard] 自己診断に失敗しました（フックが効いていません）\n');
  process.exit(1);
}
if (typeof READY_MARKER !== 'string' || READY_MARKER === '') {
  process.stderr.write('[e2e-network-guard] SES_E2E_GUARD_MARKER が未設定です\n');
  process.exit(1);
}
process.stdout.write(`${READY_MARKER}\n`);
