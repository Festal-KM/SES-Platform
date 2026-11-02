"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@ses/i18n";
import {
  Button,
  Checkbox,
  Field,
  Icon,
  IconButton,
  Input,
  Radio,
  SegmentedControl,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from "@ses/ui";
import { Dialog, Tabs, Tooltip } from "@ses/ui/client";
import type { IconName } from "@ses/ui";
import {
  PROJECT_CARD_FIELDS,
  projectCardPatch,
  projectUtilizationBand,
  type CardRequirement,
  type ProjectCardId,
  type ProjectCardValues,
} from "../../../../lib/projects/card-fields";
import type { ProjectCardData } from "../../../../lib/projects/card-data";

type Option = { value: string; label: string };
// ✅ 2026-11-02（人間の指示「4タブ＋上部共通サマリー＋1カラム＋セクション単位編集」）。
const PROJECT_DETAIL_TABS = ["overview", "requirements", "working", "related"] as const;
type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number];
export type ProjectCardOptions = Record<string, readonly Option[]>;
const label = (key: string) => t(`projects.cards.field.${key}` as MessageKey);
const title = (card: string) => t(`projects.cards.title.${card}` as MessageKey);
const numeric = new Set([
  "unitPrice",
  "internalUnitPrice",
  "settlementMinHours",
  "settlementMaxHours",
  "paymentSiteDays",
  "utilizationRate",
  "headcount",
]);
const dates = new Set(["startDate", "endDate"]);
const multiline = new Set([
  "publicSummary",
  "publicMemo",
  "remarks",
  "copySummary",
]);
// ✅ 2026-11-02: 1 カラム。どの項目も「項目名 1 : 値 4」の同じ列幅でそろえる（以前の 2 項目横並びはやめた）。
const utilizationOptions = [
  {value:'',label:t('projects.search.all')},
  ...(['FULL','HALF_TO_FULL','UNDER_HALF'] as const).map(value=>({value,label:t(`projects.search.band.${value}`)})),
];
const required = new Set(["name", "status", "sourceKind", "headcount"]);
// 🔴 公開先の取引先が読む欄（保存で再検査の対象。`projects.recheckNotice.willRun` と同じ集合）。
const publicFields = new Set(["name", "publicSummary", "locationDetail", "publicMemo"]);
// 公開欄を含むカード（要件の自由記述は content カード）。
const publicCards = new Set<ProjectCardId>(["basic", "summary", "content", "working", "notes"]);
// 🔴 取引先に出ない項目を持つカード（F-013 AC-2 の注記を常に添える）。
const hostOnlyCards = new Set<ProjectCardId>(["commercial", "company", "notes"]);

export function ProjectCardEditor({
  initial,
  options,
  canEdit,
  publishedToCount = 0,
  visibility,
  proposals,
  canViewAuditLogs = false,
  initialTab = "overview",
}: {
  /** 最初に開くタブ（既定は概要）。 */
  readonly initialTab?: ProjectDetailTab;
  /** 概要タブの「公開状況」に置く既存の公開範囲セクション（サーバ側で組んだもの）。 */
  readonly visibility?: ReactNode;
  /** 関連・履歴タブに置く既存の提案セクション。 */
  readonly proposals?: ReactNode;
  /** 監査ログ（S-041）へ案内してよいロールか（OWNER / ADMIN）。 */
  readonly canViewAuditLogs?: boolean;
  readonly initial: ProjectCardData;
  readonly options: ProjectCardOptions;
  readonly canEdit: boolean;
  /** 🔴 公開先の社数（境界適用後）。1 社以上なら公開欄を含むカードの編集中に再検査の事前表示を出す（S-012 改訂 14 と同じ）。 */
  readonly publishedToCount?: number;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [data, setData] = useState(initial);
  const [active, setActive] = useState<ProjectCardId | null>(null);
  const [draft, setDraft] = useState<ProjectCardValues>(initial.values);
  const [requirements, setRequirements] = useState<readonly CardRequirement[]>(
    initial.requirements,
  );
  const [rateBand, setRateBand] = useState(projectUtilizationBand(String(initial.values.utilizationRate ?? '')));
  const [nextCard, setNextCard] = useState<ProjectCardId | null>(null);
  // ✅ 2026-11-02: 4 タブ。未保存の変更があるときの切り替えは確認ダイアログを挟む。
  const [tab, setTab] = useState<ProjectDetailTab>(initialTab);
  const [nextTab, setNextTab] = useState<ProjectDetailTab | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    setData(initial);
  }, [initial]);
  const baseline: ProjectCardValues = {
    ...data.values,
    copySummary: data.values.copySummary || data.autoSummary,
  };
  const dirty =
    active !== null &&
    (PROJECT_CARD_FIELDS[active].some(
      (key) =>
        JSON.stringify(draft[key] ?? "") !==
        JSON.stringify(baseline[key] ?? ""),
    ) ||
      (active === "development" && rateBand !== projectUtilizationBand(String(baseline.utilizationRate ?? ""))) ||
      (active === "content" &&
        JSON.stringify(requirements) !== JSON.stringify(data.requirements)));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function begin(card: ProjectCardId): void {
    setDraft({ ...baseline });
    setRateBand(projectUtilizationBand(String(baseline.utilizationRate ?? "")));
    setRequirements(data.requirements);
    setActive(card);
    setError("");
    setNotice("");
    setNextCard(null);
  }
  function request(card: ProjectCardId): void {
    if (sending.current || refreshing) return;
    if (active && dirty) {
      setNextCard(card);
      return;
    }
    begin(card);
  }
  useEffect(() => {
    const edit = (event: Event) => {
      const target = (event as CustomEvent<{ id: string; card: ProjectCardId }>)
        .detail;
      if (target.id === initial.id && canEdit) {
        request(target.card);
        // 「該当の欄を直す」: 開いたカードの最初の入力欄にフォーカスする。
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`#project-detail-card-${target.card} input, #project-detail-card-${target.card} textarea`)?.focus();
        });
      }
    };
    window.addEventListener("project-card-edit", edit);
    return () => window.removeEventListener("project-card-edit", edit);
  });
  function update(key: string, value: string | readonly string[]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "utilizationRate" && typeof value === "string" && value.trim() !== "") setRateBand(projectUtilizationBand(value));
    setError("");
  }
  async function save(card: ProjectCardId): Promise<void> {
    if (sending.current) return;
    let patch: Record<string, unknown>;
    try {
      if (card === "development" && rateBand !== projectUtilizationBand(String(draft.utilizationRate ?? ""))) throw new Error("utilizationRate");
      patch = projectCardPatch(
        card,
        baseline,
        draft,
        data.requirements,
        requirements,
      );
    } catch (reason) {
      setError(
        `${label(reason instanceof Error ? reason.message : "name")}${t("projects.cards.invalid")}`,
      );
      return;
    }
    if (!Object.keys(patch).length) {
      setActive(null);
      return;
    }
    sending.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${data.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(String(response.status));
      // 🔴 保存の成否と再検査を 1 つの表示に混ぜない。応答の `recheck.queued` で出し分ける（F-014 AC-6）。
      const saved = (await response.json().catch(() => null)) as { recheck?: { queued?: boolean } } | null;
      setData((current) => ({
        ...current,
        values: {
          ...current.values,
          ...Object.fromEntries(
            PROJECT_CARD_FIELDS[card].map((key) => [key, draft[key] ?? ""]),
          ),
        },
        requirements:
          card === "content" ? [...requirements] : current.requirements,
      }));
      setActive(null);
      setNotice(saved?.recheck?.queued === true ? t("projects.saved.recheckQueued") : t("projects.cards.saved"));
      startRefresh(() => router.refresh());
    } catch {
      setError(t("projects.cards.failed"));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  function display(key: string): string {
    const value =
      key === "copySummary"
        ? data.values.copySummary || data.autoSummary
        : data.values[key];
    if (Array.isArray(value))
      return (
        value
          .map(
            (item) =>
              options[key]?.find((option) => option.value === item)?.label ??
              item,
          )
          .join(" / ") || t("projects.detail.valueNone")
      );
    const text = typeof value === "string" ? value : "";
    if (!text) return options[key]?.find(option => option.value === "")?.label ?? t("projects.detail.valueNone");
    if (numeric.has(key))
      return `${Number(text).toLocaleString("ja-JP")}${t(key === "unitPrice" || key === "internalUnitPrice" ? "projects.cards.yenMonth" : key === "utilizationRate" ? "projects.cards.percent" : key === "headcount" ? "projects.headcount.unit" : key === "paymentSiteDays" ? "projects.cards.days" : "projects.cards.hours")}`;
    return options[key]?.find((option) => option.value === text)?.label ?? text;
  }
  function control(key: string) {
    const value = draft[key] ?? "";
    const text = typeof value === "string" ? value : "";
    const attrs = {
      "aria-label": label(key),
      "data-testid": `project-card-input-${key}`,
    };
    if (key === "developmentPhases")
      return (
        <div className="flex flex-wrap gap-3">
          {options[key]?.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-cell"
            >
              <Checkbox
                checked={Array.isArray(value) && value.includes(option.value)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  const current = Array.isArray(value) ? value : [];
                  update(
                    key,
                    checked
                      ? [...current, option.value]
                      : current.filter((item) => item !== option.value),
                  );
                }}
                data-testid={`project-card-phase-${option.value}`}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    if (key === "developmentMethod")
      return (
        <SegmentedControl
          value={text}
          options={options[key] ?? []}
          label={label(key)}
          onChange={(value) => update(key, value)}
          testIdPrefix="project-card-method-"
        />
      );
    if (key === "parallelOk")
      return (
        <div className="flex flex-wrap gap-3">
          {options[key]?.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-cell"
            >
              <Radio
                name="card-parallel"
                value={option.value}
                checked={text === option.value}
                onChange={() => update(key, option.value)}
                data-testid={`project-card-parallel-${option.value || "unset"}`}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    if (multiline.has(key))
      return (
        <Textarea
          compact
          className="max-h-48 overflow-y-auto"
          {...attrs}
          rows={key === "publicSummary" || key === "copySummary" ? 2 : 1}
          value={text}
          onChange={(event) => update(key, event.currentTarget.value)}
        />
      );
    if (key === "utilizationRate") return <div className="flex min-w-0 flex-col gap-2 [&_[role=radiogroup]]:grid-cols-2 2xl:[&_[role=radiogroup]]:grid-cols-4">
      <SegmentedControl compact value={rateBand} options={utilizationOptions} label={label(key)} testIdPrefix="project-card-utilization-" onChange={band=>{
        setRateBand(band);
        const current = projectUtilizationBand(text);
        setDraft(values=>({...values,utilizationRate:band==='FULL'?'100':band===''?'':current===band?text:''}));
        setError('');
      }}/>
      <div className="flex min-w-0 items-center gap-2"><Input {...attrs} type="number" value={text} required={rateBand!==''} min={1} max={100} step={1} onChange={event=>update(key,event.currentTarget.value)}/><span className="shrink-0 text-cell text-fg-muted">{t("projects.cards.percent")}</span></div>
      {rateBand!==''&&!text?<p className="m-0 text-xs text-fg-muted">{t('projects.cards.rateRequired')}</p>:null}
    </div>;
    if (options[key])
      return (
        <Select
          {...attrs}
          required={required.has(key)}
          value={text}
          onChange={(event) => update(key, event.currentTarget.value)}
        >
          {options[key].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    return (
      <Input
        {...attrs}
        type={numeric.has(key) ? "number" : dates.has(key) ? "date" : "text"}
        required={required.has(key)}
        value={text}
        min={
          key === "headcount" || key === "utilizationRate"
            ? 1
            : numeric.has(key)
              ? 0
              : undefined
        }
        max={key === "utilizationRate" ? 100 : undefined}
        step={numeric.has(key) ? 1 : undefined}
        onChange={(event) => update(key, event.currentTarget.value)}
      />
    );
  }
  function requirementBlock(kind: "MUST" | "NICE", editing: boolean) {
    const rows = (editing ? requirements : data.requirements).filter(
      (row) => row.kind === kind,
    );
    return (
      <div
        className="flex min-w-0 flex-col gap-2"
        data-testid={`project-detail-requirements-${kind}`}
      >
        <h3 className="m-0 text-body font-semibold">
          {t(
            kind === "MUST"
              ? "projects.cards.required"
              : "projects.cards.preferred",
          )}
        </h3>
        <Table className="table-fixed min-w-lg" overflowNote={t("projects.cards.requirementsOverflow")}>
          <TableHeader>
            <TableRow>
              {["skill", "years", "freeText"].map((key) => (
                <TableHead key={key} className={key === "skill" ? "w-1/4" : key === "years" ? "w-20" : undefined}>
                  {t(`projects.cards.requirement.${key}` as MessageKey)}
                </TableHead>
              ))}
              {editing ? (
                <TableHead className="w-12" padding="compact">{t("projects.cards.remove")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell whitespace="normal" className="break-words">
                  {editing ? (
                    <Select
                      aria-label={t("projects.cards.requirement.skill")}
                      value={row.skillId}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRequirements((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? { ...item, skillId: value }
                              : item,
                          ),
                        );
                      }}
                      data-testid={`project-card-skill-${row.key}`}
                    >
                      <option value="">{t("projects.detail.valueNone")}</option>
                      {options.skills?.map((skill) => (
                        <option key={skill.value} value={skill.value}>
                          {skill.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (options.skills?.find(
                      (skill) => skill.value === row.skillId,
                    )?.label ?? t("projects.detail.valueNone"))
                  )}
                </TableCell>
                <TableCell>
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      step="0.1"
                      aria-label={t("projects.cards.requirement.years")}
                      value={row.requiredYears}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRequirements((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? { ...item, requiredYears: value }
                              : item,
                          ),
                        );
                      }}
                      data-testid={`project-card-years-${row.key}`}
                    />
                  ) : (
                    row.requiredYears || t("projects.detail.valueNone")
                  )}
                </TableCell>
                <TableCell whitespace="normal" className="break-words">
                  {editing ? (
                    <Textarea
                      compact
                      className="max-h-32 overflow-y-auto"
                      rows={1}
                      aria-label={t("projects.cards.requirement.freeText")}
                      value={row.freeText}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRequirements((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? { ...item, freeText: value }
                              : item,
                          ),
                        );
                      }}
                      data-testid={`project-card-requirement-text-${row.key}`}
                    />
                  ) : (
                    row.freeText || t("projects.detail.valueNone")
                  )}
                </TableCell>
                {editing ? (
                  <TableCell padding="compact">
                    <Tooltip content={t("projects.cards.remove")}>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="trash" />}
                        aria-label={t("projects.cards.remove")}
                        onClick={() =>
                          setRequirements((current) =>
                            current.filter((item) => item.key !== row.key),
                          )
                        }
                        data-testid={`project-card-requirement-remove-${row.key}`}
                      />
                    </Tooltip>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {editing ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              setRequirements((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  kind,
                  skillId: "",
                  freeText: "",
                  requiredYears: "",
                },
              ])
            }
            data-testid={`project-card-requirement-add-${kind}`}
          >
            <Icon name="plus" />
            {t("projects.cards.addRequirement")}
          </Button>
        ) : rows.length === 0 ? (
          <p className="m-0 text-cell text-fg-muted">
            {t("projects.detail.valueNone")}
          </p>
        ) : null}
      </div>
    );
  }
  function card(id: ProjectCardId) {
    const editing = active === id;
    return (
      <section
        id={`project-detail-card-${id}`}
        className={cn(
          // ✅ 2026-11-02: カードではなく、タブ内の 1 枚の白い面を区切り線で分けたセクション。編集中だけ淡いブルー。
          "min-w-0 border-b border-border last:border-b-0",
          editing ? "bg-brand-bg" : undefined,
        )}
        data-testid={`project-detail-card-${id}`}
        data-editing={editing ? "true" : "false"}
      >
        <form
          method="post"
          data-testid={
            id === "content"
              ? "project-detail-requirements"
              : id === "working"
                ? "project-detail-conditions"
                : id === "commercial"
                  ? "project-detail-commerce"
                  : `project-card-form-${id}`
          }
          onSubmit={(event) => {
            event.preventDefault();
            void save(id);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-4">
            <h2 className="m-0 text-lg font-semibold">{title(id)}</h2>
            <div className="flex items-center gap-1">
              {canEdit ? (
                editing ? (
                  <>
                    <Tooltip content={t("projects.search.cancel")}>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="x" />}
                        aria-label={t("projects.search.cancel")}
                        disabled={saving}
                        onClick={() => {
                          setActive(null);
                          setError("");
                        }}
                        data-testid={`project-card-cancel-${id}`}
                      />
                    </Tooltip>
                    <Tooltip content={t("projects.cards.save")}>
                      <IconButton
                        type="submit"
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="save" />}
                        aria-label={t("projects.cards.save")}
                        disabled={saving}
                        aria-busy={saving}
                        data-testid={`project-card-save-${id}`}
                      />
                    </Tooltip>
                  </>
                ) : (
                  <Tooltip content={t("projects.cards.edit")}>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<Icon name="pencil" />}
                      aria-label={t("projects.cards.edit")}
                      disabled={saving || refreshing}
                      onClick={() => request(id)}
                      data-testid={
                        id === "basic"
                          ? "project-detail-edit-link"
                          : `project-card-edit-${id}`
                      }
                    />
                  </Tooltip>
                )
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {/* 🔴 公開中の案件で公開欄を含むカードを編集しているあいだは常に出す（押した後ではない。S-012 改訂 14）。 */}
            {editing && publishedToCount > 0 && publicCards.has(id) ? (
              <section className="border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning" data-testid="project-card-recheck-notice">
                <p className="m-0">{t("projects.recheckNotice.publishedToPrefix")}{publishedToCount}{t("projects.recheckNotice.publishedToSuffix")}</p>
                <p className="m-0 mt-1">{t("projects.recheckNotice.willRun")}</p>
                <p className="m-0 mt-1">{t("projects.recheckNotice.willNotRun")}</p>
              </section>
            ) : null}
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{PROJECT_CARD_FIELDS[id].filter(key=>key!=="settlementMaxHours").map((key) =>
              <div key={key} className="min-w-0 sm:col-span-2">{editing ? (
                <Field key={key} as="div">
                  <div className={cn("grid min-w-0 grid-cols-1 items-start gap-2", "sm:grid-cols-5")}>
                    <span className="pt-2 text-xs text-fg-muted">
                      {label(key === "settlementMinHours" ? "settlementHours" : key)}
                      {required.has(key) ? (
                        <span className="text-danger" aria-hidden="true">
                          {t("projects.cards.requiredMark")}
                        </span>
                      ) : null}
                    </span>
                    <div className={cn("min-w-0", "sm:col-span-4")}>{key === "settlementMinHours" ? <div className="flex min-w-0 items-center gap-2">{control(key)}<span>{t('projects.cards.rangeSeparator')}</span>{control('settlementMaxHours')}<span className="shrink-0 text-xs">{t('projects.cards.hours')}</span></div> : control(key)}{publicFields.has(key) ? <p className="m-0 mt-1 text-xs text-brand" data-testid={`project-card-public-field-${key}`}>{t("projects.publicField.notice")}</p> : null}{key === "unitPrice" ? <p className="m-0 mt-1 text-xs text-brand" data-testid="project-card-unit-price-shared">{t("projects.cards.unitPriceShared")}</p> : null}</div>
                  </div>
                </Field>
              ) : (
                <div
                  key={key}
                  className={cn("grid min-w-0 grid-cols-1 gap-2 text-body", "sm:grid-cols-5")}
                >
                  <span className="text-xs text-fg-muted">{label(key === "settlementMinHours" ? "settlementHours" : key)}</span>
                  <span
                    className={cn("min-w-0 whitespace-pre-wrap break-words", "sm:col-span-4", key === "copySummary" ? "max-h-48 overflow-y-auto" : undefined)}
                    data-testid={
                      key === "publicSummary"
                        ? "project-detail-public-summary"
                        : key === "settlementMinHours" ? "project-card-value-settlementHours" : `project-card-value-${key}`
                    }
                  >
                    {key === "settlementMinHours" ? (!data.values.settlementMinHours && !data.values.settlementMaxHours ? t('projects.detail.valueNone') : <><span data-testid="project-card-value-settlementMinHours">{data.values.settlementMinHours || t('projects.detail.valueNone')}</span>{t('projects.cards.rangeSeparator')}<span data-testid="project-card-value-settlementMaxHours">{data.values.settlementMaxHours || t('projects.detail.valueNone')}</span>{t('projects.cards.hours')}</>) : display(key)}
                  </span>
                </div>
              )}</div>,
            )}</div>
            {id === "content" ? (
              <>
                {requirementBlock("MUST", editing)}
                {requirementBlock("NICE", editing)}
                {editing ? <p className="m-0 text-xs text-brand" data-testid="project-card-public-field-requirements">{t("projects.cards.requirementPublicNotice")}</p> : null}
              </>
            ) : null}
            {/* 🔴 F-013 AC-2: 取引先に出ない項目のブロックには常に注記を添える（凍結 testid の意味を保つ）。 */}
            {hostOnlyCards.has(id) ? (
              <p
                className="m-0 text-xs text-fg-muted"
                data-testid={id === "commercial" ? "project-detail-commerce-notice" : `project-card-host-only-notice-${id}`}
              >
                {t(id === "notes" ? "projects.cards.notesHostOnly" : "projects.commerce.notice")}
              </p>
            ) : null}
            {id === "commercial" ? (
              <p className="m-0 text-xs text-fg-muted" data-testid="project-card-money-hint">
                {t("projects.cards.moneyHint")}
              </p>
            ) : null}
            {id === "notes" && editing ? (
              <p className="m-0 text-xs text-fg-muted">
                {t("projects.cards.summaryHint")}
              </p>
            ) : null}
            {editing && error ? (
              <p
                role="alert"
                className="m-0 text-cell text-danger"
                data-testid="project-card-error"
              >
                {error}
              </p>
            ) : null}
          </div>
        </form>
      </section>
    );
  }
  // 🔴 読むだけのセクション（管理情報・関連情報など）も、編集できるセクションと同じ見出しの形にそろえる。
  function staticSection(id: "publish" | "related" | "management" | "history", children: ReactNode) {
    return (
      <section
        className="min-w-0 border-b border-border last:border-b-0"
        data-testid={
          id === "publish"
            ? "project-detail-section-publish"
            : id === "related"
              ? "project-detail-card-related"
              : id === "management"
                ? "project-detail-card-management"
                : "project-detail-section-history"
        }
      >
        <div className="px-4 pb-2 pt-4">
          <h2 className="m-0 text-lg font-semibold">{title(id)}</h2>
        </div>
        <div className="px-4 pb-4">{children}</div>
      </section>
    );
  }
  function definitionRows(rows: readonly (readonly [string, string])[]) {
    return (
      <dl className="m-0 flex flex-col divide-y divide-border text-body">
        {rows.map(([key, value]) => (
          <div key={key} className="grid min-w-0 grid-cols-1 gap-1 py-2 sm:grid-cols-5">
            <dt className="text-xs text-fg-muted">{label(key)}</dt>
            <dd className="m-0 min-w-0 break-words sm:col-span-4">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  // ✅ 2026-11-02: どのタブでも見える主要条件。保存後のクライアントの値（data）から描くので、保存すると即座に変わる。
  const none = t("projects.detail.valueNone");
  const summaryItems: readonly { key: string; icon: IconName; value: string }[] = [
    { key: "unitPrice", icon: "yen", value: display("unitPrice") },
    { key: "internalUnitPrice", icon: "yen", value: display("internalUnitPrice") },
    { key: "remoteMode", icon: "briefcase", value: display("remoteMode") },
    {
      key: "location",
      icon: "map-pin",
      value:
        [display("prefecture"), String(data.values.locationDetail ?? "")]
          .filter((part) => part && part !== none)
          .join(" ") || none,
    },
    { key: "startDate", icon: "calendar-clock", value: display("startDate") },
    { key: "endDate", icon: "calendar-clock", value: display("endDate") },
    { key: "headcount", icon: "users", value: display("headcount") },
  ];
  const panel = (children: ReactNode) => (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-bg">{children}</div>
  );
  const sections: Record<ProjectDetailTab, ReactNode> = {
    overview: panel(
      <>
        {card("basic")}
        {card("summary")}
        {card("company")}
        {staticSection("publish", visibility ?? null)}
      </>,
    ),
    requirements: panel(
      <>
        {card("content")}
        {card("development")}
      </>,
    ),
    working: panel(
      <>
        {card("working")}
        {card("commercial")}
      </>,
    ),
    related: panel(
      <>
        {staticSection(
          "related",
          <div className="flex flex-col gap-3 text-body">
            <div className="flex flex-wrap gap-4">
              <Button variant="ghost" size="sm" onClick={() => requestTab("overview")} data-testid="project-detail-related-visibility">
                {t("projects.cards.visibility")}
              </Button>
              <a href={`/projects/${data.id}/candidates`}>{t("projects.detail.candidates.open")}</a>
            </div>
            {proposals ?? null}
          </div>,
        )}
        {card("notes")}
        {staticSection(
          "management",
          definitionRows([
            ["id", data.id],
            ["createdAt", data.createdAt],
            ["updatedAt", data.updatedAt],
            ["origin", data.origin],
          ]),
        )}
        {staticSection(
          "history",
          <div className="flex flex-col gap-2">
            {definitionRows([
              ["createdAt", data.createdAt],
              ["updatedAt", data.updatedAt],
            ])}
            <p className="m-0 text-xs text-fg-muted">
              {canViewAuditLogs ? (
                <a href="/settings/audit-logs">{t("projects.cards.history.note")}</a>
              ) : (
                t("projects.cards.history.note")
              )}
            </p>
          </div>,
        )}
      </>,
    ),
  };
  function requestTab(value: string): void {
    const target = PROJECT_DETAIL_TABS.find((item) => item === value);
    if (!target || target === tab) return;
    if (active && dirty) {
      setNextTab(target);
      return;
    }
    setActive(null);
    setTab(target);
  }
  return (
    <div className="flex flex-col gap-4" data-testid="project-card-editor">
      {notice ? (
        <p role="status" className="m-0 text-cell text-fg-muted">
          {notice}
        </p>
      ) : null}
      <dl
        className="m-0 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-border bg-bg px-4 py-3 sm:grid-cols-4 xl:grid-cols-7"
        aria-label={t("projects.cards.summary.label")}
        data-testid="project-detail-summary-strip"
      >
        {summaryItems.map((item) => (
          <div key={item.key} className="flex min-w-0 items-start gap-2">
            <Icon name={item.icon} size="sm" className="mt-1 shrink-0 text-brand" />
            <div className="min-w-0">
              <dt className="text-xs text-fg-muted">
                {item.key === "location" ? t("projects.cards.summary.location") : label(item.key)}
              </dt>
              <dd
                className="m-0 truncate font-semibold tabular-nums text-fg"
                title={item.value}
                data-testid={`project-detail-summary-${item.key}`}
              >
                {item.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <Tabs
        label={t("projects.cards.tab.label")}
        value={tab}
        onValueChange={requestTab}
        data-testid="project-detail-tabs"
        items={[
          { value: "overview", label: t("projects.cards.tab.overview"), content: sections.overview, testId: "project-detail-tab-overview" },
          { value: "requirements", label: t("projects.cards.tab.requirements"), content: sections.requirements, testId: "project-detail-tab-requirements" },
          { value: "working", label: t("projects.cards.tab.working"), content: sections.working, testId: "project-detail-tab-working" },
          { value: "related", label: t("projects.cards.tab.related"), content: sections.related, testId: "project-detail-tab-related" },
        ]}
      />
      <Dialog
        open={nextTab !== null}
        onOpenChange={(open) => {
          if (!open) setNextTab(null);
        }}
        title={t("projects.cards.discardTitle")}
        body={t("projects.cards.tabDiscardBody")}
        cancelLabel={t("projects.cards.continue")}
        data-testid="project-card-tab-discard-dialog"
        confirm={
          <Button
            variant="primary"
            onClick={() => {
              if (nextTab) {
                setActive(null);
                setError("");
                setTab(nextTab);
              }
              setNextTab(null);
            }}
            data-testid="project-card-tab-discard-confirm"
          >
            {t("projects.cards.discard")}
          </Button>
        }
      />
      <Dialog
        open={nextCard !== null}
        onOpenChange={(open) => {
          if (!open) setNextCard(null);
        }}
        title={t("projects.cards.discardTitle")}
        body={t("projects.cards.discardBody")}
        cancelLabel={t("projects.cards.continue")}
        data-testid="project-card-discard-dialog"
        confirm={
          <Button
            variant="primary"
            onClick={() => {
              if (nextCard) begin(nextCard);
            }}
            data-testid="project-card-discard-confirm"
          >
            {t("projects.cards.discard")}
          </Button>
        }
      />
    </div>
  );
}

export function ProjectCardEditTrigger({
  id,
  label,
  field,
}: {
  readonly id: string;
  readonly label: string;
  /** 自動解除の原因の欄の先頭（案件名 → 基本情報、それ以外 → 業務内容と要件）。 */
  readonly field?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("project-card-edit", {
            detail: { id, card: field === "name" ? "basic" : field === "publicSummary" ? "summary" : "content" },
          }),
        )
      }
      data-testid="project-detail-publish-auto-revoked-fix"
    >
      {label}
    </Button>
  );
}

export function ProjectDetailCopyAction({text}:{readonly text:string}) {
  const [result,setResult]=useState<{text:string;state:'copying'|'copied'|'failed'}|null>(null);
  const state=result?.text===text?result.state:'idle';
  const busy=useRef(false);
  async function copy(){if(busy.current)return;busy.current=true;setResult({text,state:'copying'});try{await navigator.clipboard.writeText(text);setResult({text,state:'copied'});}catch{setResult({text,state:'failed'});}finally{busy.current=false;}}
  return <div className="flex items-center gap-2"><Tooltip content={t('projects.list.panel.copy.action')}><IconButton variant="secondary" size="sm" icon={<Icon name="copy"/>} aria-label={t('projects.list.panel.copy.action')} aria-busy={state==='copying'} onClick={()=>void copy()} data-testid="project-detail-copy-summary"/></Tooltip>{state==='copied'||state==='failed'?<span role={state==='failed'?'alert':'status'} className="text-xs text-fg-muted">{t(state==='copied'?'projects.list.panel.copy.copied':'projects.list.panel.copy.failed')}</span>:null}</div>;
}
