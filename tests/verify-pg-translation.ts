/**
 * Verifies that every SQL string in server/src translates to valid Postgres.
 * Extracts SQL-looking string literals, runs them through toPostgres(), and
 * executes them against pg-mem (a real Postgres parser) to catch syntax errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import { newDb } from 'pg-mem';
import { toPostgres } from '../src/db/database.js';

const SRC = path.resolve('src');
const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|BEGIN|COMMIT|ROLLBACK|WITH)\b/i;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function extractLiterals(src: string): { text: string; file: string; line: number }[] {
  const out: { text: string; file: string; line: number }[] = [];
  // single-quoted, double-quoted (naive), and template literals
  const re = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let raw = m[0];
    const quote = raw[0];
    let text = raw.slice(1, -1);
    if (quote === '`' && text.includes('${')) continue; // dynamic template -> skip
    // unescape minimal
    text = text.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (SQL_START.test(text)) {
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ text, file: '', line });
    }
  }
  return out;
}

async function main() {
  const mem = newDb();
  mem.public.registerFunction({
    name: 'current_timestamp',
    returns: 'timestamp',
    implementation: () => new Date(),
  });

  const files = collectFiles(SRC);
  const all: { text: string; file: string; line: number }[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const lit of extractLiterals(src)) {
      lit.file = path.relative(SRC, f);
      all.push(lit);
    }
  }
  console.log(`Found ${all.length} SQL literals in ${files.length} files.`);

  // First: run the full schema through pg-mem so tables exist.
  const schemaSrc = fs.readFileSync(path.join(SRC, 'db/database.ts'), 'utf8');
  const schemaMatch = schemaSrc.match(/const schema = `([\s\S]*?)`;/);
  if (!schemaMatch) throw new Error('schema not found');
  const pgSchema = toPostgres(schemaMatch[1]);
  // pg-mem: run statement by statement
  for (const stmt of pgSchema.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    try {
      mem.public.none(stmt);
    } catch (e: any) {
      console.log('SCHEMA STMT FAILED:', stmt.slice(0, 100), '\n  ->', e.message.split('\n')[0]);
    }
  }
  // extra migrations
  for (const extra of [
    'ALTER TABLE subscriptions ADD COLUMN order_id TEXT',
    'ALTER TABLE subscriptions ADD COLUMN purchase_token TEXT',
    'ALTER TABLE subscriptions ADD COLUMN current_period_start TEXT',
    'ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0',
    'ALTER TABLE document_attachments ADD COLUMN file_data BYTEA',
  ]) {
    try { mem.public.none(extra); } catch {}
  }

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const { text, file, line } of all) {
    if (/^\s*PRAGMA/i.test(text)) continue; // handled separately by the wrapper
    const pgSql = toPostgres(text);
    if (seen.has(pgSql)) continue;
    seen.add(pgSql);
    // count placeholders
    const count = (pgSql.match(/\$\d+/g) || []).map((s) => Number(s.slice(1)));
    const nParams = count.length ? Math.max(...count) : 0;
    const params = new Array(nParams).fill(null);
    try {
      // Use query (not none) so SELECTs also parse; ignore result errors from null params
      mem.public.query(pgSql, params);
      pass++;
    } catch (e: any) {
      const msg: string = e.message || '';
      // pg-mem raises different error kinds; syntax/parse errors are what we hunt.
      // Null-param type errors are acceptable (they prove parsing succeeded).
      if (/syntax error|parse error|unexpected/i.test(msg)) {
        fail++;
        failures.push(`${file}:${line}: ${msg.split('\n')[0]}\n   SQL: ${pgSql.slice(0, 140)}`);
      } else {
        pass++;
      }
    }
  }

  console.log(`\nTranslation check: ${pass} passed, ${fail} failed (unique statements: ${seen.size}).`);
  for (const f of failures.slice(0, 25)) console.log('FAIL:', f);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
