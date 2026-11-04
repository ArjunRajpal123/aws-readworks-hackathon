"""Path + env setup for the regression snapshot tests (offline, no AWS calls).

Same layout as lambda/tests/conftest.py: the flat etl/ modules, the shared ETL
fakes (etl/tests/fakes.py) and the Lambda handlers are importable top-level.
"""
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]  # .kiro/skills/regression-test/scripts -> repo
for p in (REPO / "lambda", REPO / "etl", REPO / "etl" / "tests", Path(__file__).parent):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

os.environ.setdefault("AWS_DEFAULT_REGION", "us-west-2")
os.environ.setdefault("AWS_REGION", "us-west-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")  # never sent; fakes only
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")


def pytest_addoption(parser):
    parser.addoption(
        "--update-golden", action="store_true", default=False,
        help="Rewrite golden snapshots from the current code instead of comparing.",
    )
