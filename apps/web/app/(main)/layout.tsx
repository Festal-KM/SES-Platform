// apps/web/app/(main)/layout.tsx
// 主平面（`/`）の共通外枠を**全画面に 1 箇所から**かける（docs/04 §3.1 / §3.3 / §3.4）。
//
// 🔴 **なぜレイアウトなのか**: ヘッダとグローバルナビが各画面に散ると、片方だけ直る状態が必ず
//    生まれ、「どの画面からどこへ行けるか」が画面ごとに変わる。docs/04 §3.3 は平面の外枠として
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
// 🔴 `'use client'` を持ち込まない（`_shell/app-shell.tsx` の規律）。
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
import { readShellIdentity } from '../../lib/shell/identity';
import { buildBottomTabs, buildMainNav, type NavAudience } from '../../lib/shell/nav';
import { readShellUsageIndicator } from '../../lib/shell/usage-indicator';
import { TENANT_ROLE_MESSAGE_KEYS } from '../../lib/tenants/labels';
import { AppShell } from './_shell/app-shell';


export default async function MainPlaneLayout({ children }: { readonly children: ReactNode }) {
  const outcome = await resolveTenantCtxOutcome();
  // 🔴 未認証 / 2 要素未充足では外枠を描かない（上の 🔴）。素の `children` を返す。
  if (outcome.status !== 'AUTHENTICATED') return <>{children}</>;

  const ctx = outcome.ctx;
  // 🔴 所属（`partnerCompanyId`）で決める。ロール名で代用しない（`memberships` の CHECK と 1 対 1）。
  const audience: NavAudience = ctx.partnerCompanyId === null ? 'HOST' : 'PARTNER';
  const identity = await readShellIdentity(ctx);
  const usage = await readShellUsageIndicator(ctx, new Date());

  return (
    <AppShell
      wordmark={t('product.name')}
      organizationName={identity.organizationName}
      partnerCompanyName={identity.partnerCompanyName}
      userName={identity.userName}
      roleLabel={t(TENANT_ROLE_MESSAGE_KEYS[ctx.role])}
      usage={usage}
      // 🔴 上限インジケータの遷移先（`S-038`）はホスト所属にだけ置く（`docs/04` §S-038 /
      //    `F-027 AC-1`「取引先には停止の事実と理由だけ」）。
      usageHref={ctx.partnerCompanyId === null ? '/settings/usage' : null}
      nav={buildMainNav({ audience, role: ctx.role })}
      tabs={buildBottomTabs()}
    >
      {children}
    </AppShell>
  );
}
