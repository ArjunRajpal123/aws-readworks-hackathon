"""Submissions API (lambda/submissions): queue to incoming/, report status. Offline, fake S3."""
import io
import json
from datetime import datetime, timedelta, timezone

import pytest
from botocore.exceptions import ClientError

from submissions import handler as sub


class FakeS3:
    def __init__(self):
        self.objects = {}  # key -> (bytes, LastModified)

    def _missing(self, op):
        return ClientError({"Error": {"Code": "404" if op == "HeadObject" else "NoSuchKey"}}, op)

    def put_object(self, Bucket, Key, Body, **kw):
        self.objects[Key] = (Body, datetime.now(timezone.utc))

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self._missing("HeadObject")
        return {"LastModified": self.objects[Key][1]}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self._missing("GetObject")
        return {"Body": io.BytesIO(self.objects[Key][0])}

    # what the etl-run Lambda does
    def etl_finish(self, pid, ok=True, error="bad"):
        body, _ = self.objects.pop(f"incoming/{pid}.json")
        later = datetime.now(timezone.utc) + timedelta(seconds=1)
        if ok:
            self.objects[f"processed/{pid}.json"] = (body, later)
            self.objects[f"sa/product/{pid}.soundAlong.json"] = (b"{}", later)
        else:
            self.objects[f"failed/{pid}.json"] = (body, later)
            self.objects[f"failed/{pid}.error.json"] = (json.dumps({"error": error}).encode(), later)


@pytest.fixture
def s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(sub, "s3_client", lambda: fake)
    monkeypatch.setattr(sub, "BUCKET", "test-bucket")
    return fake


def post(body):
    r = sub.handler({"requestContext": {"http": {"method": "POST"}}, "body": json.dumps(body)}, None)
    return r["statusCode"], json.loads(r["body"])


def get(sid):
    r = sub.handler({"requestContext": {"http": {"method": "GET"}}, "pathParameters": {"submissionId": sid}}, None)
    return r["statusCode"], json.loads(r["body"])


def test_queues_items_to_incoming_with_no_length_limit(s3):
    long_text = "The fox ran across the wide green field. " * 400  # ~16,800 chars
    status, body = post({"items": [{"id": "a1", "text": "Hi there.", "title": "A"},
                                   {"id": "b2", "text": long_text, "lang": "es"}]})
    assert status == 202 and body["queued"] == 2
    queued = json.loads(s3.objects["incoming/b2.json"][0])
    assert queued == {"id": "b2", "lang": "es", "title": "b2", "text": long_text}
    assert f"submissions/{body['submissionId']}.json" in s3.objects


def test_generated_id_when_missing(s3):
    status, body = post({"items": [{"text": "Hello."}]})
    assert status == 202 and body["items"][0]["id"].startswith("sub-")


@pytest.mark.parametrize("item, msg", [
    ({"text": "  "}, "'text' is required"),
    ({"text": "x", "lang": "fr"}, "'lang'"),
    ({"text": "x", "id": "../etc"}, "'id' must match"),
    ({"text": "x", "title": "t" * 201}, "'title'"),
    ({"text": "x", "pronunciation": [1]}, "'pronunciation'"),
])
def test_invalid_items_are_rejected_individually(s3, item, msg):
    status, body = post({"items": [item, {"id": "ok", "text": "Fine."}]})
    assert status == 202 and body["queued"] == 1
    assert body["items"][0]["status"] == "rejected" and msg in body["items"][0]["error"]


@pytest.mark.parametrize("body", [None, {}, {"items": []}, {"items": "x"}, [1]])
def test_bad_body_is_400(s3, body):
    status, _ = post(body)
    assert status == 400


def test_too_many_items(s3):
    status, body = post({"items": [{"text": "x"}] * (sub.MAX_ITEMS + 1)})
    assert status == 400 and str(sub.MAX_ITEMS) in body["error"]


def test_existing_id_needs_overwrite(s3):
    s3.put_object(Bucket="b", Key="sa/product/k2.soundAlong.json", Body=b"{}")
    status, body = post({"items": [{"id": "k2", "text": "New."}]})
    assert status == 400 and body["items"][0]["code"] == 409
    assert "incoming/k2.json" not in s3.objects
    status, body = post({"items": [{"id": "k2", "text": "New."}], "overwrite": True})
    assert status == 202 and "incoming/k2.json" in s3.objects


def test_duplicate_ids_in_one_submission(s3):
    _, body = post({"items": [{"id": "d", "text": "a"}, {"id": "d", "text": "b"}]})
    assert [i["status"] for i in body["items"]] == ["queued", "rejected"]


def test_status_follows_the_etl(s3):
    _, body = post({"items": [{"id": "p1", "text": "One."}, {"id": "p2", "text": "Two."},
                              {"id": "p3", "text": " "}]})
    sid = body["submissionId"]
    status, st = get(sid)
    assert status == 200 and st["counts"] == {"queued": 2, "rejected": 1} and not st["complete"]
    s3.etl_finish("p1")
    s3.etl_finish("p2", ok=False, error="one sentence is over the part cap")
    _, st = get(sid)
    by = {i["id"]: i for i in st["items"] if i.get("id")}
    assert by["p1"]["status"] == "done" and by["p1"]["productKey"] == "sa/product/p1.soundAlong.json"
    assert by["p2"]["status"] == "failed" and "part cap" in by["p2"]["error"]
    assert st["complete"]


def test_get_unknown_and_invalid_ids(s3):
    assert get("f" * 32)[0] == 404
    assert get("../x")[0] == 400
