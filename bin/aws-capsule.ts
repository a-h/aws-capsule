#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { AwsCapsuleStack } from "../lib/aws-capsule-stack";
import * as path from "path";
import * as fs from "fs";

const requiredFiles = [
	path.join(__dirname, "../keys/server.crt"),
	path.join(__dirname, "../keys/server.key"),
];
const missingFiles = requiredFiles.filter(f => !fs.existsSync(f));
if(missingFiles.length > 0) {
	missingFiles.forEach(f => console.log(`missing file: ${f}`))
	console.log("did you forget to generate server certificates?")
	process.exit(1)
}
const app = new cdk.App();
new AwsCapsuleStack(app, "AwsCapsuleStack", { env: { region: "eu-west-1" } });
