#!/usr/bin/env node
/**
 * Proves that supabase/schema.sql provisions the SAME public schema as the
 * migrations in supabase/migrations.
 *
 *   node supabase/scripts/check-schema-sync.mjs            # schema.sql vs migrations
 *   node supabase/scripts/check-schema-sync.mjs --local    # schema.sql vs the local `postgres` DB
 *
 * Needs the local stack (`npx supabase start`). Everything happens in throwaway
 * databases inside the local Postgres container, which are always dropped; the
 * `postgres` database is only ever read.
 *
 * Both sides are built on the same stand-in for what a Supabase project
 * provides before any of our SQL runs (auth.users / auth.uid(), the extensions
 * schema, the realtime publication and the platform's default grants), then
 * compared with `pg_dump --schema-only --schema=public` — the definitions, then
 * the GRANT/REVOKEs on their own so a missing REVOKE is caught too — plus our
 * trigger on auth.users and the realtime publication's tables.
 *
 * Normalisation: comments, blank lines and pg_dump's per-run \restrict keys are
 * ignored, platform default privileges owned by supabase_admin are ignored, and
 * table columns are compared as a set — schema.sql groups columns by meaning,
 * whereas a migration can only append them. Exit code 1 on any difference.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const SCHEMA_SQL = join(SUPABASE_DIR, "schema.sql");

const PLATFORM_STUB = `
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create schema extensions;
create extension "uuid-ossp" with schema extensions;
create publication supabase_realtime;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
`;

const AUTH_TRIGGERS_SQL = `
select pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
  and p.pronamespace = 'public'::regnamespace
order by 1;
`;

const PUBLICATION_SQL = `
select schemaname || '.' || tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by 1;
`;

function containerName() {
  if (process.env.SUPABASE_DB_CONTAINER) return process.env.SUPABASE_DB_CONTAINER;
  const config = readFileSync(join(SUPABASE_DIR, "config.toml"), "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

const CONTAINER = containerName();

function inContainer(args, input) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Runs SQL as the `postgres` role (as the SQL editor and the CLI do). */
function psql(db, sql) {
  return inContainer(
    ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db],
    sql,
  );
}

function pgDump(db, withPrivileges) {
  return inContainer([
    "pg_dump", "-U", "postgres", "-d", db,
    "--schema-only", "--schema=public", "--no-owner",
    ...(withPrivileges ? [] : ["--no-privileges"]),
  ]);
}

/** Drops pg_dump noise and compares table columns as a set (see header). */
function normalise(dump) {
  const out = [];
  let columns = null;
  for (const raw of dump.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("--")) continue;
    if (line.startsWith("\\restrict") || line.startsWith("\\unrestrict")) continue;
    if (line.startsWith("ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin")) continue;

    if (columns) {
      if (line === ");") {
        out.push(...columns.sort(), line);
        columns = null;
      } else {
        columns.push(line.replace(/,$/, ""));
      }
      continue;
    }
    out.push(line);
    if (/^CREATE TABLE .*\($/.test(line)) columns = [];
  }
  return out.join("\n") + "\n";
}

/** Only the GRANT/REVOKE lines — the rest of that dump is the schema above. */
function privileges(dump) {
  return normalise(dump)
    .split("\n")
    .filter((line) => /^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) /.test(line))
    .join("\n");
}

function snapshot(db) {
  return {
    schema: normalise(pgDump(db, false)),
    privileges: privileges(pgDump(db, true)),
    "triggers on auth.users": psql(db, AUTH_TRIGGERS_SQL),
    "realtime publication": psql(db, PUBLICATION_SQL),
  };
}

/** Scratch databases created so far — the only ones cleanup may drop. */
const scratchDatabases = [];

function scratchDatabase(name, files) {
  psql("postgres", `create database ${name};`);
  scratchDatabases.push(name);
  psql(name, PLATFORM_STUB);
  for (const file of files) {
    try {
      psql(name, readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file} failed to apply:\n${error.stderr ?? error.message}`);
    }
  }
}

function diff(label, expected, actual, workDir) {
  if (expected === actual) {
    console.log(`  ok    ${label}`);
    return true;
  }
  const slug = label.replace(/\W+/g, "-");
  const a = join(workDir, `${slug}.reference.sql`);
  const b = join(workDir, `${slug}.schema-sql.sql`);
  writeFileSync(a, expected);
  writeFileSync(b, actual);
  console.log(`  DIFF  ${label}  (- reference, + schema.sql)`);
  spawnSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "diff", "--no-index", "--no-color", "--", a, b],
    { stdio: "inherit" },
  );
  return false;
}

const againstLocal = process.argv.includes("--local");
const suffix = `${process.pid}_${Date.now()}`;
const schemaDb = `schema_sync_sql_${suffix}`;
const migrationsDb = `schema_sync_mig_${suffix}`;
const workDir = mkdtempSync(join(tmpdir(), "schema-sync-"));
let inSync = false;

try {
  console.log(`Container ${CONTAINER}`);
  scratchDatabase(schemaDb, [SCHEMA_SQL]);

  let referenceDb = "postgres";
  if (!againstLocal) {
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f));
    scratchDatabase(migrationsDb, migrations);
    referenceDb = migrationsDb;
  }

  console.log(`Comparing schema.sql against ${againstLocal ? "the local postgres DB" : "the migrations"}:`);
  const reference = snapshot(referenceDb);
  const candidate = snapshot(schemaDb);
  inSync = Object.keys(reference)
    .map((label) => diff(label, reference[label], candidate[label], workDir))
    .every(Boolean);
} finally {
  // Best effort, so a failure above (e.g. the stack is not running) is the
  // error reported rather than this cleanup's.
  for (const db of scratchDatabases) {
    try {
      psql("postgres", `drop database if exists ${db} with (force);`);
    } catch {
      console.error(`Could not drop scratch database ${db} — drop it by hand.`);
    }
  }
  rmSync(workDir, { recursive: true, force: true });
}

console.log(inSync ? "schema.sql is in sync." : "schema.sql has DRIFTED — see the diff above.");
process.exitCode = inSync ? 0 : 1;
