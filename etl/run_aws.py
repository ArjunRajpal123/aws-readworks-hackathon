"""Live ETL runner — writes to the deployed S3 media bucket + DynamoDB table.

Resolves the bucket/table names from the CloudFormation stack outputs
(rg-readworks-bb-storage) so it always targets the real deployed resources,
then runs the same pipeline as run_local.py but with the AwsStorage backend.

Like run_local.py it uploads the pronunciation lexicons first (tracks send
LexiconNames, so Polly fails with LexiconNotFoundException without them),
honours --track and each input's `pronunciation` overrides, and keeps going
if one passage fails.

IAM needed by the caller: polly:SynthesizeSpeech, polly:PutLexicon,
cloudformation:DescribeStacks, s3:PutObject on the media bucket,
dynamodb:PutItem on the reference table, and kms:GenerateDataKey on the
storage key.

Usage:
    python run_aws.py inputs/e1-p1.json
    python run_aws.py "inputs/rws-*.json" --profile hackathon --track tts-1
    python run_aws.py inputs/e1.json --stack rg-readworks-bb-storage
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import boto3

from audio import ensure_lexicons
from pipeline import PassageInput, run
from run_local import _expand
from storage import AwsStorage
from voices import load_voices

DEFAULT_STACK = "rg-readworks-bb-storage"
OUT_BUCKET = "MediaBucketName"
OUT_TABLE = "ReferenceTableName"


def resolve_outputs(cfn, stack_name: str) -> dict:
    resp = cfn.describe_stacks(StackName=stack_name)
    outs = resp["Stacks"][0].get("Outputs", [])
    return {o["OutputKey"]: o["OutputValue"] for o in outs}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Run the Sound Along ETL to live AWS.")
    ap.add_argument("input", nargs="+", help="passage input JSON(s): {id, lang, title, text}")
    ap.add_argument("--stack", default=DEFAULT_STACK)
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--profile", default=None,
                    help="AWS CLI profile (default: the standard credential chain)")
    ap.add_argument("--prefix", default="sa/", help="S3 key prefix (default sa/)")
    ap.add_argument("--no-lexicon", action="store_true",
                    help="skip uploading the pronunciation lexicons to Polly")
    ap.add_argument("--track", action="append", dest="tracks", metavar="ID",
                    help="only generate these extra tracks (repeatable); the default "
                         "track is always generated. Default: all tracks in voices.json")
    args = ap.parse_args(argv)

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    outputs = resolve_outputs(session.client("cloudformation"), args.stack)
    bucket = outputs[OUT_BUCKET]
    table = outputs[OUT_TABLE]
    print(f"Target bucket: {bucket}")
    print(f"Target table:  {table}")

    polly = session.client("polly")
    storage = AwsStorage(bucket, table, session.client("s3"), session.resource("dynamodb"),
                         prefix=args.prefix)

    if not args.no_lexicon:
        names = ensure_lexicons(polly, load_voices())
        print(f"Lexicons uploaded: {', '.join(names) or 'none'}")

    failed = []
    for path in _expand(args.input):
        passage = PassageInput.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
        try:
            result = run(passage, polly, storage, track_ids=args.tracks)
        except Exception as exc:  # noqa: BLE001 - keep going; report at the end
            failed.append((passage.id, f"{exc.__class__.__name__}: {exc}"))
            print(f"FAILED {passage.id}: {exc}", file=sys.stderr)
            continue
        print(json.dumps(result, indent=2))
        print(f"Wrote s3://{bucket}/{args.prefix}product/{passage.id}.soundAlong.json")
        print(f"Wrote DynamoDB item id={passage.id} in {table}\n")

    for pid, err in failed:
        print(f"FAILED {pid}: {err}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
