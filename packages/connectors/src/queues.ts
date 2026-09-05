// packages/connectors/src/queues.ts
// 🔴 キュー定義は**このファイル 1 箇所**に閉じる（docs/05 §9.1 / CLAUDE.md §3.4）。
//
// 🔴 **キューの抽象化レイヤを作らない。** ここにあるのは「名前」と「既定ジョブオプション」の
//    素のデータだけであり、`attempts` の値がソース上にリテラルとして見えていることそのものが
//    「自動リトライを禁止できている」ことの根拠である（`docs/03` program-design 申し送り 7）。
//    ラッパで包むと、その根拠がコードから読めなくなり、静的テストも書けなくなる。
//
// 🔴 BullMQ の `Queue` / `Worker` の実体配線はここに書かない（T-04-03 以降で
//    `apps/worker` が `QUEUE_DEFINITIONS` を読み `new Queue(def.name, { defaultJobOptions: def.defaultJobOptions })`
//    を行う）。`packages/connectors` が BullMQ に依存しないことで、キュー**定義**は
//    Redis が無くてもユニットテスト・静的テストで検査できる。
//
// なぜ `attempts: 1` が絶対なのか（CLAUDE.md §3.4 / §4.2 / §7）:
//   外部への到達が確定した後の再試行は、取引先への二重送信そのものである。
//   `SUBMITTING` / `SENDING` は片道であり、失敗からの復帰は**人間の明示操作のみ**。

/** BullMQ の `BackoffOptions` と構造的に一致する最小の形（内部ジョブ専用）。 */
export type BackoffOptions = {
  readonly type: 'fixed' | 'exponential';
  readonly delay: number;
};

/**
 * 🔴 送信系キューの既定ジョブオプション。**`attempts` はリテラル `1` 固定**。
 *    `attempts: 2` を書くとコンパイルエラーになる（`packages/connectors/src/queues.test.ts` の型テスト）。
 * 🔴 `backoff` は「あってはならない」ことを `undefined` 型で表す（再試行しないのだから
 *    バックオフの設定自体が意味を持たない。設定できると「再試行する気がある」ように読める）。
 */
export type ExternalSendQueueOptions = { attempts: 1; backoff?: undefined };

/**
 * 内部ジョブ（状態遷移・集計・保留の復帰・Webhook 処理など）の既定ジョブオプション。
 * 🔴 上限は 3。すべて「未処理条件」または一意制約で冪等であることが前提（docs/05 §9.10）。
 */
export type InternalQueueOptions = {
  attempts: 1 | 2 | 3;
  backoff?: BackoffOptions;
  /**
   * 🔴 `jobId` を冪等キーに使い同 ID で再 enqueue するキュー（`gate.run`）は `true` にする
   *    （docs/05 §9.1。completed が残ると再 enqueue が静かに捨てられる）。
   */
  removeOnComplete?: boolean;
};

/**
 * 🔴 外部への到達が確定しうる送信ジョブ。**この 3 本だけが `attempts: 1` の対象**である
 *    （docs/05 §9.10「不可」の行）。
 */
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal', 'send.interview-invite', 'send.contract'] as const;

export type ExternalSendJobName = (typeof EXTERNAL_SEND_JOB_NAMES)[number];

/**
 * 内部ジョブの名前。
 *
 * 🔴 `send.hold-release` は `send.` 接頭辞を持つが**外部送信ではない**（保留を再判定して
 *    他のジョブを再 enqueue するだけで、自分では外部 API を呼ばない）。したがって `attempts: 3` でよい。
 *    ⚠️ 「名前が `send.` で始まるか」で自動リトライの可否を決めてはならない。可否は
 *    `EXTERNAL_SEND_JOB_NAMES` に載っているかで決まる。静的テスト
 *    （`tests/static/queue-attempts.test.ts`）が、`send.` 接頭辞を持つ内部ジョブの集合を
 *    スナップショットで固定しており、ここに新しい `send.*` を足すと必ず落ちる。
 */
export const INTERNAL_JOB_NAMES = ['send.hold-release'] as const;

export type InternalJobName = (typeof INTERNAL_JOB_NAMES)[number];

// 🔴 送信系と内部ジョブが同じ名前を持てないことを型で固定する（片方の分類だけを見て
//    `attempts` を決める実装が入り込む余地を消す）。交差があるとこの行がコンパイルエラーになる。
type AssertDisjointJobNames = [Extract<ExternalSendJobName, InternalJobName>] extends [never] ? true : never;
const JOB_NAME_SETS_ARE_DISJOINT: AssertDisjointJobNames = true;
void JOB_NAME_SETS_ARE_DISJOINT;

/**
 * キューの定義（名前 + 既定ジョブオプション）。
 * BullMQ の `Queue` そのものではない —— 実体化は起動時に `apps/worker` が行う。
 */
export type QueueDefinition<N extends string, O> = {
  readonly name: N;
  readonly defaultJobOptions: O;
};

/**
 * 🔴 送信系キューの唯一の作り方。**オプションを引数に取らない**ので、
 *    呼び出し側が `attempts` を上書きする余地が無い。
 */
export function externalSendQueue<N extends ExternalSendJobName>(
  name: N,
): QueueDefinition<N, ExternalSendQueueOptions> {
  return { name, defaultJobOptions: { attempts: 1 } satisfies ExternalSendQueueOptions };
}

/** 内部ジョブのキュー。`attempts` は 1〜3 のみ（型で制限）。 */
export function internalQueue<N extends InternalJobName>(
  name: N,
  defaultJobOptions: InternalQueueOptions,
): QueueDefinition<N, InternalQueueOptions> {
  return { name, defaultJobOptions };
}

/**
 * 🔴 キュー定義の唯一の表。ここに無いキューは存在しない。
 *
 * 本タスク（T-04-01）の射程は「送信系の `attempts: 1` を型と静的テストで固定する」ことなので、
 * 定義するのは送信系 3 本と、その復帰を担う `send.hold-release` である。
 * `email.dispatch` / `account.mail` / `gate.*` / 日次ジョブ等は、それぞれのジョブを実装する
 * タスク（T-04-03 ほか）が**この表に追記する**（別の場所に作らない）。
 */
export const QUEUE_DEFINITIONS = {
  // 🔴 不可（docs/05 §9.10）: 外部への到達が確定した後の再試行は二重送信そのもの。
  'send.proposal': externalSendQueue('send.proposal'),
  'send.interview-invite': externalSendQueue('send.interview-invite'),
  'send.contract': externalSendQueue('send.contract'),
  // 保留の自動復帰（docs/05 §9.4）。外部 API を呼ばないので再試行してよい。
  'send.hold-release': internalQueue('send.hold-release', { attempts: 3 }),
} as const;

export type QueueName = keyof typeof QUEUE_DEFINITIONS;

/** 定義済みのキューを名前で引く（未定義の名前は型で弾かれる）。 */
export function queueDefinition<N extends QueueName>(name: N): (typeof QUEUE_DEFINITIONS)[N] {
  return QUEUE_DEFINITIONS[name];
}
