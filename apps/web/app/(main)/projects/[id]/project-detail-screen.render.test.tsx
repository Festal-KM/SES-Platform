// apps/web/app/(main)/projects/[id]/project-detail-screen.render.test.tsx
// `ProjectDetailScreen`（`S-011`）の視点別描画テスト。T-06-02。
//
// 🔴 なぜこの粒度が要るか: `F-013 AC-2` / `F-014 AC-4` は「**描かれていないこと**」が要件であり、
//    API のテスト（応答の形）でも型テスト（フィールドの有無）でも示せない最後の 1 段がここにある
//    —— 型の上では無いフィールドでも、画面が別経路（props・定数・文言）で同じ値を出してしまえば
//    同じ事故になる。**取引先視点の HTML に商流情報の文字列が 1 つも現れないこと**を、
//    描画結果そのもので固定する（`engineer-ledger-screen.render.test.tsx` と同じ判断）。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RequirementKind } from '@ses/db';
import type { ProjectPublishRevocation } from '@ses/domain';
import type {
  HostProjectDetailView,
  PartnerProjectDetailView,
  ProjectRequirementView,
} from '../../../../lib/projects/service';
import {
  ProjectDetailScreen,
  type ProjectDetailScreenMessages,
} from './project-detail-screen';

/** 🔴 取引先の HTML に 1 度も現れてはならない値。 */
const END_CLIENT_NAME = '架空エンド株式会社';
const INTERNAL_UNIT_PRICE = 987_654;
const PARTNER_A_NAME = '架空パートナー A';
const PARTNER_B_NAME = '架空パートナー B';

const REQUIREMENT_KINDS: readonly RequirementKind[] = ['MUST', 'NICE'];

const REQUIREMENTS: readonly ProjectRequirementView[] = [
  { kind: 'MUST', skillId: 'sk-1', skillName: 'Java', freeText: null, requiredYears: 3 },
  { kind: 'NICE', skillId: null, skillName: null, freeText: 'AWS の運用経験', requiredYears: null },
];

const SHARED = {
  id: '01930000-0000-7000-8000-0000000000a1',
  name: '合成案件（詳細）',
  status: 'OPEN',
  headcount: 2,
  startDate: '2026-10-01',
  unitPriceMin: 600_000,
  unitPriceMax: 800_000,
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  publicSummary: '公開用の概要（合成データ）',
  requirements: REQUIREMENTS,
} as const;

function hostView(overrides: Partial<HostProjectDetailView> = {}): HostProjectDetailView {
  return {
    ...SHARED,
    audience: 'HOST',
    endClientName: END_CLIENT_NAME,
    internalUnitPrice: INTERNAL_UNIT_PRICE,
    visibilities: [
      { partnerCompanyId: 'p-1', partnerCompanyName: PARTNER_A_NAME, publishedOn: '2026-08-01' },
      { partnerCompanyId: 'p-2', partnerCompanyName: PARTNER_B_NAME, publishedOn: '2026-08-02' },
    ],
    // 🔴 T-12-10: 公開の状態（4 値）。既定は「2 社に公開中・再検査なし」。
    publishState: { state: 'PUBLISHED', visibleToCount: 2, recheckRunning: false, latestGate: null },
    ...overrides,
  };
}

function partnerView(): PartnerProjectDetailView {
  return { ...SHARED, audience: 'PARTNER' };
}

const messages: ProjectDetailScreenMessages = {
  sectionRequirements: '要件',
  sectionConditions: '条件',
  sectionCommerce: '商流情報（内部用）',
  sectionPublicSummary: '外部公開用の記載',
  sectionVisibility: '公開範囲',
  sectionProposals: 'この案件への提案',
  requirementHeadings: { MUST: '必須要件', NICE: '尚可要件' },
  requirementNotes: { MUST: '必須の説明', NICE: '尚可の説明' },
  requirementEmpties: { MUST: '必須要件はありません', NICE: '尚可要件はありません' },
  requirementColumnRequirement: '要件',
  requirementColumnYears: '必要年数',
  publicSummaryEmpty: '—',
  commerceNotice: 'この情報は公開範囲の相手には表示されません。',
  visibilityEmpty: 'この案件はまだどの取引先にも公開されていません。',
  visibilityColumnPartner: '取引先',
  visibilityColumnPublishedOn: '公開日',
  visibilityProposalCountComingSoon: '提案数は後続のリリース。',
  visibilitySettings: '公開範囲を設定',
  partnerPublished: 'この案件は御社に公開されています。',
  proposalsEmpty: 'まだ提案はありません。',
  proposalsComingSoon: '提案の一覧は後続のリリース。',
  candidates: '候補を探す',
  edit: '編集',
  viewRecorded: 'この案件の閲覧は監査ログに記録されます。',
  // 🔴 T-12-10: 公開の状態（4 値）の語（`docs/04` 改訂 14 §S-011）。
  publishState: {
    autoRevokedTitle: '検査で問題が見つかったため、この案件の公開を解除しました。',
    autoRevokedFieldsLabel: '原因の欄',
    fieldLabels: {
      name: '案件名',
      publicSummary: '外部公開用の記載',
      requirementFreeText: '要件の自由記述',
    },
    autoRevokedInconclusive: '検査を完了できなかったため、この案件の公開を解除しました。',
    autoRevokedHiddenFromPrefix: '公開先だった ',
    autoRevokedHiddenFromSuffix: ' 社の画面から、この案件は見えなくなっています。',
    autoRevokedRecovery: '再び公開するには、指摘された欄を直して再検査に通す必要があります。',
    autoRevokedFindings: '指摘を見る',
    autoRevokedFix: '該当の欄を直す',
    autoRevokedReadOnly: '閲覧のみの権限では行えません。',
    recheckRunning: '公開中の内容を再検査しています。',
    recheckRunningNote: 'このページを離れても検査は続きます。',
    heldTitle: '公開は維持されています。',
    heldLead: 'AI が上限に達しているため、再検査をまだ実行できていません。',
    heldResetAt: '再開の見込み',
    heldLimitRaise: '上限の引き上げは運営者が行います。',
  },
};

function render(
  view: HostProjectDetailView | PartnerProjectDetailView,
  canEdit = true,
): string {
  return renderToStaticMarkup(
    createElement(ProjectDetailScreen, {
      view,
      requirementKinds: REQUIREMENT_KINDS,
      canEdit,
      messages,
    }),
  );
}

describe('🔴 F-013 AC-2: 取引先の画面に商流情報が現れない', () => {
  it('エンド企業名・自社単価が HTML に 1 文字も無い', () => {
    const html = render(partnerView());

    expect(html).not.toContain(END_CLIENT_NAME);
    expect(html).not.toContain('987,654');
    expect(html).not.toContain(messages.sectionCommerce);
    expect(html).not.toContain(messages.commerceNotice);
    expect(html).not.toContain('project-detail-commerce');
  });

  it('ホストには同じ値が出る（対照。「そもそも描いていない」ではないことの確認）', () => {
    const html = render(hostView());

    expect(html).toContain(END_CLIENT_NAME);
    expect(html).toContain('987,654');
    expect(html).toContain('data-testid="project-detail-commerce-endClientName"');
  });
});

describe('🔴 F-014 AC-4 / BR-07: 取引先が他社の存在を知る手段が無い', () => {
  it('公開先の社名・件数・公開範囲セクションが HTML に無い', () => {
    const html = render(partnerView());

    expect(html).not.toContain(PARTNER_A_NAME);
    expect(html).not.toContain(PARTNER_B_NAME);
    expect(html).not.toContain(messages.sectionVisibility);
    expect(html).not.toContain('project-detail-visibility');
  });

  it('🔴 「他 N 社」「N 件中」に相当する数字を含まない（件数バッジ・示唆を作らない）', () => {
    const html = render(partnerView());

    // 公開先は 2 社あるが、取引先の HTML には社数を表す数字が現れない。
    expect(html).not.toContain('2 社');
    expect(html).not.toContain(String(SHARED.requirements.length) + ' 件');
  });

  it('ホストには公開先テーブルが出る（対照）', () => {
    const html = render(hostView());

    expect(html).toContain('data-testid="project-detail-visibility-table"');
    expect(html).toContain(PARTNER_A_NAME);
    expect(html).toContain(PARTNER_B_NAME);
  });
});

describe('✅ T-06-06: `S-013`（公開範囲の設定）への導線', () => {
  it('ホストの編集可能なロールには導線が出る', () => {
    const html = render(hostView());

    expect(html).toContain('data-testid="project-detail-visibility-settings"');
    expect(html).toContain(`href="/projects/${SHARED.id}/visibility"`);
    expect(html).toContain(messages.visibilitySettings);
  });

  it('🔴 `VIEWER`（`canEdit=false`）には出さない（公開範囲を変更できない。`BR-31`）', () => {
    const html = render(hostView(), false);

    expect(html).not.toContain('data-testid="project-detail-visibility-settings"');
    expect(html).not.toContain('/visibility');
  });

  it('🔴 取引先には出さない（公開範囲セクション自体がホスト専用）', () => {
    expect(render(partnerView())).not.toContain('/visibility');
  });
});

describe('🔴 F-014 AC-2: 公開先が 0 件のホストには警告が出る', () => {
  it('要件より前に警告が置かれる（設定を忘れると誰にも届かないため）', () => {
    // 🔴 T-12-10: 条件は「公開先 0 社」ではなく**公開の状態の 4 値**である（`docs/04` 改訂 14
    //    §S-011。同じ 0 社でも自動解除なら別の帯を出す）。fixture も実際の応答に合わせる。
    const html = render(
      hostView({
        visibilities: [],
        publishState: { state: 'UNPUBLISHED', visibleToCount: 0, latestGate: null },
      }),
    );

    const warningIndex = html.indexOf('data-testid="project-detail-visibility-warning"');
    const requirementsIndex = html.indexOf('data-testid="project-detail-requirements"');
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(requirementsIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeLessThan(requirementsIndex);
  });

  it('🔴 取引先には警告を出さない（公開範囲はホストの関心事である）', () => {
    expect(render(partnerView())).not.toContain(messages.visibilityEmpty);
  });
});

describe('取引先の見え方（docs/04 §S-011 取引先セクション）', () => {
  it('公開されている旨の説明が出る', () => {
    const html = render(partnerView());

    expect(html).toContain('data-testid="project-detail-partner-published"');
    expect(html).toContain(messages.partnerPublished);
  });

  it('🔴 要件・条件・外部公開用の記載は取引先にも出る（判断材料を隠さない）', () => {
    const html = render(partnerView());

    expect(html).toContain('Java');
    expect(html).toContain('AWS の運用経験');
    // 外部公開用の単価レンジは出す（内部単価とは別の列である）。
    expect(html).toContain('600,000〜800,000');
    expect(html).toContain(SHARED.publicSummary);
  });

  it('🔴 編集への導線を出さない（`canEdit=false`）', () => {
    expect(render(partnerView(), false)).not.toContain('project-detail-edit-link');
  });
});

describe('共通', () => {
  it('🔴 見出しの 3 値は折りたたみの外にある（CLAUDE.md §13.3）', () => {
    for (const html of [render(hostView()), render(partnerView())]) {
      expect(html).toContain('data-testid="project-detail-headline-status"');
      expect(html).toContain('data-testid="project-detail-headline-headcount"');
      expect(html).toContain('data-testid="project-detail-headline-startDate"');
      // 折りたたみ要素（`<details>`）を使っていない ＝ 既定で隠れる項目が無い。
      expect(html).not.toContain('<details');
    }
  });

  it('必須 / 尚可の 2 ブロックが区分ごとに描かれる（`F-013 AC-1`）', () => {
    const html = render(hostView());

    expect(html).toContain('data-testid="project-detail-requirements-MUST"');
    expect(html).toContain('data-testid="project-detail-requirements-NICE"');
  });

  it('🔴 閲覧が記録される旨を出す（`BR-27` / `F-013 AC-3`）', () => {
    for (const html of [render(hostView()), render(partnerView())]) {
      expect(html).toContain(messages.viewRecorded);
    }
  });

  it('判別子が DOM に出る（E2E がホスト / 取引先の枝を取り違えないための目印）', () => {
    expect(render(hostView())).toContain('data-audience="HOST"');
    expect(render(partnerView())).toContain('data-audience="PARTNER"');
  });
});

describe('🔴 T-11-12: 公開先テーブルの会社名セル（docs/04 §10.3「長い名称」。詳細画面が無いので切り詰めない）', () => {
  it('下限 10rem を保ち、どのブレークポイントでも折り返す。リンクも切り詰めの語も無い', () => {
    const html = render(hostView());
    const cell = new RegExp(`<td class="([^"]*)"><span class="([^"]*)" title="${PARTNER_A_NAME}">${PARTNER_A_NAME}<[/]span><[/]td>`).exec(html);
    expect(cell).not.toBeNull();
    const classes = (cell?.[1] ?? '').split(' ');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('min-w-40');
    expect(classes).not.toContain('lg:max-w-64');
    expect(cell?.[2]).toBe('block');
    expect(html).not.toContain('lg:truncate');
    // 公開先の会社名からリンクで辿る先は無い（`S-013` への導線は表の下に別にある）。
    expect(html).not.toMatch(new RegExp(`<a [^>]*>${PARTNER_A_NAME}<`));
  });
});

// ============================================================================
// 🔴 T-12-10: 公開の状態（4 値。`docs/04` 改訂 14 §S-011 / `F-014 AC-9` / `AC-12`）
// ============================================================================
describe('🔴 T-12-10: 公開の状態の 4 値が別の語・別の見た目で描かれる', () => {
  const REVOCATION: ProjectPublishRevocation = {
    revokedAt: '2026-09-21T02:00:00.000Z',
    revokedPartnerCount: 2,
    reviewGateId: '01930000-0000-7000-8000-0000000000f1',
    // 🔴 原因の欄は**非空タプル**である（`fields` が空の `GATE_FINDINGS` を型として作らない）。
    cause: { kind: 'GATE_FINDINGS', fields: ['publicSummary'] },
  };

  it('未公開（`UNPUBLISHED`）: 既存の「まだどの取引先にも公開されていません」だけが出る', () => {
    const html = render(
      hostView({
        visibilities: [],
        publishState: { state: 'UNPUBLISHED', visibleToCount: 0, latestGate: null },
      }),
    );
    expect(html).toContain('data-testid="project-detail-visibility-warning"');
    expect(html).not.toContain('data-testid="project-detail-publish-auto-revoked"');
  });

  it('🔴 自動解除（`AUTO_REVOKED`）: 帯 + 原因の欄 + 「N 社の画面から見えなくなっています」+ 復帰手順', () => {
    const html = render(
      hostView({
        visibilities: [],
        publishState: {
          state: 'AUTO_REVOKED',
          visibleToCount: 0,
          revocation: REVOCATION,
          latestGate: null,
        },
      }),
    );
    expect(html).toContain('data-testid="project-detail-publish-auto-revoked"');
    expect(html).toContain(messages.publishState.autoRevokedTitle);
    // 原因の欄は閉集合の語（`S-012` の入力欄と同じ語）。
    expect(html).toContain(messages.publishState.fieldLabels.publicSummary);
    expect(html).toContain(messages.publishState.autoRevokedHiddenFromSuffix);
    expect(html).toContain(messages.publishState.autoRevokedRecovery);
    // 🔴 2 導線（「指摘を見る」→ `S-013` セクション 4 /「該当の欄を直す」→ `S-012`）。
    expect(html).toContain('data-testid="project-detail-publish-auto-revoked-findings"');
    expect(html).toContain('data-testid="project-detail-publish-auto-revoked-fix"');
    // 🔴 未設定の警告とは**同時に出さない**（同じ 0 社を 2 本の帯で説明しない）。
    expect(html).not.toContain('data-testid="project-detail-visibility-warning"');
  });

  it('🔴 自動解除: 「無視して公開」「再公開」に相当する操作を 1 つも描かない（`BR-18`）', () => {
    const html = render(
      hostView({
        visibilities: [],
        publishState: { state: 'AUTO_REVOKED', visibleToCount: 0, revocation: REVOCATION, latestGate: null },
      }),
    );
    for (const forbidden of ['無視', 'このまま公開', '再公開する', '公開を続ける', '解除を取り消']) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });

  it('🔴 自動解除: `VIEWER`（`canEdit=false`）には帯を出すが 2 導線を描かない', () => {
    const html = render(
      hostView({
        visibilities: [],
        publishState: { state: 'AUTO_REVOKED', visibleToCount: 0, revocation: REVOCATION, latestGate: null },
      }),
      false,
    );
    expect(html).toContain('data-testid="project-detail-publish-auto-revoked"');
    expect(html).not.toContain('data-testid="project-detail-publish-auto-revoked-fix"');
    expect(html).not.toContain('data-testid="project-detail-publish-auto-revoked-findings"');
    expect(html).toContain('data-testid="project-detail-publish-auto-revoked-read-only"');
  });

  it('🔴 判定不能（`GATE_INCONCLUSIVE`）: 欄名を推測して並べない（A-26 の既定①）', () => {
    const html = render(
      hostView({
        visibilities: [],
        publishState: {
          state: 'AUTO_REVOKED',
          visibleToCount: 0,
          revocation: { ...REVOCATION, cause: { kind: 'GATE_INCONCLUSIVE' } },
          latestGate: null,
        },
      }),
    );
    expect(html).toContain(messages.publishState.autoRevokedInconclusive);
    expect(html).not.toContain(messages.publishState.autoRevokedFieldsLabel);
    expect(html).not.toContain('data-testid="project-detail-publish-auto-revoked-fields"');
  });

  it('🔴 保留（`PUBLISHED_RECHECK_HELD`）: 公開は維持され、解除の語を 1 つも使わない（`AC-12`）', () => {
    const html = render(
      hostView({
        publishState: {
          state: 'PUBLISHED_RECHECK_HELD',
          visibleToCount: 2,
          held: {
            heldReasonKey: 'gate.held.aiCostLimit',
            heldSince: '2026-09-21T01:00:00.000Z',
            resetAt: '2026-09-21T15:00:00.000Z',
            limitRaise: 'PLATFORM_OPERATOR',
            rerun: { auto: true, manual: null },
          },
          latestGate: null,
        },
      }),
    );
    expect(html).toContain('data-testid="project-detail-publish-held"');
    expect(html).toContain(messages.publishState.heldTitle);
    // 🔴 低-3（レビュー申し送り）: 再開の見込みは `formatDateTimeJst` を通した JST 表記で出る
    //    （生の ISO・UTC のまま出さない。JST 翌 0 時に丸まる境界値で固定する）。
    expect(html).toContain('2026-09-22 00:00 JST');
    expect(html).not.toContain('2026-09-21T15:00:00.000Z');
    // 🔴 自動解除の帯（橙・塗り）とは別物である。
    expect(html).not.toContain('data-testid="project-detail-publish-auto-revoked"');
    expect(html).not.toContain(messages.publishState.autoRevokedTitle);
    // 🔴 「修正して再実行」を促さない（再試行ボタンを置かない）。
    expect(html).not.toContain('<button');
  });

  it('🔴 再検査の実行中（`PUBLISHED` + `recheckRunning`）: 「公開を解除しました」と先回りしない', () => {
    const html = render(
      hostView({
        publishState: { state: 'PUBLISHED', visibleToCount: 2, recheckRunning: true, latestGate: null },
      }),
    );
    expect(html).toContain('data-testid="project-detail-publish-recheck-running"');
    expect(html).toContain(messages.publishState.recheckRunning);
    expect(html).not.toContain(messages.publishState.autoRevokedTitle);
  });

  it('🔴 取引先の画面には 4 値のいずれも描かれない（`F-014 AC-10`。1 文字も足していない）', () => {
    const html = render(partnerView());
    for (const testId of [
      'project-detail-publish-auto-revoked',
      'project-detail-publish-held',
      'project-detail-publish-recheck-running',
    ]) {
      expect(html).not.toContain(testId);
    }
    expect(html).not.toContain(messages.publishState.autoRevokedTitle);
    expect(html).not.toContain(messages.publishState.heldTitle);
  });
});
