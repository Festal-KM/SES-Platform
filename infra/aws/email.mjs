/** 本番通知用のメール基盤。実際の送信や本番アクセス申請は行わない。 */
export function emailTemplate(domain = 'bizorch.com') {
  if (domain !== 'bizorch.com') throw new Error('承認された送信ドメインと異なります');
  const ref = (name) => ({ Ref: name });
  const att = (name, key) => ({ 'Fn::GetAtt': [name, key] });
  const sub = (value) => ({ 'Fn::Sub': value });
  const tags = [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: 'production' }];
  const resources = {
    Events: { Type: 'AWS::SNS::Topic', Properties: { TopicName: 'ses-platform-production-events', Tags: tags } },
    EventsPolicy: { Type: 'AWS::SNS::TopicPolicy', Properties: { Topics: [ref('Events')], PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ses.amazonaws.com' }, Action: 'sns:Publish', Resource: ref('Events'), Condition: { StringEquals: { 'AWS:SourceAccount': ref('AWS::AccountId') }, ArnLike: { 'AWS:SourceArn': sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:*') } } }] } } },
    ConfigurationSet: { Type: 'AWS::SES::ConfigurationSet', Properties: { Name: 'ses-platform-production', DeliveryOptions: { TlsPolicy: 'REQUIRE' }, SuppressionOptions: { SuppressedReasons: ['BOUNCE', 'COMPLAINT'] }, Tags: tags } },
    EventDestination: { Type: 'AWS::SES::ConfigurationSetEventDestination', DependsOn: 'EventsPolicy', Properties: { ConfigurationSetName: ref('ConfigurationSet'), EventDestination: { Name: 'delivery-status', Enabled: true, MatchingEventTypes: ['send', 'reject', 'bounce', 'complaint', 'delivery', 'renderingFailure', 'deliveryDelay'], SnsDestination: { TopicARN: ref('Events') } } } },
    Domain: { Type: 'AWS::SES::EmailIdentity', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { EmailIdentity: domain, DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' }, ConfigurationSetAttributes: { ConfigurationSetName: ref('ConfigurationSet') }, MailFromAttributes: { MailFromDomain: `mail.${domain}`, BehaviorOnMxFailure: 'REJECT_MESSAGE' }, Tags: tags } },
    SenderPolicy: { Type: 'AWS::IAM::Policy', Properties: { PolicyName: 'ses-platform-production-mail', Roles: ['ses-platform-production-task'], PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail'], Resource: [sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/' + domain), sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:configuration-set/ses-platform-production')] },
      { Effect: 'Allow', Action: 'ses:GetAccount', Resource: '*' },
      { Effect: 'Allow', Action: 'ses:GetEmailIdentity', Resource: sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/' + domain) },
    ] } } },
  };
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'BizOrch production email identity and delivery events', Resources: resources,
    Outputs: Object.fromEntries([['TopicArn', ref('Events')], ...[1, 2, 3].flatMap((index) => [[`DkimName${index}`, att('Domain', `DkimDNSTokenName${index}`)], [`DkimValue${index}`, att('Domain', `DkimDNSTokenValue${index}`)]])].map(([key, value]) => [key, { Value: value }])) };
}
