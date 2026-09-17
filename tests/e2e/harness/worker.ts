// tests/e2e/harness/worker.ts
// docs/05 §17.6 globalSetup の ⑦「`apps/worker` を起動する」（✅ T-09-11。[Issue #47](https://github.com/Festal-KM/SES-Platform/issues/47)
// の既定値 = 選択肢 1「E2E ハーネス専用の注入口で `demo` 相当のモック台本を配る」）。
//
// ============================================================================
// 🔴 なぜハーネスの**プロセス内**で `startWorkerRuntime` を呼ぶか
// ============================================================================
//   ブラウザ経路の E2E #3 / #4 / #7 / #8 / #9 / #10 は `gate.run`（モック AI で 3 層を判定）と `send.proposal`（モックの
//   メールで送信を確定）が**実際に走る**ことが前提である（docs/05 §11.12 ⑦）。worker は本番と同じ配線
//   （`apps/worker/src/runtime.ts` の `startWorkerRuntime`。`main.ts` が呼ぶのと同じ関数）をそのまま起動し、
//   **配線を書き写さない**（`tests/isolation/worker-runtime.test.ts` と同じ規律。書き写すと main.ts の配線が壊れても
//   E2E だけが緑になる）。別プロセスにしないのは、モックの台本を**値として**渡すためである（環境変数経由の JSON は
//   `parseMockEmailScript` で検証できるが、AI の台本には同等の入口が無く、増やす理由も無い）。
//
// ============================================================================
// 🔴 配る台本（`demo` 相当。Issue #44 の決定を崩さない）
// ============================================================================
//   - AI … `DEMO_MOCK_ANTHROPIC_SCRIPT`（`gate-inspector` の全層 PASS。`packages/ai`）を**明示的に**渡す。
//     `development` の既定応答は無いまま（`resolveMockAiOptions` に枝を足していない）。ゲート FAIL の再現（E2E #4）は
//     台本ではなく**機械的検出**（台帳の既知 PII 値 = エンジニアの実名を本文に書く。`packages/ai/src/gate/examine.ts`）で
//     起こす —— AI が PASS と言っても機械的検出が FAIL を作ることの証明でもある。
//   - メール … 既定は常に `deliver`（台本なし）。E2E #8 の「応答不明」だけは**宛先ドメイン別・試行番号で引く台本**
//     （`E2E_MOCK_EMAIL_SCRIPT_BY_RECIPIENT_DOMAIN`）で再現する。呼び出し順で消費する台本にしないのは、1 プロセスの
//     worker を全 spec が共有するため「何番目の送信が応答不明か」が spec の実行順・絞り込みで変わるからである。
//
// ============================================================================
// 🔴 外向きネットワークの遮断（docs/05 §17.4 / §17.6 ⑥）をこのプロセスにも入れる
// ============================================================================
//   worker は AI とメールという**外部へ出うる 2 つ**を実際に実行する側である。web のプロセスと同じフック
//   （`tests/support/outbound-network-guard.mjs`。実装は 1 箇所）をハーネスのプロセスにも入れ、自己診断が通ってから起動する。
//   「モックが選ばれているから出ない」ではなく「実装が誤っていても出られない」を worker 側でも成立させる。
//   ⚠️ このプロセスは Playwright のメインプロセスでもある。ループバック以外へ出る正当な通信（Docker デーモンは
//   名前付きパイプ / Unix ソケット / 127.0.0.1、ブラウザとの通信はパイプ）は無いので、フックは外さない。
//
// ============================================================================
// 🔴 `send.hold-release` のスケジュールを 1 分に上書きする（E2E #9 の「自動復帰」を待てる長さにする）
// ============================================================================
//   本番の周期は 10 分（`SEND_HOLD_RELEASE_SCHEDULE`）。E2E はテストごとに 120 秒であり、cron の tick を待つには長すぎる。
//   `createBullMqSchedule` は同じ `schedulerId`（= キュー名）への **upsert** なので、worker が登録した直後に同じキューを
//   `* * * * *` で登録し直せばパターンだけが置き換わる。ジョブ本体・`SchedulerRun` の slot 取得・テナントのファンアウト・
//   `send.proposal` の再 enqueue はすべて本番と同じ経路を通る（`now` の注入と同じ趣旨。docs/05 §17.6「時刻」）。
//   🔴 ハンドラを E2E から直接呼ぶ形（配線の書き写し）にしないための選択である。
import process from 'node:process';
import { DEMO_MOCK_ANTHROPIC_SCRIPT } from '@ses/ai';
import { createBullMqSchedule, type BullMqSchedule } from '@ses/connectors/bullmq';
import type { MockEmailStep } from '@ses/connectors';
import { disconnectTenantDb } from '@ses/db';
import { SEND_HOLD_RELEASE_JOB, SEND_HOLD_RELEASE_SCHEDULE } from '../../../apps/worker/src/jobs/index.js';
import { startWorkerRuntime, type WorkerRuntime } from '../../../apps/worker/src/runtime.js';
// 🔴 `@ses/config` をパッケージ名で import しない（`app-env.ts` / `web-server.ts` と同じ理由。実装は同じファイル）。
import { resolveConnectorSelection } from '../../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../../packages/config/src/load-env.js';
import type { RuntimeConfig } from '../../../packages/config/src/startup.js';
import { installOutboundNetworkGuard, isOutboundBlocked } from '../../support/outbound-network-guard.mjs';
import { buildE2eAppEnv } from './app-env.js';
import type { E2eObjectStorage } from './object-storage.js';
import type { E2eDatabase } from './postgres.js';
import type { E2eRedis } from './redis.js';

/**
 * 🔴 E2E #8 用の宛先ドメイン: **試行 1 は応答不明（`UNKNOWN`）、試行 2 以降は届く**。
 *
 * spec はこのドメインの宛先で提案を作れば、`#43` → worker が `SendAttempt(1) = UNKNOWN` + `SUBMIT_FAILED` に確定し、
 * `S-022` → `#44` → worker が seq 2 を送って `SUBMITTED` になる。他のドメイン（`example.test` 等）は常に届く。
 * 合成の値であり実在しない（RFC 6761 の `.test`）。
 */
export const E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN = 'unknown-once.e2e.example.test';

export const E2E_MOCK_EMAIL_SCRIPT_BY_RECIPIENT_DOMAIN: Readonly<Record<string, readonly MockEmailStep[]>> = {
  [E2E_UNKNOWN_ONCE_RECIPIENT_DOMAIN]: [{ kind: 'unknown' }, { kind: 'deliver' }],
};

/** E2E ハーネスが `send.hold-release` に上書きする周期（毎分）。 */
export const E2E_SEND_HOLD_RELEASE_CRON = '* * * * *';

export type E2eWorker = {
  /** 配線したキュー名（起動ログに出す）。 */
  readonly queues: readonly string[];
  readonly stop: () => Promise<void>;
};

/**
 * ハーネスのプロセスに外向き遮断を入れ、自己診断が通ったことを確かめる。
 * 🔴 順序: 遮断 → 起動。逆にすると、遮断が効いていない状態で worker がジョブを拾い始める窓ができる。
 */
function installGuardOrThrow(): void {
  installOutboundNetworkGuard();
  if (!isOutboundBlocked()) {
    throw new Error('[e2e-worker] 外向きネットワークの遮断の自己診断に失敗しました（フックが効いていません）。worker を起動しません。');
  }
}

export async function startE2eWorker(
  database: E2eDatabase,
  objectStorage: E2eObjectStorage,
  redis: E2eRedis,
): Promise<E2eWorker> {
  installGuardOrThrow();

  // 🔴 web と**同じ 1 組**の env（`app-env.ts`）。`initializeRuntimeConfig` は使わない（プロセス内キャッシュを持つ。
  //    `tests/isolation/worker-runtime.test.ts` と同じ判断で、同じ 2 関数から `RuntimeConfig` を組む）。
  const env = loadAppEnv(buildE2eAppEnv(database, objectStorage, redis));
  const config: RuntimeConfig = { env, connectors: resolveConnectorSelection(env) };
  if (config.connectors.ai !== 'mock' || config.connectors.email !== 'mock') {
    // `development` の選択結果が変わったら台本の前提が崩れる。黙って進めない（`startWorkerRuntime` も落とすが、先に名指しで止める）。
    throw new Error(
      `[e2e-worker] development の実装種別が想定と違います（ai=${config.connectors.ai} / email=${config.connectors.email}）。`,
    );
  }

  const runtime: WorkerRuntime = startWorkerRuntime(config, {
    mockAnthropicScript: DEMO_MOCK_ANTHROPIC_SCRIPT,
    mockEmailScriptByRecipientDomain: E2E_MOCK_EMAIL_SCRIPT_BY_RECIPIENT_DOMAIN,
  });
  await runtime.ready;

  // 🔴 worker の登録（10 分）の**後**に同じ schedulerId を upsert して周期だけを置き換える（ファイル冒頭）。
  const holdReleaseSchedule: BullMqSchedule & { readonly ready: Promise<void> } = createBullMqSchedule({
    queueName: SEND_HOLD_RELEASE_JOB,
    connection: { url: redis.url },
    cron: E2E_SEND_HOLD_RELEASE_CRON,
    timeZone: SEND_HOLD_RELEASE_SCHEDULE.timeZone,
  });
  await holdReleaseSchedule.ready;

  let stopped = false;
  return {
    queues: runtime.queues,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      const failures: string[] = [];
      try {
        await holdReleaseSchedule.close();
      } catch (error) {
        failures.push(`send.hold-release の上書きスケジュールの停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await runtime.close();
      } catch (error) {
        failures.push(`worker の停止に失敗: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        // 🔴 `startWorkerRuntime` は DB クライアントを切らない（プロセスに 1 つ。`runtime.ts` の `close()` の注記）。
        //    ハーネスのプロセスでは worker が唯一の利用者なので、ここで切る。
        await disconnectTenantDb();
      } catch (error) {
        failures.push(`DB クライアントの切断に失敗: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (failures.length > 0) process.stderr.write(`${failures.join('\n')}\n`);
    },
  };
}
