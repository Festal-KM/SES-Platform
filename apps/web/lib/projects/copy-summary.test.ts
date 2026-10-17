// apps/web/lib/projects/copy-summary.test.ts
// ✅✅ 2026-10-16: 案件サマリの「コピペ用サマリ」の本文（人間の明示指示）。
//
// 🔴 **ここで固定したいのは 3 つだけである**:
//     ①貼れる形になっていること（1 項目 1 行・`【…】` のラベル）
//     ②🔴 **商流情報とホスト内部の情報が 1 つも入らないこと**（`CLAUDE.md` §3.1）
//     ③未設定（`—`）と、必須要件の超過（上位 3 件しか持たない）の扱い
import { describe, expect, it } from 'vitest';
import { COPY_SUMMARY_EXCLUDED_FIELDS, projectCopySummary } from './copy-summary';
import type { ProjectListRowView } from './list-rows';

const PROJECT_A = '01930000-0000-7000-8000-00000000000a';

function row(overrides: Partial<ProjectListRowView> = {}): ProjectListRowView {
  return {
    id: PROJECT_A,
    name: '金融系 Web API 改修',
    status: '募集中',
    statusState: 'OPEN',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '65〜75 万円',
    startDate: '2026-10-01',
    location: '東京都',
    remoteMode: '一部リモート可',
    headcount: '2 名',
    updatedOn: '2026-09-05',
    // 🔴 ホスト内部の情報。**本文に出てはならない**（下の検査）。
    visibility: '3 社に公開中',
    ...overrides,
  };
}

describe('コピペ用サマリ（そのまま貼れるテキスト）', () => {
  it('1 項目 1 行で、`【ラベル】値` の形になる', () => {
    const text = projectCopySummary(row());

    expect(text.split('\n')[0]).toBe('【案件名】金融系 Web API 改修');
    expect(text).toContain('【ステータス】募集中');
    expect(text).toContain('【必須要件】Java 5 年以上、Spring');
    expect(text).toContain('【単価】65〜75 万円');
    expect(text).toContain('【開始時期】2026-10-01');
    expect(text).toContain('【勤務地】東京都');
    expect(text).toContain('【稼働形態】一部リモート可');
    expect(text).toContain('【募集人数】2 名');
  });

  it('🔴🔴 ホスト内部の情報（公開先の設定状況）を 1 つも入れない', () => {
    // 🔴 貼り先が取引先なら**他社の存在を漏らす**（`CLAUDE.md` §3.1 の 🔴
    //    「パートナー同士が相互に参照できる経路を 1 つも作らない」）。
    const text = projectCopySummary(row());

    expect(text).not.toContain('3 社に公開中');
    expect(text).not.toContain('公開先');
    // 🔴 「意図して落としたもの」が名前で残っていること（レビューが数えられる）。
    expect(COPY_SUMMARY_EXCLUDED_FIELDS).toContain('visibility');
  });

  it('🔴 商流情報を入れる余地が無い（行の型にそもそも無い）', () => {
    const text = projectCopySummary(row());

    for (const word of ['エンド', '商流', '内部単価', '卸単価', '担当者']) {
      expect(text, `${word} が入っている`).not.toContain(word);
    }
  });

  it('未設定（`—`）の項目は行ごと落とす', () => {
    // 🔴 `【開始時期】—` を貼られた相手は「未定」か「書き忘れ」か判断できない。
    const text = projectCopySummary(row({ startDate: '—', location: '—' }));

    expect(text).not.toContain('【開始時期】');
    expect(text).not.toContain('【勤務地】');
    // 他の項目は残る。
    expect(text).toContain('【案件名】金融系 Web API 改修');
  });

  it('稼働形態が未設定（`null`）なら行ごと出さない', () => {
    expect(projectCopySummary(row({ remoteMode: null }))).not.toContain('【稼働形態】');
  });

  it('🔴 必須要件の超過は「（ほか N 件）」で示す（黙って落とさない）', () => {
    // 🔴 一覧の行は上位 3 件しか持たない。超過を落とすと、**貼られたテキストだけが
    //    要件を満たしているように見える**。
    const text = projectCopySummary(row({ moreMustRequirements: '+2' }));

    expect(text).toContain('【必須要件】Java 5 年以上、Spring（ほか 2 件）');
    // 🔴 `+2` の記号をそのまま貼らない（文章の中では読めない）。
    expect(text).not.toContain('+2');
  });

  it('🔴 同じ行からは常に同じテキストが出る（純粋関数）', () => {
    expect(projectCopySummary(row())).toBe(projectCopySummary(row()));
  });
});
