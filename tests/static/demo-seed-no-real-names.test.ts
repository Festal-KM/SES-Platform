// tests/static/demo-seed-no-real-names.test.ts
// 🔴 `F-053 AC-1` / `BR-47` / `CLAUDE.md` §11「`demo` は合成データのみ」: `seed:demo` のソース
//    （`packages/db/seed/presets/demo.ts`）に**実在の企業名・実在のドメイン・実在の個人名を思わせる語が無い**ことを
//    走査で固定する。T-10-06。
//
// なぜ静的テストか: 結合テスト（`tests/isolation/seed-demo.test.ts`）は投入された行の値を接頭辞規則と突き合わせるが、
// 「規則の外の語をソースに書いた」瞬間に気づけるのはここである（実 DB を要らず、CI で毎回走る）。
//
// 🔴 禁止リストは**合理的な範囲**に留める（docs/sprints/SP-10 T-10-06「禁止リストは合理的な範囲」）:
//   - 国内の大手 SIer / 主要 IT ベンダの商号（社名の主要部分。表記ゆれは代表形で見る）
//   - 実在の企業に紐づく `.co.jp` / `.com` のドメイン
//   - 実在しうる個人名の形（姓が架空を示す語でない「漢字 2 文字 + 空白 + 名」）は、氏名の生成規則
//     （`DEMO_SEED_NAME_RULES.familyNames`）の外の姓を**ソース中の氏名リテラル**として書いていないことで担保する
// 🔴 ここに「実在名の網羅リスト」を作ろうとしない。網羅は不可能であり、規則（接頭辞）で守るのが本筋である
//    （結合テスト側が全行を規則で照合する）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_SEED_NAME_RULES } from '../../packages/db/seed/presets/demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const PRESET_FILE = path.join(repoRoot, 'packages', 'db', 'seed', 'presets', 'demo.ts');

/** コメントを落としたソース（設計意図のコメントに社名の例が出ても検査を落とさない。判定は「値として書かれているか」）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

/**
 * 🔴 実在の企業名（国内の大手 SIer / 主要ベンダ / 一般によく知られた企業。合理的な範囲）。
 *    値に 1 つでも現れたら落とす（部分一致。表記ゆれは代表形）。
 */
const REAL_COMPANY_NAMES: readonly string[] = [
  '富士通',
  'NTTデータ',
  'NTT データ',
  '日立',
  '日本電気',
  'NEC',
  'IBM',
  'アクセンチュア',
  'Accenture',
  '野村総合研究所',
  'NRI',
  'SCSK',
  'TIS',
  'BIPROGY',
  '日本ユニシス',
  '伊藤忠テクノソリューションズ',
  'CTC',
  '大塚商会',
  'オービック',
  'トヨタ',
  'ソニー',
  'パナソニック',
  '楽天',
  'メルカリ',
  'サイバーエージェント',
  'リクルート',
  'ソフトバンク',
  'KDDI',
  'Microsoft',
  'Google',
  'Amazon',
  'Meta',
  'Oracle',
  'Salesforce',
  '三菱',
  '三井',
  '住友',
  'みずほ',
];

/** 🔴 実在の企業に紐づくドメイン（`.co.jp` / `.com` の既知の企業）。RFC 6761 の予約 TLD（`.example` / `.test`）以外を値に使わない。 */
const REAL_DOMAIN_PATTERNS: readonly RegExp[] = [
  /[a-z0-9-]+\.co\.jp/i,
  /[a-z0-9-]+\.ne\.jp/i,
  /[a-z0-9-]+\.or\.jp/i,
  /(?:fujitsu|nttdata|hitachi|nec|ibm|accenture|nri|scsk|tis|biprogy|ctc|otsuka|obic|toyota|sony|panasonic|rakuten|mercari|cyberagent|recruit|softbank|kddi|microsoft|google|amazon|oracle|salesforce)\.(?:com|jp|net)/i,
];

/** 値として現れるメール・ドメインは予約 TLD だけ。 */
const ALLOWED_TLDS = ['.example', '.test'] as const;

describe('🔴 seed:demo のソースに実在の企業名・ドメイン・個人名を思わせる語が無い（F-053 AC-1 / BR-47）', () => {
  const source = readFileSync(PRESET_FILE, 'utf8');
  const code = stripComments(source);

  it('対照: 走査対象が空振りしていない（demo プリセットの本体を読んでいる）', () => {
    expect(code).toContain("name: 'demo'");
    expect(code).toContain('DEMO_SEED_NAME_RULES');
  });

  it.each(REAL_COMPANY_NAMES)('🔴 実在の企業名「%s」が値として現れない', (name) => {
    expect(code).not.toContain(name);
  });

  it('🔴 実在の企業に紐づくドメイン（.co.jp / .ne.jp / .or.jp / 既知企業の .com|.jp|.net）が現れない', () => {
    for (const pattern of REAL_DOMAIN_PATTERNS) {
      expect(code.match(pattern), pattern.source).toBeNull();
    }
  });

  it('🔴 ドメインとして書かれている文字列は RFC 6761 の予約 TLD（.example / .test）だけである', () => {
    const domains = code.match(/[a-z0-9-]+\.[a-z0-9.-]*[a-z]{2,}/gi) ?? [];
    const suspicious = domains
      // `docs/05` / `F-053` / `tests/static/x.test.ts` のような参照や、拡張子・小数を除く。
      .filter((value) => /\.(?:example|test|jp|com|net|org|io|dev)$/i.test(value))
      .filter((value) => !ALLOWED_TLDS.some((tld) => value.toLowerCase().endsWith(tld)));
    expect(suspicious).toEqual([]);
  });

  it('🔴 氏名のリテラルは生成規則の姓（DEMO_SEED_NAME_RULES.familyNames）からしか作られない', () => {
    // 「漢字またはカナ 1〜4 文字 + 空白 + 名」の形の文字列リテラル（氏名の形）を拾い、姓が規則内であることを見る。
    const nameLiterals = [...code.matchAll(/'([^'\n]{1,6}) ([^'\n]{1,4})'/g)]
      .map((match) => match[1] as string)
      .filter((family) => /^[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]+$/u.test(family));
    const outside = nameLiterals.filter(
      (family) => !(DEMO_SEED_NAME_RULES.familyNames as readonly string[]).includes(family),
    );
    expect(outside).toEqual([]);
  });

  it('生成規則そのものが「架空であることが語から分かる」語で構成されている（規則を実在名に変えられない）', () => {
    for (const family of DEMO_SEED_NAME_RULES.familyNames) {
      expect(['サンプル', '架空', '仮名', '見本', '例示', '試験', '模擬', '仮想']).toContain(family);
    }
    for (const prefix of DEMO_SEED_NAME_RULES.companyPrefixes) {
      expect(['株式会社サンプル', '株式会社ダミー', '架空']).toContain(prefix);
    }
    expect(DEMO_SEED_NAME_RULES.partnerCompanyPrefix).toBe('株式会社ダミー');
    expect(DEMO_SEED_NAME_RULES.endClientPrefix).toBe('架空');
  });
});
