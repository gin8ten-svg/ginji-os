import { existsSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.test.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
