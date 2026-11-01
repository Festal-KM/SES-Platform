// 画像指定の単一選択を、既存Radioのキーボード操作で提供する。
import { Radio } from './radio.js';
import { cn } from '../lib/cn.js';
export function SegmentedControl({ value, options, onChange, label, testIdPrefix, compact = false }: {
  readonly compact?: boolean;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly testIdPrefix: string;
}) {
  return <div role="radiogroup" aria-label={label} className={compact && options.length === 4 ? 'grid min-w-0 grid-cols-2 gap-1' : 'flex h-9 min-w-0 items-stretch gap-1'} data-testid={`${testIdPrefix}segments`}>
    {options.map(option => <label key={option.value} className="min-w-0 flex-auto cursor-pointer">
      <Radio className="peer sr-only" form="" name={`${testIdPrefix}control`} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} data-testid={`${testIdPrefix}segment-${option.value || 'all'}`} />
      <span className={cn('flex h-9 items-center justify-center whitespace-nowrap rounded-full border px-2 text-xs font-medium transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand', value === option.value ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-bg-subtle text-fg hover:bg-bg-inset')}>{option.label}</span>
    </label>)}
  </div>;
}
