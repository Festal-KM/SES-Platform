// packages/domain/src/export/closing-return.test.ts
// T-10-09: 返却データの契約（ファイル名・列・並び）をスナップショットで固定し、CSV / ZIP のエンコードを検算する。
//   🔴 列が 1 つ増減したらここが落ちる。返却データは顧客が保管する成果物であり、版ごとに形が揺れてはならない。
//   🔴 匿名候補のファイルが無く、経歴の列を持つのは `engineer_careers.csv` / `engineer_snapshot_careers.csv` の 2 つだけ。
import { describe, expect, it } from 'vitest';
import { buildClosingReturnArchive, CLOSING_RETURN_FILES, type ClosingReturnDataset } from './closing-return.js';
import { encodeCsv, sanitizeCsvCellText } from './csv.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';
import { buildZipArchive, crc32, listZipEntries } from './zip.js';

const EMPTY: ClosingReturnDataset = {
  engineers: [],
  engineerSkills: [],
  engineerCareers: [],
  projects: [],
  projectRequirements: [],
  partnerCompanies: [],
  proposals: [],
  engineerSnapshots: [],
  engineerSnapshotSkills: [],
  engineerSnapshotCareers: [],
  proposalEvents: [],
  assignments: [],
};

describe('CLOSING_RETURN_FILES（docs/05 §9.6 / docs/04 §S-042）', () => {
  it('🔴 ファイル名と列の並びのスナップショット', () => {
    expect(CLOSING_RETURN_FILES.map((f) => [f.name, [...f.columns]])).toMatchInlineSnapshot(`
      [
        [
          "engineers.csv",
          [
            "id",
            "display_name",
            "affiliation_label",
            "availability",
            "available_from",
            "unit_price_min",
            "unit_price_max",
            "prefecture",
            "city",
            "remote_mode",
            "preference_note",
            "contact_email",
            "contact_phone",
            "birth_date",
            "created_at",
            "updated_at",
          ],
        ],
        [
          "engineer_skills.csv",
          [
            "engineer_id",
            "skill_name",
            "years_of_experience",
            "level",
            "source",
          ],
        ],
        [
          "engineer_careers.csv",
          [
            "engineer_id",
            "period_from",
            "period_to",
            "role",
            "description",
            "technologies",
            "source",
          ],
        ],
        [
          "projects.csv",
          [
            "id",
            "name",
            "end_client_name",
            "internal_unit_price",
            "public_summary",
            "unit_price_min",
            "unit_price_max",
            "start_date",
            "prefecture",
            "remote_mode",
            "headcount",
            "status",
            "created_at",
            "updated_at",
          ],
        ],
        [
          "project_requirements.csv",
          [
            "project_id",
            "kind",
            "skill_name",
            "free_text",
            "required_years",
          ],
        ],
        [
          "partner_companies.csv",
          [
            "id",
            "name",
            "contact_name",
            "contact_email",
            "suspended_at",
            "invited_at",
          ],
        ],
        [
          "proposals.csv",
          [
            "id",
            "project_id",
            "engineer_id",
            "owner_partner_company_id",
            "proposal_request_id",
            "state",
            "recipient_company_name",
            "recipient_email",
            "offered_unit_price",
            "offered_start_date",
            "work_style",
            "subject",
            "body",
            "approved_at",
            "submitted_at",
            "created_at",
            "updated_at",
          ],
        ],
        [
          "engineer_snapshots.csv",
          [
            "proposal_id",
            "display_name",
            "affiliation_label",
            "unit_price_min",
            "unit_price_max",
            "available_from",
            "prefecture",
            "remote_mode",
            "frozen_at",
          ],
        ],
        [
          "engineer_snapshot_skills.csv",
          [
            "proposal_id",
            "skill_name",
            "years",
            "level",
          ],
        ],
        [
          "engineer_snapshot_careers.csv",
          [
            "proposal_id",
            "period_from",
            "period_to",
            "role",
            "description",
            "technologies",
          ],
        ],
        [
          "proposal_events.csv",
          [
            "proposal_id",
            "kind",
            "from_state",
            "to_state",
            "actor_user_id",
            "note",
            "occurred_at",
          ],
        ],
        [
          "assignments.csv",
          [
            "id",
            "engineer_id",
            "project_id",
            "proposal_id",
            "counterparty_partner_company_id",
            "state",
            "start_date",
            "end_date",
            "actual_leave_date",
            "unit_price",
            "review_opened_at",
          ],
        ],
      ]
    `);
  });

  it('🔴 経歴の列（period_from / role / description / technologies）を持つのは経歴の 2 ファイルだけ。匿名候補のファイルは無い', () => {
    const withCareerColumns = CLOSING_RETURN_FILES.filter((f) =>
      ['period_from', 'role', 'description', 'technologies'].some((c) => (f.columns as readonly string[]).includes(c)),
    ).map((f) => f.name);
    expect(withCareerColumns).toEqual(['engineer_careers.csv', 'engineer_snapshot_careers.csv']);
    expect(CLOSING_RETURN_FILES.map((f) => f.name).filter((n) => /candidate|anonym/i.test(n))).toEqual([]);
  });

  it('各ファイルの cells が columns と同じ長さの行を返す（列ずれが無い）', () => {
    const sample: ClosingReturnDataset = {
      engineers: [
        {
          id: 'e1', displayName: '山田 太郎', affiliationLabel: null, availability: 'WORKING', availableFrom: null,
          unitPriceMin: '600000.00', unitPriceMax: null, prefecture: '13', city: null, remoteMode: null,
          preferenceNote: null, contactEmail: 'a@example.test', contactPhone: null, birthDate: '1990-01-01',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      engineerSkills: [{ engineerId: 'e1', skillName: 'TypeScript', yearsOfExperience: '5.0', level: 3, source: 'MANUAL' }],
      engineerCareers: [
        { engineerId: 'e1', periodFrom: '2020-04', periodTo: null, role: 'SE', description: '設計, 実装', technologies: 'TS', source: 'MANUAL' },
      ],
      projects: [
        {
          id: 'p1', name: '案件', endClientName: null, internalUnitPrice: null, publicSummary: null, unitPriceMin: null,
          unitPriceMax: null, startDate: null, prefecture: null, remoteMode: null, headcount: 1, status: 'OPEN',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      projectRequirements: [{ projectId: 'p1', kind: 'MUST', skillName: 'TypeScript', freeText: null, requiredYears: '3.0' }],
      partnerCompanies: [{ id: 'pc1', name: 'A 社', contactName: null, contactEmail: null, suspendedAt: null, invitedAt: '2026-01-01T00:00:00.000Z' }],
      proposals: [
        {
          id: 'pr1', projectId: 'p1', engineerId: 'e9', ownerPartnerCompanyId: 'pc1', proposalRequestId: null, state: 'SUBMITTED',
          recipientCompanyName: 'X', recipientEmail: 'x@example.test', offeredUnitPrice: null, offeredStartDate: null, workStyle: null,
          subject: null, body: 'line1\nline2', approvedAt: null, submittedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      engineerSnapshots: [
        { proposalId: 'pr1', displayName: '佐藤 花子', affiliationLabel: 'A 社', unitPriceMin: null, unitPriceMax: null, availableFrom: null, prefecture: null, remoteMode: null, frozenAt: '2026-01-01T00:00:00.000Z' },
      ],
      engineerSnapshotSkills: [{ proposalId: 'pr1', skillName: 'Go', years: 2, level: null }],
      engineerSnapshotCareers: [{ proposalId: 'pr1', periodFrom: '2021-01', periodTo: '2022-12', role: 'PG', description: 'd', technologies: 't' }],
      proposalEvents: [{ proposalId: 'pr1', kind: 'STATE', fromState: 'DRAFT', toState: 'GATE_RUNNING', actorUserId: null, note: null, occurredAt: '2026-01-01T00:00:00.000Z' }],
      assignments: [
        { id: 'as1', engineerId: 'e1', projectId: 'p1', proposalId: null, counterpartyPartnerCompanyId: null, state: 'ACTIVE', startDate: '2026-02-01', endDate: null, actualLeaveDate: null, unitPrice: null, reviewOpenedAt: null },
      ],
    };
    for (const spec of CLOSING_RETURN_FILES) {
      const rows = sample[spec.source] as readonly unknown[];
      for (const row of rows) {
        expect((spec.cells as (r: unknown) => readonly unknown[])(row)).toHaveLength(spec.columns.length);
      }
    }
    const built = buildClosingReturnArchive(sample);
    expect(built.fileCount).toBe(CLOSING_RETURN_FILES.length);
    expect(built.rowCounts['engineers.csv']).toBe(1);
    expect(built.rowCounts['engineer_snapshot_careers.csv']).toBe(1);
    const entries = listZipEntries(built.archive);
    expect(entries.map((e) => e.name)).toEqual(CLOSING_RETURN_FILES.map((f) => f.name));
    const proposals = decodeUtf8(entries.find((e) => e.name === 'proposals.csv')!.data);
    expect(proposals).toContain('"line1\nline2"');
  });

  it('空のデータセットでも全ファイルがヘッダ 1 行で出る（0 件でファイルを省かない）', () => {
    const built = buildClosingReturnArchive(EMPTY);
    const entries = listZipEntries(built.archive);
    expect(entries).toHaveLength(CLOSING_RETURN_FILES.length);
    for (const entry of entries) {
      const text = decodeUtf8(entry.data);
      expect(text.startsWith('﻿')).toBe(true);
      expect(text.split('\r\n').filter((l) => l !== '')).toHaveLength(1);
    }
    expect(Object.values(built.rowCounts).every((n) => n === 0)).toBe(true);
  });

  it('決定的: 同じ入力から同じバイト列', () => {
    const a = buildClosingReturnArchive(EMPTY).archive;
    const b = buildClosingReturnArchive(EMPTY).archive;
    expect(a.length).toBe(b.length);
    expect(a.every((byte, index) => byte === b[index])).toBe(true);
  });
});

describe('encodeCsv（RFC 4180）', () => {
  it('引用・改行・null・数値・真偽値', () => {
    expect(encodeCsv(['a', 'b'], [['x,y', null], ['he said "hi"', 1], ['multi\nline', true]])).toBe(
      '﻿a,b\r\n"x,y",\r\n"he said ""hi""",1\r\n"multi\nline",true\r\n',
    );
  });

  it('列数がヘッダと違う行は例外', () => {
    expect(() => encodeCsv(['a', 'b'], [['only-one']])).toThrow(RangeError);
  });
});

describe('🔴 T-12-17 ⑲ (a): CSV 数式注入の無害化（sanitizeCsvCellText。Issue #68）', () => {
  it.each([
    ['=', '=SUM(A1:A3)', "'=SUM(A1:A3)"],
    ['+', '+1+cmd', "'+1+cmd"],
    ['-', '-2+3', "'-2+3"],
    ['@', '@SUM(1)', "'@SUM(1)"],
    ['タブ', '\t=1', "'\t=1"],
    ['CR', '\r=1', "'\r=1"],
  ])('先頭が %s のセルは \' を前置する（値そのものは落とさない）', (_label, input, expected) => {
    expect(sanitizeCsvCellText(input)).toBe(expected);
    expect(sanitizeCsvCellText(input).slice(1)).toBe(input);
  });

  it.each([
    ['通常の文字列', 'ホストの経歴'],
    ['途中に = を含む', 'a=b'],
    ['空文字', ''],
    ['メールアドレス', 'owner@example.co.jp'],
    ['ISO 8601', '2026-09-18'],
    ['既に \' で始まる', "'=1"],
  ])('%s（%s）は変えない', (_label, input) => {
    expect(sanitizeCsvCellText(input)).toBe(input);
  });

  it('encodeCsv は文字列セルにだけ掛ける（数値の負数・真偽値・null は対象外）。引用は無害化の後に掛かる', () => {
    expect(encodeCsv(['a', 'b', 'c', 'd'], [['=SUM(A1)', -1, true, null]])).toBe("\ufeffa,b,c,d\r\n'=SUM(A1),-1,true,\r\n");
    expect(encodeCsv(['a'], [['=HYPERLINK("http://x","y")']])).toBe("\ufeffa\r\n\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"\r\n");
  });
});

describe('buildZipArchive（STORE / 決定的）', () => {
  it('crc32 の既知値（"123456789" → 0xCBF43926）', () => {
    expect(crc32(encodeUtf8('123456789'))).toBe(0xcbf43926);
  });

  it('作った ZIP を自分で読み戻せ、名前・サイズ・内容が一致する', () => {
    const data = encodeUtf8('hello');
    const archive = buildZipArchive([{ name: 'a.csv', data }, { name: 'dir/b.csv', data: new Uint8Array(0) }]);
    const entries = listZipEntries(archive);
    expect(entries.map((e) => [e.name, e.size])).toEqual([['a.csv', 5], ['dir/b.csv', 0]]);
    expect(decodeUtf8(entries[0]!.data)).toBe('hello');
    // 末尾 22 バイトが EOCD（署名 0x06054b50）。
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
  });

  it('重複名・不正な名前は例外', () => {
    const data = new Uint8Array(0);
    expect(() => buildZipArchive([{ name: 'a', data }, { name: 'a', data }])).toThrow(RangeError);
    expect(() => buildZipArchive([{ name: '../a', data }])).toThrow(RangeError);
    expect(() => buildZipArchive([{ name: '/a', data }])).toThrow(RangeError);
  });
});
