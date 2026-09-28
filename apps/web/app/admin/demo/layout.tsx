// apps/web/app/admin/demo/layout.tsx
// 運営者コンソールの共通ナビ（横並びタブ 5 グループ）を、この区画の全画面にかける。
// 🔴 なぜ `app/admin/layout.tsx` ではないのかは `_components/console-frame.tsx` 冒頭に書いた
//    （`A-001` サインインはナビを持たない。docs/04 §3.3-2）。
import type { ReactNode } from 'react';
import { AdminConsoleFrame } from '../_components/console-frame';

export default function AdminConsoleAreaLayout({ children }: { readonly children: ReactNode }) {
  return <AdminConsoleFrame current="operations">{children}</AdminConsoleFrame>;
}
