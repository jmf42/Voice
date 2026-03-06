import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readMigrationSql(): string {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const sqlFiles = readdirSync(migrationsDir)
    .filter((entry) => entry !== 'migration_lock.toml')
    .map((entry) => join(migrationsDir, entry, 'migration.sql'));

  return sqlFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('Prisma migrations', () => {
  it('include all tenant settings profile fields required by the application', () => {
    const migrationSql = readMigrationSql();

    expect(migrationSql).toContain('"businessContext"');
    expect(migrationSql).toContain('"vertical"');
    expect(migrationSql).toContain('"websiteUrl"');
    expect(migrationSql).toContain('"openingHours"');
    expect(migrationSql).toContain('"recordingConsentEnabled"');
    expect(migrationSql).toContain('"faqs"');
    expect(migrationSql).toContain('"services"');
  });
});
