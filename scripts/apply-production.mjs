/**
 * Apply production schema + create admin (no demo seed).
 *
 * Option A — Supabase access token (recommended):
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply-production.mjs
 *
 * Option B — Direct Postgres (Settings → Database → connection string):
 *   DATABASE_URL=postgresql://... node scripts/apply-production.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Override per environment; falls back to the current production project.
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "naexdhmutckbxuhqwdib";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(ROOT, "supabase", "schema.sql");

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? `https://${PROJECT_REF}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@bsssolar.in";
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.error("Set ADMIN_PASSWORD env var before running production bootstrap.");
  process.exit(1);
}

async function runSqlViaManagementApi(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function runSqlViaPg(query) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

async function applySchema() {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  console.log("Applying schema.sql …");

  if (accessToken) {
    await runSqlViaManagementApi(sql);
  } else if (databaseUrl) {
    await runSqlViaPg(sql);
  } else {
    throw new Error(
      "Set SUPABASE_ACCESS_TOKEN or DATABASE_URL to apply schema on production.",
    );
  }
  console.log("Schema applied.");
}

async function configureAuth() {
  if (!accessToken) {
    console.log("Skipping auth URL update (no SUPABASE_ACCESS_TOKEN).");
    return;
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        site_url: "https://app.bss-solar.com",
        additional_redirect_urls: [
          "https://app.bss-solar.com/**",
          "https://bss-solar.com/**",
        ],
        disable_signup: true,
      }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Auth config ${res.status}: ${text}`);
  }
  console.log("Auth URLs set to https://app.bss-solar.com");
}

async function bootstrapAdmin() {
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin bootstrap.");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;

  let userId = listed.users.find((u) => u.email === adminEmail)?.id;

  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: "BSS Admin" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("Created auth user:", adminEmail);
  } else {
    console.log("Auth user exists:", adminEmail);
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      role: "admin",
      full_name: "BSS Admin",
      phone: "+91 471 2439322",
    })
    .eq("id", userId);
  if (profileError) throw profileError;

  const { data: counts } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  console.log("Profiles count:", counts);
  console.log("Admin ready:", adminEmail);
}

async function main() {
  await applySchema();
  await configureAuth();
  await bootstrapAdmin();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
