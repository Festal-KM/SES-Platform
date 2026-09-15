// 対照: apps/web が @ses/ai から import してよいのはマスキングの純粋関数と語彙、および型だけ
//（T-08-06 の依頼メッセージの商流照合。docs/05 §6.5「#31 の実装の決着」）。
import { mask, MASK_CATEGORIES, MASK_PLACEHOLDERS, type KnownSensitiveValues, type MaskCategory } from '@ses/ai';
import type { MaskResult } from '@ses/ai';

export function ok(text: string, known: KnownSensitiveValues): MaskResult {
  const categories: readonly MaskCategory[] = MASK_CATEGORIES;
  void categories;
  void MASK_PLACEHOLDERS;
  return mask(text, known);
}
