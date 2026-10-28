import { ACCOUNT_ID, REGION } from './foundation.mjs';
const SUBJECT = 'repo:Festal-KM@203054382/SES-Platform@1352164903';
export function releaseDeliveryTemplate() {
  const resources = {};
  for (const environment of ['demo', 'production']) {
    const prefix = `ses-platform-${environment}`;
    const bucket = `${prefix}-files-${ACCOUNT_ID}-${REGION}`;
    const arn = (service, resource) => `arn:aws:${service}:${REGION}:${ACCOUNT_ID}:${resource}`;
    const key = environment === 'demo' ? 'DemoKeyArn' : 'ProductionKeyArn';
    const statements = [
      { Effect: 'Allow', Action: ['cloudformation:DescribeStacks'], Resource: ['foundation', 'application', 'ingress'].map(stack => arn('cloudformation', `stack/${prefix}-${stack}/*`)) },
      { Effect: 'Allow', Action: 'ssm:GetParameter', Resource: arn('ssm', `parameter/ses-platform/${environment}/deployment`) },
      { Effect: 'Allow', Action: ['ecr:DescribeImages'], Resource: arn('ecr', `repository/${prefix}`) },
      { Effect: 'Allow', Action: ['s3:PutObject'], Resource: [`arn:aws:s3:::${bucket}/releases/*`, ...(environment === 'demo' ? [`arn:aws:s3:::${bucket}/bootstrap/build/*`] : [])] },
      { Effect: 'Allow', Action: ['kms:GenerateDataKey', 'kms:Decrypt'], Resource: { Ref: key }, Condition: { StringEquals: { 'kms:ViaService': `s3.${REGION}.amazonaws.com` } } },
      { Effect: 'Allow', Action: ['ecs:RegisterTaskDefinition', 'ecs:TagResource'], Resource: '*', Condition: { StringEquals: { 'aws:RequestTag/Environment': environment } } },
      { Effect: 'Allow', Action: 'iam:PassRole', Resource: ['task', 'execution', 'migration-execution'].map(role => `arn:aws:iam::${ACCOUNT_ID}:role/${prefix}-${role}`), Condition: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } } },
      { Effect: 'Allow', Action: 'ecs:RunTask', Resource: arn('ecs', `task-definition/${prefix}-*:*`), Condition: { ArnEquals: { 'ecs:cluster': arn('ecs', `cluster/${prefix}`) } } },
      { Effect: 'Allow', Action: ['ecs:DescribeTasks'], Resource: arn('ecs', `task/${prefix}/*`) },
      { Effect: 'Allow', Action: 'ecs:ListTasks', Resource: '*', Condition: { ArnEquals: { 'ecs:cluster': arn('ecs', `cluster/${prefix}`) } } },
      { Effect: 'Allow', Action: ['ecs:DescribeServices', 'ecs:CreateService', 'ecs:UpdateService'], Resource: arn('ecs', `service/${prefix}/${prefix}-*`) },
      { Effect: 'Deny', Action: ['secretsmanager:GetSecretValue', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'sts:AssumeRole', 'ses:*', 'sns:Publish'], Resource: '*' },
    ];
    if (environment === 'demo') {
      statements.push({ Effect: 'Allow', Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], Resource: arn('codebuild', 'project/ses-platform-demo') });
    } else {
      statements.push(
        { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
        { Effect: 'Allow', Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'], Resource: ['demo', 'production'].map(env => arn('ecr', `repository/ses-platform-${env}`)) },
        { Effect: 'Allow', Action: ['ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage'], Resource: arn('ecr', `repository/${prefix}`) },
        { Effect: 'Allow', Action: 's3:GetObject', Resource: `arn:aws:s3:::ses-platform-demo-files-${ACCOUNT_ID}-${REGION}/releases/*` },
        { Effect: 'Allow', Action: 'kms:Decrypt', Resource: { Ref: 'DemoKeyArn' }, Condition: { StringEquals: { 'kms:ViaService': `s3.${REGION}.amazonaws.com` } } },
      );
    }
    resources[environment === 'demo' ? 'DemoRole' : 'ProductionRole'] = { Type: 'AWS::IAM::Role', Properties: {
      RoleName: `${prefix}-github`, MaxSessionDuration: 7200,
      AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: { Federated: `arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com` },
        Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${SUBJECT}:environment:${environment}` } },
      }] }, Policies: [{ PolicyName: 'environment-delivery-only', PolicyDocument: { Version: '2012-10-17', Statement: statements } }],
    } };
  }
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Manual demo delivery and approved production promotion',
    Parameters: { DemoKeyArn: { Type: 'String' }, ProductionKeyArn: { Type: 'String' } }, Resources: resources };
}
