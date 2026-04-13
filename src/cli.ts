import bcrypt from 'bcryptjs';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function updateEnvFile(envPath: string, vars: Record<string, string>): void {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
    }
  }

  fs.writeFileSync(envPath, content);
}

async function setupAuth() {
  console.log('Setup authentication credentials\n');

  const username = (await question('Username (default: admin): ')).trim() || 'admin';
  const password = await question('Password: ');

  if (!password) {
    console.error('Password cannot be empty');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const secret = crypto.randomBytes(32).toString('hex');

  const envPath = path.join(process.cwd(), '.env');
  updateEnvFile(envPath, {
    AUTH_USERNAME: username,
    AUTH_PASSWORD_HASH: hash,
    SESSION_SECRET: secret,
  });

  console.log(`\nCredentials saved to ${envPath}`);
  console.log(`Username: ${username}`);
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
