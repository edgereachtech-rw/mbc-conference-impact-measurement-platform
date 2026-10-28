import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

/** Builds a Prisma client for the given connection string (Prisma 7 requires a driver adapter). */
export function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let client: PrismaClient | undefined;

/** Process-wide client. Reads DATABASE_URL lazily so importing this module never needs a database. */
export function getPrisma(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = createPrismaClient(url);
  }
  return client;
}

export type { PrismaClient };
