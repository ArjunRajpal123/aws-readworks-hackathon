"""AwsStorage must accept a real product record, and run_aws.py must behave
like run_local.py (lexicons, --track, pronunciation). No AWS calls."""
import json
from decimal import Decimal

from boto3.dynamodb.types import TypeSerializer

import audio
import run_aws
from pipeline import PassageInput, run
from storage import AwsStorage, _to_dynamo

from fakes import FakePolly, FakeStorage


def _product():
    storage = FakeStorage()
    run(PassageInput(id="t", lang="en", title="T", text="Ana smiled. Mr. Lee waved."),
        FakePolly(), storage)
    return storage.records["t"]


def test_product_record_serializes_for_dynamodb():
    product = _product()
    assert isinstance(product["generation"]["estCostUsd"], float)  # the bug's trigger
    item = _to_dynamo(product)
    TypeSerializer().serialize(item)  # raises on any float, like put_item does
    assert item["generation"]["estCostUsd"] == Decimal(str(product["generation"]["estCostUsd"]))
    assert item["tracks"][0]["default"] is True  # bools untouched


class _FakeTable:
    def __init__(self):
        self.items = []

    def put_item(self, Item):
        TypeSerializer().serialize(Item)  # what boto3 does before sending
        self.items.append(Item)


class _FakeDynamo:
    def __init__(self):
        self.table = _FakeTable()

    def Table(self, name):
        return self.table


class _FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kw):
        self.puts.append(kw)


def test_aws_storage_end_to_end_with_prefix():
    s3, ddb = _FakeS3(), _FakeDynamo()
    storage = AwsStorage("bucket", "table", s3, ddb, prefix="sa/")
    run(PassageInput(id="e2e", lang="es", title="T", text="Hola. ¿Cómo estás?"),
        FakePolly(), storage)
    keys = [p["Key"] for p in s3.puts]
    assert "sa/product/e2e.soundAlong.json" == keys[-1]  # product written last
    assert "sa/audio/e2e/tts-1.mp3" in keys and "sa/audio/e2e/tts-2.mp3" in keys
    gz = next(p for p in s3.puts if p["Key"].endswith("tts-1.timing.json.gz"))
    assert gz["ContentEncoding"] == "gzip"
    assert ddb.table.items[0]["id"] == "e2e" and ddb.table.items[0]["lang"] == "es"


def test_run_aws_uploads_lexicons_and_honours_tracks(tmp_path, monkeypatch):
    inp = tmp_path / "p.json"
    inp.write_text(json.dumps({"id": "ra", "lang": "en", "text": "I live here.",
                               "pronunciation": {"1": {"w": "amazon:VB"}}}))
    polly, s3, ddb = FakePolly(), _FakeS3(), _FakeDynamo()
    polly.lexicons = []
    polly.put_lexicon = lambda Name, Content: polly.lexicons.append(Name)

    class _Session:
        def __init__(self, **kw):
            pass

        def client(self, name):
            if name == "cloudformation":
                class _Cfn:
                    def describe_stacks(self, StackName):
                        return {"Stacks": [{"Outputs": [
                            {"OutputKey": "MediaBucketName", "OutputValue": "b"},
                            {"OutputKey": "ReferenceTableName", "OutputValue": "t"}]}]}
                return _Cfn()
            return {"polly": polly, "s3": s3}[name]

        def resource(self, name):
            return ddb

    monkeypatch.setattr(run_aws.boto3, "Session", _Session)
    assert run_aws.main([str(inp), "--track", "tts-1"]) == 0
    assert sorted(polly.lexicons) == ["saEnUS", "saEsUS"]
    keys = [p["Key"] for p in s3.puts]
    assert not any("tts-2" in k for k in keys)  # only the default track
    ssml = next(p for p in s3.puts if p["Key"].endswith("tts-1.input.ssml"))["Body"].decode()
    assert 'role="amazon:VB"' in ssml  # pronunciation override applied
    assert all(c.get("LexiconNames") == ["saEnUS"] for c in polly.calls)


def test_qa_fallback_value_matches_schema_v3():
    from tokenizer import tokenize

    tk = tokenize("One two three four five six seven eight nine ten eleven.", lang="en")
    # No marks at all -> every token interpolated -> word timing not trusted.
    t = audio.build_timing(tk.tokens, " ".join(x.text for x in tk.tokens), "", 5000,
                           "Danielle", "neural", tk.text_hash)
    assert t.qa_status == audio.QA_FALLBACK == "fallback_sentence"
