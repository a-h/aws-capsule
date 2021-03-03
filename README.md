# Gemini capsule in AWS

A CDK project to create a Gemini capsule running in AWS.

# Usage

Generate some new private server keys and overwrite the ones in the `./keys` directory.

> Make sure you don't leak the server keys, e.g. by using a public git repository, or it wil be possible to impersonate your server.

```sh
export DOMAIN_NAME=gemini.example.com
openssl ecparam -genkey -name secp384r1 -out server.key
openssl req -new -x509 -sha256 -key ./keys/server.key -out ./keys/server.crt -days 3650 -subj "/C=/ST=/L=/O=/OU=/CN=$DOMAIN_NAME"
```

Add your content to the `./content` directory.

Deploy the infrastructure:

```
npm install
npx cdk bootstrap
npx cdk deploy
```

Your infrastructure will be deployed, and you will see the resulting IP address of the server, and its instance ID. You'll also see an S3 bucket. You can copy content to and from the S3 bucket.

The instance has permission to download from the S3 bucket, so you can push your content up to the S3 bucket, and retrieve it from the instance.

From your local machine, you can copy files up:

```
# Be careful, this can delete files too - keep a backup.
aws s3 sync ./local_computer/path s3://BUCKET_NAME/content
```

Then dowload it on the box:

```
aws ssm start-session --target ${INSTANCE_ID} --region=eu-west-1
aws s3 sync /srv/gemini/content s3://BUCKET_NAME/content
```

> The infrastructure will cost you money. You're responsible for your AWS account spend and you should follow AWS best practice on establishing spending limits etc.

# CDK

This project uses CDK. If you're not familiar with CDK, you might want to read through the AWS documentation to get started and understand how it works.

# Troubleshooting

You can connect to a terminal session on the box using AWS SSM. This doesn't open up port 22 on the server, but uses an agent installed on the box in the configuration.

```
aws ssm start-session --target ${INSTANCE_ID} --region=eu-west-1
```
