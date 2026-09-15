// 違反: 動的 import / require でも @ses/ai に到達できる（静的 import だけ塞いでも素通りする）。
export async function violation() {
  const ai = await import('@ses/ai');
  return ai.createRoleRunner;
}
