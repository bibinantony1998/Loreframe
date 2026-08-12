'use client';

import React, { useState, useRef, useEffect } from 'react';
import { TerminalLogEntry } from '../../types/agent';
import {
  Terminal,
  Search,
  Trash2,
  Copy,
  ArrowDownCircle,
  Check,
  Filter,
} from 'lucide-react';

interface TerminalLogFeedProps {
  logs: TerminalLogEntry[];
  onClearLogs: () => void;
}

export default function TerminalLogFeed({
  logs,
  onClearLogs,
}: TerminalLogFeedProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      searchTerm === '' ||
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.agent.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesLevel =
      selectedLevel === 'all' || log.level === selectedLevel;

    return matchesSearch && matchesLevel;
  });

  const handleCopy = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.agent}] [${l.level.toUpperCase()}]: ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full h-full rounded-2xl bg-slate-950 border border-slate-800 flex flex-col shadow-2xl overflow-hidden">
      {/* Terminal Control Bar */}
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-yellow-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500/80"></span>
          </div>
          <div className="h-4 w-px bg-slate-800 mx-1"></div>
          <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-300">
            <Terminal className="w-4 h-4 text-amber-400" />
            <span>Loreframe Agent Terminal Feed</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
            {filteredLogs.length} events
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-2 py-1 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 w-32 sm:w-40 font-mono"
            />
          </div>

          {/* Level Filter */}
          <div className="relative flex items-center">
            <Filter className="w-3.5 h-3.5 text-slate-500 absolute left-2" />
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="pl-6 pr-2 py-1 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50 font-mono"
            >
              <option value="all">All Levels</option>
              <option value="info">INFO</option>
              <option value="success">SUCCESS</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
          </div>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll paused'}
            className={`p-1.5 rounded-lg border transition ${
              autoScroll
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            <ArrowDownCircle className="w-4 h-4" />
          </button>

          {/* Copy Logs */}
          <button
            onClick={handleCopy}
            title="Copy logs to clipboard"
            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Clear Logs */}
          <button
            onClick={onClearLogs}
            title="Clear terminal stream"
            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-red-400 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Text Scroll Window */}
      <div
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-2 min-h-[300px] max-h-[500px] selection:bg-amber-500 selection:text-slate-950"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 py-12">
            <Terminal className="w-8 h-8 mb-2 stroke-[1.5]" />
            <p>No agent log output captured yet.</p>
            <p className="text-[11px] mt-1 text-slate-600">
              Start a documentary generation job to stream agent reasoning.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const levelColors = {
              info: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
              success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
              warn: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
              error: 'text-red-400 bg-red-500/10 border-red-500/20',
            };

            return (
              <div
                key={log.id}
                className="flex items-start gap-2 leading-relaxed hover:bg-slate-900/50 p-1 rounded transition-colors group"
              >
                <span className="text-slate-400 shrink-0 text-[11px]">
                  [{log.timestamp}]
                </span>

                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold shrink-0 border ${
                    levelColors[log.level] || levelColors.info
                  }`}
                >
                  {log.agent}
                </span>

                {log.chapterIndex !== undefined && (
                  <span className="px-1 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px] shrink-0 border border-slate-800">
                    Ch.{log.chapterIndex}
                  </span>
                )}

                <span className="text-slate-300 break-words flex-1">
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
