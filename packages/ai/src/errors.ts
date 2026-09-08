// packages/ai/src/errors.ts
// AI 層が投げる例外。🔴 いずれも握り潰さない（CLAUDE.md §3.2「パース失敗・API エラーを握り潰さない」）。

import type { AiRole, AiUsageFailureKind } from '@ses/domain';

/**
 * 外部 API 呼び出しが失敗したことを表す**正規化済み**の例外（docs/05 §7.4 / docs/03 §3.3.4）。
 *
 * 🔴 分類は 1 箇所（`normalizeAnthropicError`）でのみ行う。分類が散ると「モックでは再試行するが
 *    実装では再試行しない」といった差が生まれ、どちらの green も根拠にならなくなる。
 * 🔴 `SCHEMA` はここに現れない。スキーマ違反は「応答は返ってきたが内容が不適合」であり、
 *    判定するのは受信後の `outputSchema.safeParse`（`run.ts`）だけである。
 */
export type AiClientErrorKind = Exclude<AiUsageFailureKind, 'SCHEMA'>;

export class AiClientError extends Error {
  readonly kind: AiClientErrorKind;
  /** 429 の `retry-after`（ミリ秒）。無ければ undefined。 */
  readonly retryAfterMs: number | undefined;
  /** HTTP ステータス（分かる場合）。🔴 応答本文は保持しない（プロンプト・PII が混ざりうるため）。 */
  readonly status: number | undefined;

  constructor(
    kind: AiClientErrorKind,
    options: { readonly message?: string; readonly retryAfterMs?: number; readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(options.message ?? `AI クライアントの呼び出しに失敗しました（${kind}）。`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'AiClientError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}

/**
 * 起動時 DI で選ばれた AI クライアントの実装がまだ登録されていない（docs/05 §13.1 / §7.2）。
 *
 * 🔴 **モックへフォールバックしない。** 「未設定ならモック」は
 *    「成功したように見えて実際には呼ばれていない」という最悪の壊れ方を生む（CLAUDE.md §11.1）。
 *    `packages/connectors` の `ConnectorImplementationNotAvailableError` と同じ扱いであり、
 *    起動時に throw して**プロセスを落とす**のが正しい振る舞いである。
 */
export class AiClientNotAvailableError extends Error {
  constructor(
    readonly kind: string,
    detail?: string,
  ) {
    super(
      `AI クライアントの実装種別 '${kind}' はまだ登録されていません。` +
        'モックへのフォールバックは行いません（CLAUDE.md §11.1 / docs/05 §13.1）。' +
        (detail === undefined ? '' : ` ${detail}`),
    );
    this.name = 'AiClientNotAvailableError';
  }
}

/**
 * 🔴 テナント別の「1 日の AI コスト上限」に到達したため**呼び出さなかった**（docs/05 §7.6 / `F-027`）。
 *
 * 🔴 `AiClientError('SPEND_CAP')`（Anthropic 側の月間支出上限で**弾かれた**）と混同しない。
 *    - 本例外 … 呼んでいない。ゲートは `ReviewGate.execution='HELD_AI_COST_LIMIT'` で保持され、
 *      対象は `GATE_RUNNING` のまま（`GATE_FAILED` にしない。`F-027 AC-5`）
 *    - `SPEND_CAP` … 呼んで失敗した。`gate-inspector` なら PII / 商流層は判定不能 = FAIL
 * 🔴 主平面の API 応答には `reasonKey` と `resetAt` だけを載せる（金額は `A-004` にのみ。`F-027 AC-6`）。
 *
 * ⚠️ 投げるのは `AiCostGuard.reserve` の実装（**T-07-04**）である。`runRole` は catch せず伝播させる。
 */
export class AiCostLimitExceededError extends Error {
  readonly resetAt: Date;
  /** 🔴 10 進文字列（IEEE754 で金額を持たない）。運営者向け（`A-004`）にのみ表示する。 */
  readonly limitUsd: string;
  readonly remainingUsd: string;

  constructor(options: { readonly resetAt: Date; readonly limitUsd: string; readonly remainingUsd: string }) {
    super('テナントの 1 日あたりの AI コスト上限に到達しています。');
    this.name = 'AiCostLimitExceededError';
    this.resetAt = options.resetAt;
    this.limitUsd = options.limitUsd;
    this.remainingUsd = options.remainingUsd;
  }
}

/**
 * 🔴 `AiUsage` の記録に失敗した（docs/05 §7.3 の実行時ガード 3）。
 *
 * `runRole` は `ok: false` を返さず **throw する**。記録できない呼び出しを成功として扱うと、
 * `F-026 AC-1`（呼び出し 1 回につき `AiUsage` 1 件）と `F-063`（ロール別原価）が
 * 「だいたい合っている」状態になり、逆ざやの検知（§10.2）が成立しなくなる。
 */
export class AiUsageNotRecordedError extends Error {
  constructor(
    readonly role: AiRole,
    readonly attemptNo: number,
    options: { readonly cause?: unknown } = {},
  ) {
    super(
      `AiUsage の記録に失敗しました（role=${role} / attemptNo=${attemptNo}）。` +
        '記録を経由しない AI 呼び出しは成功として扱いません（docs/05 §7.3 / F-026 AC-1）。',
      { ...(options.cause === undefined ? {} : { cause: options.cause }) },
    );
    this.name = 'AiUsageNotRecordedError';
  }
}
