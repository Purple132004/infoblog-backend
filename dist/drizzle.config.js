import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL. Create a .env file in the project root and set DATABASE_URL="postgres://user:password@host:5432/dbname"');
}
export default defineConfig({
    out: './drizzle',
    schema: './src/db/schema.ts',
    dialect: 'postgresql',
    dbCredentials: {
        url: databaseUrl,
    },
});
