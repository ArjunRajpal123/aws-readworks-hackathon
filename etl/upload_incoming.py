"""Check ETL inputs and upload them to the cloud ETL (s3://<media bucket>/incoming/).

Inputs are JSON files, or `-` to read one JSON object per line from stdin
(nothing is written locally). For each input:
  - tokenizes it with the pipeline's tokenizer and, if the file has
    `_playerTokens` (from export_player_inputs.mjs), requires the same count,
    so word timing lines up with the words the player shows;
  - skips ids whose current product record already has the same textHash and
    every configured voice (re-running would only re-bill Polly), unless --force.

Dry run by default. Prints the Polly character estimate before anything is sent.

    node etl/export_player_inputs.mjs | python etl/upload_incoming.py -          # plan only
    node etl/export_player_inputs.mjs | python etl/upload_incoming.py - --yes    # upload
    python etl/upload_incoming.py etl/inputs/rws-e2-en.json --yes --force
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tokenizer import tokenize  # noqa: E402
from voices import tracks_for  # noqa: E402

CALLS_PER_TRACK = 2  # MP3 + speech marks
NEURAL_USD_PER_MCHAR = 16.0


def bucket_from_stack(cfn, stack: str) -> str:
    outs = cfn.describe_stacks(StackName=stack)["Stacks"][0].get("Outputs", [])
    for o in outs:
        if o["OutputKey"] == "MediaBucketName":
            return o["OutputValue"]
    sys.exit(f"{stack} has no MediaBucketName output")


def current_record(s3, bucket: str, pid: str) -> dict | None:
    try:
        body = s3.get_object(Bucket=bucket, Key=f"sa/product/{pid}.soundAlong.json")["Body"].read()
        return json.loads(body)
    except s3.exceptions.NoSuchKey:
        return None


def read_inputs(files):
    """Yield input dicts from JSON files, or JSON lines on stdin for `-`."""
    for f in files:
        if f == "-":
            for line in sys.stdin:
                if line.strip():
                    yield json.loads(line)
            continue
        for path in sorted(glob.glob(f)) or [f]:
            with open(path, encoding="utf-8") as fh:
                yield json.load(fh)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--stack", default="rg-readworks-bb-storage")
    ap.add_argument("--bucket", help="media bucket (default: from --stack outputs)")
    ap.add_argument("--region", default=os.environ.get("AWS_REGION", "us-west-2"))
    ap.add_argument("--profile")
    ap.add_argument("--yes", action="store_true", help="actually upload")
    ap.add_argument("--force", action="store_true", help="upload even if already generated")
    args = ap.parse_args(argv)

    import boto3
    sess = boto3.Session(profile_name=args.profile, region_name=args.region)
    s3 = sess.client("s3")
    bucket = args.bucket or bucket_from_stack(sess.client("cloudformation"), args.stack)

    send, skipped, billed = [], [], 0
    for data in read_inputs(args.files):
        pid, lang = data["id"], (data.get("lang") or "en")[:2]
        tk = tokenize(data["text"], lang)
        want = data.get("_playerTokens")
        if want is not None and tk.token_count != want:
            skipped.append((pid, f"token mismatch: pipeline {tk.token_count}, player {want}"))
            continue
        voices = {v.voice_id for v in tracks_for(lang)}
        rec = None if args.force else current_record(s3, bucket, pid)
        if rec and rec.get("textHash") == tk.text_hash and voices <= {t["voiceId"] for t in rec.get("tracks", [])}:
            skipped.append((pid, "already generated with current text and voices"))
            continue
        chars = len(data["text"]) * len(voices) * CALLS_PER_TRACK
        billed += chars
        body = {k: v for k, v in data.items() if not k.startswith("_")}
        send.append((json.dumps(body, ensure_ascii=False).encode("utf-8"), pid, chars))

    for pid, why in skipped:
        print(f"skip  {pid:<14} {why}")
    for _, pid, chars in send:
        print(f"send  {pid:<14} ~{chars:,} billed chars")
    usd = billed * NEURAL_USD_PER_MCHAR / 1e6
    print(f"\n{len(send)} to send, {len(skipped)} skipped. ~{billed:,} Polly chars, ~${usd:.2f} "
          f"-> s3://{bucket}/incoming/")
    if not args.yes:
        print("dry run: add --yes to upload")
        return 0
    for body, pid, _ in send:
        s3.put_object(Bucket=bucket, Key=f"incoming/{pid}.json", Body=body, ContentType="application/json")
    print(f"uploaded {len(send)}. Watch: aws s3 ls s3://{bucket}/processed/ ; failures land in failed/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
