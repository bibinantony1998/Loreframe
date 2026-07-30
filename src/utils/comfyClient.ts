import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import { sleep } from './rateLimiter';
import { getShutdownSignal, isShuttingDown } from './shutdownManager';

export async function generateComfyImage(
  promptText: string,
  outputFilename: string
): Promise<string> {
  const comfyUrl = config.comfyuiBaseUrl.replace(/\/$/, '');
  console.log(`[ComfyUI Client] Initiating local image generation via ${comfyUrl}...`);

  // 1. Read workflow JSON template
  const workflowPath = path.join(
    process.cwd(),
    'src',
    'workflows',
    'comfy_image_workflow.json'
  );

  if (!fs.existsSync(workflowPath)) {
    throw new Error(`ComfyUI workflow file missing at ${workflowPath}`);
  }

  const rawJson = fs.readFileSync(workflowPath, 'utf-8');
  const promptWorkflow = JSON.parse(rawJson);

  // 2. Inject positive prompt text, randomize KSampler seed & auto-detect installed checkpoint
  let positiveNodeFound = false;
  const installedCheckpoints = await getInstalledComfyCheckpoints(comfyUrl);

  for (const nodeId of Object.keys(promptWorkflow)) {
    const node = promptWorkflow[nodeId];
    if (node.class_type === 'CLIPTextEncode') {
      const title = node._meta?.title?.toLowerCase() || '';
      // Inject prompt into positive node (node 6 or title containing positive/not negative)
      if (!title.includes('negative') || nodeId === '6') {
        node.inputs.text = promptText;
        positiveNodeFound = true;
      }
    } else if (node.class_type === 'KSampler') {
      // Randomize seed
      node.inputs.seed = Math.floor(Math.random() * 1000000000000);
    } else if (node.class_type === 'CheckpointLoaderSimple' && installedCheckpoints.length > 0) {
      // Check if current ckpt_name is valid on local ComfyUI server
      const currentCkpt = node.inputs?.ckpt_name;
      if (!currentCkpt || !installedCheckpoints.includes(currentCkpt)) {
        console.log(
          `[ComfyUI Client] Auto-selecting installed checkpoint model: "${installedCheckpoints[0]}" (replacing "${currentCkpt || 'none'}")...`
        );
        node.inputs.ckpt_name = installedCheckpoints[0];
      }
    }
  }

  if (!positiveNodeFound) {
    // Fallback: search for first CLIPTextEncode node
    for (const nodeId of Object.keys(promptWorkflow)) {
      if (promptWorkflow[nodeId].class_type === 'CLIPTextEncode') {
        promptWorkflow[nodeId].inputs.text = promptText;
        break;
      }
    }
  }

  // 3. Queue prompt to ComfyUI REST API
  const promptEndpoint = `${comfyUrl}/prompt`;
  let response: Response;

  try {
    response = await fetch(promptEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: getShutdownSignal(),
      body: JSON.stringify({ prompt: promptWorkflow }),
    });
  } catch (netErr) {
    throw new Error(
      `Failed to connect to ComfyUI at ${comfyUrl}. Ensure ComfyUI server is running. Error: ${
        (netErr as Error).message
      }`
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ComfyUI /prompt returned HTTP ${response.status}: ${errorText}`);
  }

  const promptResult = (await response.json()) as {
    prompt_id: string;
    number: number;
    node_errors?: Record<string, unknown>;
  };

  const promptId = promptResult.prompt_id;
  if (!promptId) {
    throw new Error(`ComfyUI /prompt response missing prompt_id.`);
  }

  console.log(`[ComfyUI Client] Queued prompt with prompt_id: ${promptId}. Polling execution status...`);

  // 4. Poll /history/:prompt_id until completed (max 120s)
  const historyUrl = `${comfyUrl}/history/${promptId}`;
  const maxAttempts = 60;
  let outputImageMeta: { filename: string; subfolder: string; type: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isShuttingDown()) {
      throw new Error('ComfyUI generation cancelled: Server process is shutting down.');
    }
    await sleep(2000);

    try {
      const historyRes = await fetch(historyUrl, { signal: getShutdownSignal() });
      if (historyRes.ok) {
        const historyData = (await historyRes.json()) as Record<string, any>;
        const jobHistory = historyData[promptId];

        if (jobHistory && jobHistory.outputs) {
          // Extract output images from SaveImage node
          for (const nodeId of Object.keys(jobHistory.outputs)) {
            const nodeOutput = jobHistory.outputs[nodeId];
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              outputImageMeta = nodeOutput.images[0];
              break;
            }
          }

          if (outputImageMeta) {
            console.log(
              `[ComfyUI Client] Generation completed! Output image: ${outputImageMeta.filename}`
            );
            break;
          }
        }
      }
    } catch (e) {
      // transient network error during polling, continue loop
    }
  }

  if (!outputImageMeta) {
    throw new Error(`ComfyUI execution timed out or produced no output image for prompt_id: ${promptId}`);
  }

  // 5. Download resulting image from /view
  const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(
    outputImageMeta.filename
  )}&subfolder=${encodeURIComponent(
    outputImageMeta.subfolder || ''
  )}&type=${encodeURIComponent(outputImageMeta.type || 'output')}`;

  console.log(`[ComfyUI Client] Downloading generated image from ${viewUrl}...`);
  const imageRes = await fetch(viewUrl);

  if (!imageRes.ok) {
    throw new Error(`Failed to download ComfyUI image asset from ${viewUrl}`);
  }

  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  // 6. Save image to /public/images/
  const imagesDir = path.join(process.cwd(), 'public', 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const localFilePath = path.join(imagesDir, outputFilename);
  fs.writeFileSync(localFilePath, imageBuffer);

  const relativeUrl = `/public/images/${outputFilename}`;
  console.log(`[ComfyUI Client] Saved local image asset to ${localFilePath} (${relativeUrl})`);

  return relativeUrl;
}

async function getInstalledComfyCheckpoints(comfyUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`);
    if (!res.ok) return [];
    const info = (await res.json()) as Record<string, any>;
    const ckptConfig = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
    if (Array.isArray(ckptConfig) && Array.isArray(ckptConfig[0])) {
      return ckptConfig[0] as string[];
    }
  } catch (e) {
    // ignore error, return empty array fallback
  }
  return [];
}
