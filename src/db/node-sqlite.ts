import * as sqlite from "node:sqlite";

// @types/node 26.6.5は、実行環境26.12.1の正式名Database/Statement.closeを
// まだ宣言していません。旧名は型としてのみ参照し、実行時には利用しません。
type NativeStatement = sqlite.StatementSync & { close(): void };
export type NativeDatabase = Omit<sqlite.DatabaseSync, "prepare"> & {
    prepare(sql: string): NativeStatement;
};

export const Database = (sqlite as unknown as {
    Database: new (path: string, options?: sqlite.DatabaseSyncOptions) => NativeDatabase;
}).Database;
