-- ============================================================================
-- T-09-06 提案の送信 —— 保留列の CHECK（docs/05 §10.4 / §10.5 / §8.3-Q ⑥ / `CLAUDE.md` §4.2）
-- ============================================================================
-- 本 migration は列を足さない。既存の `proposals.send_hold_reason_key` / `contracts.send_hold_reason_key`
-- （T-02-03 / T-02-04 で置いた 2 列。docs/05 §3.6 / §3.7）に **値集合の CHECK（7 値）** と
-- **`send_hold_reason_key` と `send_hold_since` の同時性**を足す。
--
-- 🔴 判断事項 1: 保留は状態ではなく属性（`CLAUDE.md` §4.2 は状態の追加を禁じている）
-- ============================================================================
-- 「事前判定に抵触したので送っていない」は `state` を動かさず（`Proposal` は `APPROVED` のまま）、
-- この 2 列で表す。`SUBMITTING` に入れず `SUBMIT_FAILED` にも落とさない（docs/05 §10.4）。
-- 値集合の単一の出所は `@ses/domain` の `SEND_HOLD_REASON_KEYS`（`packages/db/src/schema-value-sets.ts` は
-- re-export）。`tests/static/schema-enum-drift.test.ts` が本 CHECK と突合する。
--
-- 🔴 判断事項 2: `RATE_LIMIT`（テナントの日次上限）と `PROVIDER_QUOTA`（送信基盤 = 環境全体の枠）は別の値
-- ============================================================================
-- 対処する相手が異なる（前者はテナント〔`S-038`〕、後者は運営者）。混ぜると環境枠で止まったテナントに
-- `S-038` を案内してしまう（docs/05 §8.3-Q ⑥ / `F-059 AC-7`）。
--
-- 🔴 判断事項 3: 理由と時刻は同時に立ち、同時に消える
-- ============================================================================
-- `send.hold-release` は `send_hold_since` の古い順に枠を配る（docs/05 §9.4）。時刻の無い保留があると
-- 順序が決まらず、理由の無い時刻があると「保留中」に見えて理由が無い。どちらも書き込み側のバグであり、
-- DB レベルで起こり得ないようにする。
ALTER TABLE "proposals"
  ADD CONSTRAINT "proposals_send_hold_reason_key_check" CHECK ("send_hold_reason_key" IN (
    'RATE_LIMIT', 'DOMAIN_UNVERIFIED', 'ESIGN_DISCONNECTED', 'TENANT_SUSPENDED', 'GATE_STALE', 'AI_COST_LIMIT', 'PROVIDER_QUOTA'
  )),
  ADD CONSTRAINT "proposals_send_hold_pair_check" CHECK (
    ("send_hold_reason_key" IS NULL) = ("send_hold_since" IS NULL)
  );

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_send_hold_reason_key_check" CHECK ("send_hold_reason_key" IN (
    'RATE_LIMIT', 'DOMAIN_UNVERIFIED', 'ESIGN_DISCONNECTED', 'TENANT_SUSPENDED', 'GATE_STALE', 'AI_COST_LIMIT', 'PROVIDER_QUOTA'
  )),
  ADD CONSTRAINT "contracts_send_hold_pair_check" CHECK (
    ("send_hold_reason_key" IS NULL) = ("send_hold_since" IS NULL)
  );

-- 🔴 `send.hold-release` の走査（`state='APPROVED' AND send_hold_reason_key IS NOT NULL`。テナント文脈の RLS の下で
--    `send_hold_since` 昇順）と `A-005` 項目 14（理由別内訳）のための部分インデックス。
CREATE INDEX "proposals_send_hold_idx"
  ON "proposals" ("tenant_id", "send_hold_reason_key", "send_hold_since")
  WHERE "send_hold_reason_key" IS NOT NULL;
