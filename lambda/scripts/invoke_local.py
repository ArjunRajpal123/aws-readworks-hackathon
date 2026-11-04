#!/usr/bin/env python3
"""Invoke the text-to-speech Lambda handlers locally, against real AWS.

Builds an API Gateway proxy-style event and calls the handler function
directly (no SAM/Docker). Requires working AWS credentials and
TTS_MEDIA_BUCKET / TTS_REFERENCE_TABLE in the environment -- see ../.env.example.

The POST handler runs the Sound Along pipeline from ../etl; in Lambda those
modules sit at the bundle root (see infra/cdk/lib/api-stack.ts), locally we
put ../etl on sys.path instead.
"""

import argparse
import json
import sys
from pathlib import Path

LAMBDA_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAMBDA_DIR))
sys.path.insert(1, str(LAMBDA_DIR.parent / "etl"))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    post = sub.add_parser("post")
    post.add_argument("--text", required=True)
    post.add_argument("--id")
    post.add_argument("--title")
    post.add_argument("--voice-id", help="extra configured voice, e.g. Stephen")
    post.add_argument("--language-code", help="en-US (default) or es-US")
    post.add_argument("--all-voices", action="store_true")

    get = sub.add_parser("get")
    get.add_argument("--id", required=True)

    args = parser.parse_args()

    if args.command == "post":
        from text_to_speech_post.handler import handler

        body = {"text": args.text}
        for key, value in (("id", args.id), ("title", args.title),
                           ("voiceId", args.voice_id), ("languageCode", args.language_code)):
            if value:
                body[key] = value
        if args.all_voices:
            body["allVoices"] = True
        event = {"httpMethod": "POST", "body": json.dumps(body)}
    else:
        from text_to_speech_get.handler import handler

        event = {"httpMethod": "GET", "queryStringParameters": {"id": args.id}}

    response = handler(event, None)
    response["body"] = json.loads(response["body"])
    print(json.dumps(response, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
