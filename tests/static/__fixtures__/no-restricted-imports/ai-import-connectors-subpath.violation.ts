// 違反: packages/ai が packages/connectors のサブパスに依存している（CLAUDE.md §2.1 ③）
import { sendEmail } from '@ses/connectors/email';

export const use = () => sendEmail;
