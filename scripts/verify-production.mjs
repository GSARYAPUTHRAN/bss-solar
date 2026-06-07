import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});
await client.connect();

const tables = ["profiles", "work_orders", "projects", "service_tickets"];
for (const t of tables) {
  const { rows } = await client.query(`select count(*)::int as n from ${t}`);
  console.log(`${t}: ${rows[0].n}`);
}

const { rows: users } = await client.query(`
  select p.role, p.full_name, u.email
  from profiles p
  join auth.users u on u.id = p.id
  order by u.email
`);
console.log("users:", users);

await client.end();
