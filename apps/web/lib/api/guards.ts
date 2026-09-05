// apps/web/lib/api/guards.ts
// docs/05 §6.2「共通ガード（呼ぶ順序が決まっている）」。T-03-04（SP-03）。
//
// 🔴 ガードは**宣言**であり、実行順は宣言順ではない。
//    docs/05 §6.2 は 5 本のガードを「呼ぶ順序が決まっている」ものとして定義している。
//    順序を「ハンドラがその順に書く」ことで守らせると、書き間違いが検出できない
//    （しかも間違いは 500 ではなく「別のエラーコードが返る」形で静かに現れる）。
//    そこで本モジュールは各ガードに `stage` を持たせ、`applyGuards` が **`GUARD_STAGES` の順に
//    並べ替えてから実行する**。ルート側の配列の並びを間違えても、実行順は変わらない。
//
// 🔴 なぜ順序が意味を持つか（どれを先に返すかで漏れる情報が変わる）:
//    ① `requireRole` が最初 —— 権限の無いロールに、テナントが停止中か / 解約手続き中かを
//       教えない。ロールの判定は認証コンテキストだけで閉じており、何も漏らさない。
//    ② `requireExecutable` が `requireNotViewer` より先 —— テナントの状態は
//       **ロールの権限より優先する**（`F-004` 処理⑤ / `AC-7`）。`VIEWER` にだけ先に 403 を
//       返すと、「ロールを上げれば実行できる」と読める応答になる。
//    ③ 送信ドメイン・電子署名の接続（SP-04 / SP-17）は最後 —— 実行してよい相手かが
//       決まってから、外部へ出せる状態かを見る。
//
// 🔴 `requireExecutable` は `F-004` と同じ経路に置く（docs/05 §6.2 / `docs/03` 申し送り 11-①）。
//    ロールごとの分岐に散らすと `SUSPENDED` の抜け穴になる。実行系の Route Handler は
//    例外なくこれを通し、`tests/static/execute-guard.test.ts` が全ルートを AST で走査する。
import type { AuthenticatedTenantCtx, TenantLifecycleState, TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
import { sendingDomainRuntime } from '../db/bootstrap';
import {
  evaluateSendingDomain,
  type SendingDomainResolver,
} from '../settings/sending-domains';
import {
  ForbiddenError,
  PartnerCompanySuspendedError,
  SendingDomainNotVerifiedError,
  TenantNotExecutableError,
  ViewerNotAllowedError,
} from './errors';

/**
 * 🔴 docs/05 §6.2 のガード 5 本。**この配列の順序が実行順である。**
 *
 * 末尾 2 本は枠だけを予約している（実装は SP-04 / SP-17）。
 * 🔴 「まだ実装が無いガード」を no-op の関数として置かない —— 呼べば必ず通る関数は、
 *    掛けたつもりで掛かっていない状態を作る（`CLAUDE.md` §11.1 の
 *    「成功したように見えて実際には起きていない」と同じ壊れ方）。実装が入る時点で
 *    `requireVerifiedSendingDomain` / `requireEsignConnection` を**新たに export し**、
 *    ここに追記するのではなく既にある stage を使う。
 */
export const GUARD_STAGES = [
  /** `requireRole` — 403 `ForbiddenError`。 */
  'role',
  /** `requireExecutable` — 409 `TenantNotExecutableError`。🔴 テナント状態ゲート。 */
  'executable',
  /** `requireNotViewer` — 403 `ViewerNotAllowedError`（`BR-31` / `F-004 AC-6`）。 */
  'notViewer',
  /** `requireVerifiedSendingDomain` — 422。**SP-04 で実装する**（docs/05 §8.3）。 */
  'verifiedSendingDomain',
  /** `requireEsignConnection` — 409。**SP-17 で実装する**（docs/05 §8.4）。 */
  'esignConnection',
] as const;

export type GuardStage = (typeof GUARD_STAGES)[number];

/** 🔴 本タスクで実装済みの stage。未実装の stage を宣言したルートは構築時に落とす。 */
export const IMPLEMENTED_GUARD_STAGES = [
  'role',
  'executable',
  'notViewer',
  // 🔴 T-04-05 で実装（docs/05 §8.3 / `BR-51` / `F-022 AC-7`）。
  'verifiedSendingDomain',
] as const satisfies readonly GuardStage[];

/**
 * ルートが宣言するガード 1 本。
 * 🔴 `run` は**認証コンテキストしか受け取らない**（`CLAUDE.md` §3.1 / `BR-03`）。
 *    リクエストの body / query / path を判定材料にできない構造にする。
 */
export type RouteGuard = {
  readonly stage: GuardStage;
  readonly run: (ctx: AuthenticatedTenantCtx) => void | Promise<void>;
};

function stageIndex(stage: GuardStage): number {
  return GUARD_STAGES.indexOf(stage);
}

/**
 * ロールで拒否する（docs/05 §6.2 / `F-004 AC-2`）。
 * 🔴 判定材料は `ctx.role`（＝ `memberships` の行）だけである。セッションの主張でも
 *    リクエスト入力でもない（`loadTenantMembership` が毎リクエスト DB から確定する）。
 */
export function requireRole(allowed: readonly TenantRole[]): RouteGuard {
  if (allowed.length === 0) {
    // 誰も通れないガードは、書き間違い以外にあり得ない（構築時に落とす）。
    throw new Error('requireRole: 許可ロールが空です（docs/05 §6.2）。');
  }
  return {
    stage: 'role',
    run: (ctx) => {
      if (!allowed.includes(ctx.role)) throw new ForbiddenError();
    },
  };
}

/**
 * 🔴 テナントのライフサイクル状態ごとの実行可否（`CLAUDE.md` §4.2 / `docs/02` 章 5.4 /
 *    `F-004 AC-7`〜`AC-9`）。**値は「拒否理由の文言キー」、`null` は実行可**。
 *
 * 🔴 `Record<TenantLifecycleState, …>` にしているため、状態が増えたらコンパイルが落ちる。
 *    列挙漏れが「その状態だけ素通り」にならない（fail-closed）。
 *
 * 🔴 `SUSPENDED` も拒否側に置いてある。**判定の完成は `T-20-05`** であり本スプリントの
 *    完了判定に `F-004 AC-7` は含めない（`ACTIVE` → `SUSPENDED` を起こす管理平面の操作が
 *    Phase 3 にあるため、Phase 0 では到達不能）。それでも許可側に置かないのは、
 *    到達不能な状態を「実行可」と書いた表を残すと、Phase 3 で停止機能を足した瞬間に
 *    **停止が効かないテナント**ができるためである（安全側に倒す）。
 */
const LIFECYCLE_EXECUTION_DENIAL = {
  // 見込み客が自分のデータで試す場（`CLAUDE.md` §11）。挙動は本番と同じ。
  SANDBOX: null,
  ACTIVE: null,
  SUSPENDED: 'error.tenant.suspended',
  CLOSING: 'error.tenant.closing',
  PURGED: 'error.tenant.purged',
} as const satisfies Record<TenantLifecycleState, MessageKey | null>;

/** テナントの状態が実行系を許すか（純粋関数。ユニットテストが全状態を固定する）。 */
export function executionDenialMessageKey(state: TenantLifecycleState): MessageKey | null {
  return LIFECYCLE_EXECUTION_DENIAL[state];
}

/**
 * 🔴 実行系のテナント状態ゲート（docs/05 §6.2 / `F-004 AC-7`〜`AC-9`）。409。
 *
 * 🔴 **閲覧・エクスポートにこのガードを掛けてはならない。** `CLOSING` では
 *    「閲覧と返却（エクスポート）のみ実行できる」（`F-004 AC-8` / `F-064 AC-5`）。
 *    ダウンロード / エクスポートに要るのは `requireNotViewer` であって本ガードではない。
 *
 * 🔴 `ctx.lifecycleState` はセッションに焼き込まれていない。`loadTenantMembership` が
 *    毎リクエスト `tenants` から読むため、遷移は**次のリクエストから**効く。
 *
 * 🔴 T-04-07: **取引先企業の停止（`F-007 AC-2`）も本ガードが見る。**「実行できるか」を
 *    決める停止の軸は 2 つある（テナントのライフサイクル / 所属取引先の停止）が、
 *    ガードを分けない —— docs/05 §6.2 が `requireExecutable` について書いている
 *    「ロールごとの分岐に散らすと `SUSPENDED` の抜け穴になる」は取引先の停止にもそのまま当てはまり、
 *    別のガードにすると**掛け忘れたルートだけ停止が効かない**状態ができる。
 *    本ガードに同居させることで、`tests/static/execute-guard.test.ts`（実行系ルート全数走査）が
 *    そのまま取引先停止の網羅も担保する（新しい実行系ルートは自動的に対象に入る）。
 *
 * 🔴 判定の順序（テナント → 取引先）にも理由がある: テナントが `CLOSING` / `PURGED` なら、
 *    取引先の停止状態を問わず結論は同じであり、**より広い停止**を先に返すほうが
 *    利用者の次の行動（誰に解除を依頼するか）が正しく決まる。
 */
export function requireExecutable(): RouteGuard {
  return {
    stage: 'executable',
    run: (ctx) => {
      const messageKey = executionDenialMessageKey(ctx.lifecycleState);
      if (messageKey !== null) {
        throw new TenantNotExecutableError(ctx.lifecycleState, messageKey);
      }
      // 🔴 `partnerSuspendedAt` はホスト所属では必ず `null`（`resolveTenantCtx` の不変条件）。
      //    したがってこの判定はパートナー所属の利用者にだけ効く。
      if (ctx.partnerSuspendedAt !== null) throw new PartnerCompanySuspendedError();
    },
  };
}

/**
 * 🔴 `VIEWER` の実行系（承認 / 送信 / ダウンロード / エクスポート）を拒否する
 *    （`BR-31` / `F-004 AC-6`）。403。
 *
 * 画面の導線を隠すだけでは足りない（`F-004 AC-9`「API を直接呼んでも拒否される」）。
 */
export function requireNotViewer(): RouteGuard {
  return {
    stage: 'notViewer',
    run: (ctx) => {
      if (ctx.role === 'VIEWER') throw new ViewerNotAllowedError();
    },
  };
}

/**
 * 🔴 送信元の独自ドメインが検証済みであることを要求する（docs/05 §6.2 / §8.3 / `BR-51` /
 *    `BR-71` / `F-001 AC-4` / `F-022 AC-7` / `F-047 AC-7`）。422。T-04-05。
 *
 * 🔴 **掛ける先は「取引先へ届く送信」だけ**である（docs/05 §8.3 の「対象」）:
 *    `F-007`（取引先招待の**送達**）/ `F-022`（提案送信 #43）/ `F-041`（面談調整）/
 *    `F-047`（契約書のメール送付 #60 `via='EMAIL'`）。
 *    🔴 **`F-002`（自社メンバーの招待）・`F-003` などホスト宛・運営者宛には掛けない**
 *    （共通ドメインで送ってよい。`F-001 AC-5`。掛けると、ドメイン未設定のテナントが
 *    自社の管理者すら招けなくなり、開設フローが完了不能になる）。
 *    🔴 **`F-049`（電子署名依頼）にも掛けない** —— メールを送るのは電子署名サービスであり
 *    テナントの SES を通らない（前提条件は `requireEsignConnection`。`F-049 AC-8`）。
 *
 * 🔴 **`#14`（招待の発行）にはこのガードを掛けない。** `F-007 AC-5` は
 *    「招待そのものは作成できるが、送達は検証完了後」と定めており、422 で拒否すると
 *    招待を作ることすらできなくなる。#14 は同じ判定（`evaluateSendingDomain`）を使って
 *    `deliveryState='HELD_DOMAIN_UNVERIFIED'` を返す（`lib/invitations/service.ts`）。
 *
 * 🔴 未検証は**障害ではなく設定未了**である。呼び出し側は状態を進めてはならない
 *    （`Proposal` は `APPROVED` のまま、`Contract` は `DRAFT` のまま）。ガードは
 *    Route Handler の**本体より前**に走るので、状態を進める余地がそもそも無い。
 *
 * 🔴 `resolve` を差し替え可能にしてあるのはテストのためだけである。**既定値を
 *    「常に通す」実装にしない** —— 掛けたつもりで掛かっていない状態を作らないため、
 *    既定は必ず DB を見る実装である（`CLAUDE.md` §11.1）。
 */
export function requireVerifiedSendingDomain(deps?: {
  readonly resolve: SendingDomainResolver;
}): RouteGuard {
  const resolve = deps?.resolve ?? defaultSendingDomainResolver;
  return {
    stage: 'verifiedSendingDomain',
    run: async (ctx) => {
      const requirement = await resolve(ctx);
      if (requirement.kind === 'UNVERIFIED') {
        throw new SendingDomainNotVerifiedError(requirement.detail);
      }
    },
  };
}

/**
 * 判定の実体（`lib/settings/sending-domains.ts` の `evaluateSendingDomain`）。
 * 🔴 **ここで `APP_ENV` を分岐しない。** 環境差（`sandbox` / `demo` / `development` は
 *    共通ドメインで動く）は `sendingDomainRuntime()` が起動時に解決済みである
 *    （`CLAUDE.md` §11.1 / docs/05 §13.1）。
 */
export type { SendingDomainResolver };

const defaultSendingDomainResolver: SendingDomainResolver = async (ctx) =>
  evaluateSendingDomain(ctx, sendingDomainRuntime());

/**
 * 🔴 ガードの宣言が破綻していないことを**ルート構築時**（モジュール読み込み時）に確かめる。
 *    リクエスト時ではないのは、壊れたルートが「たまたま呼ばれるまで気づかれない」状態を
 *    作らないためである（`pnpm build` / import の時点で落ちる）。
 */
export function assertGuardDeclaration(guards: readonly RouteGuard[], label: string): void {
  const seen = new Set<GuardStage>();
  for (const guard of guards) {
    if (!(GUARD_STAGES as readonly string[]).includes(guard.stage)) {
      throw new Error(`${label}: 未知のガード stage です（${String(guard.stage)}）。`);
    }
    if (!(IMPLEMENTED_GUARD_STAGES as readonly string[]).includes(guard.stage)) {
      throw new Error(
        `${label}: ガード stage '${guard.stage}' は未実装です（SP-04 / SP-17）。` +
          '実装が入るまでルートに宣言しないでください（docs/05 §6.2）。',
      );
    }
    if (seen.has(guard.stage)) {
      // 同じ stage を 2 回宣言すると「どちらが効いているか」が読めなくなる。
      throw new Error(`${label}: ガード stage '${guard.stage}' が重複しています。`);
    }
    seen.add(guard.stage);
  }
}

/**
 * 🔴 ガードを **`GUARD_STAGES` の順に**実行する（docs/05 §6.2）。
 *    引数の配列の並びは結果に影響しない。
 */
export async function applyGuards(
  ctx: AuthenticatedTenantCtx,
  guards: readonly RouteGuard[],
): Promise<void> {
  const ordered = [...guards].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));
  for (const guard of ordered) {
    await guard.run(ctx);
  }
}
