#!/usr/bin/env python3
"""Invoke the text-to-speech Lambda handlers locally, against real AWS.

Builds an API Gateway proxy-style event and calls the handler function
directly (no SAM/Docker). Requires working AWS credentials and
TTS_OUTPUT_BUCKET in the environment -- see ../.env.example.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    post = sub.add_parser("post")
    post.add_argument("--text", required=True)
    post.add_argument("--voice-id")
    post.add_argument("--language-code")
    post.add_argument("--engine")

    get = sub.add_parser("get")
    get.add_argument("--id", required=True)

    args = parser.parse_args()

    if args.command == "post":
        from text_to_speech_post.handler import handler

        body = {"text": args.text}
        if args.voice_id:
            body["voiceId"] = args.voice_id
        if args.language_code:
            body["languageCode"] = args.language_code
        if args.engine:
            body["engine"] = args.engine
        event = {"httpMethod": "POST", "body": json.dumps(body)}
    else:
        from text_to_speech_get.handler import handler

        event = {"httpMethod": "GET", "queryStringParameters": {"id": args.id}}

    response = handler(event, None)
    response["body"] = json.loads(response["body"])
    print(json.dumps(response, indent=2))


if __name__ == "__main__":
    main()
