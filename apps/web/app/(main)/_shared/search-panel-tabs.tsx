'use client';

import type { ComponentProps } from 'react';
import { Tabs } from '@ses/ui/client';

/** 案件・人材の検索条件と保存条件を同じ見た目で切り替える。 */
export function SearchPanelTabs(props: ComponentProps<typeof Tabs>) {
  return <Tabs {...props} className="gap-0 [&_[role=tab]]:text-cell [&_[role=tab][data-state=active]]:border-b-fg [&_[role=tab][data-state=active]]:text-fg" />;
}
