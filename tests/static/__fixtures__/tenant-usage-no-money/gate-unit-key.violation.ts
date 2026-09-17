// 対照（違反）: 残量に `gate-inspector` のキーがある（F-027 AC-7）。`tenant-usage-no-money.test.ts` ② が検出する。
export const AI_UNIT_KEYS = {
  AI_UNIT_SHEET_PARSE: 'sheetParse',
  AI_UNIT_GATE: 'gateInspector',
} as const;

export type TamperedAiUnits = {
  readonly sheetParse: number;
  readonly gateInspector: number;
};

export const stoppedFeature = 'reviewGate';
export const role = 'gate-inspector';
