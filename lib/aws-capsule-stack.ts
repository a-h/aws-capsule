import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as route53 from "@aws-cdk/aws-route53";
import * as iam from "@aws-cdk/aws-iam";
import * as s3 from "@aws-cdk/aws-s3";
import * as s3Deployment from "@aws-cdk/aws-s3-deployment";
import * as fs from "fs";
import * as path from "path";

export class AwsCapsuleStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // This has been set to run in eu-west-1 by default, check bin/aws-capsule.ts
    // These are used to set up the DNS later, you'll need to review the DNS configuration.
    // I manually set up a Route 53 DNS zone. This script references the zone by its name and ID.
    const zoneName = "adrianhesketh.com";
    const hostedZoneId = "Z16GN2T46LUWB0";
    // This script adds a subdomain to the zone, and adds a DNS A record. This enables the Gemini
    // server to serve on the given domain and for the TLS certificates to make sense.
    const domainName = "capsule.adrianhesketh.com";

    // Create a bucket for content. The content isn't served from here, it's just
    // used as a temporary holding location.
    const bucket = new s3.Bucket(this, "content", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        { noncurrentVersionExpiration: cdk.Duration.days(7) },
      ],
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      versioned: true,
    });

    // Deploy the static resources from the local filesystem to the bucket.
    new s3Deployment.BucketDeployment(this, "contentDeployment", {
      sources: [s3Deployment.Source.asset(path.join(__dirname, "../content"))],
      destinationKeyPrefix: "content",
      destinationBucket: bucket,
    });
    new s3Deployment.BucketDeployment(this, "keysDeployment", {
      sources: [s3Deployment.Source.asset(path.join(__dirname, "../keys"))],
      destinationKeyPrefix: "keys",
      destinationBucket: bucket,
    });
    new cdk.CfnOutput(this, "S3_CONTENT_LOCATION", {
      value: `s3://${bucket.bucketName}/content`,
    });
    new cdk.CfnOutput(this, "S3_KEYS_LOCATION", {
      value: `s3://${bucket.bucketName}/keys`,
    });

    // Create a network inside AWS.
    const vpc = new ec2.Vpc(this, "VPC", {
      natGateways: 0,
    });

    // Create a security group that opens up port 1965.
    const allowInboundGeminiSG = new ec2.SecurityGroup(
      this,
      "allowInboundGemini",
      { vpc: vpc, description: "Allow inbound Gemini on port 1965" }
    );
    allowInboundGeminiSG.addIngressRule(
      ec2.Peer.anyIpv6(),
      ec2.Port.tcp(1965),
      "Gemini"
    );
    allowInboundGeminiSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(1965),
      "Gemini"
    );

    // Setup a script to install the server into an EC2 instance.
    const userData = fs
      .readFileSync(path.join(__dirname, "./user-data.sh"), "utf8")
      .replace(/\$BUCKET/g, bucket.bucketName)
      .replace(/\$DOMAIN/g, domainName);

    // Launch an EC2 instance in the public subnet that executes the script on startup.
    const instance = new ec2.Instance(this, "geminiInstance", {
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.NANO
      ), // ARM processor, 2 vCPU and 0.5GB of RAM.
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      userData: ec2.UserData.custom(userData),
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: {
              volumeType: ec2.EbsDeviceVolumeType.GENERAL_PURPOSE_SSD,
              deleteOnTermination: true,
              volumeSize: 8,
            },
          },
        },
      ],
      userDataCausesReplacement: true, // If the script changes, the instance will be destroyed and recreated.
    });
    instance.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    // Enable CloudWatch Agent (https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Agent-on-EC2-Instance.html).
    instance.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );
    // Allow the instance to read content from the bucket.
    bucket.grantRead(instance.role);
    // Allow the instance to be connected to via Gemini protocol.
    instance.addSecurityGroup(allowInboundGeminiSG);
    new cdk.CfnOutput(this, "INSTANCE_ID", {
      value: instance.instanceId,
    });
    new cdk.CfnOutput(this, "INSTANCE_IP", {
      value: instance.instance.attrPublicIp,
    });

    // Make sure we use the same IP address every time the server is destroyed and recreated.
    // This avoids having to update DNS each time and risk outages.
    const elasticIp = new ec2.CfnEIP(this, "elasticIp", {
      domain: "vpc",
      instanceId: instance.instanceId,
    });

    // Set up DNS (you might prefer to this manually, in which case just delete this section.)
    // I already have a hosted zone, so I'm looking it up instead of creating it.
    const zone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "hostedZone",
      { zoneName, hostedZoneId }
    );
    // Then add an A record on the subdomain to point at the IP address of my server.
    new route53.ARecord(this, "ARecord", {
      zone: zone,
      recordName: domainName,
      target: route53.RecordTarget.fromIpAddresses(elasticIp.ref),
    });
  }
}
