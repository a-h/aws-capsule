import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as route53 from "@aws-cdk/aws-route53";
import * as iam from "@aws-cdk/aws-iam";

export class AwsCapsuleStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // This has been set to run in eu-west-1 by default, check bin/aws-capsule.ts

    // Create a private network.
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

    // Install the SSM Agent.
    const SSM_AGENT_RPM =
      "https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_arm64/amazon-ssm-agent.rpm";
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      `sudo yum update -y`,
      `sudo yum install -y ${SSM_AGENT_RPM}`,
      "restart amazon-ssm-agent",
      "sudo amazon-linux-extras install docker",
      "sudo systemctl enable docker",
      "sudo service docker start",
      "sudo usermod -a -G docker ssm-user",
      // Use https://github.com/linuxserver/docker-docker-compose because Docker don't have an official build on aarch64.
      // Track at https://github.com/docker/compose/issues/6831
      `sudo curl -L --fail https://raw.githubusercontent.com/linuxserver/docker-docker-compose/master/run.sh -o /usr/local/bin/docker-compose`,
      `sudo chmod +x /usr/local/bin/docker-compose`,
    );

    // Launch an EC2 instance in the public subnet.
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
      userData: userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: {
              volumeType: ec2.EbsDeviceVolumeType.GENERAL_PURPOSE_SSD,
              deleteOnTermination: true,
              volumeSize: 50,
            },
          },
        },
      ],
    });
    instance.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    // Allow the instance to be connected to via Gemini protocol.
    instance.addSecurityGroup(allowInboundGeminiSG);
    new cdk.CfnOutput(this, "INSTANCE_ID", {
      value: instance.instanceId,
    });
    new cdk.CfnOutput(this, "INSTANCE_IP", {
      value: instance.instance.attrPublicIp,
    });

    const elasticIp = new ec2.CfnEIP(this, "elasticIp", {
      domain: "vpc",
      instanceId: instance.instanceId,
    });

    // Set up DNS (you might prefer to this manually).
    // I already have a hosted zone, so I'm looking it up instead of creating it.
    const zone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "hostedZone",
      { zoneName: "adrianhesketh.com", hostedZoneId: "Z16GN2T46LUWB0" }
    );
    // Then add an A record on the subdomain to point at the IP address of my server.
    new route53.ARecord(this, "ARecord", {
      zone: zone,
      recordName: "capsule.adrianhesketh.com",
      target: route53.RecordTarget.fromIpAddresses(elasticIp.ref),
    });
  }
}