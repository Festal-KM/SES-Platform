// apps/web/app/(main)/skills/skill-dictionary-screen.render.test.tsx
// `SkillDictionaryScreen`（`S-009`）の状態別描画テスト。T-05-03。
//
// 🔴 なぜこの粒度で要るか: `F-010 AC-1`（**パートナーに採否の導線が無い**）と
//    `F-010 AC-2`（**グローバル別名に操作が無い**）は「無いこと」の検証であり、
//    API の結合テストでは「呼んでも 403 / 404 になる」ことしか示せない。
//    `docs/04` §S-009 は「取引先は候補の起票のみ（採否の導線が無い）」と書いており、
//    押しても拒否されるボタンが画面にあるだけで要件違反である。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`engineer-form.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SkillAliasView, SkillView } from '../../../lib/skills/service';
import {
  SkillDictionaryScreen,
  type SkillDictionaryScreenMessages,
} from './skill-dictionary-screen';

const CANDIDATE_ID = '01930000-0000-7000-8000-0000000000b1';
const GLOBAL_ALIAS_ID = '01930000-0000-7000-8000-0000000000b2';
const TENANT_ALIAS_ID = '01930000-0000-7000-8000-0000000000b3';
const SKILL_JAVA = '01930000-0000-7000-8000-0000000000e1';

function alias(overrides: Partial<SkillAliasView> = {}): SkillAliasView {
  return {
    id: CANDIDATE_ID,
    alias: 'Java8',
    status: 'PROPOSED',
    origin: 'HUMAN',
    scope: 'TENANT',
    skillId: null,
    skillName: null,
    proposedAt: '2026-09-05T02:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

const SKILLS: readonly SkillView[] = [
  { id: SKILL_JAVA, name: 'Java', category: 'LANGUAGE' },
];

const messages: SkillDictionaryScreenMessages = {
  sectionCandidates: '新語候補（採否待ち）',
  candidatesNote: '採用して正規化先を決めるまで、この表記は検索の正規化に使われません。',
  candidatesEmpty: '採否を待っている表記はありません。',
  candidatesColumnAlias: '表記',
  candidatesColumnOrigin: '起票元',
  candidatesColumnProposedAt: '起票日',
  candidatesColumnTarget: '正規化先',
  candidatesColumnActions: '採否',
  candidatesTargetPlaceholder: '正規化先を選ぶ',
  candidatesAccept: '採用',
  candidatesReject: '却下',
  candidatesSubmitting: '反映しています…',
  candidatesAcceptHint: '採用するには正規化先を選んでください。',
  candidatesRejectNote: '却下した表記は候補の一覧から外れます。',
  candidatesError: '採否を反映できませんでした。',
  candidatesReadOnlyNote: '採否の操作はこの画面では行えません。',
  candidatesOccurrenceComingSoon: '出現件数の集計は後続のリリースで表示できるようになります。',

  sectionAliases: '別名の一覧',
  aliasesNote: '採用済みの別名です。',
  aliasesEmpty: '採用済みの別名はまだありません。',
  aliasesColumnAlias: '別名',
  aliasesColumnTarget: '正規化先',
  aliasesColumnScope: '適用範囲',
  aliasesColumnDecidedAt: '決定日',
  scopeLabels: { TENANT: 'この組織のみ', GLOBAL: '全社共通（編集不可）' },
  originLabels: { HUMAN: '手入力', AI: 'AI が提案した正規化先' },

  sectionDictionary: 'グローバル辞書（参照のみ）',
  dictionaryReadOnlyNote: 'グローバル辞書はこの組織から追加・変更・削除はできません。',
  dictionarySearchLabel: 'スキル名で検索',
  dictionarySearchSubmit: '検索',
  dictionarySearchSubmitting: '検索しています…',
  dictionaryColumnName: 'スキル',
  dictionaryColumnCategory: '分類',
  dictionaryEmpty: '条件に一致するスキルはありません。',
  dictionaryError: 'スキル辞書を取得できませんでした。',

  valueNone: '—',
};

function render(options: {
  readonly aliases: readonly SkillAliasView[];
  readonly canDecide: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(SkillDictionaryScreen, {
      initialAliases: { items: options.aliases },
      initialSkills: { items: SKILLS },
      canDecide: options.canDecide,
      messages,
    }),
  );
}

// ⚠️ T-06-01（Issue #36 既定 A）: 採否ロールに `OWNER` を足した。画面は `canDecide` の
//    真偽しか見ないため、ロール一覧の出所（`SKILL_ALIAS_DECIDER_ROLES`）は 1 か所のままである。
describe('🔴 F-010 AC-1: 採否の導線は OWNER / ADMIN / SALES にしか無い', () => {
  it('採否できる立場では、採用・却下のボタンと正規化先の選択が出る', () => {
    const html = render({ aliases: [alias()], canDecide: true });

    expect(html).toContain(`data-testid="skill-candidate-accept-${CANDIDATE_ID}"`);
    expect(html).toContain(`data-testid="skill-candidate-reject-${CANDIDATE_ID}"`);
    expect(html).toContain(`data-testid="skill-candidate-target-${CANDIDATE_ID}"`);
  });

  it('🔴 取引先・VIEWER には採否の導線が DOM に存在しない（隠すのではなく描かない）', () => {
    const html = render({ aliases: [alias()], canDecide: false });

    expect(html).not.toContain('skill-candidate-accept-');
    expect(html).not.toContain('skill-candidate-reject-');
    expect(html).not.toContain('skill-candidate-target-');
    // 🔴 行き止まりにしない（誰が決めるのかを書く）。
    expect(html).toContain('data-testid="skill-candidates-read-only-note"');
    expect(html).toContain(messages.candidatesReadOnlyNote);
  });

  it('🔴 候補は起票された表記として見えるが、採用前は正規化先を持たない', () => {
    const html = render({ aliases: [alias()], canDecide: false });

    expect(html).toContain('Java8');
    expect(html).toContain(messages.candidatesNote);
  });

  it('🔴 採用は正規化先を選ぶまで実行できない（ボタンが disabled）', () => {
    const html = render({ aliases: [alias()], canDecide: true });
    const acceptIndex = html.indexOf(`data-testid="skill-candidate-accept-${CANDIDATE_ID}"`);
    const buttonStart = html.lastIndexOf('<button', acceptIndex);

    expect(html.slice(buttonStart, acceptIndex)).toContain('disabled');
  });
});

describe('🔴 F-010 AC-2: グローバル辞書はこの組織から編集できない', () => {
  it('グローバル別名は「全社共通（編集不可）」として読み取り専用で並ぶ', () => {
    const html = render({
      aliases: [
        alias({
          id: GLOBAL_ALIAS_ID,
          alias: 'JavaSE',
          status: 'ACCEPTED',
          scope: 'GLOBAL',
          skillId: SKILL_JAVA,
          skillName: 'Java',
          decidedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
      canDecide: true,
    });

    expect(html).toContain(`data-testid="skill-alias-row-${GLOBAL_ALIAS_ID}"`);
    expect(html).toContain('data-scope="GLOBAL"');
    expect(html).toContain(messages.scopeLabels.GLOBAL);
    // 🔴 採否できる立場でも、決着済みの行に操作は出ない（候補セクションに現れない）。
    expect(html).not.toContain(`skill-candidate-accept-${GLOBAL_ALIAS_ID}`);
  });

  it('🔴 `PROPOSED` のグローバル別名には、採否できる立場でも操作が DOM に存在しない', () => {
    const html = render({
      aliases: [alias({ id: GLOBAL_ALIAS_ID, alias: 'JavaSE', scope: 'GLOBAL' })],
      canDecide: true,
    });

    // 候補としては見える（`skill_aliases` の C1 は `OR tenant_id IS NULL` を読む）。
    expect(html).toContain(`data-testid="skill-candidate-row-${GLOBAL_ALIAS_ID}"`);
    // 🔴 押しても 403 になるボタンを画面に出さない（`F-010 AC-2`）。
    expect(html).not.toContain(`skill-candidate-accept-${GLOBAL_ALIAS_ID}`);
    expect(html).not.toContain(`skill-candidate-reject-${GLOBAL_ALIAS_ID}`);
    expect(html).not.toContain(`skill-candidate-target-${GLOBAL_ALIAS_ID}`);
    // 代わりに「編集できない理由」を読み取り専用で示す。
    expect(html).toContain(`data-testid="skill-candidate-read-only-${GLOBAL_ALIAS_ID}"`);
    expect(html).toContain(messages.scopeLabels.GLOBAL);
  });

  it('🔴 同じ表でもテナント行には操作が出る（グローバル行だけが読み取り専用である）', () => {
    const html = render({
      aliases: [
        alias({ id: GLOBAL_ALIAS_ID, alias: 'JavaSE', scope: 'GLOBAL' }),
        alias({ id: CANDIDATE_ID, alias: 'Java8', scope: 'TENANT' }),
      ],
      canDecide: true,
    });

    expect(html).toContain(`data-testid="skill-candidate-accept-${CANDIDATE_ID}"`);
    expect(html).toContain(`data-testid="skill-candidate-target-${CANDIDATE_ID}"`);
    expect(html).not.toContain(`skill-candidate-accept-${GLOBAL_ALIAS_ID}`);
    expect(html).not.toContain(`skill-candidate-target-${GLOBAL_ALIAS_ID}`);
  });

  it('辞書セクションに読み取り専用である旨が常時出る（導線を消すだけにしない）', () => {
    const html = render({ aliases: [], canDecide: true });

    expect(html).toContain('data-testid="skill-dictionary-read-only-note"');
    expect(html).toContain(messages.dictionaryReadOnlyNote);
    expect(html).toContain('Java');
  });
});

describe('セクションの分かれ方と空表示（docs/04 §S-009）', () => {
  it('🔴 新語候補が 0 件のときは「正常である」と読める空表示になる', () => {
    const html = render({ aliases: [], canDecide: true });

    expect(html).toContain('data-testid="skill-candidates-empty"');
    expect(html).toContain(messages.candidatesEmpty);
  });

  it('採用済みのテナント別名は別名セクションに出る（候補には出ない）', () => {
    const html = render({
      aliases: [
        alias({
          id: TENANT_ALIAS_ID,
          alias: 'Java 8',
          status: 'ACCEPTED',
          skillId: SKILL_JAVA,
          skillName: 'Java',
          decidedAt: '2026-09-05T03:00:00.000Z',
        }),
      ],
      canDecide: true,
    });

    expect(html).toContain(`data-testid="skill-alias-row-${TENANT_ALIAS_ID}"`);
    expect(html).toContain('data-testid="skill-candidates-empty"');
  });

  it('🔴 却下済みの候補はどちらのセクションにも出ない（「候補を閉じる」）', () => {
    const html = render({
      aliases: [alias({ status: 'REJECTED', decidedAt: '2026-09-05T03:00:00.000Z' })],
      canDecide: true,
    });

    expect(html).toContain('data-testid="skill-candidates-empty"');
    expect(html).toContain('data-testid="skill-aliases-empty"');
    expect(html).not.toContain('Java8');
  });

  it('出せない列（出現件数）は隠さずに、いま出せないことを書く', () => {
    const html = render({ aliases: [alias()], canDecide: true });

    expect(html).toContain('data-testid="skill-candidates-occurrence-note"');
    expect(html).toContain(messages.candidatesOccurrenceComingSoon);
  });

  it('由来（手入力 / AI）を常時 1 行で示す（docs/04 §9）', () => {
    const human = render({ aliases: [alias()], canDecide: false });
    const ai = render({ aliases: [alias({ origin: 'AI' })], canDecide: false });

    expect(human).toContain(messages.originLabels.HUMAN);
    expect(ai).toContain(messages.originLabels.AI);
  });
});
