"""Storage backends for the pipeline.

LocalStorage writes the player-facing files under frontend/public/sa/ so the
running Vite app picks up real Polly audio immediately.

AwsStorage writes the same blobs to the deployed S3 media bucket and the
passage record to the DynamoDB reference table. Flip to it once the
StorageStack is deployed.
"""

from __future__ import annotations

import json
from decimal import Decimal
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
    """Make a product record acceptable to the boto3 DynamoDB resource.

    - floats -> Decimal (boto3 rejects Python floats; the record carries
      cost fields such as qa.estCostUsd and generation.estCostUsd). Going
      through str() keeps the printed value (0.00544, not 0.0054399999...).
    - None values are dropped (DynamoDB has no null in our usage).
    - bools are left alone (bool is an int subclass, not a float).
    """
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_to_dynamo(v) for v in obj]
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj
