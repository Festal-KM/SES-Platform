import { ACCOUNT_ID, REGION } from './foundation.mjs';
export function buildTemplate(environment) {
  if (!['demo', 'production'].includes(environment)) throw new Error('ビルド環境が不正です');
  const prefix = `ses-platform-${environment}`;
  const ref = (name) => ({ Ref: name });
  const att = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const sub = (value) => ({ 'Fn::Sub': value });
  return { AWSTemplateFormatVersion: '2010-09-09', Description: `${prefix} image build without application secrets`,
    Parameters: { Bucket: { Type: 'String' }, KeyArn: { Type: 'String' } },
    Resources: {
      Logs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: `/ses-platform/build/${environment}`, RetentionInDays: 14 } },
      Role: { Type: 'AWS::IAM::Role', Properties: {
        RoleName: `${prefix}-build`,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'codebuild.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ACCOUNT_ID }, ArnEquals: { 'aws:SourceArn': `arn:aws:codebuild:${REGION}:${ACCOUNT_ID}:project/${prefix}` } } }] },
        Policies: [{ PolicyName: 'build-artifacts-only', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: att('Logs', 'Arn') },
          { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion'], Resource: sub('arn:${AWS::Partition}:s3:::${Bucket}/bootstrap/build/*') },
          { Effect: 'Allow', Action: 'kms:Decrypt', Resource: ref('KeyArn'), Condition: { StringEquals: { 'kms:ViaService': `s3.${REGION}.amazonaws.com` } } },
          { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:DescribeImages', 'ecr:BatchCheckLayerAvailability', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], Resource: `arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${prefix}` },
          { Effect: 'Deny', Action: ['secretsmanager:*', 'ssm:GetParameter*', 'sts:AssumeRole', 'iam:*'], Resource: '*' },
        ] } }],
      } },
      Project: { Type: 'AWS::CodeBuild::Project', Properties: {
        Name: prefix, ServiceRole: att('Role', 'Arn'), TimeoutInMinutes: 45, QueuedTimeoutInMinutes: 30,
        Artifacts: { Type: 'NO_ARTIFACTS' },
        Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_MEDIUM', Image: 'aws/codebuild/standard:7.0', PrivilegedMode: true,
          EnvironmentVariables: [{ Name: 'REPOSITORY', Value: `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${prefix}` }, { Name: 'IMAGE_TAG', Value: 'not-set' }] },
        Source: { Type: 'S3', Location: sub('${Bucket}/bootstrap/build/source.zip'), BuildSpec: `version: 0.2
phases:
  pre_build:
    commands:
      - echo "$IMAGE_TAG" | grep -Eq '^[a-f0-9]{40}$'
      - export IMAGE_EXISTS=$(aws ecr describe-images --repository-name ${prefix} --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)
      - aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
  build:
    commands:
      - if [ -z "$IMAGE_EXISTS" ]; then docker build -f Dockerfile.aws -t "$REPOSITORY:$IMAGE_TAG" .; fi
  post_build:
    commands:
      - test "$CODEBUILD_BUILD_SUCCEEDING" = 1
      - if [ -z "$IMAGE_EXISTS" ]; then docker push "$REPOSITORY:$IMAGE_TAG"; fi
` },
        LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('Logs') } },
        Tags: [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: environment }],
      } },
    }, Outputs: { ProjectName: { Value: ref('Project') } },
  };
}
