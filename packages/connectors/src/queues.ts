// packages/connectors/src/queues.ts
// 🔴 キュー定義は**このファイル 1 箇所**に閉じる（docs/05 §9.1 / CLAUDE.md §3.4）。
//
// 🔴 **キューの抽象化レイヤを作らない。** ここにあるのは「名前」と「既定ジョブオプション」の
//    素のデータだけであり、`attempts` の値がソース上にリテラルとして見えていることそのものが
//    「自動リトライを禁止できている」ことの根拠である（`docs/03` program-design 申し送り 7）。
//    ラッパで包むと、その根拠がコードから読めなくなり、静的テストも書けなくなる。
//
// 🔴 BullMQ の `Queue` / `Worker` の実体配線はここに書かない（**SP-07** で
//    `apps/worker` が `QUEUE_DEFINITIONS` を読み `new Queue(def.name, { defaultJobOptions: def.defaultJobOptions })`
//    と `new Worker(..., { settings: { backoffStrategy: steppedBackoffDelayMs } })` を行う）。
//    `packages/connectors` が BullMQ に依存しないことで、キュー**定義**は
//    Redis が無くてもユニットテスト・静的テストで検査できる。
//
// なぜ `attempts: 1` が絶対なのか（CLAUDE.md §3.4 / §4.2 / §7）:
//   外部への到達が確定した後の再試行は、取引先への二重送信そのものである。
//   `SUBMITTING` / `SENDING` は片道であり、失敗からの復帰は**人間の明示操作のみ**。

/** BullMQ の `BackoffOptions` と構造的に一致する最小の形（内部ジョブ専用）。 */
export type BackoffOptions =
  | {
      readonly type: 'fixed' | 'exponential';
      readonly delay: number;
    }
  /**
   * 🔴 T-04-03: BullMQ の**カスタム戦略**（`settings.backoffStrategy`）で表現する段階的な待ち時間。
   *
   * docs/05 §9.4 は `email.dispatch` のバックオフを **5s / 30s** と定めるが、これは BullMQ の
   * 組み込み戦略では表現できない（`fixed` は毎回同じ、`exponential` は `delay * 2^(n-1)` なので
   * 5s の次は 10s になる）。組み込みで近似して docs と食い違わせるのではなく、
   * **遅延の表を定義として持ち**、`steppedBackoffDelayMs()` を worker が
   * `settings.backoffStrategy` に渡す（キューの実体化と同じく SP-07 の配線）。
   */
  | {
      readonly type: 'stepped';
      /** 1 回目の再試行・2 回目の再試行 … の待ち時間（ミリ秒）。 */
      readonly delaysMs: readonly [number, ...number[]];
    };

/**
 * `stepped` バックオフの待ち時間を返す純粋関数（BullMQ の `backoffStrategy` の中身）。
 *
 * @param attemptsMade BullMQ が渡す「これまでに試した回数」（1 回目の失敗後は 1）。
 * 🔴 表を超えた回数を要求されたら**最後の値**を返す（0 や `undefined` を返すと即時再試行になる）。
 */
export function steppedBackoffDelayMs(
  attemptsMade: number,
  delaysMs: readonly [number, ...number[]],
): number {
  const index = Math.max(0, Math.min(attemptsMade - 1, delaysMs.length - 1));
  return delaysMs[index] ?? delaysMs[delaysMs.length - 1] ?? 0;
}

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
export const INTERNAL_JOB_NAMES = [
  'send.hold-release',
  // 🔴 T-04-03（docs/05 §9.4）。**`email.dispatch` だけが `attempts: 3` を許される送信**である。
  //    根拠は「宛先が**業務上の外部送信（分類 3 / 4）ではない**」ことであり、その限定は
  //    payload の型（`OperationalMailDispatch`）が担保する（T-05-08 で分類 2 を追加した。
  //    理由は `packages/domain/src/recipient/scope.ts` の `OPERATIONAL_MAIL_RECIPIENT_CLASSES`）。
  //    二重送信そのものは `EmailDispatch.dedupeKey` の `UNIQUE` が止める（再試行しても 1 通）。
  'email.dispatch',
  // 🔴 招待・パスワード再設定。宛先は「招待中の本人 / 本人」に限られる（分類 1 / 2）。
  //    業務上の外部送信を載せる型を持たない（`AccountMailJob.recipientClass`）。
  'account.mail',
  // Webhook 受信後の処理。外部 API を呼ばない（`WebhookDelivery.dedupeKey` + `processedAt` の CAS で冪等）。
  'webhook.process',
  // 🔴 T-04-04（docs/05 §8.3 / §9.9）。**メールを 1 通も送らない**（SES の identity を
  //    作る / 状態を読むだけ）。だから `attempts: 3` を許せる（§9.10「読み取り・作成系。送信ではない」）。
  //    型でも担保されている —— ハンドラの deps は `SesIdentityApi` であり `sendEmail` を持たない。
  'domain.provision',
  'domain.verify',
  'domain.recheck',
  // 🔴 T-05-05（docs/05 §9.6）。**外部への書き込みを 1 つも行わない**（GuardDuty の結果を
  //    受け取って DB を更新するだけ / タグを読むだけ）ので `attempts: 3` を許せる。
  //    冪等性は `FileScanResult` の `UNIQUE(object_key, version_id)` と
  //    `WebhookDelivery.processedAt` の CAS、そして状態遷移の単調性（domain）が担う。
  'scan.apply-result',
  'scan.poll',
  // 🔴 T-07-06（docs/05 §9.3）。品質ゲートの実行。**外部への送信ではない**が
  //    `attempts: 1` である —— 理由は送信系とは別で、**LLM の再試行は `runRole` の内部で
  //    最大 2 回まで行うため**（docs/05 §7.4）。ジョブ単位で再試行すると、マスキングと
  //    プロンプト構築からやり直しになり `AiUsage` が二重に積まれる（原価が実態と合わなくなる）。
  'gate.run',
] as const;

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
 * 🔴 `email.dispatch` の再試行間隔（docs/05 §9.4「バックオフ 5s/30s」）。
 *    `account.mail` も同じ表を使う（どちらも同じ性質の運用メールであり、待ち方を変える理由が無い）。
 */
export const EMAIL_DISPATCH_BACKOFF_DELAYS_MS = [5_000, 30_000] as const;

/**
 * 🔴 キュー定義の唯一の表。ここに無いキューは存在しない。
 *
 * T-04-01 で送信系 3 本と `send.hold-release` を、T-04-03 で運用メール 2 本と
 * `webhook.process` を置いた。`gate.*` / `ai.*` / 日次ジョブ等は、それぞれのジョブを実装する
 * タスクが**この表に追記する**（別の場所に作らない）。
 */
export const QUEUE_DEFINITIONS = {
  // 🔴 不可（docs/05 §9.10）: 外部への到達が確定した後の再試行は二重送信そのもの。
  'send.proposal': externalSendQueue('send.proposal'),
  'send.interview-invite': externalSendQueue('send.interview-invite'),
  'send.contract': externalSendQueue('send.contract'),
  // 保留の自動復帰（docs/05 §9.4）。外部 API を呼ばないので再試行してよい。
  'send.hold-release': internalQueue('send.hold-release', { attempts: 3 }),
  // 🔴 運用メール（docs/05 §9.4 / §9.10「可（限定）」）。`dedupeKey` の `UNIQUE` で冪等。
  'email.dispatch': internalQueue('email.dispatch', {
    attempts: 3,
    backoff: { type: 'stepped', delaysMs: EMAIL_DISPATCH_BACKOFF_DELAYS_MS },
  }),
  'account.mail': internalQueue('account.mail', {
    attempts: 3,
    backoff: { type: 'stepped', delaysMs: EMAIL_DISPATCH_BACKOFF_DELAYS_MS },
  }),
  // Webhook 受信後の処理（docs/05 §9.4）。`WebhookDelivery` の `UNIQUE` + CAS で冪等。
  'webhook.process': internalQueue('webhook.process', {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  }),
  // 🔴 T-04-04（docs/05 §9.9）。送信元ドメインの登録・検証・日次の再確認。
  //    冪等: SES 側は「既にある」を成功として扱い、DB 側は `WHERE state <> 'VERIFIED'` /
  //    `state='VERIFIED'` の条件付き更新である。
  'domain.provision': internalQueue('domain.provision', {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  }),
  'domain.verify': internalQueue('domain.verify', {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  }),
  'domain.recheck': internalQueue('domain.recheck', { attempts: 3 }),
  // 🔴 T-05-05（docs/05 §9.6）。スキャン結果の適用と滞留の保険。
  //    `scan.apply-result` は `webhook.process` と同じ性質（受信済みの行を処理するだけ）なので
  //    同じバックオフにする。`scan.poll` はスケジュール実行（毎 5 分）でありバックオフ不要。
  'scan.apply-result': internalQueue('scan.apply-result', {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  }),
  'scan.poll': internalQueue('scan.poll', { attempts: 3 }),
  // 🔴 T-07-06（docs/05 §9.1 / §9.3）。品質ゲートの実行。
  //    - `attempts: 1` … LLM の再試行は `runRole` の内部で完結する（上記 `INTERNAL_JOB_NAMES` の 🔴）。
  //    - 🔴 `removeOnComplete: true` … **`jobId` を冪等キーに使うキューだから必須**である。
  //      BullMQ は同じ `jobId` が completed / failed セットに残っている間 `add` を無視するため、
  //      HELD（AI 上限で未実行）として**正常終了**した記録が残ると、`gate.hold-release` と
  //      #39 の再 enqueue が**静かに捨てられ**、対象が `GATE_RUNNING` に留まり続ける
  //      （`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」と同型の壊れ方）。
  //    - 🔴 `removeOnFail` は付けない。failed の記録は §16.5 の失敗ジョブ数の根拠であり、
  //      失敗した `gate.run` の再実行（§9.10）は「その failed 記録を消す」ことを手順に含む。
  'gate.run': internalQueue('gate.run', { attempts: 1, removeOnComplete: true }),
} as const;

// ---------------------------------------------------------------------------
// gate.run の冪等キー（docs/05 §9.3 / §9.10。T-07-06）
// ---------------------------------------------------------------------------

/**
 * `gate.run` の payload（docs/05 §9.3）。
 *
 * 🔴 **enqueue 側（`apps/web` の #39 / `gate.hold-release`）と実行側（`apps/worker`）の契約**を
 *    1 箇所に置く（`AccountMailJob` / `DomainJob` と同じ整理）。両側が別々に型を持つと、
 *    片方だけが項目を増やしたときに `jobId` の材料がずれ、**重複排除が静かに効かなくなる**。
 * 🔴 `contentHash` を payload に含めるのは、**その内容を検査したという事実**を
 *    `ReviewGate.contentHash` に残すためである（§11.5。承認 CAS がこの値で一致を見る）。
 */
export type GateRunJob = {
  readonly tenantId: string;
  /** `ReviewGate.targetType`（値集合の出所は `@ses/domain` の `GATE_TARGET_TYPES`）。 */
  readonly targetType: string;
  readonly targetId: string;
  readonly contentHash: string;
};

/** `gate.run` のキュー名（`QUEUE_DEFINITIONS` のキーと同じ。文字列を書き写さない）。 */
export const GATE_RUN_JOB = 'gate.run' satisfies InternalJobName;

/**
 * 🔴 区切り文字（docs/05 §9.3 のスケッチは `:` だったが **`.` に変えた**。T-07-08 / §11.10）。
 *
 * 🔴 **理由は BullMQ の実装制約である**（実測。`bullmq@6` の `Job.validateOptions`）:
 *    カスタム `jobId` に `:` を含められない（Redis のキー名前空間が `bull:{queue}:{id}` の形で
 *    `:` を使うため）。`:` を使うと `add` が例外になり、**レビュー依頼が丸ごと失敗する**。
 * 🔴 意味は 1 ビットも変わらない —— この ID に求められるのは
 *    「(対象種別 × 対象 × 内容) が同じなら同じ文字列」だけであり、区切りの見た目ではない。
 *    **この ID をパースする実装を書かないこと**（`jobId` は不透明な鍵である）。
 */
const GATE_RUN_JOB_ID_SEPARATOR = '.';

/**
 * 🔴 `gate.run` の `jobId`（docs/05 §9.3 / §11.10）。**同一対象・同一内容のゲートを多重化させない。**
 *
 * BullMQ は同じ `jobId` の待機中・実行中ジョブを重複排除する。#39 の手動再実行と
 * `gate.hold-release` の自動再実行が同時に走っても、**キューに乗るのは 1 本**である
 * （確定後の抑止は DB 側 —— 開始時の `execution='DONE'` 行チェックと HELD 完了 CAS。§9.3）。
 *
 * 🔴 **組み立てを 2 箇所に書かない。** 材料の順序が 1 つでも違えば別の `jobId` になり、
 *    重複排除は「書いてあるだけ」になる。
 */
export function gateRunJobId(job: GateRunJobKey): string {
  return [GATE_RUN_JOB, job.targetType, job.targetId, job.contentHash].join(
    GATE_RUN_JOB_ID_SEPARATOR,
  );
}

/** `jobId` を決める材料（対象 1 件 × 内容 1 版）。 */
export type GateRunJobKey = Pick<GateRunJob, 'targetType' | 'targetId' | 'contentHash'>;

/**
 * 🔴 失敗した `gate.run` を消したかどうか（docs/05 §9.10 ②）。T-07-08。
 *
 * - `REMOVED` … `failed` だったので消した（同 `jobId` の再 enqueue が通るようになる）
 * - 🔴 `NOT_FAILED` … `waiting` / `active` だった。**消さない**（走っているものを止めない。
 *   この場合の再 enqueue は BullMQ の重複排除で no-op になる）
 * - `NOT_FOUND` … その `jobId` のジョブが無い（`removeOnComplete: true` で消えている等）
 */
export type GateRunFailedJobRemoval = 'REMOVED' | 'NOT_FAILED' | 'NOT_FOUND';

/**
 * 🔴 `gate.run` の enqueue 側の契約（`apps/web` の #39 と `apps/worker` の
 *    `gate.hold-release` が使う。docs/05 §9.3 / §9.10）。
 *
 * 🔴 **`jobId` を引数に取らない。** 実装が `gateRunJobId(job)` で組み立てるため、
 *    呼び出し側が別の文字列を渡す余地が無い（組み立てが 2 箇所に散ると重複排除が
 *    「書いてあるだけ」になる。`gateRunJobId` の 🔴）。
 * 🔴 **`attempts` / `backoff` を引数に取らない**（既定ジョブオプションは `QUEUE_DEFINITIONS`
 *    だけが決める。§9.1 / §17.2 #6）。
 */
export type GateRunJobQueue = {
  enqueue(job: GateRunJob): Promise<void>;
  /**
   * 🔴 §9.10 ②「**状態が `failed` のときだけ** `Job.remove()`」。
   *    `removeOnFail` を付けていない（§9.1）ため、失敗の記録が残ったままだと
   *    **同じ `jobId` の `add` が静かに捨てられる**（対象が `GATE_RUNNING` に留まり続ける）。
   */
  removeFailedJob(key: GateRunJobKey): Promise<GateRunFailedJobRemoval>;
};

/**
 * 🔴 「消してよいのは `failed` だけ」という規則（docs/05 §9.10 ②）。**判定はここ 1 箇所**である。
 *
 * 実装（BullMQ）はこの関数を通してから `Job.remove()` を呼ぶ。規則を実装の中に
 * インラインで書くと、Redis を立てないと検証できない判断になってしまう。
 *
 * @param state `Job.getState()` の値（未存在は `null`）。BullMQ の `JobState` は
 *        `completed` / `failed` / `active` / `delayed` / `prioritized` / `waiting` /
 *        `waiting-children` と `unknown` を取りうる。
 */
export function shouldRemoveGateRunJob(state: string | null): boolean {
  return state === 'failed';
}

export type QueueName = keyof typeof QUEUE_DEFINITIONS;

/** 定義済みのキューを名前で引く（未定義の名前は型で弾かれる）。 */
export function queueDefinition<N extends QueueName>(name: N): (typeof QUEUE_DEFINITIONS)[N] {
  return QUEUE_DEFINITIONS[name];
}
