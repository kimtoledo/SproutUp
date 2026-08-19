import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = ReturnType<typeof drizzle>;

export interface DatabaseServices {
  db: Database;
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseServices {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    db: drizzle(client),
    async check() {
      await client`select 1 as ready`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
