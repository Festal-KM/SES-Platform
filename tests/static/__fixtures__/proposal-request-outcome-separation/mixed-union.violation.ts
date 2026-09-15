// 違反 fixture: 2 つのエンティティの状態を 1 つの union 型に畳んでいる。
export type ClosedState = 'LOST' | 'DECLINED' | 'WITHDRAWN_BY_HOST';
