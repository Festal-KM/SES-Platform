/**
 * 環境ごとの基盤。アプリ・DB の起動とは分け、停止しても保存先を残す。
 * 既存の別プロジェクトには依存せず、VPC・鍵・ロールを共有しない。
 */
export const ACCOUNT_ID = '117425831827';
export const REGION = 'ap-northeast-1';
export const ENVIRONMENTS = Object.freeze({
  development: { cidr: '10.80.0.0/16', subnetPrefix: '10.80', alwaysOn: false },
  demo: { cidr: '10.81.0.0/16', subnetPrefix: '10.81', alwaysOn: true },
  production: { cidr: '10.82.0.0/16', subnetPrefix: '10.82', alwaysOn: true },
});

export function foundationTemplate(environment) {
  const config = ENVIRONMENTS[environment];
  if (!Object.hasOwn(ENVIRONMENTS, environment)) throw new Error('未知の環境です');
  const prefix = `ses-platform-${environment}`;
  const tags = [
    { Key: 'Project', Value: 'ses-platform' },
    { Key: 'Environment', Value: environment },
    { Key: 'ManagedBy', Value: 'cloudformation' },
  ];
  const ref = (name) => ({ Ref: name });
  const attr = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const sub = (value) => ({ 'Fn::Sub': value });
  const resources = {
    Vpc: {
      Type: 'AWS::EC2::VPC',
      Properties: { CidrBlock: config.cidr, EnableDnsSupport: true, EnableDnsHostnames: true, Tags: [...tags, { Key: 'Name', Value: prefix }] },
    },
    InternetGateway: { Type: 'AWS::EC2::InternetGateway', Properties: { Tags: tags } },
    GatewayAttachment: { Type: 'AWS::EC2::VPCGatewayAttachment', Properties: { VpcId: ref('Vpc'), InternetGatewayId: ref('InternetGateway') } },
    PublicRoutes: { Type: 'AWS::EC2::RouteTable', Properties: { VpcId: ref('Vpc'), Tags: tags } },
    PrivateRoutes: { Type: 'AWS::EC2::RouteTable', Properties: { VpcId: ref('Vpc'), Tags: tags } },
    InternetRoute: {
      Type: 'AWS::EC2::Route', DependsOn: 'GatewayAttachment',
      Properties: { RouteTableId: ref('PublicRoutes'), DestinationCidrBlock: '0.0.0.0/0', GatewayId: ref('InternetGateway') },
    },
    StorageKey: {
      Type: 'AWS::KMS::Key', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: {
        Description: `${prefix} storage`, EnableKeyRotation: true, Tags: tags,
        KeyPolicy: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root') }, Action: 'kms:*', Resource: '*' }] },
      },
    },
    StorageKeyAlias: { Type: 'AWS::KMS::Alias', Properties: { AliasName: `alias/${prefix}-storage`, TargetKeyId: ref('StorageKey') } },
    Files: {
      Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: {
        BucketName: sub(`${prefix}-files-` + '${AWS::AccountId}-${AWS::Region}'),
        VersioningConfiguration: { Status: 'Enabled' },
        ...(environment === 'development' ? { CorsConfiguration: { CorsRules: [{ AllowedOrigins: ['https://dev-es.bizorch.com'], AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['*'], ExposedHeaders: ['ETag', 'x-amz-version-id'], MaxAge: 3600 }] } } : {}),
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ BucketKeyEnabled: true, ServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: attr('StorageKey', 'Arn') } }] },
        Tags: tags,
      },
    },
    FilesPolicy: {
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: ref('Files'),
        PolicyDocument: { Version: '2012-10-17', Statement: [
          { Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [attr('Files', 'Arn'), sub('${Files.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
        ] },
      },
    },
    Images: {
      Type: 'AWS::ECR::Repository', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { RepositoryName: prefix, ImageTagMutability: 'IMMUTABLE', ImageScanningConfiguration: { ScanOnPush: true }, EncryptionConfiguration: { EncryptionType: 'AES256' }, Tags: tags },
    },
    Logs: {
      Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { LogGroupName: `/ses-platform/${environment}`, RetentionInDays: environment === 'production' ? 90 : 14, Tags: tags },
    },
    Cluster: { Type: 'AWS::ECS::Cluster', Properties: { ClusterName: prefix, ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }], Tags: tags } },
    TaskRole: {
      Type: 'AWS::IAM::Role', Properties: {
        RoleName: `${prefix}-task`, Tags: tags,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') }, ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*') } } }] },
        Policies: [{ PolicyName: 'environment-files-only', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetBucketVersioning'], Resource: attr('Files', 'Arn') },
          { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion'], Resource: sub('${Files.Arn}/*') },
          // 配備の証跡とビルド元をアプリから書き換えさせない。業務ファイルとは分ける。
          { Effect: 'Deny', Action: 's3:*', Resource: [sub('${Files.Arn}/releases/*'), sub('${Files.Arn}/bootstrap/*')] },
          { Effect: 'Allow', Action: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'], Resource: attr('StorageKey', 'Arn'), Condition: { StringEquals: { 'kms:ViaService': sub('s3.${AWS::Region}.amazonaws.com') } } },
          // 他のロール・追加ポリシーを誤って付けても環境を越えない。
          { Effect: 'Deny', Action: 's3:*', NotResource: [attr('Files', 'Arn'), sub('${Files.Arn}/*')] },
          { Effect: 'Deny', Action: 'kms:*', NotResource: attr('StorageKey', 'Arn') },
          { Effect: 'Deny', Action: ['sts:AssumeRole', 'iam:*', 'secretsmanager:*', 'ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'], Resource: '*' },
          ...(environment === 'production' ? [] : [{ Effect: 'Deny', Action: ['ses:*', 'sns:Publish'], Resource: '*' }]),
        ] } }],
      },
    },
    ExecutionRole: {
      Type: 'AWS::IAM::Role', Properties: {
        RoleName: `${prefix}-execution`, Tags: tags,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') }, ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*') } } }] },
        Policies: [{ PolicyName: 'environment-runtime-only', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'], Resource: attr('Images', 'Arn') },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: sub('${Logs.Arn}') },
          { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: sub('arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:/' + prefix + '/*') },
          { Effect: 'Deny', Action: 'secretsmanager:*', NotResource: sub('arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:/' + prefix + '/*') },
        ] } }],
      },
    },
  };
  for (const [index, zone] of ['A', 'C'].entries()) {
    for (const [kind, offset] of [['Public', 0], ['Private', 10]]) {
      const name = `${kind}Subnet${zone}`;
      resources[name] = { Type: 'AWS::EC2::Subnet', Properties: {
        VpcId: ref('Vpc'), CidrBlock: `${config.subnetPrefix}.${offset + index}.0/24`,
        AvailabilityZone: { 'Fn::Select': [index, { 'Fn::GetAZs': '' }] }, MapPublicIpOnLaunch: false,
        Tags: [...tags, { Key: 'Name', Value: `${prefix}-${kind.toLowerCase()}-${zone.toLowerCase()}` }],
      } };
      resources[`${name}Routes`] = { Type: 'AWS::EC2::SubnetRouteTableAssociation', Properties: { SubnetId: ref(name), RouteTableId: ref(kind === 'Public' ? 'PublicRoutes' : 'PrivateRoutes') } };
    }
  }
  resources.S3Endpoint = { Type: 'AWS::EC2::VPCEndpoint', Properties: {
    VpcId: ref('Vpc'), VpcEndpointType: 'Gateway', ServiceName: sub('com.amazonaws.${AWS::Region}.s3'),
    RouteTableIds: [ref('PrivateRoutes')],
    PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Principal: '*', Action: 's3:*', Resource: [attr('Files', 'Arn'), sub('${Files.Arn}/*')] },
      // ECR のイメージ本体はAWS所有のS3から取得される。自環境の業務データとは別に読み取りだけを許可する。
      { Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: sub('arn:${AWS::Partition}:s3:::prod-${AWS::Region}-starport-layer-bucket/*') },
    ] },
  } };
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: `${prefix} isolated foundation (no running application or database)`,
    Resources: resources,
    Outputs: Object.fromEntries([
      ['VpcId', ref('Vpc')], ['PublicSubnetA', ref('PublicSubnetA')], ['PublicSubnetC', ref('PublicSubnetC')],
      ['PrivateSubnetA', ref('PrivateSubnetA')], ['PrivateSubnetC', ref('PrivateSubnetC')],
      ['FilesBucket', ref('Files')], ['StorageKeyArn', attr('StorageKey', 'Arn')], ['RepositoryUri', attr('Images', 'RepositoryUri')],
      ['TaskRoleArn', attr('TaskRole', 'Arn')], ['ExecutionRoleArn', attr('ExecutionRole', 'Arn')], ['ClusterName', ref('Cluster')],
    ].map(([key, value]) => [key, { Value: value }])),
  };
}
