"""Offline test setup for the Lambda handlers.

Mirrors the deployed bundle layout: lambda/ (handlers + common/) and the
etl/ pipeline modules both importable at top level. The ETL test fakes
(fake Polly with real-shaped speech marks) are reused from etl/tests.
"""
import os
import sys
from pathlib import Path

LAMBDA_DIR = Path(__file__).resolve().parent.parent
REPO = LAMBDA_DIR.parent
for p in (LAMBDA_DIR, REPO / "etl", REPO / "etl" / "tests"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

os.environ.setdefault("AWS_DEFAULT_REGION", "us-west-2")
os.environ.setdefault("AWS_REGION", "us-west-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")  # presigning is local; never sent
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("TTS_MEDIA_BUCKET", "test-bucket")
os.environ.setdefault("TTS_REFERENCE_TABLE", "test-table")
os.environ.setdefault("TTS_S3_KEY_PREFIX", "sa/")
