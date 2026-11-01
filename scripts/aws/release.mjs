import { ACCOUNT_ID, REGION } from '../../infra/aws/foundation.mjs';
export function releaseRecord({ commit, digest, buildId, verifiedAt }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '') || !buildId?.startsWith('ses-platform-demo:')) throw new Error('リリースの識別子が不正です');
  return { version: 1, commit, digest, buildId, ...(verifiedAt ? { verifiedAt } : {}) };
}
export function releaseImage(environment, digest) {
  if (!['demo', 'production'].includes(environment) || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('環境またはイメージが不正です');
  return `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/ses-platform-${environment}@${digest}`;
}
export function releaseServicesReady(services, definitions) {
  return services.length === 2 && ['web', 'worker'].every(role => {
    const service = services.find(item => item.serviceName.endsWith(`-${role}`));
    return service?.taskDefinition === definitions[role] && service.deployments.length === 1
      && service.deployments[0].rolloutState === 'COMPLETED'
      && service.runningCount === service.desiredCount && service.pendingCount === 0;
  });
}
