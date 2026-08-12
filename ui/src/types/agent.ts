export type AgentNodeId =
  | 'ResearchAgent'
  | 'ContentBuilderAgent'
  | 'DBPersistNode'
  | 'ScriptWriterAgent'
  | 'TTSAgent'
  | 'ImagePrompterAgent'
  | 'ImageGeneratorAgent'
  | 'VideoAssemblerAgent'
  | 'SupervisorLoop';

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'error';

export interface AgentStatusUpdateEvent {
  type?: 'AGENT_STATUS_UPDATE' | 'CONNECTED';
  jobId?: string;
  activeAgent?: AgentNodeId;
  currentTask?: string;
  chapterIndex?: number;
  totalChapters?: number;
  progressPercentage?: number;
  status?: 'running' | 'waiting' | 'completed' | 'error';
  timestamp?: string;
  assetUrl?: string;
  assetType?: 'image' | 'audio' | 'video';
  logMessage?: string;
}

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  agent: AgentNodeId | 'System';
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
  chapterIndex?: number;
}

export interface AssetItem {
  id: string;
  type: 'image' | 'audio' | 'video';
  url: string;
  title: string;
  chapterIndex?: number;
  timestamp: string;
}

export interface AgentNodeInfo {
  id: AgentNodeId;
  label: string;
  shortName: string;
  description: string;
  category: 'planning' | 'writing' | 'media' | 'assembly';
  icon: string;
  status: AgentStatus;
  currentTask?: string;
  lastUpdated?: string;
}
