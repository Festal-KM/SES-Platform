// 違反: packages/config が apps/* に依存している（CLAUDE.md §2.1 ①）
// db/ai/connectors 以外の packages/* ゾーン（config/ui/i18n）にもルール①が
// 一律で効くことを確認する回帰テスト用。
import { placeholder } from '@ses/worker';

export const use = () => placeholder;
