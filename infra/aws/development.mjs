/** 開発だけの停止可能な作業用VM。SSHは開けず、保存先を保持する。 */
export function developmentTemplate() {
  const ref = (name) => ({ Ref: name });
  const sub = (value) => ({ 'Fn::Sub': value });
  const attr = (name, value) => ({ 'Fn::GetAtt': [name, value] });
  const tags = [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: 'development' }];
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'SES Platform development workspace with persistent disk and automatic stop',
    Parameters: {
      VpcId: { Type: 'AWS::EC2::VPC::Id' }, SubnetId: { Type: 'AWS::EC2::Subnet::Id' },
      StopAfter: { Type: 'String', AllowedPattern: '[0-9]+' },
      StorageKeyArn: { Type: 'String', AllowedPattern: 'arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9-]+' },
      ImageId: { Type: 'AWS::EC2::Image::Id' },
    },
    Resources: {
      WorkspaceRole: {
        Type: 'AWS::IAM::Role', Properties: {
          RoleName: 'ses-platform-development-workspace', Tags: tags,
          AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
          Policies: [{ PolicyName: 'session-manager-only', PolicyDocument: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Action: ['ssm:UpdateInstanceInformation', 'ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel', 'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel'], Resource: '*' },
            { Effect: 'Allow', Action: 's3:GetObject', Resource: sub('arn:${AWS::Partition}:s3:::ses-platform-development-files-${AWS::AccountId}-${AWS::Region}/bootstrap/*') },
            { Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetBucketVersioning'], Resource: sub('arn:${AWS::Partition}:s3:::ses-platform-development-files-${AWS::AccountId}-${AWS::Region}') },
            { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject'], Resource: sub('arn:${AWS::Partition}:s3:::ses-platform-development-files-${AWS::AccountId}-${AWS::Region}/*') },
            { Effect: 'Allow', Action: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'], Resource: ref('StorageKeyArn'), Condition: { StringEquals: { 'kms:ViaService': sub('s3.${AWS::Region}.amazonaws.com') } } },
            { Effect: 'Deny', Action: 's3:*', NotResource: [sub('arn:${AWS::Partition}:s3:::ses-platform-development-files-${AWS::AccountId}-${AWS::Region}'), sub('arn:${AWS::Partition}:s3:::ses-platform-development-files-${AWS::AccountId}-${AWS::Region}/*')] },
            { Effect: 'Deny', Action: 'kms:*', NotResource: ref('StorageKeyArn') },
            { Effect: 'Deny', Action: ['secretsmanager:*', 'ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'sts:AssumeRole', 'iam:*', 'ses:*', 'sns:Publish'], Resource: '*' },
          ] } }],
        },
      },
      InstanceProfile: { Type: 'AWS::IAM::InstanceProfile', Properties: { Roles: [ref('WorkspaceRole')] } },
      WorkspaceNetwork: {
        Type: 'AWS::EC2::SecurityGroup', Properties: {
          GroupDescription: 'No inbound access; use Systems Manager', VpcId: ref('VpcId'), Tags: tags,
          SecurityGroupIngress: [],
          SecurityGroupEgress: [
            { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0', Description: 'SSM and package downloads via HTTPS' },
            { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '0.0.0.0/0', Description: 'Signed OS package repositories in development builds' },
          ],
        },
      },
      Workspace: {
        Type: 'AWS::EC2::Instance', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
        Properties: {
          ImageId: ref('ImageId'), InstanceType: 't3.large', CreditSpecification: { CPUCredits: 'standard' },
          IamInstanceProfile: ref('InstanceProfile'), DisableApiTermination: true,
          MetadataOptions: { HttpTokens: 'required', HttpEndpoint: 'enabled', HttpPutResponseHopLimit: 1 },
          NetworkInterfaces: [{ DeviceIndex: '0', AssociatePublicIpAddress: true, SubnetId: ref('SubnetId'), GroupSet: [ref('WorkspaceNetwork')] }],
          BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeType: 'gp3', VolumeSize: 80, Encrypted: true, DeleteOnTermination: false } }],
          Tags: [...tags, { Key: 'Name', Value: 'ses-platform-development' }, { Key: 'StopAfter', Value: ref('StopAfter') }],
          UserData: { 'Fn::Base64': '#!/bin/bash\nset -euo pipefail\ndnf install -y docker git tar gzip openssl\nsystemctl enable --now docker\nsystemctl enable --now amazon-ssm-agent\nusermod -aG docker ec2-user\ninstall -d -o ec2-user -g ec2-user /workspaces/ses-platform\ndocker info >/var/log/ses-workspace-ready.log\n' },
        },
      },
      StopLogs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/aws/lambda/ses-platform-development-autostop', RetentionInDays: 14 } },
      StopRole: {
        Type: 'AWS::IAM::Role', Properties: {
          Tags: tags,
          AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
          Policies: [{ PolicyName: 'stop-development-only', PolicyDocument: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Action: 'ec2:DescribeInstances', Resource: '*' },
            { Effect: 'Allow', Action: 'ec2:StopInstances', Resource: sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Workspace}'), Condition: { StringEquals: { 'ec2:ResourceTag/Project': 'ses-platform', 'ec2:ResourceTag/Environment': 'development' } } },
            { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: attr('StopLogs', 'Arn') },
          ] } }],
        },
      },
      AutoStop: {
        Type: 'AWS::Lambda::Function', Properties: {
          FunctionName: 'ses-platform-development-autostop', Runtime: 'python3.13', Handler: 'index.handler', Role: attr('StopRole', 'Arn'), Timeout: 30,
          Environment: { Variables: { INSTANCE_ID: ref('Workspace') } },
          Code: { ZipFile: `import os, time, boto3

def handler(event, context):
    ec2 = boto3.client('ec2')
    instance_id = os.environ['INSTANCE_ID']
    reservations = ec2.describe_instances(InstanceIds=[instance_id])['Reservations']
    instance = reservations[0]['Instances'][0]
    tags = {t['Key']: t['Value'] for t in instance.get('Tags', [])}
    if tags.get('Project') != 'ses-platform' or tags.get('Environment') != 'development':
        raise ValueError('Unexpected development instance tags')
    try:
        deadline = int(tags.get('StopAfter', '0'))
    except (ValueError, TypeError):
        deadline = 0
    if instance['State']['Name'] == 'running' and time.time() >= deadline:
        ec2.stop_instances(InstanceIds=[instance_id])
        return {'stopped': True}
    return {'stopped': False}
` },
        },
      },
      StopSchedule: { Type: 'AWS::Events::Rule', Properties: { Name: 'ses-platform-development-autostop', ScheduleExpression: 'rate(15 minutes)', State: 'ENABLED', Targets: [{ Id: 'StopDevelopment', Arn: attr('AutoStop', 'Arn') }] } },
      StopPermission: { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('AutoStop'), Principal: 'events.amazonaws.com', SourceArn: attr('StopSchedule', 'Arn') } },
    },
    Outputs: { InstanceId: { Value: ref('Workspace') }, WorkspaceRoleArn: { Value: attr('WorkspaceRole', 'Arn') } },
  };
}
