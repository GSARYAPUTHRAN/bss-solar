/**
 * Normalise a PostgREST embedded resource that is one-to-one in the schema.
 *
 * Its shape depends on the PostgREST version: older ones always return an
 * array; newer ones notice the UNIQUE foreign key and return the row itself
 * (or null). Supabase upgrades PostgREST on its own schedule, so callers must
 * accept both — reading only the array form made an approved work order lose
 * its project the moment the server was upgraded.
 */
export function oneToOne<T>(embed: T | T[] | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed ?? null;
}
