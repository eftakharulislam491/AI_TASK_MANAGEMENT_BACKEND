import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { validateEnv } from './src/config/env';

loadEnv();

const env = validateEnv(process.env);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env.DATABASE_URL,
  },
});
