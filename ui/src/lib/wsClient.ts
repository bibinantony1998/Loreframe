'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  AgentNodeId,
  AgentStatus,
  AgentStatusUpdateEvent,
  TerminalLogEntry,
  AssetItem,
} from '../types/agent';
import { pollVideoStatus } from './api';

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

const INITIAL_NODE_STATUSES: Record<AgentNodeId, AgentStatus> = {
  ResearchAgent: 'idle',
  ContentBuilderAgent: 'idle',
  DBPersistNode: 'idle',
  ScriptWriterAgent: 'idle',
  TTSAgent: 'idle',
  ImagePrompterAgent: 'idle',
  ImageGeneratorAgent: 'idle',
  VideoAssemblerAgent: 'idle',
  SupervisorLoop: 'idle',
};

export interface UseAgentWorkflowReturn {
  isConnected: boolean;
  activeJobId: string | null;
  activeAgent: AgentNodeId | null;
  currentTask: string;
  activeChapter?: number;
  totalChapters?: number;
  progressPercentage: number;
  logs: TerminalLogEntry[];
  assets: AssetItem[];
  nodeStatuses: Record<AgentNodeId, AgentStatus>;
  clearLogs: () => void;
  setActiveJobId: (jobId: string | null) => void;
  reconnect: () => void;
}

export function useAgentWorkflow(
  initialJobId: string | null = null
): UseAgentWorkflowReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [activeJobId, setActiveJobIdState] = useState<string | null>(initialJobId);
  const [activeAgent, setActiveAgent] = useState<AgentNodeId | null>(null);
  const [currentTask, setCurrentTask] = useState<string>('Standing by for agent workflow initialization...');
  const [activeChapter, setActiveChapter] = useState<number | undefined>(undefined);
  const [totalChapters, setTotalChapters] = useState<number | undefined>(undefined);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);

  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [nodeStatuses, setNodeStatuses] = useState<Record<AgentNodeId, AgentStatus>>(
    INITIAL_NODE_STATUSES
  );

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);

  const addLog = useCallback(
    (
      message: string,
      agent: AgentNodeId | 'System' = 'System',
      level: 'info' | 'success' | 'warn' | 'error' = 'info',
      chapterIndex?: number
    ) => {
      const newEntry: TerminalLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        agent,
        message,
        level,
        chapterIndex,
      };
      setLogs((prev) => [...prev.slice(-499), newEntry]); // keep up to 500 logs
    },
    []
  );

  const addAsset = useCallback(
    (type: 'image' | 'audio' | 'video', url: string, title: string, chapterIndex?: number) => {
      setAssets((prev) => {
        // Prevent duplicate assets with same URL
        if (prev.some((a) => a.url === url)) return prev;
        const newAsset: AssetItem = {
          id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type,
          url,
          title,
          chapterIndex,
          timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        return [newAsset, ...prev];
      });
    },
    []
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const setActiveJobId = useCallback((jobId: string | null) => {
    setActiveJobIdState(jobId);
    if (jobId) {
      // Reset status indicators for new job
      setActiveAgent('ResearchAgent');
      setProgressPercentage(5);
      setCurrentTask(`Starting job: ${jobId}`);
      setNodeStatuses({
        ...INITIAL_NODE_STATUSES,
        ResearchAgent: 'running',
      });
    }
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const wsUrl = DEFAULT_WS_URL;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        retryCountRef.current = 0;
        addLog('Connected to Loreframe Server Agent WebSocket Stream (/ws)', 'System', 'success');
      };

      ws.onmessage = (event) => {
        try {
          const data: AgentStatusUpdateEvent = JSON.parse(event.data);

          if (data.type === 'CONNECTED') {
            addLog(data.logMessage || 'Live status channel connected.', 'System', 'info');
            return;
          }

          if (data.type === 'AGENT_STATUS_UPDATE' || data.activeAgent) {
            const agentId = data.activeAgent;
            if (!agentId) return;

            // Filter out events if activeJobId is specified and doesn't match
            if (activeJobId && data.jobId && data.jobId !== activeJobId) {
              return;
            }

            if (!activeJobId && data.jobId) {
              setActiveJobIdState(data.jobId);
            }

            setActiveAgent(agentId);
            if (data.currentTask) setCurrentTask(data.currentTask);
            if (data.chapterIndex !== undefined) setActiveChapter(data.chapterIndex);
            if (data.totalChapters !== undefined) setTotalChapters(data.totalChapters);
            if (data.progressPercentage !== undefined) setProgressPercentage(data.progressPercentage);

            // Update Node States
            setNodeStatuses((prev) => {
              const updated = { ...prev };
              if (data.status === 'running') {
                updated[agentId] = 'running';
              } else if (data.status === 'completed') {
                updated[agentId] = 'completed';
              } else if (data.status === 'error') {
                updated[agentId] = 'error';
              }
              return updated;
            });

            // Log entry
            const logLevel =
              data.status === 'error'
                ? 'error'
                : data.status === 'completed'
                ? 'success'
                : 'info';

            const logText = data.logMessage || data.currentTask || `Agent ${agentId} updated status to ${data.status}`;
            addLog(logText, agentId, logLevel, data.chapterIndex);

            // Asset discovery
            if (data.assetUrl && data.assetType) {
              const fullUrl = data.assetUrl.startsWith('http')
                ? data.assetUrl
                : `http://localhost:3001${data.assetUrl}`;

              const assetTitle =
                data.assetType === 'video'
                  ? 'Final Documentary Video'
                  : data.assetType === 'audio'
                  ? `Voiceover - Chapter ${data.chapterIndex ?? 'Clip'}`
                  : `16:9 Visual Asset - Chapter ${data.chapterIndex ?? 'Scene'}`;

              addAsset(data.assetType, fullUrl, assetTitle, data.chapterIndex);
            }
          }
        } catch (err) {
          console.warn('[wsClient] Error parsing WebSocket frame:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        socketRef.current = null;

        // Exponential backoff reconnect
        const nextDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
        retryCountRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, nextDelay);
      };

      ws.onerror = (err) => {
        console.warn('[wsClient] WebSocket error:', err);
        setIsConnected(false);
      };
    } catch (err) {
      console.error('[wsClient] Socket initialization failed:', err);
      setIsConnected(false);
    }
  }, [addLog, addAsset, activeJobId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  // Polling fallback sync for media assets when a job is active
  useEffect(() => {
    if (!activeJobId) return;

    let timer: NodeJS.Timeout;
    const syncAssetsFromJob = async () => {
      try {
        const res = await pollVideoStatus(activeJobId);
        if (res.segments) {
          res.segments.forEach((seg) => {
            if (seg.audioUrl) {
              const fullAudioUrl = seg.audioUrl.startsWith('http')
                ? seg.audioUrl
                : `http://localhost:3001${seg.audioUrl}`;
              addAsset('audio', fullAudioUrl, `Audio - ${seg.title || 'Chapter ' + (seg.sequenceIndex + 1)}`, seg.sequenceIndex + 1);
            }
            if (seg.imageUrl) {
              let imgUrls: string[] = [];
              try {
                const parsed = JSON.parse(seg.imageUrl);
                if (Array.isArray(parsed)) imgUrls = parsed;
                else imgUrls = [seg.imageUrl];
              } catch {
                imgUrls = [seg.imageUrl];
              }
              imgUrls.forEach((img) => {
                const fullImgUrl = img.startsWith('http') ? img : `http://localhost:3001${img}`;
                addAsset('image', fullImgUrl, `Visual - ${seg.title || 'Chapter ' + (seg.sequenceIndex + 1)}`, seg.sequenceIndex + 1);
              });
            }
          });
        }

        if (res.videoUrl) {
          const fullVideoUrl = res.videoUrl.startsWith('http')
            ? res.videoUrl
            : `http://localhost:3001${res.videoUrl}`;
          addAsset('video', fullVideoUrl, 'Final Documentary Video');
          setNodeStatuses((prev) => ({ ...prev, VideoAssemblerAgent: 'completed' }));
          setProgressPercentage(100);
        }
      } catch (e) {
        // ignore polling errors
      }
    };

    syncAssetsFromJob();
    timer = setInterval(syncAssetsFromJob, 4000);

    return () => clearInterval(timer);
  }, [activeJobId, addAsset]);

  return {
    isConnected,
    activeJobId,
    activeAgent,
    currentTask,
    activeChapter,
    totalChapters,
    progressPercentage,
    logs,
    assets,
    nodeStatuses,
    clearLogs,
    setActiveJobId,
    reconnect: connect,
  };
}
