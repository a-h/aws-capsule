#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { AwsCapsuleStack } from "../lib/aws-capsule-stack";

const app = new cdk.App();
new AwsCapsuleStack(app, "AwsCapsuleStack", { env: {  region: "eu-west-1" } });
