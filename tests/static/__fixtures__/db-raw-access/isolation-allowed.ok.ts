// 対照: tests/isolation/** だけが @ses/db/testing の import と $queryRaw の直接呼び出しを行える
// （docs/05 §4.7。分離機構そのものを検証する専用の入口）。
import { createUnextendedClient } from '@ses/db/testing';

export async function run() {
  const client = createUnextendedClient('postgresql://example');
  const rows = await client.$queryRaw<Array<{ id: string }>>`SELECT id FROM engineers`;
  return rows;
}
