"""Live ETL runner — writes to the deployed S3 media bucket + DynamoDB table.

Resolves the bucket/table names from the CloudFormation stack outputs
(rg-readworks-bb-storage) so it always targets the real deployed resources,
then runs the same pipeline as run_local.py but with the AwsStorage backend.

Usage:
    python run_aws.py inputs/e1p1.json
    python run_aws.py inputs/e1.json --stack rg-readworks-bb-storage
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import boto3

from pipeline import PassageInput, run
from storage import AwsStorage

DEFAULT_STACK = "rg-readworks-bb-storage"
OUT_BUCKET = "MediaBucketName"
OUT_TABLE = "ReferenceTableName"


def resolve_outputs(cfn, stack_name: str) -> dict:
    resp = cfn.describe_stacks(StackName=stack_name)
    outs = resp["Stacks"][0].get("Outputs", [])
    return {o["OutputKey"]: o["OutputValue"] for o in outs}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Run the Sound Along ETL to live AWS.")
    ap.add_argument("input", help="passage input JSON: {id, lang, title, text}")
    ap.add_argument("--stack", default=DEFAULT_STACK)
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--prefix", default="sa/", help="S3 key prefix (default sa/)")
    args = ap.parse_args(argv)

    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    passage = PassageInput(
        id=data["id"],
        lang=data.get("lang", "en"),
        title=data.get("title", data["id"]),
        text=data["text"],
    )

    session = boto3.Session(region_name=args.region)
    cfn = session.client("cloudformation")
    outputs = resolve_outputs(cfn, args.stack)
    bucket = outputs[OUT_BUCKET]
    table = outputs[OUT_TABLE]
    print(f"Target bucket: {bucket}")
    print(f"Target table:  {table}")

    polly = session.client("polly")
    s3 = session.client("s3")
    dynamodb = session.resource("dynamodb")
    storage = AwsStorage(bucket, table, s3, dynamodb, prefix=args.prefix)

    result = run(passage, polly, storage)
    print(json.dumps(result, indent=2))
    print(f"\nWrote s3://{bucket}/{args.prefix}product/{passage.id}.soundAlong.json")
    print(f"Wrote DynamoDB item id={passage.id} in {table}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
