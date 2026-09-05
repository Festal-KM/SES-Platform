// 対照 fixture: index.ts（モックの唯一の import 元）からの相対 import は許可される。
import { MockEmailSender } from './mock/index.js';

export const use = MockEmailSender;
