// tests/e2e/harness/sending-domain.ts
// ✅ T-09-11: E2E テナントの送信元ドメイン（合成）。`global-setup.ts`（テナント 1 を検証済みにする）と
// `proposal-cycle.spec.ts`（E2E #9 でテナント 2 を検証する）が同じ値を使う。
//
// 🔴 実在しないドメイン（RFC 6761 の `.test`）。`development` のメールはモックであり、この値で外部に何かが起きることは無い。
//    書くのは `harness/db-admin.ts` の `registerVerifiedSendingDomainForE2e` だけである。
export const E2E_VERIFIED_SENDING_DOMAIN = 'e2e-sender.example.test';
