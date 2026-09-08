// tests/isolation/support/redis.ts
// 🔴 結合テスト用の Redis（BullMQ の実挙動を実測するための Testcontainers 起動）。T-07-08。
//
// なぜ実 Redis を立てるのか（偽キューで済ませない理由）:
//   docs/05 §9.10 の再実行手順が守っているのは **BullMQ の仕様そのもの**である ——
//   「同じ `jobId` が待機中・実行中・failed のいずれかに存在する間、`add` は静かに無視される」。
//   偽キューを書くと、その仕様を我々の思い込みで再現することになり、**思い込みが間違っていても
//   テストは緑になる**（実際、`removeOnComplete: true` が要る理由はこの仕様の帰結である）。
//
// 🔴 `bullmq` を直接 import しない（`tests/static/queue-attempts.test.ts` の走査対象）。
//    キューの実体化は `@ses/connectors/bullmq` の 1 ファイルに閉じており、テストもそこを通る。
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/** docker-compose.yml（開発環境）と同じタグに揃える（`CLAUDE.md` §2「Redis / Valkey ^7」）。 */
const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = 6379;

export type IsolationRedis = {
  /** `redis://host:port`。`@ses/connectors/bullmq` の `BullMqConnection` にそのまま渡す。 */
  readonly url: string;
  readonly stop: () => Promise<void>;
};

/**
 * Redis コンテナを起動する。🔴 ホストの 6379 は使わない（ランダムポート）。
 *
 * 🔴 永続化を切ってある（`--appendonly no`）。テスト内で作ったジョブが次回起動に残らないほうが、
 *    「前回の残骸で緑になる / 落ちる」を作らない。
 */
export async function startIsolationRedis(): Promise<IsolationRedis> {
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
