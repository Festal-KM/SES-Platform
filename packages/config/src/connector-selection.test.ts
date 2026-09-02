// packages/config/src/connector-selection.test.ts
// SP-01 T-01-03 完了判定: 「APP_ENV の 5 値それぞれでファクトリが返す実装のスナップショットテスト」。
// docs/05 §13.1 の起動時 DI（唯一の分岐点）を検証する。

import { describe, expect, it } from 'vitest';
import type { ConnectorSelection } from './connector-selection.js';
import { assertNoMockInProduction, resolveConnectorSelection } from './connector-selection.js';
import { ProductionMockConnectorError } from './errors.js';
import { loadAppEnv } from './load-env.js';
import { allAppEnvKinds, buildValidEnv } from './testing/fixtures.js';

// 🔴 スナップショットに加え、期待値を明示的にも固定する（docs/05 §13.1 が示す表を実装として
// 固定するため）。スナップショットだけだと「今の実装をそのまま正とする」だけになり、
// 意図しない変更を機械的に見逃す可能性があるため、両方で検証する。
const EXPECTED_SELECTION_BY_KIND: Record<string, ConnectorSelection> = {
  development: { email: 'mock', objectStore: 'real', malwareScanner: 'real', esign: 'mock', billing: 'mock', ai: 'mock' },
  // demo: CLAUDE.md §11「demo は全モック」に完全準拠（objectStore も mock）。
  demo: { email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock', ai: 'mock' },
  // sandbox: CLAUDE.md §11「送信系（メール/電子署名）のみモック、それ以外は本番同等」に準拠
  // （billing も real。sandbox テナントは Subscription を持たないため実害なし）。
  sandbox: {
    email: 'sandboxRecipientScoped',
    objectStore: 'real',
    malwareScanner: 'real',
    esign: 'mock',
    billing: 'real',
    ai: 'real',
  },
  staging: { email: 'real', objectStore: 'real', malwareScanner: 'real', esign: 'real', billing: 'real', ai: 'real' },
  production: { email: 'real', objectStore: 'real', malwareScanner: 'real', esign: 'real', billing: 'real', ai: 'real' },
};

describe('resolveConnectorSelection — APP_ENV の 5 値のスナップショット', () => {
  for (const kind of allAppEnvKinds()) {
    it(`APP_ENV=${kind} の選択結果`, () => {
      const env = loadAppEnv(buildValidEnv(kind));
      const selection = resolveConnectorSelection(env);
      expect(selection).toEqual(EXPECTED_SELECTION_BY_KIND[kind]);
      expect(selection).toMatchSnapshot();
    });
  }
});

describe('🔴 production では mock が 1 件も選択されない（NFR-ENV-3）', () => {
  it('production の選択結果に mock を含まない', () => {
    const env = loadAppEnv(buildValidEnv('production'));
    const selection = resolveConnectorSelection(env);
    expect(Object.values(selection)).not.toContain('mock');
  });

  it('development / demo は mock を含む（送信系は既定でモック）', () => {
    for (const kind of ['development', 'demo'] as const) {
      const env = loadAppEnv(buildValidEnv(kind));
      const selection = resolveConnectorSelection(env);
      expect(Object.values(selection), `APP_ENV=${kind}`).toContain('mock');
    }
  });

  it('sandbox の email は宛先分類で分岐する専用の実装（sandboxRecipientScoped）であって mock 単体ではない', () => {
    const env = loadAppEnv(buildValidEnv('sandbox'));
    const selection = resolveConnectorSelection(env);
    expect(selection.email).toBe('sandboxRecipientScoped');
  });
});

describe('assertNoMockInProduction — 実行時の二重防御', () => {
  it('production かつ選択結果に mock が混ざっていたら throw する', () => {
    expect(() =>
      assertNoMockInProduction(
        { APP_ENV: 'production' },
        { email: 'mock', objectStore: 'real', malwareScanner: 'real', esign: 'real', billing: 'real', ai: 'real' },
      ),
    ).toThrow(ProductionMockConnectorError);
  });

  it('production 以外では mock が混ざっていても throw しない（各コネクタの通常の選択結果を尊重する）', () => {
    expect(() =>
      assertNoMockInProduction(
        { APP_ENV: 'development' },
        { email: 'mock', objectStore: 'real', malwareScanner: 'real', esign: 'mock', billing: 'mock', ai: 'mock' },
      ),
    ).not.toThrow();
  });
});
