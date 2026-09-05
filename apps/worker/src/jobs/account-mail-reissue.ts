// apps/worker/src/jobs/account-mail-reissue.ts
// 🔴 `send.hold-release` の `reissueAccountMail` seam の**実体**（docs/05 §8.3 の復帰手順 /
//    §9.4 の `send.hold-release`）。T-04-05。
//
// ============================================================================
// 🔴 このファイルが担う 1 つのこと
// ============================================================================
// 保留（`HELD_DOMAIN_UNVERIFIED` / `HELD_PROVIDER_QUOTA`）に入った `account.mail` 由来の行は、
// **平文トークンが payload（Redis）と共に消えている**（docs/05 §9.4 / §16.2）。DB には
// `sha256(token)` しか無く平文は復元できないので、「保留していたメールをあとで送る」ことは
// **原理的にできない**。復帰は新しいトークンを発行して**新しい 1 通を作る**ことでしか行えない。
//
// ============================================================================
// 🔴 順序（1 つでも入れ替えると事故になる）
// ============================================================================
//   ① `dedupeKey` から `kind` / `targetId` を復元する（唯一の手がかり）
//   ② 🔴 宛先分類を確定させる（**CAS より前**。`send-hold-release.ts` の `releaseOne` と同じ規律）
//   ③ 新しいトークンを生成し、**ハッシュだけ**を DB へ渡す
//   ④ 🔴 同一トランザクションで「保留行の CAS」→「期限判定」→「`tokenHash` の差し替え」
//      （`packages/db` の `reissueHeldInvitationToken`。片方だけ成立させない）
//   ⑤ **commit の後**に `account.mail` を enqueue する（未コミットの行をワーカーが先に読まない）
// 🔴 ②が④より後ろにあると、**行は閉じ・旧トークンは失効し・新しい 1 通は積まれていない**という
//    「招待が永久に届かない」状態が残る。失敗しうる判定は、状態を動かす前に済ませる。
// 🔴 ④が `SKIPPED` / `EXPIRED` を返したら enqueue しない。**「1 通」を担保するのは④の CAS** で
//    あり、`dedupeKey` の `UNIQUE` ではない（`UNIQUE` は同一トークンの再試行にしか効かない）。
//
// ============================================================================
// 🔴 パスワード再設定を再発行しない（docs/05 §8.3 / §9.4 に追記済みの意図的な差分）
// ============================================================================
// 理由は `packages/db/src/account-mail-reissue.ts` の冒頭に書いた 3 点（①1 時間の TTL に対して
// 保留は数時間〜数日 ②本人がいつでも #5 から再要求できる ③パートナー所属利用者の
// `users` 行はジョブのホスト文脈から書き換えられない = C3 UPDATE）。
// ここでは保留行を `EXPIRED` として**閉じる**（送らずに終える）。閉じないと `send.hold-release` が
// 10 分ごとに同じ行を拾い続ける。
import {
  parseAccountMailDedupeKey,
  type AccountMailJob,
  type AccountMailKind,
} from '@ses/connectors';
import {
  closeHeldEmailDispatch,
  generateSecretToken,
  hashSecretToken,
  reissueHeldInvitationToken,
  type HeldEmailDispatchRow,
  type SystemTenantCtx,
} from '@ses/db';
import type { AccountMailReissue } from './send-hold-release.js';

export type AccountMailReissueDeps = {
  /**
   * 🔴 新しいトークンで `account.mail` を積み直す（docs/05 §9.4）。
   *    **平文トークンはこの payload にしか載らない。**
   */
  readonly enqueueAccountMail: (job: AccountMailJob) => Promise<void>;
  /**
   * 招待の受諾期限（`INVITATION_TTL_MS`。`packages/config`）。
   * 🔴 **保留していた期間を受諾期限から差し引かない**（docs/05 §8.3 の復帰手順③）。
   *    差し引くと「届いた時にはもう切れているリンク」が生まれる。
   * 🔴 値をここに書かない（`packages/config` が唯一の出所）。
   */
  readonly invitationTtlMs: number;
  readonly now: () => Date;
};

/**
 * 🔴 `dedupeKey` の形式が壊れている / `kind` が未知（実装バグ）。
 *
 * **握り潰さない。** 推測して `targetId` を埋めると、**他人の招待のトークンを差し替える**
 * ことになりうる（別人に有効なリンクが届く）。`send.hold-release` は `attempts: 3` であり、
 * ここで throw すれば失敗ジョブとして `A-005` に現れる（docs/05 §9.10）。
 */
export class UnparsableAccountMailDedupeKeyError extends Error {
  constructor(readonly dispatchId: string) {
    super(
      `保留中の account.mail 由来の行の dedupeKey を解釈できません（dispatchId=${dispatchId}）。` +
        '形式は docs/05 §9.4 の `{kind}:{targetId}:{tokenHashPrefix}` です。',
    );
    this.name = 'UnparsableAccountMailDedupeKeyError';
  }
}

/**
 * 🔴 復帰の本体（`SendHoldReleaseDeps.reissueAccountMail` に渡す）。
 *
 * 🔴 `kind` ごとの分岐は**ここ 1 箇所**である。`send.hold-release` 側は「`account.mail` 由来か」
 *    だけを見て（`isAccountMailTemplateKey`）この関数に委ねる。
 */
export function createAccountMailReissue(deps: AccountMailReissueDeps): AccountMailReissue {
  return async (ctx: SystemTenantCtx, dispatch: HeldEmailDispatchRow) => {
    const parsed = parseAccountMailDedupeKey(dispatch.dedupeKey);
    if (parsed === null) throw new UnparsableAccountMailDedupeKeyError(dispatch.dispatchId);

    // 🔴 **CAS の前に判定する**（`send-hold-release.ts` の `releaseOne` と同じ規律）。
    //    CAS の後ろに置くと、保留行を閉じてトークンを差し替えた**後**に throw することになり、
    //    「行は閉じた・旧トークンは失効した・新しい 1 通は積まれていない」= **招待が永久に
    //    届かない**状態が残る（`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」）。
    //    ここで落ちれば行は保留のままであり、`send.hold-release` が 10 分後に再び拾う。
    const recipientClass = assertAccountMailRecipientClass(dispatch);

    const now = deps.now();

    if (parsed.kind === 'PASSWORD_RESET') {
      // 🔴 再発行しない（上記の理由）。閉じるだけ。CAS が 0 件なら他の実行が処理済み。
      await closeHeldEmailDispatch(ctx, {
        dispatchId: dispatch.dispatchId,
        fromStatus: dispatch.status,
        reason: 'EXPIRED',
      });
      // 🔴 `EXPIRED` を返す（`REISSUED` ではない）。`send.hold-release` の復帰件数に数えない。
      return 'EXPIRED';
    }

    // 🔴 平文はこの関数のスコープにしか存在しない。DB へ渡すのはハッシュだけである。
    const token = generateSecretToken();
    const outcome = await reissueHeldInvitationToken(ctx, {
      dispatchId: dispatch.dispatchId,
      fromStatus: dispatch.status,
      invitationId: parsed.targetId,
      tokenHash: hashSecretToken(token),
      expiresAt: new Date(now.getTime() + deps.invitationTtlMs),
      now,
    });
    if (outcome !== 'REISSUED') return outcome;

    // ④ commit の後に enqueue する。
    // 🔴 `recipientClass` は**保留行に保存されている値**を使う（enqueue 元の
    //    `resolveRecipientClass` が `Invitation` から機械的に導いたもの。docs/05 §8.2）。
    //    ここで導き直すと分類の判定が 2 つになり、片方が古くなる。
    //    🔴 値は CAS の**前**に確定させてある（上記）。ここで失敗しうる式を書かない。
    await deps.enqueueAccountMail({
      tenantId: ctx.tenantId,
      kind: 'INVITATION' satisfies AccountMailKind,
      targetId: parsed.targetId,
      recipientClass,
      token,
    });
    return 'REISSUED';
  };
}

/**
 * 🔴 保留行の宛先分類が `account.mail` に載る 2 値（分類 1 / 2）であることを確かめる。
 *
 * 行の `templateKey` が `account.mail` 由来である以上、分類 3 / 4 はあり得ない（型で禁じてある）。
 * ここへ来るのは所属の引き当てが壊れているときであり、**その状態で送ってはならない**
 * （分類 3 / 4 には `sandbox` のモック分岐が効かず、実在の第三者へ届きうる）。
 */
function assertAccountMailRecipientClass(
  dispatch: HeldEmailDispatchRow,
): AccountMailJob['recipientClass'] {
  const { recipientClass } = dispatch;
  if (recipientClass === 'HOST_MEMBER' || recipientClass === 'PARTNER_MEMBER') {
    return recipientClass;
  }
  throw new Error(
    `保留中の account.mail 由来の行に宛先分類 '${recipientClass}' が入っています` +
      `（dispatchId=${dispatch.dispatchId}）。docs/05 §9.4 は分類 1 / 2 に限っています。`,
  );
}
