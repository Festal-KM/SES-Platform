// tests/e2e/harness/redis.ts
// docs/05 §17.6 globalSetup ①「コンテナ起動（PostgreSQL / Redis / MinIO / MailHog / ClamAV）」の Redis。T-09-06。
//
// 🔴 なぜここで Redis を足すか: T-09-06 で `S-021` の primary が「送信する」（#43）になり、#43 は `send.proposal` を
//    **BullMQ（Redis）に積む**（`lib/db/bootstrap.ts` の `configureSendProposalJobQueue`。`gate.run` と同じく環境で分岐しない）。
//    Redis が無いと #43 は接続待ちで応答せず、ブラウザ経路の E2E が「送信する」を押せない。
//    `tests/isolation/support/redis.ts` と同じイメージ・同じ起動方法（ランダムポート / 永続化なし）。
//
// ✅ T-09-11: **worker はハーネスのプロセス内で起動する**（`harness/worker.ts`。globalSetup ⑦。Issue #47 の既定値 = 選択肢 1）。
//    積まれた `gate.run` / `send.proposal` は E2E の中で消費され、ゲートの確定・送信の確定（`SUBMITTED` / `SUBMIT_FAILED` / 保留）が
//    ブラウザ経路で起きる（`proposal-cycle.spec.ts` / `home.mobile.spec.ts`）。
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = 6379;

export type E2eRedis = {
  /** `redis://host:port`。アプリの `REDIS_URL` にそのまま渡す。 */
  readonly url: string;
  readonly stop: () => Promise<void>;
};

export async function startE2eRedis(): Promise<E2eRedis> {
  const container: StartedTestContainer = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(REDIS_PORT)
    .withCommand(['redis-server', '--appendonly', 'no'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  return {
    url: `redis://${container.getHost()}:${String(container.getMappedPort(REDIS_PORT))}`,
    stop: async () => {
      await container.stop();
    },
  };
}
