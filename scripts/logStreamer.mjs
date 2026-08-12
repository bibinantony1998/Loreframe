import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');

fs.mkdirSync(logsDir, { recursive: true });

const serviceName = process.argv[2] || 'app';
const commandToRun = process.argv.slice(3).join(' ');

if (!commandToRun) {
  console.error('❌ Usage: node scripts/logStreamer.mjs <service-name> <command>');
  process.exit(1);
}

const logFile = path.join(logsDir, `${serviceName}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

logStream.write(`\n--- Started ${serviceName} at ${new Date().toISOString()} ---\n`);

const child = spawn(commandToRun, {
  shell: true,
  cwd: rootDir,
  env: process.env,
});

function shouldPrintLine(service, line) {
  const cleanLine = line.trim();
  if (!cleanLine) return false;

  // 1. Service Specific Ignores (Filter out harmless warning noise first)
  if (service === 'comfy') {
    if (
      cleanLine.includes('nodes_glsl') ||
      cleanLine.includes('nodes_anthropic') ||
      cleanLine.includes('nodes_bytedance') ||
      cleanLine.includes('nodes_openrouter') ||
      cleanLine.includes('NotOpenSSLWarning') ||
      cleanLine.includes('comfy_angle') ||
      cleanLine.includes('Asset seeder') ||
      cleanLine.includes('frontend-package') ||
      cleanLine.includes('ModelMetaclass') ||
      cleanLine.includes('older than 3.10') ||
      cleanLine.includes('Cannot import') ||
      cleanLine.includes('IMPORT FAILED') ||
      cleanLine.includes('WARNING')
    ) {
      return false;
    }
  }

  if (service === 'ui') {
    if (
      cleanLine.includes('GET /') ||
      cleanLine.includes('WebSocket error') ||
      cleanLine.includes('Next.js inferred your workspace root') ||
      cleanLine.includes('lockfiles')
    ) {
      return false;
    }
  }

  if (service === 'server') {
    if (cleanLine.includes('[tsx]')) return false;
  }

  // 2. Critical Runtime Errors
  if (cleanLine.includes('Error') || cleanLine.includes('ERROR') || cleanLine.includes('Exception') || cleanLine.includes('Traceback')) {
    return true;
  }

  // 3. Status Milestones
  if (service === 'server') {
    return (
      cleanLine.includes('Backend running on') ||
      cleanLine.includes('Health check available') ||
      cleanLine.includes('Generate API available') ||
      cleanLine.includes('Static files served') ||
      cleanLine.includes('[WebSocket]') ||
      cleanLine.includes('Agent]') ||
      cleanLine.includes('Worker]') ||
      cleanLine.includes('%')
    );
  }

  if (service === 'ui') {
    return (
      cleanLine.includes('Local:') ||
      cleanLine.includes('Network:') ||
      cleanLine.includes('Ready in') ||
      cleanLine.includes('Next.js')
    );
  }

  if (service === 'comfy') {
    return (
      cleanLine.includes('Device:') ||
      cleanLine.includes('Total VRAM') ||
      cleanLine.includes('To see the GUI go to:') ||
      cleanLine.includes('Prompt executed') ||
      cleanLine.includes('got prompt')
    );
  }

  return true;
}

function processBuffer(stream, isError = false) {
  let buffer = '';
  stream.on('data', (chunk) => {
    const str = chunk.toString('utf-8');
    logStream.write(str); // Save full un-truncated log to logs/<service>.log

    buffer += str;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete trailing line

    for (const line of lines) {
      if (shouldPrintLine(serviceName, line)) {
        if (isError) {
          process.stderr.write(`${line}\n`);
        } else {
          process.stdout.write(`${line}\n`);
        }
      }
    }
  });
}

processBuffer(child.stdout, false);
processBuffer(child.stderr, true);

child.on('close', (code) => {
  logStream.write(`\n--- Exited ${serviceName} with code ${code} ---\n`);
  logStream.end();
  process.exit(code || 0);
});

// Handle termination signals
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
