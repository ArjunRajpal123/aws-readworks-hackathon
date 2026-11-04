"""Architecture diagram (diagrams-as-code) for the Sound Along ETL + player.

Renders what this session built:
  passage text -> tokenize (P1) -> Amazon Polly (P3, mp3 + byte-offset word
  timing) -> stored in S3 (audio + gzipped timing) and DynamoDB (passage
  record + keys) -> Vue player reads the product JSON and drives word-synced
  highlighting. Provisioned by AWS CDK (web + storage stacks).

Run:  /workshop/.venv-etl/bin/python diagram.py
Out:  /workshop/docs/architecture.png
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.ml import Polly
from diagrams.aws.storage import SimpleStorageServiceS3Bucket as S3
from diagrams.aws.database import Dynamodb
from diagrams.aws.security import KMS
from diagrams.aws.management import Cloudformation
from diagrams.aws.general import General, Users
from diagrams.onprem.client import Client
from diagrams.programming.language import Python
from diagrams.programming.framework import Vue

graph_attr = {
    "fontsize": "20",
    "labelloc": "t",
    "pad": "0.5",
    "nodesep": "0.6",
    "ranksep": "0.9",
    "bgcolor": "white",
}

with Diagram(
    "ReadWorks Sound Along — ETL + Read-Along Player",
    filename="/workshop/docs/architecture",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    src = General("Passage text\n(RW_Data.xlsx / input JSON)")

    with Cluster("ETL pipeline (Python, local + boto3)"):
        tok = Python("P1 Tokenizer\nspans + structure + textHash")
        polly = Polly("P3 Amazon Polly\nneural mp3 + word speech marks")
        timing = Python("Byte-offset mapping\nstart[] / end[] + QA")
        tok >> Edge(label="tokens") >> polly >> Edge(label="speech marks") >> timing

    with Cluster("Storage (CDK: rg-readworks-bb-storage)"):
        s3 = S3("S3 media bucket\nmp3 + timing.json.gz")
        ddb = Dynamodb("DynamoDB reference\nproduct record + S3 keys")
        kms = KMS("KMS key")
        kms - Edge(style="dashed", label="encrypts") - s3
        kms - Edge(style="dashed") - ddb

    with Cluster("Frontend"):
        player = Vue("Vue player\nrenders contentTokenized")
        user = Client("Student\nplay + tap-to-replay")
        player >> user

    cdk = Cloudformation("AWS CDK\nweb + storage stacks")

    # Data flow
    src >> Edge(label="raw text") >> tok
    timing >> Edge(label="mp3 + gzip timing") >> s3
    timing >> Edge(label="soundAlong.json\n(record + keys)") >> ddb
    s3 >> Edge(label="audio + timing") >> player
    ddb >> Edge(label="product JSON") >> player

    # Provisioning (dotted)
    cdk >> Edge(style="dotted", color="gray", label="provisions") >> s3
    cdk >> Edge(style="dotted", color="gray") >> ddb
