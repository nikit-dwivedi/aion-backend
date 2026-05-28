import { defineConfig } from 'drizzle-kit';
export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: 'postgres://aion_user:aion_password@localhost:5432/aion_db',
    },
});
//# sourceMappingURL=drizzle.config.js.map