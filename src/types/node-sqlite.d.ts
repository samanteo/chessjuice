/**
 * Minimal ambient types for Node's built-in `node:sqlite` module.
 *
 * WHY THIS EXISTS:
 *   This project runs on Node 26 (where `node:sqlite` is available at runtime),
 *   but the installed `@types/node` is v20, which predates the module — so
 *   `import { DatabaseSync } from 'node:sqlite'` fails type-checking with
 *   "Cannot find module 'node:sqlite'". `next dev` doesn't type-check so the app
 *   runs fine, but `next build` would fail.
 *
 *   Rather than bump @types/node to v22+ (which would surface unrelated type
 *   churn across the whole project), this declares only the surface we actually
 *   use: DatabaseSync + prepare/exec/get/all.
 *
 * If @types/node is ever upgraded to >= 22, DELETE this file — it will then be
 * redundant (and may conflict with the official declarations).
 */

declare module 'node:sqlite' {
  export type SupportedValueType = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    /** Returns the first row as an object, or undefined if there are no rows. */
    get(...anonymousParameters: SupportedValueType[]): unknown;
    /** Returns all rows as an array of objects. */
    all(...anonymousParameters: SupportedValueType[]): unknown[];
    /** Executes the statement and returns change information. */
    run(...anonymousParameters: SupportedValueType[]): StatementResultingChanges;
    /** Iterates the rows lazily. */
    iterate(...anonymousParameters: SupportedValueType[]): IterableIterator<unknown>;

    setAllowBareNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;

    /** The SQL source this statement was prepared from. */
    readonly sourceSQL: string;
    /** The SQL with bound parameters expanded (debugging). */
    readonly expandedSQL: string;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
    timeout?: number;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);

    /** Runs SQL with no result (DDL, PRAGMA, etc). */
    exec(sql: string): void;
    /** Prepares a statement for repeated execution. */
    prepare(sql: string): StatementSync;
    /** Closes the database handle. */
    close(): void;
    /** Opens a closed handle. */
    open(): void;

    readonly isOpen: boolean;
  }
}
