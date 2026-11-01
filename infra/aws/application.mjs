import { ENVIRONMENTS } from './foundation.mjs';

/** デモ・本番の実行基盤。最初はタスク0で作り、DB初期化と設定検査後に起動する。 */
export function applicationTemplate(environment) {
  if (!['demo', 'production'].includes(environment)) throw new Error('アプリ基盤はdemo / productionだけを指定してください');
  const production = environment === 'production';
  const prefix = `ses-platform-${environment}`;
  const ref = (name) => ({ Ref: name });
  const att = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const sub = (value) => ({ 'Fn::Sub': value });
  const tags = [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: environment }];
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: `${prefix} database, cache and private application access`,
    Parameters: {
      VpcId: { Type: 'AWS::EC2::VPC::Id' }, PublicSubnets: { Type: 'List<AWS::EC2::Subnet::Id>' }, PrivateSubnets: { Type: 'List<AWS::EC2::Subnet::Id>' },
      StorageKeyArn: { Type: 'String' }, DatabaseVersion: { Type: 'String' },
      CacheTokenSecretArn: { Type: 'String' },
    },
    Resources: {
      ApplicationNetwork: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: `${prefix} application`, VpcId: ref('VpcId'), Tags: tags, SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }] } },
      DatabaseNetwork: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: `${prefix} private PostgreSQL`, VpcId: ref('VpcId'), Tags: tags,
        SecurityGroupIngress: [{ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: ref('ApplicationNetwork') }] } },
      CacheNetwork: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: `${prefix} private Redis`, VpcId: ref('VpcId'), Tags: tags,
        SecurityGroupIngress: [{ IpProtocol: 'tcp', FromPort: 6379, ToPort: 6379, SourceSecurityGroupId: ref('ApplicationNetwork') }] } },
      DatabaseSubnets: { Type: 'AWS::RDS::DBSubnetGroup', Properties: { DBSubnetGroupDescription: prefix, SubnetIds: ref('PrivateSubnets'), Tags: tags } },
      DatabaseParameters: { Type: 'AWS::RDS::DBParameterGroup', Properties: { Family: 'postgres17', Description: `${prefix} require TLS`, Parameters: { 'rds.force_ssl': '1', log_statement: 'none', log_min_error_statement: 'panic' }, Tags: tags } },
      Database: { Type: 'AWS::RDS::DBInstance', DeletionPolicy: 'Snapshot', UpdateReplacePolicy: 'Snapshot', Properties: {
        DBInstanceIdentifier: `${prefix}-db`, Engine: 'postgres', EngineVersion: ref('DatabaseVersion'), DBInstanceClass: production ? 'db.t4g.small' : 'db.t4g.micro',
        DBName: 'ses_platform', MasterUsername: 'ses_admin', ManageMasterUserPassword: true,
        DBSubnetGroupName: ref('DatabaseSubnets'), VPCSecurityGroups: [ref('DatabaseNetwork')], DBParameterGroupName: ref('DatabaseParameters'),
        PubliclyAccessible: false, MultiAZ: production, StorageEncrypted: true, KmsKeyId: ref('StorageKeyArn'), StorageType: 'gp3', AllocatedStorage: '20', MaxAllocatedStorage: 100,
        BackupRetentionPeriod: production ? 14 : 7, DeletionProtection: true, AutoMinorVersionUpgrade: true, CopyTagsToSnapshot: true,
        EnableCloudwatchLogsExports: ['postgresql', 'upgrade'], Tags: tags,
      } },
      CacheSubnets: { Type: 'AWS::ElastiCache::SubnetGroup', Properties: { Description: prefix, SubnetIds: ref('PrivateSubnets') } },
      CacheParameters: { Type: 'AWS::ElastiCache::ParameterGroup', Properties: { CacheParameterGroupFamily: 'redis7', Description: `${prefix} BullMQ queue persistence`, Properties: { 'maxmemory-policy': 'noeviction' } } },
      Cache: { Type: 'AWS::ElastiCache::ReplicationGroup', DeletionPolicy: 'Snapshot', UpdateReplacePolicy: 'Snapshot', Properties: {
        ReplicationGroupId: `${prefix}-cache`, ReplicationGroupDescription: prefix, Engine: 'redis', EngineVersion: '7.1',
        CacheNodeType: production ? 'cache.t4g.small' : 'cache.t4g.micro', NumCacheClusters: production ? 2 : 1,
        AutomaticFailoverEnabled: production, MultiAZEnabled: production, AtRestEncryptionEnabled: true, KmsKeyId: ref('StorageKeyArn'), TransitEncryptionEnabled: true,
        AuthToken: sub('{{resolve:secretsmanager:${CacheTokenSecretArn}:SecretString:token}}'),
        CacheSubnetGroupName: ref('CacheSubnets'), CacheParameterGroupName: ref('CacheParameters'), SecurityGroupIds: [ref('CacheNetwork')],
        SnapshotRetentionLimit: production ? 7 : 3, Tags: tags,
      } },
      MigrationExecution: { Type: 'AWS::IAM::Role', Properties: {
        RoleName: `${prefix}-migration-execution`, Tags: tags,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') } } }] },
        Policies: [{ PolicyName: 'migration-only', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'], Resource: sub('arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/' + prefix) },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/ses-platform/' + environment + ':*') },
          { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [sub('arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:/' + prefix + '/*'), att('Database', 'MasterUserSecret.SecretArn')] },
        ] } }],
      } },
    },
    Outputs: {
      DatabaseHost: { Value: att('Database', 'Endpoint.Address') }, MasterSecretArn: { Value: att('Database', 'MasterUserSecret.SecretArn') },
      CacheHost: { Value: att('Cache', 'PrimaryEndPoint.Address') }, ApplicationSecurityGroup: { Value: ref('ApplicationNetwork') },
    },
  };
}

/** 公開用TLSのALB。証明書はCloudflareのDNS検証が済んだACMを指定する。 */
export function ingressTemplate(environment) {
  if (!Object.hasOwn(ENVIRONMENTS, environment)) throw new Error('未知の環境です');
  const prefix = `ses-platform-${environment}`;
  const ref = (name) => ({ Ref: name });
  const att = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const tags = [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: environment }];
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: `${prefix} HTTPS ingress`,
    Parameters: { VpcId: { Type: 'AWS::EC2::VPC::Id' }, PublicSubnets: { Type: 'List<AWS::EC2::Subnet::Id>' }, CertificateArn: { Type: 'String' }, ApplicationSecurityGroup: { Type: 'AWS::EC2::SecurityGroup::Id' } },
    Resources: {
      LoadBalancerNetwork: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: `${prefix} HTTPS`, VpcId: ref('VpcId'), Tags: tags,
        SecurityGroupIngress: [80, 443].map((port) => ({ IpProtocol: 'tcp', FromPort: port, ToPort: port, CidrIp: '0.0.0.0/0' })) } },
      ApplicationIngress: { Type: 'AWS::EC2::SecurityGroupIngress', Properties: { GroupId: ref('ApplicationSecurityGroup'), IpProtocol: 'tcp', FromPort: 3000, ToPort: 3000, SourceSecurityGroupId: ref('LoadBalancerNetwork') } },
      LoadBalancer: { Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer', Properties: { Name: prefix, Scheme: 'internet-facing', Type: 'application', Subnets: ref('PublicSubnets'), SecurityGroups: [ref('LoadBalancerNetwork')],
        LoadBalancerAttributes: [{ Key: 'deletion_protection.enabled', Value: 'true' }, { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' }, { Key: 'idle_timeout.timeout_seconds', Value: '120' }], Tags: tags } },
      TargetGroup: { Type: 'AWS::ElasticLoadBalancingV2::TargetGroup', Properties: { VpcId: ref('VpcId'), Protocol: 'HTTP', Port: 3000, TargetType: 'ip', HealthCheckPath: '/signin', Matcher: { HttpCode: '200' }, HealthCheckIntervalSeconds: 30, HealthCheckTimeoutSeconds: 10, HealthyThresholdCount: 2, Tags: tags } },
      HttpRedirect: { Type: 'AWS::ElasticLoadBalancingV2::Listener', Properties: { LoadBalancerArn: ref('LoadBalancer'), Port: 80, Protocol: 'HTTP', DefaultActions: [{ Type: 'redirect', RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' } }] } },
      Https: { Type: 'AWS::ElasticLoadBalancingV2::Listener', Properties: { LoadBalancerArn: ref('LoadBalancer'), Port: 443, Protocol: 'HTTPS', SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06', Certificates: [{ CertificateArn: ref('CertificateArn') }], DefaultActions: [{ Type: 'forward', TargetGroupArn: ref('TargetGroup') }] } },
    },
    Outputs: { Hostname: { Value: att('LoadBalancer', 'DNSName') }, TargetGroupArn: { Value: ref('TargetGroup') } },
  };
}
