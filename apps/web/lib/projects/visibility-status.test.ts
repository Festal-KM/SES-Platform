import { describe, expect, it } from 'vitest';
import { projectVisibilityLabel } from './visibility-status';

describe('公開状況の表示', () => {
  it('公開先が0社なら、取引先の有無にかかわらず未公開', () => {
    expect(projectVisibilityLabel(0, 0)).toBe('UNPUBLISHED');
    expect(projectVisibilityLabel(0, 3)).toBe('UNPUBLISHED');
  });
  it('全社に公開されたときだけ公開中、それ以外は一部公開中', () => {
    expect(projectVisibilityLabel(3, 3)).toBe('PUBLISHED');
    expect(projectVisibilityLabel(1, 3)).toBe('PARTIAL');
    expect(projectVisibilityLabel(3, 4)).toBe('PARTIAL');
    expect(projectVisibilityLabel(2, 1)).toBe('PARTIAL');
  });
});
