// packages/ai/src/gate/examine.ts
// 🔴 品質ゲートの「AI に渡す前」と「AI から受け取った後」の写像（docs/05 §11.2 / §11.4 / §11.7）。
//    T-07-06。**I/O を持たない**（DB もキューも見ない。ジョブから呼ばれる純粋な変換である）。
//
// ============================================================================
// 🔴 ここが担っている 3 つのこと
// ============================================================================
//   ① `GateInput`（生の本文）→ `gate-inspector` の入力（**マスキング済みの欄**）への写像
//      （docs/05 §7.13 ③ の T-07-06 への申し送り 1）
//   ② 🔴 **機械的検出**（§11.4）—— 台帳の既知 PII 値・公開範囲外の商流語が本文に残っていないか。
//      `mask()` と**同じ照合**（`locateSensitive`）を使う。別実装にすると、
//      **LLM には伏せて送っているのにゲートは見逃す**という最も気づきにくい壊れ方になる
//   ③ AI が返した欄内オフセットを、**マスキング前の本文の位置に戻す**
//      （画面がハイライトするのは利用者が編集する生の本文である。§11.7）
//
// ============================================================================
// 🔴 なぜ機械的検出は「既知値」だけを FAIL にするのか
// ============================================================================
// パターン検出（メール・電話の形）まで FAIL にすると、提案本文の末尾にある**自社担当者の署名**
// （自分のメール・電話）だけで毎回 FAIL になる。`BR-18` は「FAIL の解消手段は元データの修正のみ」
// と定めているので、直しようのない FAIL を作ると承認フロー全体が回らなくなる。
// 守るべきは `BR-11`（**エンジニアの** PII を外に出さない）であり、それは台帳の既知値で
// 完全に表現できる。台帳に無い氏名・連絡先の指摘は `gate-inspector`（AI）の領分である。

import {
  GATE_FINDING_EXCERPT_MAX_LENGTH,
  type GateFinding,
  type GateFindingField,
  type GateFindingKind,
  type GateInput,
  type GateLayerResult,
} from '@ses/domain';
import {
  locateSensitive,
  mask,
  MASK_PLACEHOLDERS,
  type KnownSensitiveValues,
  type MaskCategory,
  type MaskHit,
  type SensitiveSpan,
} from '../mask.js';
import type {
  GateInspectorInput,
  GateInspectorOutput,
  GateInspectorSection,
} from '../roles/gate-inspector.js';

/**
 * 🔴 検査できる本文が 1 欄も無い（docs/05 §11.1 / `F-020 AC-1`）。
 *
 * **PASS にも FAIL にもせず、ゲートを成立させない。** 「検査対象が無いので PASS」は
 * 「ゲートを通したことにして外部共有できる」ことを意味し、`BR-15` を空回りさせる。
 * 入力を組み立てる側（`packages/db` の `loadGateInput`）が非空を保証する契約であり、
 * ここに来たら**呼び出し側の不具合**なので握り潰さず throw する。
 */
export class EmptyGateContentError extends Error {
  constructor(readonly targetType: string, readonly targetId: string) {
    super(
      `検査できる本文がありません（targetType=${targetType} / targetId=${targetId}）。` +
        '空の入力を PASS として扱うことはできません（docs/05 §11.1 / F-020 AC-1）。',
    );
    this.name = 'EmptyGateContentError';
  }
}

// ============================================================================
// 1. 種別の写像（`MaskCategory` → `GateFinding`）
// ============================================================================

type MechanicalKind = { readonly layer: 'PII' | 'COMMERCE'; readonly kind: GateFindingKind };

/**
 * 🔴 **全 `MaskCategory` を網羅する**（`Record` なので値が増えるとコンパイルエラーになる）。
 *    `null` は「指摘にしない」であり、`BOUNDARY_TAG`（プロンプトインジェクション対策で
 *    除去するタグ）だけがそれに当たる —— タグの混入は外部共有物の欠陥ではない。
 */
const MECHANICAL_KIND: Readonly<Record<MaskCategory, MechanicalKind | null>> = {
  NAME: { layer: 'PII', kind: 'FULL_NAME' },
  BIRTH_DATE: { layer: 'PII', kind: 'BIRTH_DATE' },
  EMAIL: { layer: 'PII', kind: 'CONTACT' },
  PHONE: { layer: 'PII', kind: 'CONTACT' },
  PERSONAL_NUMBER: { layer: 'PII', kind: 'CONTACT' },
  POSTAL_CODE: { layer: 'PII', kind: 'CONTACT' },
  AFFILIATION: { layer: 'PII', kind: 'AFFILIATION' },
  UNIT_PRICE: { layer: 'COMMERCE', kind: 'UNIT_PRICE' },
  END_CLIENT: { layer: 'COMMERCE', kind: 'END_CLIENT' },
  BOUNDARY_TAG: null,
};

/** 既知値だけを見る（本ファイル冒頭の 🔴）。 */
const KNOWN_VALUES_ONLY = { includePatterns: false } as const;

const EMPTY_KNOWN: KnownSensitiveValues = {
  fullNames: [],
  birthDates: [],
  emails: [],
  phones: [],
  affiliations: [],
  unitPrices: [],
  endClientNames: [],
};

/**
 * 🔴 指摘の `excerpt` は**伏せ字そのもの**にする（`[名前]` / `[企業名]` …）。
 *
 * §3.6 は「該当箇所の抜粋（最大 80 文字。**PII はマスク済み**）」と定める。原文を切り出すと
 * `ReviewGate.findings`（JSON）が PII と商流情報の保管場所になり、承認画面・監査・エクスポートの
 * すべてに載る。位置は `offsetStart` / `offsetEnd` が示すので、抜粋に原文は要らない。
 */
function mechanicalExcerpt(category: MaskCategory): string {
  return MASK_PLACEHOLDERS[category].slice(0, GATE_FINDING_EXCERPT_MAX_LENGTH);
}

// ============================================================================
// 2. マスキング前後のオフセットの対応
// ============================================================================

type OffsetSegment = {
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly maskedStart: number;
  readonly maskedEnd: number;
  /** 伏せ字に置き換わった区間（この中の位置は原文の区間の端に丸める）。 */
  readonly placeholder: boolean;
};

/** 欄ごとの対応表。🔴 原文も伏せ字も持たない（長さと位置だけ）。 */
export type MaskOffsetMap = readonly OffsetSegment[];

function buildOffsetMap(raw: string, spans: readonly SensitiveSpan[]): MaskOffsetMap {
  const segments: OffsetSegment[] = [];
  let rawCursor = 0;
  let maskedCursor = 0;
  for (const span of spans) {
    if (span.start > rawCursor) {
      const length = span.start - rawCursor;
      segments.push({
        rawStart: rawCursor,
        rawEnd: span.start,
        maskedStart: maskedCursor,
        maskedEnd: maskedCursor + length,
        placeholder: false,
      });
      maskedCursor += length;
    }
    const placeholderLength = MASK_PLACEHOLDERS[span.category].length;
    segments.push({
      rawStart: span.start,
      rawEnd: span.end,
      maskedStart: maskedCursor,
      maskedEnd: maskedCursor + placeholderLength,
      placeholder: true,
    });
    maskedCursor += placeholderLength;
    rawCursor = span.end;
  }
  if (rawCursor < raw.length) {
    const length = raw.length - rawCursor;
    segments.push({
      rawStart: rawCursor,
      rawEnd: raw.length,
      maskedStart: maskedCursor,
      maskedEnd: maskedCursor + length,
      placeholder: false,
    });
  }
  return segments;
}

/**
 * マスキング後のオフセットを原文のオフセットへ戻す。
 *
 * 🔴 伏せ字の内側を指す位置は、原文の**区間の端**へ丸める（`start` は左端 / `end` は右端）。
 *    伏せ字は原文と長さが違うので、内側に 1 対 1 の対応は存在しない。丸めておけば
 *    ハイライトが「伏せられていた値の全体」を覆う —— 中途半端な位置を返すより正しい。
 */
export function toRawOffset(map: MaskOffsetMap, maskedOffset: number, edge: 'start' | 'end'): number | null {
  if (maskedOffset < 0) return null;
  for (const segment of map) {
    const inside =
      edge === 'start'
        ? maskedOffset >= segment.maskedStart && maskedOffset < segment.maskedEnd
        : maskedOffset > segment.maskedStart && maskedOffset <= segment.maskedEnd;
    if (!inside) continue;
    if (segment.placeholder) return edge === 'start' ? segment.rawStart : segment.rawEnd;
    return segment.rawStart + (maskedOffset - segment.maskedStart);
  }
  const last = map[map.length - 1];
  // 末尾ちょうど（空欄・末尾一致）だけは端に丸める。それ以外は「特定できない」。
  if (edge === 'start' && maskedOffset === 0) return 0;
  if (last !== undefined && edge === 'end' && maskedOffset === last.maskedEnd) return last.rawEnd;
  return null;
}

// ============================================================================
// 3. 準備（マスキング + 機械的検出）
// ============================================================================

export type PreparedGateExamination = {
  /** 🔴 `runRole` に渡す入力（本文はすべて `MaskedText`）。 */
  readonly inspectorInput: GateInspectorInput;
  /** 🔴 `AiCallContext.maskHits` に渡す要約（docs/05 §7.11 ③）。 */
  readonly maskHits: readonly MaskHit[];
  /** 既知 PII 値の残存（`layer='PII'` / `severity='BLOCK'`）。 */
  readonly mechanicalPii: readonly GateFinding[];
  /** 公開範囲外の商流語の露出（`layer='COMMERCE'` / `severity='BLOCK'`）。 */
  readonly mechanicalCommerce: readonly GateFinding[];
  /** 欄ごとのオフセット対応表（AI の指摘を原文の位置に戻すために使う）。 */
  readonly offsetMaps: ReadonlyMap<GateFindingField, MaskOffsetMap>;
};

function mergeHits(all: readonly (readonly MaskHit[])[]): readonly MaskHit[] {
  const counts = new Map<string, MaskHit>();
  for (const hits of all) {
    for (const hit of hits) {
      const key = `${hit.category} ${hit.method}`;
      const previous = counts.get(key);
      counts.set(key, previous === undefined ? hit : { ...hit, count: previous.count + hit.count });
    }
  }
  return [...counts.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.method.localeCompare(b.method),
  );
}

function findingsFromSpans(
  field: GateFindingField,
  spans: readonly SensitiveSpan[],
  override?: GateFindingKind,
): { readonly pii: GateFinding[]; readonly commerce: GateFinding[] } {
  const pii: GateFinding[] = [];
  const commerce: GateFinding[] = [];
  for (const span of spans) {
    const mapped = MECHANICAL_KIND[span.category];
    if (mapped === null) continue;
    const finding: GateFinding = {
      layer: mapped.layer,
      kind: override ?? mapped.kind,
      field,
      offsetStart: span.start,
      offsetEnd: span.end,
      excerpt: mechanicalExcerpt(span.category),
      // 🔴 機械的検出は必ず `BLOCK`（＝ FAIL を作る）。既知値の残存に「警告」は無い。
      severity: 'BLOCK',
    };
    (mapped.layer === 'PII' ? pii : commerce).push(finding);
  }
  return { pii, commerce };
}

/** 位置が重なる指摘を落とす（他社名の走査が既知値の走査と重なったとき）。 */
function withoutOverlaps(
  primary: readonly GateFinding[],
  extra: readonly GateFinding[],
): readonly GateFinding[] {
  return extra.filter(
    (candidate) =>
      !primary.some(
        (existing) =>
          existing.field === candidate.field &&
          existing.offsetStart !== null &&
          candidate.offsetStart !== null &&
          existing.offsetEnd !== null &&
          candidate.offsetEnd !== null &&
          candidate.offsetStart < existing.offsetEnd &&
          existing.offsetStart < candidate.offsetEnd,
      ),
  );
}

/** 指摘の並びを決定的にする（欄の並び → 位置 → 種別）。 */
function sortFindings(findings: readonly GateFinding[], fieldOrder: readonly GateFindingField[]): GateFinding[] {
  return [...findings].sort((a, b) => {
    const fieldDiff = fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field);
    if (fieldDiff !== 0) return fieldDiff;
    const startDiff = (a.offsetStart ?? -1) - (b.offsetStart ?? -1);
    if (startDiff !== 0) return startDiff;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

/**
 * 🔴 ゲートの入力を「AI に渡す形」と「機械的検出の結果」に変換する。
 *
 * @throws EmptyGateContentError 検査できる本文が 1 欄も無いとき（PASS に倒さない）。
 */
export function prepareGateExamination(input: GateInput): PreparedGateExamination {
  // 🔴 `mask()` に渡す既知値は PII と商流の**両方**である（docs/05 §7.10 ②）。
  //    LLM には氏名も単価もエンド企業名も渡さない（`BR-11` / `BR-12`）。
  const maskKnown: KnownSensitiveValues = {
    fullNames: input.knownPii.fullNames,
    birthDates: input.knownPii.birthDates,
    emails: input.knownPii.emails,
    phones: input.knownPii.phones,
    affiliations: input.knownPii.affiliations,
    unitPrices: input.forbiddenTerms.unitPrices,
    // 🔴 他社名も伏せて送る（LLM の生成物に混入させない）。指摘の種別だけは下で分ける。
    endClientNames: [...input.forbiddenTerms.endClientNames, ...input.forbiddenTerms.otherCompanyNames],
  };
  // 🔴 指摘の照合は 2 本に分ける。`mask()` は「伏せる」だけなので他社名もエンド企業名も同じ
  //    種別でよいが、**指摘の種別は分けなければならない** —— 承認画面と `F-014 AC-3` は
  //    「エンド企業名が出た」と「他社名が出た」を別の事故として扱う（前者は商流情報の漏れ、
  //    後者はパートナー間の相互参照そのもの。`CLAUDE.md` §3.1 の 🔴）。
  const findingKnown: KnownSensitiveValues = {
    fullNames: input.knownPii.fullNames,
    birthDates: input.knownPii.birthDates,
    emails: input.knownPii.emails,
    phones: input.knownPii.phones,
    affiliations: input.knownPii.affiliations,
    unitPrices: input.forbiddenTerms.unitPrices,
    endClientNames: input.forbiddenTerms.endClientNames,
  };
  const otherCompanyKnown: KnownSensitiveValues = {
    ...EMPTY_KNOWN,
    endClientNames: input.forbiddenTerms.otherCompanyNames,
  };

  const sections: GateInspectorSection[] = [];
  const maskHits: (readonly MaskHit[])[] = [];
  const offsetMaps = new Map<GateFindingField, MaskOffsetMap>();
  const fieldOrder: GateFindingField[] = [];
  let pii: GateFinding[] = [];
  let commerce: GateFinding[] = [];

  for (const section of input.sections) {
    if (section.text.trim().length === 0) continue;
    fieldOrder.push(section.field);

    // ① LLM へ送る本文（伏せ字入り）と、その位置対応表。
    const masked = mask(section.text, maskKnown);
    const maskedSpans = locateSensitive(section.text, maskKnown);
    offsetMaps.set(section.field, buildOffsetMap(section.text, maskedSpans));
    sections.push({ field: section.field, text: masked.text });
    maskHits.push(masked.hits);

    // ② 機械的検出（既知値のみ）。
    const known = findingsFromSpans(
      section.field,
      locateSensitive(section.text, findingKnown, KNOWN_VALUES_ONLY),
    );
    const others = findingsFromSpans(
      section.field,
      locateSensitive(section.text, otherCompanyKnown, KNOWN_VALUES_ONLY),
      'OTHER_COMPANY',
    );
    pii = [...pii, ...known.pii];
    commerce = [
      ...commerce,
      ...known.commerce,
      // 🔴 同じ箇所を 2 件として数えない（提案元の会社名が「現所属会社」= PII 層でも
      //    拾われる場合など）。**先に確定した種別を優先する。**
      ...withoutOverlaps([...known.pii, ...known.commerce], others.commerce),
    ];
  }

  if (sections.length === 0) throw new EmptyGateContentError(input.targetType, input.targetId);

  return {
    inspectorInput: { audienceKind: input.audience.kind, sections },
    maskHits: mergeHits(maskHits),
    mechanicalPii: sortFindings(pii, fieldOrder),
    mechanicalCommerce: sortFindings(commerce, fieldOrder),
    offsetMaps,
  };
}

// ============================================================================
// 4. AI の出力を `GateFinding` に写す
// ============================================================================

export type InterpretedGateInspection = {
  readonly pii: GateLayerResult;
  readonly commerce: GateLayerResult;
  /** 🔴 整合層の**警告**（合否に効かない。`BR-61`）。 */
  readonly warnings: readonly GateFinding[];
};

type RawInspectorFinding = {
  readonly kind: GateFindingKind;
  readonly field: GateFindingField;
  readonly offsetStart: number | null;
  readonly offsetEnd: number | null;
  readonly excerpt: string;
  readonly severity: 'BLOCK' | 'WARN';
};

function toFinding(
  prepared: PreparedGateExamination,
  layer: GateFinding['layer'],
  raw: RawInspectorFinding,
): GateFinding {
  const map = prepared.offsetMaps.get(raw.field);
  const start =
    map === undefined || raw.offsetStart === null ? null : toRawOffset(map, raw.offsetStart, 'start');
  const end = map === undefined || raw.offsetEnd === null ? null : toRawOffset(map, raw.offsetEnd, 'end');
  // 🔴 片方だけ・逆転は「特定できない」に倒す（空文字や -1 を画面へ渡さない。docs/05 §11.7）。
  const usable = start !== null && end !== null && start < end;
  return {
    layer,
    kind: raw.kind,
    field: raw.field,
    offsetStart: usable ? start : null,
    offsetEnd: usable ? end : null,
    excerpt: raw.excerpt,
    severity: raw.severity,
  };
}

/**
 * 🔴 `gate-inspector` の出力に `layer` を付け、オフセットを**原文の位置**へ戻す。
 *
 * 🔴 `layer` は AI に決めさせない（どちらの配列に入っていたかで決まる。docs/05 §7.13 ④）。
 * 🔴 整合層の警告は `severity='WARN'` しか取り得ない（出力スキーマの `z.literal`）。
 *    ここでも `layer='CONSISTENCY'` を付けるだけで、合否には一切触れない。
 */
export function interpretGateInspection(
  prepared: PreparedGateExamination,
  output: GateInspectorOutput,
): InterpretedGateInspection {
  return {
    pii: {
      verdict: output.pii.verdict,
      findings: output.pii.findings.map((finding) => toFinding(prepared, 'PII', finding)),
    },
    commerce: {
      verdict: output.commerce.verdict,
      findings: output.commerce.findings.map((finding) => toFinding(prepared, 'COMMERCE', finding)),
    },
    warnings: output.consistencyWarnings.map((warning) => toFinding(prepared, 'CONSISTENCY', warning)),
  };
}
