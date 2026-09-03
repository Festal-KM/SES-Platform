// packages/ui/src/index.ts — @ses/ui の公開 API。
// 🔴 取り込んだ shadcn/ui コンポーネントは、ここから export したものだけを `apps/*` が使う
//    （CLAUDE.md §2.1「共有 UI コンポーネント」/ docs/03 §2「取り込んだコンポーネントは
//    packages/ui に一元管理」）。S-003 / S-004 が使う最小構成（Button / Card）のみ。
export { Button } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/card.js';
export { cn } from './lib/cn.js';
