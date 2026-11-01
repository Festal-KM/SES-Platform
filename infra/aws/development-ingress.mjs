/** AWS開発画面をHTTPSで直接開く。VMのアプリポートはALBからだけ受け付ける。 */
export function developmentIngressTemplate() {
  const ref = (name) => ({ Ref: name });
  const att = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const tags = [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: 'development' }];
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Parameters: { VpcId: { Type: 'AWS::EC2::VPC::Id' }, PublicSubnets: { Type: 'List<AWS::EC2::Subnet::Id>' }, CertificateArn: { Type: 'String' }, InstanceId: { Type: 'AWS::EC2::Instance::Id' }, WorkspaceSecurityGroup: { Type: 'AWS::EC2::SecurityGroup::Id' } },
    Resources: {
      Network: { Type: 'AWS::EC2::SecurityGroup', Properties: { VpcId: ref('VpcId'), GroupDescription: 'Development HTTPS entry', Tags: tags,
        SecurityGroupIngress: [80, 443].map((port) => ({ IpProtocol: 'tcp', FromPort: port, ToPort: port, CidrIp: '0.0.0.0/0' })) } },
      ApplicationIngress: { Type: 'AWS::EC2::SecurityGroupIngress', Properties: { GroupId: ref('WorkspaceSecurityGroup'), IpProtocol: 'tcp', FromPort: 3000, ToPort: 3000, SourceSecurityGroupId: ref('Network') } },
      LoadBalancer: { Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer', Properties: { Name: 'ses-platform-development', Scheme: 'internet-facing', Type: 'application', Subnets: ref('PublicSubnets'), SecurityGroups: [ref('Network')], Tags: tags,
        LoadBalancerAttributes: [{ Key: 'deletion_protection.enabled', Value: 'true' }, { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' }] } },
      Target: { Type: 'AWS::ElasticLoadBalancingV2::TargetGroup', Properties: { VpcId: ref('VpcId'), Protocol: 'HTTP', Port: 3000, TargetType: 'instance', Targets: [{ Id: ref('InstanceId'), Port: 3000 }], HealthCheckPath: '/signin', Matcher: { HttpCode: '200' }, HealthyThresholdCount: 2, HealthCheckIntervalSeconds: 15, Tags: tags } },
      Redirect: { Type: 'AWS::ElasticLoadBalancingV2::Listener', Properties: { LoadBalancerArn: ref('LoadBalancer'), Port: 80, Protocol: 'HTTP', DefaultActions: [{ Type: 'redirect', RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' } }] } },
      Https: { Type: 'AWS::ElasticLoadBalancingV2::Listener', Properties: { LoadBalancerArn: ref('LoadBalancer'), Port: 443, Protocol: 'HTTPS', Certificates: [{ CertificateArn: ref('CertificateArn') }], SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06', DefaultActions: [{ Type: 'forward', TargetGroupArn: ref('Target') }] } },
    },
    Outputs: { Hostname: { Value: att('LoadBalancer', 'DNSName') }, TargetGroupArn: { Value: ref('Target') } },
  };
}
