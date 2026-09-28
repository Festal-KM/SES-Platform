// tests/static/build-node-env-guard.test.ts
// 🔴 `apps/web/next.config.ts` の `assertProductionNodeEnv`（ビルド入口の門番）を固定する。
//
// 何を守るテストか（2026-09-28 の実測に基づく）:
//   環境に `NODE_ENV=development` が残ったまま `next build` を実行すると、Next は production の
//   バンドルを出力する一方で、事前生成のワーカーだけが **React の development 版を内蔵した描画
//   ランタイム**（`app-page-turbo.runtime.dev.js`）を読み込む。React が 2 つ同居するため
//   `useContext` が読む dispatcher が null になり、`/_global-error` の事前生成が
//   `TypeError: Cannot read properties of null (reading 'useContext')` で落ちる。
//   `/_global-error` は Next が `isStatic: true` にハードコードしている合成ページであり、
//   `force-dynamic` でも静的生成から外せない —— つまり回避できず、必ずビルドが落ちる。
//
//   🔴 この門番が消えると、症状は「コンパイルは通り、事前生成だけが source map 無しの
//      TypeError で落ちる」形で戻る。**原因を名指しできない 6 分のビルド**に戻るので、
//      ガードの存在と向きをここで機械的に固定する。
//
// 🔴 **向き（fail-safe）も固定する。** 許可リストは「`development` を許すフェーズ」側にある。
//    ビルドのフェーズ名を列挙する向きにすると、Next がフェーズ名を変えた日にガードが黙って
//    効かなくなる。許す側に置けば、最悪でも「dev で落ちる」= すぐ気づける方向に倒れる。
//    このテストは**未知のフェーズ名で落ちること**を明示的に確かめる。
import { describe, expect, it } from 'vitest';
import nextConfigForPhase, { assertProductionNodeEnv } from '../../apps/web/next.config.js';

/**
 * 🔴 Next の `next/constants` が定める値（`PHASE_PRODUCTION_BUILD` / `PHASE_EXPORT` /
 *    `PHASE_PRODUCTION_SERVER` / `PHASE_DEVELOPMENT_SERVER` / `PHASE_INFO`）。
 *    `next/constants` を import せずリテラルで持つ理由は `next.config.ts` 側の 🔴 と同じ
 *    （設定ファイルに実行時 import を増やさない）。Next が名前を変えた場合、
 *    「dev 用フェーズが許可リストから外れて dev が落ちる」= 気づける方向に壊れる。
 */
const PHASE_PRODUCTION_BUILD = 'phase-production-build';
const PHASE_EXPORT = 'phase-export';
const PHASE_PRODUCTION_SERVER = 'phase-production-server';
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';
const PHASE_INFO = 'phase-info';

describe('assertProductionNodeEnv — NODE_ENV=development のままビルドさせない', () => {
  it.each([PHASE_PRODUCTION_BUILD, PHASE_EXPORT, PHASE_PRODUCTION_SERVER])(
    '%s では NODE_ENV=development を拒否する',
    (phase) => {
      expect(() => {
        assertProductionNodeEnv(phase, 'development');
      }).toThrow(/NODE_ENV=development/);
    },
  );

  it('拒否のメッセージが原因の変数名と症状を名指しする（source map 無しの TypeError に戻さない）', () => {
    let message = '';
    try {
      assertProductionNodeEnv(PHASE_PRODUCTION_BUILD, 'development');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('NODE_ENV');
    expect(message).toContain('production');
    expect(message).toContain('/_global-error');
    expect(message).toContain('useContext');
  });

  it.each([undefined, '', 'production'])('NODE_ENV=%o は通す（未設定は Next が production を割り当てる）', (nodeEnv) => {
    expect(() => {
      assertProductionNodeEnv(PHASE_PRODUCTION_BUILD, nodeEnv);
    }).not.toThrow();
  });

  it.each([PHASE_DEVELOPMENT_SERVER, PHASE_INFO])('%s は NODE_ENV=development を許す', (phase) => {
    expect(() => {
      assertProductionNodeEnv(phase, 'development');
    }).not.toThrow();
  });

  // 🔴 向きの確認。Next が新しいフェーズを足しても、既定は「production を要求する」側である。
  it('未知のフェーズ名では NODE_ENV=development を拒否する（fail-safe な向き）', () => {
    expect(() => {
      assertProductionNodeEnv('phase-something-new', 'development');
    }).toThrow(/NODE_ENV=development/);
  });

  it('test も拒否する（production の成果物を test の NODE_ENV で作らせない）', () => {
    expect(() => {
      assertProductionNodeEnv(PHASE_PRODUCTION_BUILD, 'test');
    }).toThrow(/NODE_ENV=test/);
  });
});

describe('next.config.ts の既定 export — フェーズ関数であり、門番を必ず通る', () => {
  it('フェーズ関数であり、設定の中身はフェーズで変わらない', () => {
    expect(typeof nextConfigForPhase).toBe('function');
    // 🔴 `NODE_ENV` は Vitest では `test` だが、許可フェーズなら門番を通らない。
    const dev = nextConfigForPhase(PHASE_DEVELOPMENT_SERVER);
    const info = nextConfigForPhase(PHASE_INFO);
    expect(dev).toStrictEqual(info);
    // 設定の要点（他のタスクが触る箇所なので、値そのものは固定しない）。
    expect(dev.typescript?.ignoreBuildErrors).toBe(false);
    expect(dev.serverExternalPackages).toContain('@prisma/client');
  });
});
