// apps/web/app/(main)/layout.tsx
// 主平面（`/`）の共通外枠を**全画面に 1 箇所から**かける（docs/04 §3.1 / §3.4）。
//
// 🔴 **なぜレイアウトなのか**: ヘッダとグローバルナビが各画面に散ると、片方だけ直る状態が必ず
//    生まれ、「どの画面からどこへ行けるか」が画面ごとに変わる。docs/04 §3.1 は平面の外枠として
//    定義しており、実装も平面に 1 つだけ置く。
//
// 🔴 **未認証の画面（`S-001` / `S-002` / `S-046`）には外枠を描かない。** それらは同じルート
//    グループ配下（`app/(main)/(auth)/**`）に在り、`AuthShell`（`app/_components/auth-shell.tsx`）
//    を自前で持つ。ここでは ctx が作れないこと自体を判定に使う ——
//    **「未認証なら外枠なし」は所属・ロールの判定より 1 段手前の事実**であり、パスの一致で
//    分岐すると認証画面が増えるたびに書き足す必要が出る。
//
// 🔴 **境界の強制ではない。** ここで ctx を解決するのはヘッダの材料（自分の所属・氏名・上限）を
//    読むためであり、業務データの拒否は各画面 / 各 API の `resolveTenantCtxOutcome` +
//    `withTenant`（RLS + Prisma 拡張）が行う。このレイアウトから redirect もしない
//    （各画面が自分の遷移先を決める。2 箇所で redirect すると、どちらが効いたのか読めなくなる）。
//
// 🔴 `'use client'` を持ち込まない（`_shell/main-shell.tsx` の規律）。
//
// ============================================================================
// 🔴 外枠が 1 リクエストに足すトランザクションの本数（2026-09-28 の実測値。是正後）
// ============================================================================
// 計測の方法: `tests/isolation/shell-header.test.ts` ⑤ が、**1 トランザクションを開く
// `@ses/db` の関数**（`withTenant` / `readTenantUsageSnapshot` / `readAiStopNotice` /
// `resolveTenantQuotas`。いずれも本体が `runInTenantTransaction` 1 回）の呼び出し回数を
// 実 DB 上で数える。**テストが数を固定している**ので、読み取りを足すと落ちる。
//
//   | 所属 | 本数 | 内訳 |
//   |---|---|---|
//   | ホスト | **4** | `readShellIdentity` 1 + `readUsageView` 3（使用量 / AI 停止 / 上限の解決。`Promise.all`） |
//   | 取引先 | **3** | `readShellIdentity` 1 + `readBlockedNotice` 1 + **`readProposalRequestDue` 1**（T-12-21 で +1） |
//
// 🔴 T-12-21 で増えたのは**取引先の 1 本だけ**である（`③ 提案依頼` の期限バッジ。docs/04 §3.1 の
//    取引先列）。ホストは 4 本のまま（`audience === 'PARTNER'` のときだけ読む）。読むのは
//    `findFirst` 1 行 + 索引（`expiresAt`）であり、件数は数えない（`count` を使わない）。
//
// 🔴 **`resolveTenantCtxOutcome` はここに含まれない（0 本）。** ページも同じものを呼ぶため
//    `cache()` でリクエスト内 1 回に畳んだ（`lib/auth/session.ts` の 🔴）。畳む前は主平面の
//    全ページで `loadTenantMembership` が 2 回走り、外枠だけで 5 本増えていた。
// 🔴 `/settings/usage` でも本数は上の表のままである。ページ側の `readUsageView` は
//    `lib/usage/request-scope.ts` の畳み込みで外枠と共有される（畳む前は 3 本増えていた）。
// 🔴 ここに読み取りを足すときは、上の表と `tests/isolation/shell-header.test.ts` を必ず更新する。
//    外枠は**主平面の全ページ**に乗るので、1 本の追加が全画面の p95（`CLAUDE.md` §7）に効く。
//
// 🔴 **セグメント設定（`dynamic` / `runtime`）をここに書かない。** `dynamic = 'force-dynamic'` は
//    ルートレイアウト（`app/layout.tsx`）が宣言済みで、Next はページから上へ全レイアウトの設定を
//    畳み込む（`next/dist/build/get-static-info-including-layouts.js`）ため、主平面の全ページに
//    既に効いている（`next build` のルート表が全ルートを `ƒ` = Dynamic と出すことで確認できる）。
//    `runtime` も App Router の既定が `nodejs` である。**同じ宣言を 2 箇所に置くと、片方だけ
//    変えられて食い違う。** 2026-09-28 に「ビルドが落ちるのはこの宣言のせいではないか」と疑って
//    外した経緯があるが、原因は別（`apps/web/next.config.ts` の `assertProductionNodeEnv` の 🔴）で、
//    宣言の有無はビルドの成否に影響しない。**復活させないこと。**
import type { ReactNode } from 'react';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../lib/auth/session';
import { requestNow } from '../../lib/request/now';
import { remainingLabels } from '../../lib/proposal-requests/list-rows';
import { formatRemaining } from '../../lib/proposal-requests/remaining';
import { readCurrentPath } from '../../lib/shell/current-path';
import { readShellIdentity } from '../../lib/shell/identity';
import { readProposalRequestDue } from '../../lib/shell/proposal-request-due';
import { buildBottomTabs, buildMainNav, type NavAudience } from '../../lib/shell/nav';
import { readShellUsageIndicator } from '../../lib/shell/usage-indicator';
import { TENANT_ROLE_MESSAGE_KEYS } from '../../lib/tenants/labels';
import { MainShell } from './_shell/main-shell';


export default async function MainPlaneLayout({ children }: { readonly children: ReactNode }) {
  const outcome = await resolveTenantCtxOutcome();
  // 🔴 未認証 / 2 要素未充足では外枠を描かない（上の 🔴）。素の `children` を返す。
  if (outcome.status !== 'AUTHENTICATED') return <>{children}</>;

  const ctx = outcome.ctx;
  // 🔴 所属（`partnerCompanyId`）で決める。ロール名で代用しない（`memberships` の CHECK と 1 対 1）。
  const audience: NavAudience = ctx.partnerCompanyId === null ? 'HOST' : 'PARTNER';
  // 🔴 `now` は `requestNow()` から取る（`new Date()` を自前で作らない）。ページ側の読み取りと
  //    同じインスタンスであることが、`lib/usage/request-scope.ts` の畳み込みがヒットする条件である。
  const [currentPath, identity, usage, proposalRequestDue] = await Promise.all([
    // 🔴 T-22-05: 現在地（サイドバーのハイライト。docs/04 §3.1）。`proxy.ts` が添えたリクエスト
    //    ヘッダを読むだけであり、**DB のトランザクションは 1 本も増えない**（下の表は不変）。
    readCurrentPath(),
    readShellIdentity(ctx),
    readShellUsageIndicator(ctx, requestNow()),
    // 🔴 T-12-21: `③ 提案依頼`（`S-017`）の期限バッジ（docs/04 §3.1 の取引先列）。
    //    🔴 **取引先所属のときだけ読む**（ホストでは 1 本も増えない。docs/04 の表が取引先列にしか
    //       バッジを書いていない）。🔴 読むのは**最も近い期限 1 件だけ**で、件数は数えない
    //       （`lib/shell/proposal-request-due.ts` の 🔴）。
    audience === 'PARTNER' ? readProposalRequestDue(ctx) : Promise.resolve(null),
  ]);
  // 🔴 残り時間の表現は `formatRemaining`（`S-017` の一覧と同じ 1 実装）に寄せる。
  //    現在時刻は `requestNow()`（ページ側の読み取りと同じインスタンス）から取る。
  const proposalRequestDueText =
    proposalRequestDue === null
      ? null
      : formatRemaining(proposalRequestDue.expiresAtIso, requestNow().getTime(), remainingLabels());

  return (
    <MainShell
      wordmark={t('product.name')}
      organizationName={identity.organizationName}
      partnerCompanyName={identity.partnerCompanyName}
      userName={identity.userName}
      roleLabel={t(TENANT_ROLE_MESSAGE_KEYS[ctx.role])}
      usage={usage}
      // 🔴 上限インジケータの遷移先（`S-038`）はホスト所属にだけ置く（`docs/04` §S-038 /
      //    `F-027 AC-1`「取引先には停止の事実と理由だけ」）。
      usageHref={ctx.partnerCompanyId === null ? '/settings/usage' : null}
      nav={buildMainNav({ audience, role: ctx.role, proposalRequestDueText })}
      tabs={buildBottomTabs()}
      currentPath={currentPath}
    >
      {children}
    </MainShell>
  );
}
