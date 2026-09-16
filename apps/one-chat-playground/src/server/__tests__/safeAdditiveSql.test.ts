import { describe, expect, test } from 'vitest'

import {
  inspectSafeAdditiveSql,
  planSafeAdditiveMigration,
  type SqliteSchemaSnapshot,
} from '../safeAdditiveSql'

const base: SqliteSchemaSnapshot = {
  tables: [{
    name: 'members',
    sql: 'CREATE TABLE "members" ("id" integer PRIMARY KEY, "name" text NOT NULL)',
    columns: [
      { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
      { name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    ],
    indexes: [],
  }],
}

function withSql(sql: string, columns = base.tables[0]!.columns): SqliteSchemaSnapshot {
  return { tables: [{ ...base.tables[0]!, sql, columns }] }
}

describe('safe-additive schema gate', () => {
  test('accepts a nullable column and a required column with a safe constant default', () => {
    const target = withSql(
      'CREATE TABLE "members" ("id" integer PRIMARY KEY, "name" text NOT NULL, "phone" text, "active" integer DEFAULT 1 NOT NULL)',
      [
        ...base.tables[0]!.columns,
        { name: 'phone', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'active', type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0 },
      ],
    )
    expect(planSafeAdditiveMigration(base, target)).toEqual({
      ok: true,
      statements: [
        'ALTER TABLE "members" ADD COLUMN "phone" text;',
        'ALTER TABLE "members" ADD COLUMN "active" integer DEFAULT 1 NOT NULL;',
      ],
    })
  })

  test('accepts a new table, including its constraints', () => {
    const target: SqliteSchemaSnapshot = {
      tables: [...base.tables, {
        name: 'notes',
        sql: 'CREATE TABLE "notes" ("id" integer PRIMARY KEY, "body" text NOT NULL)',
        columns: [
          { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
          { name: 'body', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        ],
        indexes: [],
      }],
    }
    expect(planSafeAdditiveMigration(base, target)).toMatchObject({ ok: true })
  })

  test.each([
    ['drop', 'DROP TABLE members;'],
    ['rename', 'ALTER TABLE members RENAME COLUMN name TO full_name;'],
    ['retype', 'ALTER TABLE members ALTER COLUMN name TYPE integer;'],
    ['constraint', 'ALTER TABLE members ADD COLUMN email text UNIQUE;'],
    ['table rebuild', 'CREATE TABLE members (id integer);'],
    ['backfill', "UPDATE members SET name = 'unknown';"],
  ])('refuses %s SQL', (_name, sql) => {
    expect(inspectSafeAdditiveSql(sql, new Set(['members']))).toMatchObject({ ok: false })
  })

  test('refuses a removed/renamed column and a retyped existing column from snapshots', () => {
    const renamed = withSql(
      'CREATE TABLE "members" ("id" integer PRIMARY KEY, "full_name" text NOT NULL)',
      [
        base.tables[0]!.columns[0]!,
        { name: 'full_name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      ],
    )
    expect(planSafeAdditiveMigration(base, renamed)).toMatchObject({ ok: false })

    const retyped = withSql(
      'CREATE TABLE "members" ("id" integer PRIMARY KEY, "name" integer NOT NULL)',
      [
        base.tables[0]!.columns[0]!,
        { name: 'name', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      ],
    )
    expect(planSafeAdditiveMigration(base, retyped)).toMatchObject({ ok: false })
  })

  test('refuses a constraint added to existing data and an unsafe required column', () => {
    const constrained = withSql('CREATE TABLE "members" ("id" integer PRIMARY KEY, "name" text NOT NULL UNIQUE)')
    expect(planSafeAdditiveMigration(base, constrained)).toMatchObject({ ok: false })

    const required = withSql(
      'CREATE TABLE "members" ("id" integer PRIMARY KEY, "name" text NOT NULL, "phone" text NOT NULL)',
      [...base.tables[0]!.columns, { name: 'phone', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 }],
    )
    expect(planSafeAdditiveMigration(base, required)).toMatchObject({ ok: false })
  })
})
