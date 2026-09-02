// 違反: @ses/db から PrismaClient を named import している（防御的ルール。CLAUDE.md §3.1 / docs/05 §4.3）
// @ses/db は現状これを export しないが、将来のエクスポート追加による迂回を防ぐ。
import { PrismaClient } from '@ses/db';

export const use = () => new PrismaClient();
