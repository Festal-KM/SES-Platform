import { Icon, type IconName } from '../icons.js';
import { IconButton, type IconButtonProps } from './button.js';
import { Tooltip } from './tooltip.js';

/** 印だけの操作でツールチップと読み上げ名を揃える。操作と結果の扱いは呼び出し側が持つ。 */
export type TooltipIconButtonProps = Omit<IconButtonProps, 'icon' | 'aria-label'> & {
  readonly label: string;
  readonly iconName: IconName;
  readonly 'data-testid'?: string;
};

export function TooltipIconButton({ label, iconName, ...props }: TooltipIconButtonProps) {
  return (
    <Tooltip content={label}>
      <IconButton type="button" size="sm" {...props} icon={<Icon name={iconName} />} aria-label={label} />
    </Tooltip>
  );
}
