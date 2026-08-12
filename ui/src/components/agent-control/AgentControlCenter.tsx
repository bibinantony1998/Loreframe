'use client';

import React from 'react';
import { useAgentWorkflow } from '../../lib/wsClient';
import AgentNodeGraph from './AgentNodeGraph';
import TerminalLogFeed from './TerminalLogFeed';
import AssetPreviewStream from './AssetPreviewStream';
import {
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
  Cpu,
  Layers,
  Terminal,
  Clock,
  Sparkles,
} from 'lucide-react';

interface AgentControlCenterProps {
  jobId?: string | null;
}

export default function AgentControlCenter({ jobId = null }: AgentControlCenterProps) {
  const {
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
    reconnect,
  } = useAgentWorkflow(jobId);

  const displayJobId = jobId || activeJobId;

  return (
    <div className="w-full space-y-5">
      {/* Control Center Status Header */}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/30 via-orange-500/30 to-yellow-500/30 rounded-3xl blur opacity-30 animate-pulse"></div>

        <div className="relative rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20">
                <Cpu className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
                    Agent Workflow Control Center
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold">
                    v1.0 Live
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time WebSocket telemetry for Loreframe-server multi-agent pipeline
                </p>
              </div>
            </div>

            {/* Connection Status Badge */}
            <div className="flex items-center gap-3">
              {isConnected ? (
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                  <Wifi className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span>WS Connected</span>
                </div>
              ) : (
                <button
                  onClick={reconnect}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition"
                >
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span>Disconnected (Click to Reconnect)</span>
                </button>
              )}
            </div>
          </div>

          {/* Sub-header info bar */}
          <div className="pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Active Job ID:{' '}
                <span className="text-slate-200 font-bold">
                  {displayJobId ? `${displayJobId.slice(0, 12)}...` : 'None (Standing by)'}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Active Chapter:{' '}
                <span className="text-slate-200 font-bold">
                  {activeChapter !== undefined ? `Ch. ${activeChapter}` : 'N/A'}
                </span>
                {totalChapters ? ` / ${totalChapters}` : ''}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Discovered Assets:{' '}
                <span className="text-slate-200 font-bold">{assets.length} items</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Node Graph Matrix */}
      <AgentNodeGraph
        activeAgent={activeAgent}
        nodeStatuses={nodeStatuses}
        currentTask={currentTask}
        progressPercentage={progressPercentage}
      />

      {/* Main Grid: Terminal Feed & Full Width Asset Stream */}
      <div className="space-y-5">

        {/* Live Asset Stream Panel - Full Width */}
        <div className="w-full">
          <AssetPreviewStream assets={assets} />
        </div>

        {/* Terminal Log Panel */}
        <div className="h-[380px]">
          <TerminalLogFeed logs={logs} onClearLogs={clearLogs} />
        </div>
      </div>
    </div>
  );
}
