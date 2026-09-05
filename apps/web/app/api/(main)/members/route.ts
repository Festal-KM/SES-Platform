// apps/web/app/api/(main)/members/route.ts
// docs/05 §6.7 #83 `GET /api/members`（`F-002` / `S-014` の「配下アカウント」/ `S-035`）。T-04-09。
//
// 🔴 **母集団は RLS（C5）が絞る。アプリ側に絞り込みを書かない**（`F-002 AC-4` / `F-004 AC-1`）。
//    `PARTNER_ADMIN` が API を直接叩いても、自社配下以外は `items` にも `total` にも現れない。
//    ホスト（`OWNER` / `ADMIN`）には自社社員と各取引先の配下が並ぶ（`S-035` の「所属」列）。
// 🔴 認可は `F-002` の関連ロール（`OWNER` / `ADMIN`（テナント全体）/ `PARTNER_ADMIN`（自社配下））に
//    そろえる。`SALES` / `VIEWER` / `PARTNER_SALES` はアカウント管理の当事者ではなく、
//    一覧には氏名とメールアドレス（PII）が並ぶため、**見せる理由が無い側に倒す**。
//    ⚠️ `S-014` の取引先一覧そのもの（#11）は従来どおり全ロールが見られる（件数までは出る）。
// 🔴 読み取り専用なので `requireExecutable` を掛けない（`CLOSING` でも閲覧はできる。`F-004 AC-8`）。
import { requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { listMembers } from '../../../../lib/members/service';
import { MEMBER_MANAGER_ROLES } from '../../../../lib/members/policy';

// 🔴 Node ランタイム固定（Prisma は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/members',
    guards: [requireRole(MEMBER_MANAGER_ROLES)],
  },
  async ({ ctx }) => Response.json(await listMembers(ctx)),
);
