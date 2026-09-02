// 違反: @ses/db/testing は tests/isolation/** 以外から import できない（docs/05 §4.7）
import { createUnextendedClient } from '@ses/db/testing';

export const use = () => createUnextendedClient;
