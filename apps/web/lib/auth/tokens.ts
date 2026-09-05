// apps/web/lib/auth/tokens.ts
// 招待トークン（docs/05 §6.3 #6 / #7 / §6.4 #14）とパスワード再設定トークン（#5 / #5b）の
// 生成・ハッシュ化。
//
// 🔴 T-04-05: **実装は `@ses/db`（`packages/db/src/tokens.ts`）へ移した。** ここは名前を
//    合わせるための再輸出だけである。
//
//    移した理由: 保留（`HELD_*`）からの復帰でトークンを**再発行するのは `apps/worker`** に
//    なった（docs/05 §8.3）。`apps/worker` は `apps/web` を import できない（`CLAUDE.md` §2.1 の
//    依存方向）ため、ここに実装を残すとワーカー側に 2 つ目のハッシュ実装が生まれる。
//    2 つが少しでもずれた瞬間、再発行された招待リンクは `withInvitationToken(hashToken(token))`
//    で 1 行も引けず、**リンクが黙って死ぬ**（`CLAUDE.md` §11.1 の「成功したように見えて
//    実際には起きていない」と同じ壊れ方）。
//
// 🔴 平文の扱いは変わらない（`CLAUDE.md` §3.4）: 出てよいのはメール本文と
//    `sandbox` の招待リンク表示だけであり、DB・ログ・監査ログ・エラー追跡には載せない。
export { generateSecretToken as generateToken, hashSecretToken as hashToken } from '@ses/db';
