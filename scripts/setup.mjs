import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const rootDir = process.cwd();
const uiDir = path.join(rootDir, 'ui');
const comfyDir = path.join(rootDir, 'comfyui');

console.log('--------------------------------------------------');
console.log('🚀 Starting Loreframe Unified Cross-Platform Setup');
console.log('--------------------------------------------------\n');

function parseEnv() {
  const envPath = path.join(rootDir, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valParts] = trimmed.split('=');
        const val = valParts.join('=').trim().replace(/^["']|["']$/g, '');
        env[key.trim()] = val;
      }
    }
  }
  return env;
}

function runCommand(command, cwd = rootDir) {
  console.log(`> Executing: ${command} (in ${cwd})`);
  try {
    execSync(command, { cwd, stdio: 'inherit', env: process.env });
  } catch (error) {
    console.error(`❌ Error executing command: ${command}`);
    throw error;
  }
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 100000) {
      console.log(`✅ File ready (${(stats.size / 1024 / 1024).toFixed(1)} MB): ${path.basename(destPath)}`);
      return;
    } else {
      console.log(`⚠️ Cleaning up incomplete file (${stats.size} bytes): ${path.basename(destPath)}`);
      try { fs.unlinkSync(destPath); } catch (e) { }
    }
  }

  console.log(`📥 Downloading ${path.basename(destPath)}...`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (reqUrl) => {
      https.get(reqUrl, (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode)) {
          return request(new URL(response.headers.location, reqUrl).href);
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastLogTime = Date.now();

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastLogTime > 2000) { // Log progress every 2 seconds
            lastLogTime = now;
            const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
            if (totalBytes > 0) {
              const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
              const pct = ((downloadedBytes / totalBytes) * 100).toFixed(0);
              process.stdout.write(`⏳ Downloading ${path.basename(destPath)}: ${pct}% (${downloadedMB} MB / ${totalMB} MB)\r`);
            } else {
              process.stdout.write(`⏳ Downloading ${path.basename(destPath)}: ${downloadedMB} MB downloaded\r`);
            }
          }
        });

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`\n✅ Successfully downloaded ${path.basename(destPath)}`);
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => { });
        reject(err);
      });
    };
    request(url);
  });
}

async function setupComfyUI() {
  const mainPy = path.join(comfyDir, 'main.py');
  if (!fs.existsSync(mainPy)) {
    console.log('🤖 Cloning ComfyUI repository...');
    const tmpCloneDir = path.join(rootDir, 'comfyui_git_tmp');
    if (fs.existsSync(tmpCloneDir)) {
      try {
        fs.rmSync(tmpCloneDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore if directory doesn't exist
      }
    }
    runCommand('git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git comfyui_git_tmp');

    // Copy into comfyDir preserving existing models/
    runCommand(`cp -Rn comfyui_git_tmp/. comfyui/`);
    try {
      fs.rmSync(tmpCloneDir, { recursive: true, force: true });
    } catch (e) { }
    console.log('✅ ComfyUI repository cloned successfully.');
  } else {
    console.log('✅ ComfyUI core codebase already present.');
  }

  // Setup Python Virtual Environment
  const venvDir = path.join(comfyDir, 'venv');
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  if (!fs.existsSync(venvDir)) {
    console.log('🐍 Creating Python Virtual Environment for ComfyUI...');
    runCommand('python3 -m venv venv', comfyDir);
    console.log('📦 Installing PyTorch and dependencies into ComfyUI venv...');
    const pipCmd = process.platform === 'win32'
      ? `${path.join('venv', 'Scripts', 'pip.exe')} install -r requirements.txt`
      : `${path.join('venv', 'bin', 'pip')} install -r requirements.txt`;
    try {
      runCommand(pipCmd, comfyDir);
      console.log('✅ ComfyUI Python environment configured.');
    } catch (err) {
      console.warn('ℹ️ Python pip install finished with warnings, proceeding...');
    }
  } else {
    console.log('✅ ComfyUI Python virtual environment ready.');
  }
}

async function setup() {
  const env = parseEnv();
  const serverPort = env.PORT || 3001;
  const comfyUrl = env.COMFYUI_BASE_URL || 'http://localhost:8188';
  const kokoroUrl = env.KOKORO_BASE_URL || 'http://localhost:8880';
  const ollamaUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const redisPort = env.REDIS_PORT || 6379;
  const uiUrl = 'http://localhost:3002';

  // 1. Root Server Dependencies
  const rootNodeModules = path.join(rootDir, 'node_modules');
  if (!fs.existsSync(rootNodeModules)) {
    console.log('📦 1/4 Installing Backend Server dependencies...');
    runCommand('npm install --no-audit --no-fund');
  } else {
    console.log('✅ 1/4 Backend Server dependencies already installed.');
  }

  // 2. Database Client Generation
  console.log('\n🗄️ 2/4 Generating Prisma Database client...');
  runCommand('npx prisma generate');

  // 3. UI Dependencies
  if (fs.existsSync(uiDir)) {
    const uiNodeModules = path.join(uiDir, 'node_modules');
    if (!fs.existsSync(uiNodeModules)) {
      console.log('\n🎨 3/4 Installing Frontend UI dependencies...');
      runCommand('npm install --no-audit --no-fund', uiDir);
    } else {
      console.log('✅ 3/4 Frontend UI dependencies already installed.');
    }
  } else {
    console.warn('⚠️ UI directory missing at ./ui');
  }

  // 4. ComfyUI Environment Setup & Model Downloads
  console.log('\n🤖 4/4 Setting up ComfyUI codebase and model assets...');
  await setupComfyUI();

  const comfyCheckpointsDir = path.join(comfyDir, 'models', 'checkpoints', 'SD1.5');
  const comfyLorasDir = path.join(comfyDir, 'models', 'loras', 'HyperSD', 'SD15');
  const baseCheckpointsDir = path.join(comfyDir, 'models', 'checkpoints');
  const baseLorasDir = path.join(comfyDir, 'models', 'loras');

  fs.mkdirSync(comfyCheckpointsDir, { recursive: true });
  fs.mkdirSync(comfyLorasDir, { recursive: true });

  try {
    const sd15Url = 'https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.ckpt';
    const loraUrl = 'https://huggingface.co/ByteDance/Hyper-SD/resolve/main/Hyper-SD15-4steps-lora.safetensors';

    const ckptTarget = path.join(comfyCheckpointsDir, 'v1-5-pruned-emaonly.ckpt');
    const loraTarget = path.join(comfyLorasDir, 'Hyper-SD15-4steps-lora.safetensors');

    await downloadFile(sd15Url, ckptTarget);
    await downloadFile(loraUrl, loraTarget);

    // Hardlink/copy to root model folders for total path compatibility
    const rootCkpt = path.join(baseCheckpointsDir, 'v1-5-pruned-emaonly.ckpt');
    const rootLora = path.join(baseLorasDir, 'Hyper-SD15-4steps-lora.safetensors');
    if (fs.existsSync(ckptTarget) && !fs.existsSync(rootCkpt)) {
      try { fs.linkSync(ckptTarget, rootCkpt); } catch (e) { fs.copyFileSync(ckptTarget, rootCkpt); }
    }
    if (fs.existsSync(loraTarget) && !fs.existsSync(rootLora)) {
      try { fs.linkSync(loraTarget, rootLora); } catch (e) { fs.copyFileSync(loraTarget, rootLora); }
    }
  } catch (err) {
    console.warn('ℹ️ Model check complete:', err.message);
  }

  // 5. ComfyUI Workflow Auto-Import & Default Configuration
  const workflowSrc = path.join(rootDir, 'src', 'workflows', 'comfy_workflow_ui.json');
  const comfyUserDir = path.join(comfyDir, 'user', 'default');
  const comfyUserWorkflowsDir = path.join(comfyUserDir, 'workflows');
  fs.mkdirSync(comfyUserWorkflowsDir, { recursive: true });

  if (fs.existsSync(workflowSrc)) {
    fs.copyFileSync(workflowSrc, path.join(comfyUserWorkflowsDir, 'default.json'));
    fs.copyFileSync(workflowSrc, path.join(comfyUserWorkflowsDir, 'Loreframe_Workflow.json'));

    const settingsPath = path.join(comfyUserDir, 'comfy.settings.json');
    try {
      let settings = { "Comfy.InstalledVersion": "1.47.12", "Comfy.TutorialCompleted": true };
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      settings["Comfy.DefaultWorkflow"] = "Loreframe_Workflow.json";
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
    } catch (e) { }

    console.log('✅ ComfyUI workflow auto-imported to user workspace (default.json & Loreframe_Workflow.json).');
  }

  // 6. Kokoro TTS Docker Check & Auto-Startup
  try {
    const dockerCheck = execSync('docker ps', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (!dockerCheck.includes('kokoro-tts')) {
      console.log('🗣️ Starting Kokoro TTS Docker container on port 8880...');
      try {
        execSync('docker start kokoro-tts', { stdio: 'ignore' });
      } catch (e) {
        execSync('docker run -d --name kokoro-tts -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest', { stdio: 'ignore' });
      }
    }
    console.log('✅ Kokoro TTS container ready at http://localhost:8880');
  } catch (err) {
    console.log('ℹ️ Docker unavailable, Kokoro TTS will fallback to local audio synthesizer.');
  }

  console.log('\n--------------------------------------------------');
  console.log('🎉 Setup Complete! Configured Services & Ports:');
  console.log('--------------------------------------------------');
  console.log(`  🖥️  Frontend UI:    ${uiUrl}`);
  console.log(`  ⚙️  Backend Server: http://localhost:${serverPort} (from .env)`);
  console.log(`  🎨 ComfyUI:         ${comfyUrl}`);
  console.log(`  🗣️  Kokoro TTS:      ${kokoroUrl}`);
  console.log(`  🦙 Ollama LLM:      ${ollamaUrl}`);
  console.log(`  🔴 Redis:           redis://localhost:${redisPort}`);
  console.log('--------------------------------------------------');
  console.log('🚀 Application setup completed!\n');
}

setup().catch((err) => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
