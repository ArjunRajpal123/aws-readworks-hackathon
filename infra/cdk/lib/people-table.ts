import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import { AppConfig, resourceName } from "./config";

export interface PeopleTableProps {
  readonly config: AppConfig;
  /** Customer-managed key, shared with the media bucket and reference table. */
  readonly encryptionKey: kms.IKey;
}

/** Name of the one overloaded GSI (see docs/PEOPLE_DATA_MODEL.md). */
export const PEOPLE_GSI1 = "gsi1";

/**
 * DynamoDB "people" table: admins, teachers, parents, students, classes,
 * the links between them, assignments, reading sessions and word practice.
 *
 * Single-table design, generic keys `pk` / `sk` plus one overloaded GSI
 * (`gsi1pk` / `gsi1sk`) for the inverse side of each relationship and for
 * listing people by role. Item layout and access patterns:
 * docs/PEOPLE_DATA_MODEL.md. Data access: lambda/common/people_store.py.
 *
 * Kept apart from the passage reference table on purpose: the content
 * pipeline (ETL + text-to-speech POST) has write access to that table and
 * must never be able to touch student data.
 */
export class PeopleTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: PeopleTableProps) {
    super(scope, id);
    const { config, encryptionKey } = props;

    // Same convention as StorageStack: dev/sandbox tears down, prod retains.
    const isProd = config.environment === "prod";

    this.table = new dynamodb.Table(this, "Table", {
      tableName: resourceName(config, "dynamodb", "people"),
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      // Student records: block accidental DeleteTable in prod.
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Overloaded GSI: parent->child inverse (child's parents), person ->
    // classes (teacher's classes, student's classes), people by role,
    // classes list, assignments sent by a teacher/parent. Items are small,
    // so ALL projection avoids a second read per row.
    this.table.addGlobalSecondaryIndex({
      indexName: PEOPLE_GSI1,
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
