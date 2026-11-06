require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

// Migrações transacionais e versionadas. Reexecutar não recria as tabelas.
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84620551)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    const migrations = [{ name: '0001_initial.sql', sql: schema }];
    const dir = path.join(__dirname, '../migrations');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir).filter(name => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort()) {
        migrations.push({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') });
      }
    }
    const applied = await client.query('SELECT name,checksum FROM schema_migrations');
    const existing = new Map(applied.rows.map(row => [row.name, row.checksum]));
    if (!existing.has('0001_initial.sql')) {
      const legacy = await client.query("SELECT to_regclass('public.users') AS users");
      if (legacy.rows[0].users) throw new Error('Banco existente sem histórico de migrações. Faça backup e migração manual antes de prosseguir.');
    }
    for (const migration of migrations) {
      const checksum = crypto.createHash('sha256').update(migration.sql).digest('hex');
      if (existing.has(migration.name)) {
        if (existing.get(migration.name) !== checksum) throw new Error(`Migração alterada após aplicação: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [migration.name, checksum]);
      console.log(`Aplicada: ${migration.name}`);
    }
    await client.query('COMMIT');
    console.log('Banco atualizado com segurança.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
