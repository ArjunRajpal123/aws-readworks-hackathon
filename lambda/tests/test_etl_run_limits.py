"""Cloud ETL input check: long passages (synthesized in parts) are accepted."""
import json

import pytest

from etl_run import handler as etl_mod


def _raw(text, **extra):
    return json.dumps({"id": "p1", "lang": "en", "text": text, **extra}).encode("utf-8")


def test_full_length_passage_is_accepted():
    # The longest UI passage (rwf-e8-en) is about 7,900 chars: over Polly's sync cap.
    passage = etl_mod._parse(_raw("The fox ran home. " * 450))
    assert passage.id == "p1" and len(passage.text) > 3000


def test_text_over_the_cloud_limit_is_rejected():
    with pytest.raises(etl_mod.BadInput, match="cloud ETL accepts up to 20000"):
        etl_mod._parse(_raw("x" * (etl_mod.MAX_TEXT_CHARS + 1)))


def test_unsupported_language_is_still_rejected():
    with pytest.raises(etl_mod.BadInput, match="unsupported lang"):
        etl_mod._parse(_raw("Bonjour.", lang="fr"))
