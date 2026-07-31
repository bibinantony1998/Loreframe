import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface AgentStatusEvent {
  jobId: string;
  activeAgent:
    | 'ResearchAgent'
    | 'ContentBuilderAgent'
    | 'DBPersistNode'
    | 'ScriptWriterAgent'
    | 'TTSAgent'
    | 'ImagePrompterAgent'
    | 'ImageGeneratorAgent'
    | 'VideoAssemblerAgent'
    | 'SupervisorLoop';
  currentTask: string;
  chapterIndex?: number;
  totalChapters?: number;
  progressPercentage: number;
  status: 'running' | 'waiting' | 'completed' | 'error';
  timestamp?: string;
  assetUrl?: string;
  assetType?: 'image' | 'audio' | 'video';
  logMessage?: string;
}

let wss: WebSocketServer | null = null;
const connectedClients = new Set<WebSocket>();

export function initWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WebSocket] UI Client connected to real-time status stream.');
    connectedClients.add(ws);

    ws.on('close', () => {
      connectedClients.delete(ws);
      console.log('[WebSocket] UI Client disconnected.');
    });

    ws.on('error', (err) => {
      console.warn('[WebSocket] Client socket error:', err.message);
      connectedClients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Loreframe Real-Time Status Stream Active' }));
  });

  console.log('[WebSocket] Server initialized on path /ws');
  return wss;
}

export function broadcastAgentStatus(event: AgentStatusEvent): void {
  const payload = JSON.stringify({
    type: 'AGENT_STATUS_UPDATE',
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });

  console.log(
    `[WebSocket Broadcast] [${event.activeAgent}] (${event.progressPercentage}%) - ${event.currentTask}`
  );

  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn('[WebSocket Broadcast] Error sending payload to client:', (err as Error).message);
      }
    }
  }
}

export function closeWebSocketServer(): void {
  if (wss) {
    for (const client of connectedClients) {
      try {
        client.close();
      } catch (e) {}
    }
    connectedClients.clear();
    wss.close();
    console.log('[WebSocket] Server closed cleanly.');
    wss = null;
  }
}
