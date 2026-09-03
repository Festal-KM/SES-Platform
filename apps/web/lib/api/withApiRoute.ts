// apps/web/lib/api/withApiRoute.ts
// docs/05 §6.1「方針」/ §6.2「共通ガード」。T-03-04（SP-03）。
//
// 🔴 **すべて Route Handler。Server Actions を使わない**（docs/05 §6.1 / `P-A-04`）。
//    `F-004 AC-9` /`F-060 AC-3` は「**API を直接呼んでも拒否される**」ことをテストで
//    証明することを要求しており、経路が 1 本でなければ検証できない。
//
// 🔴 本モジュールが引き受けるのは次の 6 つで、**ハンドラ本体に書かせない**:
//    ① 認証コンテキストの解決（`requireTenantCtx`。ハンドラは自前でセッションを読まない）
//    ② 共通ガードの実行（docs/05 §6.2 の**固定順**。`applyGuards` が並べ替える）
//    ③ Zod による境界検証（params / query / body。失敗は 400）
//    ④ 🔴 **分離キーをリクエスト入力に持てないこと**（`CLAUDE.md` §3.1 / `BR-03` /
//       `F-003 AC-1` / `F-004 AC-2`）。スキーマに `tenantId` 等があればルート構築時に落ちる
//    ⑤ `audit` オプション（T-03-05。ハンドラ本体の前に `AuditLog` を書く。docs/05 §16.1）
//    ⑥ 例外 → §15.2 の共通フォーマットへの写像と `x-request-id` の採番
//
// 🔴 実行の順序（①→②→③→監査→ハンドラ）には理由がある:
//    - ①が先 —— 未認証の呼び出しに、スキーマの形（400 のフィールドパス）を教えない。
//    - ②が③より先 —— 権限もテナント状態も満たさない呼び出しの入力を解釈しない。
//      ライフサイクル状態による拒否は**入力の妥当性より優先する**（`F-004` 処理⑤）。
//    - 監査（`audit` オプション）が最後 —— ③までを通過した、実際にハンドラへ渡る入力から
//      対象（`targetType` / `targetId`）を導出できる。記録に失敗したら **ハンドラを呼ばない**
//      （docs/05 §6.1「ハンドラ本体の前に `AuditLog` を書く」/ `F-005` / `F-012 AC-2`）。
//
// 🔴 `audit` オプション（T-03-05。docs/05 §6.1 / §16.1）:
//    - 書き込みは `@ses/db` の `recordAuditLog`（ctx だけで開ける専用トランザクション）**1 本**に
//      委ねる。行の組み立て（`createMany` / `RETURNING` の回避）を二重実装しない
//      （`packages/db/src/audit.ts` の意図的 seam）。
//    - このオプションが開くトランザクションは、ハンドラが別途 `withTenant` で開く業務トランザクションと
//      **別物**である（記録できなければハンドラを呼ばない、が優先原則。詳細は `recordAuditLog` の
//      コメント）。行に紐づく詳細を要する記録は、引き続き業務トランザクション内の `writeAuditLog`
//      （`issueInvitation` 等の既存の意図的 seam）を使う。
import { z } from 'zod';
import {
  recordAuditLog,
  type AuditActorKind,
  type AuditSummary,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { readRequestMeta, requireTenantCtx } from '../auth/session';
import { errorResponse, ValidationError } from './errors';
import { applyGuards, assertGuardDeclaration, type RouteGuard } from './guards';
import { assertNoIsolationKeys } from './isolation-keys';

/** 🔴 全ログ・全応答に載せる相関 ID（docs/05 §16.2）。 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Next.js（App Router）の Route Handler の第 2 引数。
 * 動的セグメントを持たないルートでも渡されるため、両方を受けられる形にしておく。
 */
export type RouteSegmentData = {
  readonly params?: Promise<Record<string, string | readonly string[]>>;
};

export type NextRouteHandler = (
  request: Request,
  segment?: RouteSegmentData,
) => Promise<Response>;

/**
 * ハンドラが受け取るもの。
 * 🔴 `ctx` 以外に分離キーの出所は無い。`params` / `query` / `body` は検証済みの業務入力だけである。
 */
export type RouteInput<TParams, TQuery, TBody> = {
  readonly ctx: AuthenticatedTenantCtx;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  /** 生のリクエスト（ヘッダの参照など）。🔴 ここから分離キーを読まない。 */
  readonly request: Request;
  readonly requestId: string;
};

/**
 * `audit` オプションの `resolve` に渡す入力（docs/05 §16.1）。
 * 🔴 ガード通過後・Zod 検証後の値のみ（`ctx` 以外に分離キーの出所が無いのはハンドラと同じ）。
 */
export type AuditHookInput<TParams, TQuery, TBody> = {
  readonly ctx: AuthenticatedTenantCtx;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly request: Request;
};

/** `resolve` が返す、`AuditLogEntry` のうち呼び出し側が決める部分。 */
export type AuditHookOutcome = {
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly summary: AuditSummary;
  /**
   * 🔴 既定は `actorKind === 'SYSTEM'` なら `null`、それ以外は `ctx.userId`。
   *    `system` が主体でも人間の起点を残したい場合は `summary` に載せる
   *    （docs/05 §16.1 の `summary.requestedBy` と同じ扱い）。ここを明示的に上書きしたい
   *    まれなケースのためだけに存在する。
   */
  readonly actorId?: string | null;
};

/** `audit` オプション本体（docs/05 §6.1 / §16.1）。 */
export type AuditHook<TParams, TQuery, TBody> = {
  /** docs/05 §16.1 の一覧に載っている `action` 名。 */
  readonly action: string;
  /** 既定 `'USER'`。`system` が主体の操作（§16.1 の SYSTEM 行）だけ明示する。 */
  readonly actorKind?: AuditActorKind;
  readonly resolve: (
    input: AuditHookInput<TParams, TQuery, TBody>,
  ) => AuditHookOutcome;
};

export type RouteDefinition<TParams, TQuery, TBody> = {
  /**
   * 🔴 **必須**である（省略可能にしない）。ガードが不要な読み取り専用ルートでも
   *    `guards: []` と書かせ、「掛けるかどうかを考えていない」状態を作らない。
   */
  readonly guards: readonly RouteGuard[];
  /** ルートの識別名（構築時エラーと内部ログに出す。応答には載せない）。 */
  readonly label: string;
  readonly params?: z.ZodType<TParams>;
  readonly query?: z.ZodType<TQuery>;
  readonly body?: z.ZodType<TBody>;
  /**
   * 🔴 指定すると、ハンドラ本体の**前**に `AuditLog` を 1 行書く（docs/05 §6.1 / §16.1）。
   *    記録に失敗したら `handler` を呼ばない（`AuditLogWriteError` → 500 `AUDIT_WRITE_FAILED`）。
   *    `BR-27` の 11 種のうち、ここに載らないもの（閲覧の記録・送信ジョブ内の記録など）は
   *    引き続き `packages/db` の `writeAuditLog` を業務トランザクション内で直接使う。
   */
  readonly audit?: AuditHook<TParams, TQuery, TBody>;
};

/**
 * スキーマのトップレベルのキー。オブジェクトスキーマでなければ `null`。
 * 🔴 `null` は「分離キーの検査ができない」ことを意味するため、構築時に落とす（fail-closed）。
 */
function shapeKeysOf(schema: unknown): readonly string[] | null {
  if (typeof schema !== 'object' || schema === null || !('shape' in schema)) return null;
  const shape = (schema as { readonly shape: unknown }).shape;
  if (typeof shape !== 'object' || shape === null) return null;
  return Object.keys(shape);
}

function assertBoundarySchema(schema: unknown, label: string): void {
  const keys = shapeKeysOf(schema);
  if (keys === null) {
    throw new Error(
      `${label}: params / query / body のスキーマはオブジェクトスキーマである必要があります` +
        '（分離キーの検査ができないため。CLAUDE.md §3.1 / docs/05 §6.1）。',
    );
  }
  assertNoIsolationKeys(keys, label);
}

/** Zod の失敗を §15.2 の `details`（フィールドパスのみ）に写像する。 */
function toValidationError(error: z.ZodError, prefix: string): ValidationError {
  return new ValidationError(
    error.issues.map((issue) => [prefix, ...issue.path.map(String)].filter(Boolean).join('.')),
  );
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, prefix: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw toValidationError(parsed.error, prefix);
  return parsed.data;
}

/**
 * `URLSearchParams` を素のオブジェクトにする。
 * 同じキーが複数回現れたら配列にする（`?state[]=A&state[]=B`）。
 */
export function searchParamsToObject(
  params: URLSearchParams,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return result;
}

/**
 * 応答に相関 ID を載せ（成功・失敗のどちらでも）、キャッシュを既定で禁じる。
 *
 * 🔴 `cache-control: no-store` を**既定**にする理由（`CLAUDE.md` §3.1）:
 *    本 API の応答はすべてテナント境界の内側の値である。経路上のキャッシュが 1 つでも
 *    効くと、あるテナントの応答が別のテナントに返る事故が起こりうる。
 *    ハンドラが明示したヘッダは尊重する（上書きしない）。
 */
function finalizeResponse(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Route Handler を組み立てる（docs/05 §6.1）。
 *
 * 使い方:
 * ```ts
 * export const POST = withApiRoute(
 *   { label: 'POST /api/…', guards: [requireRole(['OWNER','ADMIN']), requireExecutable()], body: schema },
 *   async ({ ctx, body }) => Response.json(await doSomething(ctx, body), { status: 201 }),
 * );
 * ```
 */
export function withApiRoute<TParams = undefined, TQuery = undefined, TBody = undefined>(
  definition: RouteDefinition<TParams, TQuery, TBody>,
  handler: (input: RouteInput<TParams, TQuery, TBody>) => Promise<Response>,
): NextRouteHandler {
  // 🔴 ここはモジュール読み込み時（＝ ビルド / 起動時）に走る。壊れたルート定義が
  //    「呼ばれるまで気づかれない」状態を作らない。
  assertGuardDeclaration(definition.guards, definition.label);
  if (definition.params !== undefined) {
    assertBoundarySchema(definition.params, `${definition.label} params`);
  }
  if (definition.query !== undefined) {
    assertBoundarySchema(definition.query, `${definition.label} query`);
  }
  if (definition.body !== undefined) {
    assertBoundarySchema(definition.body, `${definition.label} body`);
  }

  return async (request: Request, segment?: RouteSegmentData): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      // ① 認証コンテキスト（401 / 403）。🔴 ハンドラは自前でセッションを読まない。
      const ctx = await requireTenantCtx();

      // ② 共通ガード（docs/05 §6.2 の固定順）。
      await applyGuards(ctx, definition.guards);

      // ③ 境界検証（400）。スキーマを宣言しなかった面は `undefined` のまま渡す。
      const rawParams = segment?.params === undefined ? {} : await segment.params;
      const params =
        definition.params === undefined
          ? (undefined as TParams)
          : parseOrThrow(definition.params, rawParams, 'params');
      const query =
        definition.query === undefined
          ? (undefined as TQuery)
          : parseOrThrow(
              definition.query,
              searchParamsToObject(new URL(request.url).searchParams),
              'query',
            );
      const body =
        definition.body === undefined
          ? (undefined as TBody)
          : parseOrThrow(
              definition.body,
              // 本文が無い / JSON でない場合は `null` としてスキーマに判定させる（400）。
              await request.json().catch(() => null),
              'body',
            );

      // ④ 監査（`audit` オプション。ハンドラ本体の前。docs/05 §6.1 / §16.1）。
      //    🔴 記録に失敗したら（`recordAuditLog` が投げたら）ハンドラを呼ばない。
      if (definition.audit !== undefined) {
        const hook = definition.audit;
        const outcome = hook.resolve({ ctx, params, query, body, request });
        const actorKind = hook.actorKind ?? 'USER';
        const meta = await readRequestMeta();
        await recordAuditLog(ctx, {
          action: hook.action,
          actorKind,
          actorId:
            outcome.actorId !== undefined ? outcome.actorId : actorKind === 'SYSTEM' ? null : ctx.userId,
          targetType: outcome.targetType ?? null,
          targetId: outcome.targetId ?? null,
          summary: outcome.summary,
          ipAddress: meta.ipAddress,
          deviceKind: ctx.deviceKind,
        });
      }

      return finalizeResponse(
        await handler({ ctx, params, query, body, request, requestId }),
        requestId,
      );
    } catch (error) {
      // 🔴 例外は 1 箇所で §15.2 の形に写像する。ハンドラ側で catch して握り潰さない。
      return finalizeResponse(errorResponse(error), requestId);
    }
  };
}
