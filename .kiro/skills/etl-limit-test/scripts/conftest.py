"""Path + env setup for the ETL limit tests (offline, no AWS calls).

Mirrors lambda/tests/conftest.py: the flat etl/ modules, the shared ETL fakes
(etl/tests/fakes.py) and the Lambda handlers are all importable top-level.
Env vars are set before any Lambda module is imported.
"""
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]  # .kiro/skills/etl-limit-test/scripts -> repo
for p in (REPO / "lambda", REPO / "etl", REPO / "etl" / "tests", Path(__file__).parent):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

os.environ.setdefault("AWS_DEFAULT_REGION", "us-west-2")
os.environ.setdefault("AWS_REGION", "us-west-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")  # presigning is local; never sent
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("TTS_MEDIA_BUCKET", "test-bucket")
os.environ.setdefault("TTS_REFERENCE_TABLE", "test-table")
os.environ.setdefault("TTS_S3_KEY_PREFIX", "sa/")
