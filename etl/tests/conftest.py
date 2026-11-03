"""Make the flat ETL modules importable from the test suite.

The modules under /workshop/etl use flat imports (e.g. `from tokenizer import
Token`), so we put the parent `etl` directory on sys.path. This lets the tests
run regardless of pytest's rootdir / invocation directory.
"""

import os
import sys

ETL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ETL_DIR not in sys.path:
    sys.path.insert(0, ETL_DIR)
