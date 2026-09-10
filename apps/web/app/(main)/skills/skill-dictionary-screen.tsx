'use client';

// apps/web/app/(main)/skills/skill-dictionary-screen.tsx
// `S-009` スキル辞書・別名・新語候補 — 本体（docs/04 §S-009 / `F-010` / docs/05 §6.4 #23 #24）。T-05-03。
//
// 🔴 **新語候補を最上部に置く**（docs/04 §S-009 セクション 1）。放置すると検索に効かないため、
//    「決めるべきもの」を先に見せる。
// 🔴 **採用するまで検索の正規化に使われない**（`F-010 AC-1`）ことを候補セクションに常時書く。
// 🔴 **グローバル辞書はこの組織から編集できない**（`F-010 AC-2`）。導線を出さないだけでなく、
//    読み取り専用である旨を文言でも示す（docs/04 §S-009「空 / ローディング / エラー」）。
//    ⚠️ 画面に操作が無いことは補助であり、拒否の本体は DB 権限（`skills` は `GRANT SELECT` のみ）と
//    RLS（`skill_aliases` の書込は `tenant_id = app_tenant_id()`）と `#24` の認可である。
// 🔴 **採否は `OWNER` / `ADMIN` / `SALES` のみ**（docs/04 §S-009 権限差分 / docs/05 §6.4 #24。
//    🔴 `OWNER` は T-06-01 で追加した暫定値である。Issue #36 既定 A）。
//    取引先（`PARTNER_ADMIN` / `PARTNER_SALES`）は起票のみ、`VIEWER` は閲覧のみ。
//    導線を消すだけにせず「誰が決めるのか」を書く（行き止まりにしない）。
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    表は横スクロールで劣化させ、非表示にはしない。
import { useState, type FormEvent } from 'react';
import {
  Button,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import type {
  SkillAliasListView,
  SkillAliasView,
  SkillListView,
  SkillView,
} from '../../../lib/skills/service';
import type { SkillAliasDecision } from '../../../lib/skills/policy';

export type SkillDictionaryScreenMessages = {
  readonly sectionCandidates: string;
  readonly candidatesNote: string;
  readonly candidatesEmpty: string;
  readonly candidatesColumnAlias: string;
  readonly candidatesColumnOrigin: string;
  readonly candidatesColumnProposedAt: string;
  readonly candidatesColumnTarget: string;
  readonly candidatesColumnActions: string;
  readonly candidatesTargetPlaceholder: string;
  readonly candidatesAccept: string;
  readonly candidatesReject: string;
  readonly candidatesSubmitting: string;
  readonly candidatesAcceptHint: string;
  readonly candidatesRejectNote: string;
  readonly candidatesError: string;
  readonly candidatesReadOnlyNote: string;
  readonly candidatesOccurrenceComingSoon: string;

  readonly sectionAliases: string;
  readonly aliasesNote: string;
  readonly aliasesEmpty: string;
  readonly aliasesColumnAlias: string;
  readonly aliasesColumnTarget: string;
  readonly aliasesColumnScope: string;
  readonly aliasesColumnDecidedAt: string;
  readonly scopeLabels: Readonly<Record<SkillAliasView['scope'], string>>;
  readonly originLabels: Readonly<Record<SkillAliasView['origin'], string>>;

  readonly sectionDictionary: string;
  readonly dictionaryReadOnlyNote: string;
  readonly dictionarySearchLabel: string;
  readonly dictionarySearchSubmit: string;
  readonly dictionarySearchSubmitting: string;
  readonly dictionaryColumnName: string;
  readonly dictionaryColumnCategory: string;
  readonly dictionaryEmpty: string;
  readonly dictionaryError: string;

  readonly valueNone: string;
};

type Phase = 'idle' | 'submitting' | 'error';

/** 🔴 却下した候補は一覧から外れる（docs/04 §S-009「却下 → 候補を閉じる」）。 */
const CANDIDATE_STATUS = 'PROPOSED';
const ALIAS_STATUS = 'ACCEPTED';

/**
 * 🔴 **行単位の採否可否**（`F-010 AC-2`）。ロール（`canDecide`）だけでは足りない ——
 *    `skill_aliases` の一覧にはグローバル行（`tenant_id IS NULL`）が混ざる（RLS の C1 の
 *    `SELECT` が `OR tenant_id IS NULL` を許すため。docs/05 §4.4）。グローバル行は
 *    採否ロール（`SKILL_ALIAS_DECIDER_ROLES`）でも編集できない（`#24` は 403、RLS と
 *    Prisma 拡張は 0 件更新）。
 *    **拒否されるボタンを描かない**ために、行の `scope` でも判定する
 *    （`policy.ts` の `GLOBAL_ROW` と同じ規則を画面側でも 1 か所に持つ）。
 */
function isDecidable(alias: SkillAliasView): boolean {
  return alias.scope !== 'GLOBAL';
}

export function SkillDictionaryScreen({
  initialAliases,
  initialSkills,
  canDecide,
  messages,
}: {
  readonly initialAliases: SkillAliasListView;
  readonly initialSkills: SkillListView;
  /**
   * 🔴 採否の導線を出すか（docs/04 §S-009 権限差分）。値の出所は `page.tsx` の
   *    `isSkillAliasDeciderRole(ctx.role)` であり、**API 側の `requireRole` と同じ定数**を見る。
   */
  readonly canDecide: boolean;
  readonly messages: SkillDictionaryScreenMessages;
}) {
  const [aliases, setAliases] = useState<readonly SkillAliasView[]>(initialAliases.items);
  const [skills, setSkills] = useState<readonly SkillView[]>(initialSkills.items);
  /** 候補 ID → 選択中の正規化先（`''` = 未選択）。 */
  const [targets, setTargets] = useState<Readonly<Record<string, string>>>({});
  const [decisionPhase, setDecisionPhase] = useState<Phase>('idle');
  const [query, setQuery] = useState('');
  const [searchPhase, setSearchPhase] = useState<Phase>('idle');

  const candidates = aliases.filter((alias) => alias.status === CANDIDATE_STATUS);
  const accepted = aliases.filter((alias) => alias.status === ALIAS_STATUS);

  /** 一覧を引き直す（件数・状態は API の値だけを正とし、クライアントで組み立てない）。 */
  async function reloadAliases(): Promise<void> {
    const response = await fetch('/api/skill-aliases', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const view = (await response.json()) as SkillAliasListView;
    setAliases(view.items);
  }

  /**
   * 🔴 採否（`#24`）。**サーバの応答だけを正とする** —— 手元で行を書き換えると、
   *    サーバが拒否した操作（403 / 409）を成功したように見せてしまう。
   */
  async function onDecide(aliasId: string, decision: SkillAliasDecision): Promise<void> {
    if (decisionPhase === 'submitting') return;
    // 🔴 グローバル別名には導線を描いていないが、ここでも止める（描画の分岐は見た目であり
    //    判定ではない。拒否の本体は `#24` の 403 と RLS である）。
    const target = aliases.find((alias) => alias.id === aliasId);
    if (target === undefined || !isDecidable(target)) return;
    const skillId = targets[aliasId] ?? '';
    // 🔴 採用には正規化先が要る（`policy.ts` の `SKILL_REQUIRED`）。ボタンも無効にしてあるが、
    //    ここでも止める（無効化は見た目であり、判定ではない）。
    if (decision === 'ACCEPT' && skillId === '') return;
    setDecisionPhase('submitting');
    try {
      const response = await fetch(`/api/skill-aliases/${aliasId}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision,
          skillId: decision === 'ACCEPT' ? skillId : null,
        }),
      });
      if (!response.ok) {
        setDecisionPhase('error');
        return;
      }
      setDecisionPhase('idle');
      await reloadAliases();
    } catch {
      setDecisionPhase('error');
    }
  }

  /** グローバル辞書の検索（`#23` の `?q=`）。 */
  async function onSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (searchPhase === 'submitting') return;
    setSearchPhase('submitting');
    try {
      const response = await fetch(`/api/skills?q=${encodeURIComponent(query.trim())}`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        setSearchPhase('error');
        return;
      }
      const view = (await response.json()) as SkillListView;
      setSkills(view.items);
      setSearchPhase('idle');
    } catch {
      setSearchPhase('error');
    }
  }

  return (
    <div data-testid="skill-dictionary-screen">
      <section className="mb-8" data-testid="skill-candidates-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {messages.sectionCandidates}
        </h2>
        {/* 🔴 `F-010 AC-1` の明示。候補の一覧より前に置く。 */}
        <p className="mb-2 text-sm text-slate-600" data-testid="skill-candidates-note">
          {messages.candidatesNote}
        </p>
        {canDecide ? (
          <p className="mb-2 text-sm text-slate-500" data-testid="skill-candidates-reject-note">
            {messages.candidatesRejectNote}
          </p>
        ) : (
          <p className="mb-2 text-sm text-slate-500" data-testid="skill-candidates-read-only-note">
            {messages.candidatesReadOnlyNote}
          </p>
        )}
        {/* 🔴 docs/04 の「出現件数」列は保存先が無いため出せない。隠さずに書く。 */}
        <p className="mb-3 text-sm text-slate-500" data-testid="skill-candidates-occurrence-note">
          {messages.candidatesOccurrenceComingSoon}
        </p>

        {candidates.length === 0 ? (
          <p
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            data-testid="skill-candidates-empty"
          >
            {messages.candidatesEmpty}
          </p>
        ) : (
          <div>
            <Table data-testid="skill-candidates-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.candidatesColumnAlias}</TableHead>
                  <TableHead>{messages.candidatesColumnOrigin}</TableHead>
                  <TableHead>{messages.candidatesColumnProposedAt}</TableHead>
                  {canDecide ? (
                    <>
                      <TableHead>{messages.candidatesColumnTarget}</TableHead>
                      <TableHead>{messages.candidatesColumnActions}</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((candidate) => (
                  <TableRow
                    key={candidate.id}
                    data-testid={`skill-candidate-row-${candidate.id}`}
                    data-scope={candidate.scope}
                  >
                    <TableCell whitespace="normal">{candidate.alias}</TableCell>
                    {/* 🔴 docs/04 §9: 生成物か手入力かを常時 1 行で示す。 */}
                    <TableCell>{messages.originLabels[candidate.origin]}</TableCell>
                    <TableCell>
                      {candidate.proposedAt === null
                        ? messages.valueNone
                        : formatDateTimeJst(candidate.proposedAt)}
                    </TableCell>
                    {canDecide ? (
                      // 🔴 **グローバル別名には採否の導線を出さない**（`F-010 AC-2`）。
                      //    `#24` は 403 を返し、RLS と Prisma 拡張も 0 件更新にするが、
                      //    **押しても拒否されるボタンが画面にあること自体が要件違反**である
                      //    （`docs/04` §S-009「グローバル辞書はテナントから編集できない旨を
                      //    読み取り専用の表示で示す」）。列そのものは残し、値だけを
                      //    「全社共通（編集不可）」に置き換える（列が消えると行がずれる）。
                      isDecidable(candidate) ? (
                        <>
                          <TableCell>
                            <label className="block">
                              <span className="sr-only">{messages.candidatesColumnTarget}</span>
                              <Select
                                value={targets[candidate.id] ?? ''}
                                disabled={decisionPhase === 'submitting'}
                                onChange={(event) =>
                                  setTargets((current) => ({
                                    ...current,
                                    [candidate.id]: event.target.value,
                                  }))
                                }
                                data-testid={`skill-candidate-target-${candidate.id}`}
                              >
                                <option value="">{messages.candidatesTargetPlaceholder}</option>
                                {skills.map((skill) => (
                                  <option key={skill.id} value={skill.id}>
                                    {skill.name}
                                  </option>
                                ))}
                              </Select>
                            </label>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                // 🔴 正規化先を選ぶまで採用できない（`docs/04` §S-009「操作と結果」）。
                                disabled={
                                  decisionPhase === 'submitting' ||
                                  (targets[candidate.id] ?? '') === ''
                                }
                                onClick={() => void onDecide(candidate.id, 'ACCEPT')}
                                data-testid={`skill-candidate-accept-${candidate.id}`}
                              >
                                {messages.candidatesAccept}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={decisionPhase === 'submitting'}
                                onClick={() => void onDecide(candidate.id, 'REJECT')}
                                data-testid={`skill-candidate-reject-${candidate.id}`}
                              >
                                {messages.candidatesReject}
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>{messages.valueNone}</TableCell>
                          <TableCell
                            className="text-slate-500"
                            data-testid={`skill-candidate-read-only-${candidate.id}`}
                          >
                            {messages.scopeLabels[candidate.scope]}
                          </TableCell>
                        </>
                      )
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canDecide ? (
              <p className="mt-2 text-sm text-slate-500" data-testid="skill-candidates-accept-hint">
                {messages.candidatesAcceptHint}
              </p>
            ) : null}
          </div>
        )}

        {decisionPhase === 'submitting' ? (
          <p role="status" className="mt-2 text-sm text-slate-600" data-testid="skill-candidates-submitting">
            {messages.candidatesSubmitting}
          </p>
        ) : null}
        {decisionPhase === 'error' ? (
          <p role="alert" className="mt-2 text-sm text-red-700" data-testid="skill-candidates-error">
            {messages.candidatesError}
          </p>
        ) : null}
      </section>

      <section className="mb-8" data-testid="skill-aliases-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionAliases}</h2>
        <p className="mb-3 text-sm text-slate-600">{messages.aliasesNote}</p>
        {accepted.length === 0 ? (
          <p
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            data-testid="skill-aliases-empty"
          >
            {messages.aliasesEmpty}
          </p>
        ) : (
          <Table data-testid="skill-aliases-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.aliasesColumnAlias}</TableHead>
                <TableHead>{messages.aliasesColumnTarget}</TableHead>
                <TableHead>{messages.aliasesColumnScope}</TableHead>
                <TableHead>{messages.aliasesColumnDecidedAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accepted.map((alias) => (
                <TableRow
                  key={alias.id}
                  data-testid={`skill-alias-row-${alias.id}`}
                  data-scope={alias.scope}
                >
                  <TableCell whitespace="normal">{alias.alias}</TableCell>
                  <TableCell whitespace="normal">{alias.skillName ?? messages.valueNone}</TableCell>
                  {/* 🔴 `GLOBAL` は「この組織から編集できない」ことの表示である（`F-010 AC-2`）。 */}
                  <TableCell>{messages.scopeLabels[alias.scope]}</TableCell>
                  <TableCell>
                    {alias.decidedAt === null
                      ? messages.valueNone
                      : formatDateTimeJst(alias.decidedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section data-testid="skill-dictionary-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionDictionary}</h2>
        {/* 🔴 `F-010 AC-2`: 読み取り専用であることを文言でも示す。 */}
        <p className="mb-3 text-sm text-slate-600" data-testid="skill-dictionary-read-only-note">
          {messages.dictionaryReadOnlyNote}
        </p>
        <form onSubmit={onSearch} noValidate className="mb-3" data-testid="skill-dictionary-search-form">
          <Field className="mb-2 max-w-sm" label={messages.dictionarySearchLabel}>
            <Input
              type="search"
              name="q"
              value={query}
              disabled={searchPhase === 'submitting'}
              onChange={(event) => setQuery(event.target.value)}
              data-testid="skill-dictionary-search-input"
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={searchPhase === 'submitting'}
            data-testid="skill-dictionary-search-submit"
          >
            {searchPhase === 'submitting'
              ? messages.dictionarySearchSubmitting
              : messages.dictionarySearchSubmit}
          </Button>
          {searchPhase === 'error' ? (
            <p role="alert" className="mt-2 text-sm text-red-700" data-testid="skill-dictionary-error">
              {messages.dictionaryError}
            </p>
          ) : null}
        </form>
        {skills.length === 0 ? (
          <p
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            data-testid="skill-dictionary-empty"
          >
            {messages.dictionaryEmpty}
          </p>
        ) : (
          <Table data-testid="skill-dictionary-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.dictionaryColumnName}</TableHead>
                <TableHead>{messages.dictionaryColumnCategory}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id} data-testid={`skill-dictionary-row-${skill.id}`}>
                  <TableCell whitespace="normal">{skill.name}</TableCell>
                  <TableCell whitespace="normal">{skill.category}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
