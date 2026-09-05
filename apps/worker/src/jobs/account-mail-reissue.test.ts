// apps/worker/src/jobs/account-mail-reissue.test.ts
// 🔴 `reissueAccountMail` seam の実体（docs/05 §8.3 の復帰手順 / §9.4）。T-04-05。
//
// 固定するのは 6 点である:
//   ① `dedupeKey` から `kind` / `targetId` を復元する（**推測しない**。壊れていたら throw）
//   ② 招待は**新しいトークン**で再発行され、DB へ渡るのは**ハッシュだけ**である
//   ③ `REISSUED` のときだけ enqueue する（`SKIPPED` / `EXPIRED` では 1 通も積まない）
//   ④ 受諾期限は `now + INVITATION_TTL`（保留期間を差し引かない。docs/05 §8.3 復帰手順③）
//   ⑤ 🔴 パスワード再設定は**再発行せず**、保留行を `EXPIRED` として閉じる
//   ⑥ 宛先分類は**保留行の値**を使う（ここで導き直さない。docs/05 §8.2）
//
// 🔴 DB もネットワークも使わない（`@ses/db` をモックする）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reissueHeldInvitationToken = vi.fn();
const closeHeldEmailDispatch = vi.fn();
const generateSecretToken = vi.fn();
const hashSecretToken = vi.fn();

vi.mock('@ses/db', () => ({
  reissueHeldInvitationToken,
  closeHeldEmailDispatch,
  generateSecretToken,
  hashSecretToken,
}));

const { createAccountMailReissue, UnparsableAccountMailDedupeKeyError } = await import(
  './account-mail-reissue.js'
);
const { accountMailDedupeKey } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const INVITATION_ID = '01930000-0000-7000-8000-000000000191';
const USER_ID = '01930000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-09-05T03:00:00.000Z');
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CTX = { tenantId: TENANT_ID } as never;

function held(overrides: Record<string, unknown> = {}) {
  return {
    dispatchId: '01930000-0000-7000-8000-000000000901',
    status: 'HELD_DOMAIN_UNVERIFIED',
    recipientClass: 'PARTNER_MEMBER',
    recipientEmail: 'partner@example.co.jp',
    templateKey: 'ACCOUNT_INVITATION',
    dedupeKey: accountMailDedupeKey({
      kind: 'INVITATION',
      targetId: INVITATION_ID,
      tokenHashPrefix: '0123456789abcdef',
    }),
    heldAt: NOW,
    ...overrides,
  } as never;
}

function makeReissue(overrides: Record<string, unknown> = {}) {
  const enqueueAccountMail = vi.fn(async () => undefined);
  const deps = {
    enqueueAccountMail,
    invitationTtlMs: INVITATION_TTL_MS,
    now: () => NOW,
    ...overrides,
  };
  return { reissue: createAccountMailReissue(deps as never), enqueueAccountMail: deps.enqueueAccountMail };
}

beforeEach(() => {
  reissueHeldInvitationToken.mockReset();
  closeHeldEmailDispatch.mockReset();
  generateSecretToken.mockReset();
  hashSecretToken.mockReset();
  reissueHeldInvitationToken.mockResolvedValue('REISSUED');
  closeHeldEmailDispatch.mockResolvedValue(true);
  generateSecretToken.mockReturnValue('new-plaintext-token');
  // 🔴 平文を含まない値を返す（含めると「平文が DB へ渡らない」検査が自分で壊れる）。
  hashSecretToken.mockReturnValue('a'.repeat(64));
});

describe('🔴 ① dedupeKey の復元（推測して埋めない）', () => {
  it('形式が壊れていたら throw する（他人の招待を差し替えない）', async () => {
    const { reissue } = makeReissue();
    await expect(reissue(CTX, held({ dedupeKey: 'broken-key' }))).rejects.toBeInstanceOf(
      UnparsableAccountMailDedupeKeyError,
    );
    expect(reissueHeldInvitationToken).not.toHaveBeenCalled();
  });

  it('未知の kind でも throw する', async () => {
    const { reissue } = makeReissue();
    await expect(
      reissue(CTX, held({ dedupeKey: `UNKNOWN:${INVITATION_ID}:0123456789abcdef` })),
    ).rejects.toBeInstanceOf(UnparsableAccountMailDedupeKeyError);
  });

  it('招待 ID を dedupeKey から取り出して渡す', async () => {
    const { reissue } = makeReissue();
    await reissue(CTX, held());
    expect(reissueHeldInvitationToken).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ invitationId: INVITATION_ID }),
    );
  });
});

describe('🔴 ② 平文は DB へ渡らない（渡るのはハッシュだけ）', () => {
  it('tokenHash は hashSecretToken(新トークン) であり、平文そのものではない', async () => {
    const { reissue } = makeReissue();
    await reissue(CTX, held());

    expect(hashSecretToken).toHaveBeenCalledWith('new-plaintext-token');
    const input = reissueHeldInvitationToken.mock.calls[0]?.[1] as { tokenHash: string };
    expect(input.tokenHash).toBe('a'.repeat(64));
    // 🔴 `packages/db` へ渡る引数のどこにも平文が現れない。
    expect(JSON.stringify(reissueHeldInvitationToken.mock.calls[0])).not.toContain(
      'new-plaintext-token',
    );
  });

  it('🔴 平文が現れるのは enqueue する payload だけである（docs/05 §9.4）', async () => {
    const { reissue, enqueueAccountMail } = makeReissue();
    await reissue(CTX, held());
    expect(enqueueAccountMail).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'new-plaintext-token' }),
    );
  });

  it('呼ぶたびに新しいトークンを生成する（同じ平文を使い回さない）', async () => {
    const { reissue } = makeReissue();
    await reissue(CTX, held());
    await reissue(CTX, held());
    expect(generateSecretToken).toHaveBeenCalledTimes(2);
  });
});

describe('🔴 ③ REISSUED のときだけ enqueue する', () => {
  it('CAS が 0 件（SKIPPED）なら 1 通も積まない', async () => {
    reissueHeldInvitationToken.mockResolvedValue('SKIPPED');
    const { reissue, enqueueAccountMail } = makeReissue();

    expect(await reissue(CTX, held())).toBe('SKIPPED');
    expect(enqueueAccountMail).not.toHaveBeenCalled();
  });

  it('期限切れ（EXPIRED）なら 1 通も積まない（再招待は #14 の明示操作）', async () => {
    reissueHeldInvitationToken.mockResolvedValue('EXPIRED');
    const { reissue, enqueueAccountMail } = makeReissue();

    expect(await reissue(CTX, held())).toBe('EXPIRED');
    expect(enqueueAccountMail).not.toHaveBeenCalled();
  });

  it('REISSUED なら 1 通だけ積む', async () => {
    const { reissue, enqueueAccountMail } = makeReissue();
    expect(await reissue(CTX, held())).toBe('REISSUED');
    expect(enqueueAccountMail).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 ④ 受諾期限は now + INVITATION_TTL（保留期間を差し引かない）', () => {
  it('保留が長引いても、再発行時点から満了まで使える', async () => {
    const { reissue } = makeReissue();
    await reissue(CTX, held({ heldAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) }));

    const input = reissueHeldInvitationToken.mock.calls[0]?.[1] as { expiresAt: Date; now: Date };
    expect(input.expiresAt.getTime()).toBe(NOW.getTime() + INVITATION_TTL_MS);
    expect(input.now).toEqual(NOW);
  });

  it('🔴 期限の値をハードコードしていない（deps から来る）', async () => {
    const { reissue } = makeReissue({ invitationTtlMs: 1_000 });
    await reissue(CTX, held());
    const input = reissueHeldInvitationToken.mock.calls[0]?.[1] as { expiresAt: Date };
    expect(input.expiresAt.getTime()).toBe(NOW.getTime() + 1_000);
  });
});

describe('🔴 ⑤ パスワード再設定は再発行しない（docs/05 §8.3 への意図的な差分）', () => {
  const passwordReset = () =>
    held({
      templateKey: 'ACCOUNT_PASSWORD_RESET',
      recipientClass: 'PARTNER_MEMBER',
      dedupeKey: accountMailDedupeKey({
        kind: 'PASSWORD_RESET',
        targetId: USER_ID,
        tokenHashPrefix: 'fedcba9876543210',
      }),
    });

  it('EXPIRED を返し、トークンを 1 つも生成しない', async () => {
    const { reissue, enqueueAccountMail } = makeReissue();

    expect(await reissue(CTX, passwordReset())).toBe('EXPIRED');
    expect(generateSecretToken).not.toHaveBeenCalled();
    expect(reissueHeldInvitationToken).not.toHaveBeenCalled();
    expect(enqueueAccountMail).not.toHaveBeenCalled();
  });

  it('🔴 保留行を EXPIRED として閉じる（閉じないと 10 分ごとに拾い続ける）', async () => {
    const { reissue } = makeReissue();
    await reissue(CTX, passwordReset());

    expect(closeHeldEmailDispatch).toHaveBeenCalledWith(CTX, {
      dispatchId: '01930000-0000-7000-8000-000000000901',
      fromStatus: 'HELD_DOMAIN_UNVERIFIED',
      reason: 'EXPIRED',
    });
  });

  it('保留の理由が送信基盤の枠でも同じ扱いになる（CAS の対象状態だけが変わる）', async () => {
    const { reissue } = makeReissue();
    await reissue(
      CTX,
      held({
        status: 'HELD_PROVIDER_QUOTA',
        templateKey: 'ACCOUNT_PASSWORD_RESET',
        dedupeKey: accountMailDedupeKey({
          kind: 'PASSWORD_RESET',
          targetId: USER_ID,
          tokenHashPrefix: 'fedcba9876543210',
        }),
      }),
    );

    expect(closeHeldEmailDispatch).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ fromStatus: 'HELD_PROVIDER_QUOTA' }),
    );
  });
});

describe('🔴 ⑥ 宛先分類は保留行の値を使う（導き直さない）', () => {
  it.each(['HOST_MEMBER', 'PARTNER_MEMBER'])('%s がそのまま payload に載る', async (recipientClass) => {
    const { reissue, enqueueAccountMail } = makeReissue();
    await reissue(CTX, held({ recipientClass }));
    expect(enqueueAccountMail).toHaveBeenCalledWith(expect.objectContaining({ recipientClass }));
  });

  /**
   * 🔴 判定は **CAS より前**に済ませる（`send-hold-release.ts` の `releaseOne` と同じ規律）。
   *    後ろに置くと「保留行は閉じた・旧トークンは失効した・新しい 1 通は積まれていない」＝
   *    **招待が永久に届かない**状態が残る。ここで落ちれば行は保留のままであり、
   *    10 分後の `send.hold-release` が再び拾う。
   */
  it('🔴 分類 3 / 4 が入っていたら、状態を 1 つも動かさずに落とす（CAS の前に判定する）', async () => {
    const { reissue, enqueueAccountMail } = makeReissue();
    await expect(reissue(CTX, held({ recipientClass: 'CLIENT' }))).rejects.toThrow(/CLIENT/);

    // 🔴 トークンの差し替えも保留行の CAS も起きていない（行は保留のまま）。
    expect(reissueHeldInvitationToken).not.toHaveBeenCalled();
    expect(closeHeldEmailDispatch).not.toHaveBeenCalled();
    expect(generateSecretToken).not.toHaveBeenCalled();
    expect(enqueueAccountMail).not.toHaveBeenCalled();
  });

  it('🔴 パスワード再設定でも同じ（EXPIRED で閉じる前に落とす）', async () => {
    const { reissue } = makeReissue();
    await expect(
      reissue(
        CTX,
        held({
          recipientClass: 'ENGINEER',
          templateKey: 'ACCOUNT_PASSWORD_RESET',
          dedupeKey: accountMailDedupeKey({
            kind: 'PASSWORD_RESET',
            targetId: USER_ID,
            tokenHashPrefix: 'fedcba9876543210',
          }),
        }),
      ),
    ).rejects.toThrow(/ENGINEER/);
    expect(closeHeldEmailDispatch).not.toHaveBeenCalled();
  });
});
