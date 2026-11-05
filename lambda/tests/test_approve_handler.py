"""POST /api/v1/passages/approve: flips review.reviewStatus to reviewed,
updating both the S3 product JSON and the DynamoDB item. No AWS calls."""
import json

import pytest

from common import reference_store
from passage_approve import handler as mod


@pytest.fixture
def store(monkeypatch):
    # In-memory S3 product + DynamoDB stand-ins.
    products = {}
    ddb = {}

    monkeypatch.setattr(mod, "get_product", lambda rid: products.get(rid))
    monkeypatch.setattr(mod, "put_product", lambda rid, prod: products.__setitem__(rid, prod))

    def set_status(rid, status):
        if rid not in ddb:
            return None
        ddb[rid].setdefault("review", {})["reviewStatus"] = status
        return ddb[rid]

    monkeypatch.setattr(reference_store, "set_review_status", set_status)
    return products, ddb


def _approve(body):
    resp = mod.handler({"body": json.dumps(body)}, None)
    return resp["statusCode"], json.loads(resp["body"])


def test_approve_flips_status(store):
    products, ddb = store
    rec = {"id": "foo-es", "review": {"provenance": "machine", "reviewStatus": "draft"}}
    products["foo-es"] = dict(rec)
    ddb["foo-es"] = dict(rec)
    status, body = _approve({"id": "foo-es"})
    assert status == 200 and body["reviewStatus"] == "reviewed"
    assert products["foo-es"]["review"]["reviewStatus"] == "reviewed"
    assert ddb["foo-es"]["review"]["reviewStatus"] == "reviewed"


def test_approve_idempotent(store):
    products, ddb = store
    rec = {"id": "foo-es", "review": {"reviewStatus": "reviewed"}}
    products["foo-es"] = dict(rec); ddb["foo-es"] = dict(rec)
    status, body = _approve({"id": "foo-es"})
    assert status == 200 and body["reviewStatus"] == "reviewed"


def test_approve_missing_id_is_400(store):
    assert _approve({})[0] == 400


def test_approve_unknown_passage_is_404(store):
    assert _approve({"id": "nope"})[0] == 404


def test_approve_passage_without_review_block_is_409(store):
    products, _ = store
    products["plain"] = {"id": "plain"}  # no review block
    status, resp = _approve({"id": "plain"})
    assert status == 409
