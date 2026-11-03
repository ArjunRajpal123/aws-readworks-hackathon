"""Storage backends for the pipeline.

LocalStorage writes the player-facing files under frontend/public/sa/ so the
running Vite app picks up real Polly audio immediately.

AwsStorage writes the same blobs to the deployed S3 media bucket and the
passage record to the DynamoDB reference table. Flip to it once the
StorageStack is deployed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


class LocalStorage:
    def __init__(self, root: str):
        # root is the sa/ directory, e.g. frontend/public/sa
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def put_bytes(self, key, data, content_type, content_encoding=None):
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def put_record(self, record_id, record):
        # Mirror the DynamoDB record locally for inspection/parity.
        path = self.root / "records" / f"{record_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2))


class AwsStorage:
    """S3 for blobs, DynamoDB for the passage record.

    Keys are written under an `sa/` prefix in the bucket so the layout matches
    what CloudFront/the player expect.
    """

    def __init__(self, bucket: str, table: str, s3_client, dynamodb_resource,
                 prefix: str = "sa/"):
        self.bucket = bucket
        self.prefix = prefix
        self.s3 = s3_client
        self.table = dynamodb_resource.Table(table)

    def put_bytes(self, key, data, content_type, content_encoding=None):
        extra = {"ContentType": content_type}
        if content_encoding:
            extra["ContentEncoding"] = content_encoding
        self.s3.put_object(
            Bucket=self.bucket,
            Key=self.prefix + key,
            Body=data,
            **extra,
        )

    def put_record(self, record_id, record):
        # DynamoDB item: the product record, keyed by `id` (table PK), plus the
        # `lang` attribute that backs the lang-index GSI.
        item = dict(record)
        item["id"] = record_id
        item.setdefault("lang", record.get("lang", "en"))
        self.table.put_item(Item=_to_dynamo(item))


def _to_dynamo(obj):
    """DynamoDB (boto3 resource) rejects empty strings in some contexts and
    floats; keep it simple: ints stay ints, drop None, pass through the rest.
    The product record is already int/str/list/dict, so this mostly strips
    None values.
    """
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_to_dynamo(v) for v in obj]
    return obj
