// packages/config/src/connector-selection.test.ts
// SP-01 T-01-03 完了判定: 「APP_ENV の 5 値それぞれでファクトリが返す実装のスナップショットテスト」。
// docs/05 §13.1 の起動時 DI（唯一の分岐点）を検証する。

import { describe, expect, it } from 'vitest';
import type { ConnectorSelection } from './connector-selection.js';
import { assertNoMockInProduction, isAllMockEmailEnv, resolveConnectorSelection } from './connector-selection.js';
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

  // ✅ T-10-07: `F-053 AC-5` / `BR-45`。`demo` は宛先による区別（`sandbox` の `sandboxRecipientScoped`）を**適用せず**、送信系
  //    （email / esign）を含む全区分が `mock` である。上のスナップショットと同じ事実だが、受け入れ基準の名前で 1 本固定する
  //    （`demo` の行だけが `sandbox` 側へ寄せられた変更を、AC の名前で落とす）。
  it('🔴 F-053 AC-5: demo は全送信系がモックであり、sandbox の宛先分類（sandboxRecipientScoped）を適用しない', () => {
    const selection = resolveConnectorSelection(loadAppEnv(buildValidEnv('demo')));
    expect(selection.email).toBe('mock');
    expect(selection.esign).toBe('mock');
    expect(Object.values(selection)).not.toContain('sandboxRecipientScoped');
    expect(Object.values(selection)).not.toContain('real');
  });
});

// ✅ T-10-12: `EmailDispatch.status='MOCKED'` を「配送済み」とみなしてよい環境（docs/05 §9.7 `tenant.purge-scan`）。
//    判定は上の選択表（`email` 区分）から導かれ、環境名の列挙をテスト側にも実装側にも持たない。
describe('🔴 isAllMockEmailEnv — MOCKED を配送済みとみなせるのは email が mock の環境だけ（docs/05 §9.7）', () => {
  it('development / demo は true（送信系が全てモック）', () => {
    expect(isAllMockEmailEnv('development')).toBe(true);
    expect(isAllMockEmailEnv('demo')).toBe(true);
  });

  it('🔴 sandbox は false（分類 1 は実送信されるため MOCKED は「届いていない」の記録）', () => {
    expect(isAllMockEmailEnv('sandbox')).toBe(false);
  });

  it('staging / production は false', () => {
    expect(isAllMockEmailEnv('staging')).toBe(false);
    expect(isAllMockEmailEnv('production')).toBe(false);
  });

  it('判定は選択表の email 区分と一致する（表が変われば同時に変わる）', () => {
    for (const kind of allAppEnvKinds()) {
      const selection = resolveConnectorSelection(loadAppEnv(buildValidEnv(kind)));
      expect(isAllMockEmailEnv(kind), `APP_ENV=${kind}`).toBe(selection.email === 'mock');
    }
  });
});

describe('assertNoMockInProduction — 実行時の二重防御', () => {
  const ALL_REAL: ConnectorSelection = { email: 'real', objectStore: 'real', malwareScanner: 'real', esign: 'real', billing: 'real', ai: 'real' };
  const CATEGORIES = Object.keys(ALL_REAL) as (keyof ConnectorSelection)[];

  // ✅ T-12-04（docs/05 §17.4「`production` の起動検証」）: **6 区分すべて**を 1 つずつ `mock` にして走査する。
  //    email / objectStore / billing / ai は環境変数でモックを指名できない（選択表が `APP_ENV` だけで決まる）ため、
  //    スキーマの枝では落ちようがなく、**この走査が唯一の防御**である（`schema.test.ts` の T-12-04 ① と対）。
  it('走査する区分は 6 つ（縮んでいたら網羅が空振りする）', () => {
    expect(CATEGORIES).toEqual(['email', 'objectStore', 'malwareScanner', 'esign', 'billing', 'ai']);
  });

  it.each(CATEGORIES)('🔴 production で %s だけが mock でも起動失敗（ProductionMockConnectorError に区分名が載る）', (category) => {
    const selection: ConnectorSelection = { ...ALL_REAL, [category]: 'mock' };
    let caught: unknown;
    try {
      assertNoMockInProduction({ APP_ENV: 'production' }, selection);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProductionMockConnectorError);
    expect(String((caught as Error).message)).toContain(category);
  });

  it('🔴 production で sandboxRecipientScoped（メールの宛先分岐）が選ばれても mock ではないので走査は通す —— 選択表がそれを返さないことは上のスナップショットが固定する', () => {
    expect(() => assertNoMockInProduction({ APP_ENV: 'production' }, { ...ALL_REAL, email: 'sandboxRecipientScoped' })).not.toThrow();
    expect(resolveConnectorSelection(loadAppEnv(buildValidEnv('production'))).email).toBe('real');
  });

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
