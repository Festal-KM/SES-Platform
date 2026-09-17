// apps/web/lib/admin-demo/reset-confirmation.test.ts
// T-10-07: リセットの確認入力（環境名 + テナント名）の照合。画面（ボタンの有効化）とサービス（400）が同じ 1 関数を呼ぶ。
import { describe, expect, it } from 'vitest';
import {
  matchesDemoResetConfirmation,
  matchesDemoResetEnv,
  matchesDemoResetTenantName,
} from './reset-confirmation';

const TARGET = { appEnv: 'demo', tenantNames: ['株式会社サンプルアルファ', '株式会社サンプルブラボー'] } as const;

describe('matchesDemoResetConfirmation（docs/04 §A-012 確認ステップ / docs/05 §13.6）', () => {
  it('環境名とテナント名の両方が一致したときだけ真', () => {
    expect(matchesDemoResetConfirmation(TARGET, { confirmEnv: 'demo', confirmTenantName: '株式会社サンプルアルファ' })).toBe(true);
    expect(matchesDemoResetConfirmation(TARGET, { confirmEnv: 'demo', confirmTenantName: '株式会社サンプルブラボー' })).toBe(true);
  });

  it('🔴 環境名が接続先と違えば偽（間違った環境で叩いたを止める 3 枚目の板）', () => {
    for (const confirmEnv of ['production', 'sandbox', 'staging', 'development', 'DEMO', 'demo ', '']) {
      const matched = matchesDemoResetConfirmation(TARGET, { confirmEnv, confirmTenantName: '株式会社サンプルアルファ' });
      // 前後の空白だけは除く（`'demo '` は通る）。大文字小文字は寄せない。
      expect(matched, confirmEnv).toBe(confirmEnv === 'demo ');
    }
  });

  it('🔴 テナント名が demo プリセットのいずれとも一致しなければ偽（部分一致・別テナントを通さない）', () => {
    for (const confirmTenantName of ['株式会社サンプル', 'サンプルアルファ', '株式会社ダミーチャーリー', 'Tenant A', '']) {
      expect(matchesDemoResetConfirmation(TARGET, { confirmEnv: 'demo', confirmTenantName }), confirmTenantName).toBe(false);
    }
  });

  it('片方だけの一致では偽', () => {
    expect(matchesDemoResetEnv(TARGET, 'demo')).toBe(true);
    expect(matchesDemoResetTenantName(TARGET, '株式会社サンプルアルファ')).toBe(true);
    expect(matchesDemoResetConfirmation(TARGET, { confirmEnv: 'demo', confirmTenantName: 'x' })).toBe(false);
    expect(matchesDemoResetConfirmation(TARGET, { confirmEnv: 'x', confirmTenantName: '株式会社サンプルアルファ' })).toBe(false);
  });

  it('空文字は一致とみなさない（照合先が空の場合も含む）', () => {
    expect(matchesDemoResetEnv({ appEnv: '', tenantNames: [] }, '')).toBe(false);
    expect(matchesDemoResetTenantName({ appEnv: 'demo', tenantNames: [''] }, '')).toBe(false);
  });
});
