'use client';

import React from 'react';
import { AgentNodeId, AgentStatus } from '../../types/agent';
import {
  Search,
  BookOpen,
  FileText,
  Volume2,
  Image as ImageIcon,
  Film,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface AgentNodeGraphProps {
  activeAgent: AgentNodeId | null;
  nodeStatuses: Record<AgentNodeId, AgentStatus>;
  currentTask: string;
  progressPercentage: number;
}

interface NodeDefinition {
  id: AgentNodeId;
  label: string;
  category: string;
  description: string;
  icon: React.ElementType;
}

const AGENT_NODES: NodeDefinition[] = [
  {
    id: 'ResearchAgent',
    label: 'Research Agent',
    category: 'Information & Context',
    description: 'Retrieves historical facts & structured context from LLM / Web',
    icon: Search,
  },
  {
    id: 'ContentBuilderAgent',
    label: 'Chapter Planner',
    category: 'Story Architecture',
    description: 'Structures narrative arc into sequential historical chapters',
    icon: BookOpen,
  },
  {
    id: 'ScriptWriterAgent',
    label: 'Script Writer',
    category: 'Voice Narration',
    description: 'Drafts detailed narration script per chapter with timing cues',
    icon: FileText,
  },
  {
    id: 'TTSAgent',
    label: 'TTS Engine',
    category: 'Audio Synthesis',
    description: 'Synthesizes voiceover narration via Kokoro / Google Cloud TTS',
    icon: Volume2,
  },
  {
    id: 'ImageGeneratorAgent',
    label: 'ComfyUI Generator',
    category: 'Visual Rendering',
    description: 'Renders 16:9 high-res historical scene visuals via ComfyUI SDXL',
    icon: ImageIcon,
  },
  {
    id: 'VideoAssemblerAgent',
    label: 'Video Assembler',
    category: 'FFmpeg Production',
    description: 'Stitches continuous audio and image sequences into final MP4',
    icon: Film,
  },
];

export default function AgentNodeGraph({
  activeAgent,
  nodeStatuses,
  currentTask,
  progressPercentage,
}: AgentNodeGraphProps) {
  return (
    <div className="w-full rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-5 shadow-2xl space-y-6">
      {/* Header & Status Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Sparkles className="w-4 h-4" />
            </span>
            <h3 className="text-lg font-bold text-slate-100 tracking-tight">
              Agent Swarm Flow Matrix
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time topology & node state monitor for Loreframe-server agents
          </p>
        </div>

        {/* Global Progress pill */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Overall Pipeline
            </span>
            <span className="text-sm font-extrabold text-amber-400 font-mono">
              {progressPercentage}%
            </span>
          </div>
          <div className="w-24 h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Node Graph Matrix Grid */}
      <div
        className="grid gap-3.5 relative"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {AGENT_NODES.map((node, index) => {
          const Icon = node.icon;
          const status = nodeStatuses[node.id] || 'idle';
          const isActive = activeAgent === node.id || (node.id === 'ContentBuilderAgent' && activeAgent === 'DBPersistNode');

          return (
            <div
              key={node.id}
              className={`relative group rounded-xl p-3.5 border transition-all duration-300 min-w-[220px] ${
                isActive
                  ? 'bg-slate-950 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30'
                  : status === 'completed'
                  ? 'bg-slate-950/60 border-emerald-500/30 text-slate-200'
                  : status === 'error'
                  ? 'bg-slate-950/60 border-red-500/40 text-slate-200'
                  : 'bg-slate-950/30 border-slate-800/60 opacity-75 hover:opacity-100 hover:border-slate-700'
              }`}
            >
              {/* Active Node Ambient Pulse Glow */}
              {isActive && (
                <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-30 blur animate-pulse"></div>
              )}

              <div className="relative z-10 space-y-2.5 min-w-0">
                {/* Node Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 shadow-md shadow-amber-500/30'
                          : status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : status === 'error'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-slate-900 border border-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'animate-bounce' : ''}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-slate-100 truncate">
                        {node.label}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className="font-mono">#{index + 1}</span>
                        <span>•</span>
                        <span className="truncate">{node.category}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="shrink-0">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold tracking-wide animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                        ACTIVE
                      </span>
                    ) : status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        DONE
                      </span>
                    ) : status === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-semibold">
                        <AlertCircle className="w-3 h-3 text-red-400" />
                        ERROR
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-semibold">
                        <Clock className="w-3 h-3 text-slate-400" />
                        IDLE
                      </span>
                    )}
                  </div>
                </div>

                {/* Node Description */}
                <p className="text-xs text-slate-400 leading-relaxed font-sans line-clamp-2">
                  {node.description}
                </p>

                {/* Active Task Snippet if processing */}
                {isActive && (
                  <div className="pt-2 border-t border-amber-500/20 text-[11px] font-mono text-amber-300/90 truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                    {currentTask}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
