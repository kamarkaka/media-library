import bcrypt from 'bcryptjs';
import readline from 'readline';
import { initDatabase, setSetting } from './db';
import db from './db';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function setupAuth() {
  await initDatabase();

  console.log('Setup authentication credentials\n');

  const username = (await question('Username (default: admin): ')).trim() || 'admin';
  const password = await question('Password: ');

  if (!password) {
    console.error('Password cannot be empty');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);

  await setSetting('auth_username', username);
  await setSetting('auth_password_hash', hash);

  console.log(`\nCredentials saved to database`);
  console.log(`Username: ${username}`);

  await db.destroy();
}

async function hashPassword() {
  const password = await question('Password to hash: ');
  console.log(`\nHash: ${bcrypt.hashSync(password, 12)}`);
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'setup-auth':
      await setupAuth();
      break;
    case 'hash-password':
      await hashPassword();
      break;
    default:
      console.log('Usage:');
      console.log('  setup-auth     - Set up authentication credentials');
      console.log('  hash-password  - Generate a bcrypt hash');
  }

  rl.close();
}

main();
