import { ACCOUNT_ID, REGION } from './foundation.mjs';

// リポジトリ名の再利用によるなりすましも避けるため、GitHubの不変IDを照合する。
export const OIDC_SUBJECT = 'repo:Festal-KM@203054382/SES-Platform@1352164903';
export const DEVELOPMENT_BUCKET = `ses-platform-development-files-${ACCOUNT_ID}-${REGION}`;
export const DEVELOPMENT_INSTANCE = 'i-0bc41c9e860ebe14c';
export const DEVELOPMENT_DOCUMENT = 'ses-platform-development-deploy';
export function cicdTemplate() {
  const arn = (service, resource) => `arn:aws:${service}:${REGION}:${ACCOUNT_ID}:${resource}`;
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'GitHub OIDC development delivery without long-lived credentials',
    Parameters: { StorageKeyArn: { Type: 'String', AllowedPattern: `arn:aws:kms:${REGION}:${ACCOUNT_ID}:key/[a-f0-9-]+` } },
    Resources: {
      Provider: { Type: 'AWS::IAM::OIDCProvider', Properties: { Url: 'https://token.actions.githubusercontent.com', ClientIdList: ['sts.amazonaws.com'] } },
      Document: { Type: 'AWS::SSM::Document', Properties: {
        Name: DEVELOPMENT_DOCUMENT, DocumentType: 'Command', UpdateMethod: 'NewVersion',
        Content: { schemaVersion: '2.2', description: 'Verified development source only',
          parameters: {
            Commit: { type: 'String', allowedPattern: '^[a-f0-9]{40}$', interpolationType: 'ENV_VAR' },
            ArchiveDigest: { type: 'String', allowedPattern: '^[a-f0-9]{64}$', interpolationType: 'ENV_VAR' },
          },
          mainSteps: [{ action: 'aws:runShellScript', name: 'Deploy', inputs: { timeoutSeconds: '3600', runCommand: [
            'set -eu',
            'test -n "$SSM_Commit" && test -n "$SSM_ArchiveDigest"',
            'exec 9>/var/lock/ses-development-deploy.lock', 'flock -n 9 || { echo "Another development deployment is running"; exit 1; }',
            'cd /workspaces/ses-platform',
            'archive=$(mktemp /tmp/ses-ci-source.XXXXXX)', 'trap \'rm -f "$archive"\' EXIT',
            `aws s3 cp "s3://${DEVELOPMENT_BUCKET}/bootstrap/ci/$SSM_Commit/$SSM_ArchiveDigest.tar.gz" "$archive" --region ${REGION} --only-show-errors`,
            'printf \'%s  %s\\n\' "$SSM_ArchiveDigest" "$archive" | sha256sum -c -',
            'if [ -f .aws-source-manifest.json ]; then cp .aws-source-manifest.json .aws-source-manifest.previous.json; fi',
            'tar -xzf "$archive" -C /workspaces/ses-platform --no-same-owner',
            'bash scripts/aws-bootstrap-development.sh --initialize',
            'curl --fail --silent --show-error --retry 30 --retry-delay 5 --retry-connrefused http://127.0.0.1:3000/signin >/dev/null',
            'printf \'%s\\n\' "$SSM_Commit" > .aws-deployed-commit',
          ] } }],
        },
      } },
      DevelopmentRole: { Type: 'AWS::IAM::Role', Properties: {
        RoleName: 'ses-platform-development-github', MaxSessionDuration: 7200,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
          Principal: { Federated: { Ref: 'Provider' } }, Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `${OIDC_SUBJECT}:environment:development` } },
        }] },
        Policies: [{ PolicyName: 'development-delivery-only', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['s3:PutObject'], Resource: `arn:aws:s3:::${DEVELOPMENT_BUCKET}/bootstrap/ci/*` },
          { Effect: 'Allow', Action: ['kms:GenerateDataKey', 'kms:Decrypt'], Resource: { Ref: 'StorageKeyArn' }, Condition: { StringEquals: { 'kms:ViaService': `s3.${REGION}.amazonaws.com` } } },
          { Effect: 'Allow', Action: 'ssm:SendCommand', Resource: [arn('ssm', `document/${DEVELOPMENT_DOCUMENT}`), arn('ec2', `instance/${DEVELOPMENT_INSTANCE}`)] },
          { Effect: 'Allow', Action: ['ssm:GetCommandInvocation', 'ec2:DescribeInstances'], Resource: '*' },
          { Effect: 'Deny', Action: ['secretsmanager:*', 'iam:*', 'sts:AssumeRole', 'ses:*', 'sns:Publish'], Resource: '*' },
        ] } }],
      } },
    },
    Outputs: { DevelopmentRoleArn: { Value: { 'Fn::GetAtt': ['DevelopmentRole', 'Arn'] } } },
  };
}
