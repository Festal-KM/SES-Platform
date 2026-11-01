import { z } from 'zod';
import { roleAccountAccess } from '../../../../../lib/db/bootstrap';
import { signInRoleAccount } from '../../../../../lib/auth/nonproduction-signin';
import { AuthenticationError, ValidationError, errorResponse } from '../../../../../lib/api/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  if (!roleAccountAccess().enabled) return new Response(null, { status: 404 });
  try {
    const body = z.object({ accountId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new ValidationError(['accountId']);
    const result = await signInRoleAccount(body.data.accountId, 'tenant');
    if (!result) throw new AuthenticationError();
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
