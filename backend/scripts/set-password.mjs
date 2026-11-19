#!/usr/bin/env node
/*
 * Set a user's password directly in the auth database.
 *
 * The Python backend hashed passwords with Argon2 (pwdlib); the Node backend
 * hashes with scrypt and cannot verify an Argon2 hash, so an account created
 * before the migration can no longer sign in. This rewrites the hash in place,
 * keeping the same user id -- which matters, because evidence lives under
 * data/evidence/users/<user_id>/ and a re-registered account would get a new
 * id and lose sight of every batch already collected.
 *
 * The password is read from stdin, never from argv, so it does not end up in
 * shell history or in the process list.
 *
 *   node scripts/set-password.mjs you@example.com
 */
import readline from 'node:readline';
import { getDb, initSchema } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data.split('\n')[0].trim()));
      process.stdin.on('error', reject);
      return;
    }

    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo so the password is not printed to the terminal.
    const onKeypress = () => { readline.clearLine(process.stdout, 0); readline.cursorTo(process.stdout, 0); process.stdout.write(prompt); };
    process.stdin.on('keypress', onKeypress);
    rl.question('', answer => {
      process.stdin.removeListener('keypress', onKeypress);
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/set-password.mjs <email>');
    process.exit(2);
  }

  const password = await readSecret('New password: ');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }

  const db = getDb();
  initSchema(db);

  const row = db.prepare('SELECT id, email, name FROM users WHERE lower(email) = ?').get(email);
  if (!row) {
    console.error(`No account found for ${email}. Existing accounts:`);
    for (const u of db.prepare('SELECT id, email FROM users ORDER BY id').all()) {
      console.error(`  id=${u.id}  ${u.email}`);
    }
    process.exit(1);
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id);

  // Old session cookies stay valid across a password change otherwise.
  const cleared = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);

  console.log(`Password updated for ${row.email} (user id ${row.id}, unchanged).`);
  console.log(`Signed out ${cleared.changes} existing session(s).`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
