import { CfnTable } from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IConnection } from './connection';
import { Column } from './schema';
import { PartitionIndex, TableBase, TableBaseProps } from './table-base';
import { addConstructMetadata, MethodMetadata } from 'aws-cdk-lib/core/lib/metadata-resource';

export interface ExternalTableProps extends TableBaseProps {
  /**
   * The connection the table will use when performing reads and writes.
   *
   * @default - No connection
   */
  readonly connection: IConnection;

  /**
   * The data source location of the glue table, (e.g. `default_db_public_example` for Redshift).
   *
   * If this property is set, it will override both `bucket` and `s3Prefix`.
   *
   * @default - No outsourced data source location
   */
  readonly externalDataLocation: string;
}

/**
 * A Glue table that targets an external data location (e.g. A table in a Redshift Cluster).
 * @resource AWS::Glue::Table
 */
export class ExternalTable extends TableBase {
  /**
   * Name of this table.
   */
  public readonly tableName: string;

  /**
   * ARN of this table.
   */
  public readonly tableArn: string;

  /**
   * The connection associated to this table
   */
  public readonly connection: IConnection;

  /**
   * This table's partition indexes.
   */
  public readonly partitionIndexes?: PartitionIndex[];

  protected readonly tableResource: CfnTable;

  constructor(scope: Construct, id: string, props: ExternalTableProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);
    this.connection = props.connection;
    this.tableResource = new CfnTable(this, 'Table', {
      catalogId: props.database.catalogId,

      databaseName: props.database.databaseName,

      tableInput: {
        name: this.physicalName,
        description: props.description || `${this.physicalName} generated by CDK`,

        partitionKeys: renderColumns(props.partitionKeys),

        parameters: {
          'classification': props.dataFormat.classificationString?.value,
          'has_encrypted_data': true,
          'partition_filtering.enabled': props.enablePartitionFiltering,
          'connectionName': props.connection.connectionName,
          ...props.parameters,
        },
        storageDescriptor: {
          location: props.externalDataLocation,
          compressed: this.compressed,
          storedAsSubDirectories: props.storedAsSubDirectories ?? false,
          columns: renderColumns(props.columns),
          inputFormat: props.dataFormat.inputFormat.className,
          outputFormat: props.dataFormat.outputFormat.className,
          serdeInfo: {
            serializationLibrary: props.dataFormat.serializationLibrary.className,
          },
          parameters: props.storageParameters ? props.storageParameters.reduce((acc, param) => {
            if (param.key in acc) {
              throw new Error(`Duplicate storage parameter key: ${param.key}`);
            }
            const key = param.key;
            acc[key] = param.value;
            return acc;
          }, {} as { [key: string]: string }) : undefined,
        },

        tableType: 'EXTERNAL_TABLE',
      },
    });

    this.tableName = this.getResourceNameAttribute(this.tableResource.ref);
    this.tableArn = this.stack.formatArn({
      service: 'glue',
      resource: 'table',
      resourceName: `${this.database.databaseName}/${this.tableName}`,
    });
    this.node.defaultChild = this.tableResource;

    // Partition index creation relies on created table.
    if (props.partitionIndexes) {
      this.partitionIndexes = props.partitionIndexes;
      this.partitionIndexes.forEach((index) => this.addPartitionIndex(index));
    }
  }

  /**
   * Grant read permissions to the table
   *
   * @param grantee the principal
   */
  @MethodMetadata()
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    const ret = this.grant(grantee, readPermissions);
    return ret;
  }

  /**
   * Grant write permissions to the table
   *
   * @param grantee the principal
   */
  @MethodMetadata()
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    const ret = this.grant(grantee, writePermissions);
    return ret;
  }

  /**
   * Grant read and write permissions to the table
   *
   * @param grantee the principal
   */
  @MethodMetadata()
  public grantReadWrite(grantee: iam.IGrantable): iam.Grant {
    const ret = this.grant(grantee, [...readPermissions, ...writePermissions]);
    return ret;
  }
}

const readPermissions = [
  'glue:BatchGetPartition',
  'glue:GetPartition',
  'glue:GetPartitions',
  'glue:GetTable',
  'glue:GetTables',
  'glue:GetTableVersion',
  'glue:GetTableVersions',
];

const writePermissions = [
  'glue:BatchCreatePartition',
  'glue:BatchDeletePartition',
  'glue:CreatePartition',
  'glue:DeletePartition',
  'glue:UpdatePartition',
];

function renderColumns(columns?: Array<Column | Column>) {
  if (columns === undefined) {
    return undefined;
  }
  return columns.map(column => {
    return {
      name: column.name,
      type: column.type.inputString,
      comment: column.comment,
    };
  });
}
