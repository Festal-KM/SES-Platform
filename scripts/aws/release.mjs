import { ACCOUNT_ID, REGION } from '../../infra/aws/foundation.mjs';
export function releaseRecord({ commit, digest, buildId, verifiedAt }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '') || !buildId?.startsWith('ses-platform-demo:')) throw new Error('リリースの識別子が不正です');
  return { version: 1, commit, digest, buildId, ...(verifiedAt ? { verifiedAt } : {}) };
}
export function releaseImage(environment, digest) {
  if (!['demo', 'production'].includes(environment) || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('環境またはイメージが不正です');
  return `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/ses-platform-${environment}@${digest}`;
}
