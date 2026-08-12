'use client';

import React, { useState, useRef, useEffect } from 'react';
import HeroForm from '../components/HeroForm';
import ProgressTracker from '../components/ProgressTracker';
import VideoResult from '../components/VideoResult';
import AgentControlCenter from '../components/agent-control/AgentControlCenter';
import { startVideoGeneration } from '../lib/api';
import { JobStatusResponse } from '../types/api';
import { Film, Cpu, Layout, Columns, Sparkles, GripVertical } from 'lucide-react';

type AppState = 'IDLE' | 'GENERATING' | 'COMPLETED';
type ViewMode = 'SPLIT' | 'STUDIO' | 'CONTROL';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  // Side-by-Side (SPLIT) is default
  const [viewMode, setViewMode] = useState<ViewMode>('SPLIT');
  const [topic, setTopic] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [jobId, setJobId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [jobData, setJobData] = useState<JobStatusResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Interactive Resizer State (Split ratio % for Left Panel)
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic vertical mouse hover position along the resizer divider track
  const [handleY, setHandleY] = useState<number | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleStartGeneration = async (selectedTopic: string, selectedDuration: number) => {
    setIsSubmitting(true);
    setApiError(null);
    setTopic(selectedTopic);
    setDurationMinutes(selectedDuration);

    try {
      const response = await startVideoGeneration(selectedTopic, selectedDuration);
      setJobId(response.jobId);
      setAppState('GENERATING');
    } catch (err) {
      console.error('Start generation error:', err);
      setApiError((err as Error).message || 'Failed to submit documentary generation request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJobComplete = (completedVideoUrl: string, statusResponse: JobStatusResponse) => {
    setVideoUrl(completedVideoUrl);
    setJobData(statusResponse);
    setAppState('COMPLETED');
  };

  const handleJobError = (errorMessage: string) => {
    setApiError(errorMessage);
  };

  const handleReset = () => {
    setAppState('IDLE');
    setTopic('');
    setDurationMinutes(5);
    setJobId(null);
    setVideoUrl(null);
    setJobData(null);
    setApiError(null);
  };

  // Mouse drag handler for split view resizer
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDividerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dividerRef.current) return;
    const rect = dividerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    // Keep handle knob within vertical bounds of the track
    setHandleY(Math.max(40, Math.min(rect.height - 40, y)));
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      // Restrict split width between 20% and 75%
      const newRatio = Math.max(20, Math.min(75, (offsetX / rect.width) * 100));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950">
      {/* Navigation Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1850px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div
            onClick={handleReset}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-slate-950 shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">
                Loreframe AI
              </span>
              <span className="block text-[10px] uppercase font-bold tracking-widest text-amber-500">
                Multi-Agent Studio
              </span>
            </div>
          </div>

          {/* View Switcher Tabs */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setViewMode('SPLIT')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition ${viewMode === 'SPLIT'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>

            <button
              onClick={() => setViewMode('STUDIO')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition ${viewMode === 'STUDIO'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Layout className="w-3.5 h-3.5" />
              <span>Studio</span>
            </button>

            <button
              onClick={() => setViewMode('CONTROL')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition ${viewMode === 'CONTROL'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Control Center</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Backend API & WS Active
            </span>
          </div>
        </div>
      </header>

      {/* Main App Content View */}
      <main className="flex-1 p-4 sm:p-6">
        <div
          ref={containerRef}
          className={`w-full max-w-[1850px] mx-auto py-2 ${viewMode === 'SPLIT'
            ? 'flex flex-col lg:flex-row items-start gap-2 lg:gap-4 relative'
            : 'block'
            }`}
        >
          {/* Studio Panel Component Wrapper */}
          <div
            style={
              viewMode === 'SPLIT'
                ? { width: `${splitRatio}%` }
                : undefined
            }
            className={`${viewMode === 'CONTROL'
              ? 'hidden'
              : viewMode === 'SPLIT'
                ? 'w-full space-y-4 bg-slate-900/40 p-4 sm:p-5 rounded-3xl border border-slate-800/80 shrink-0'
                : 'max-w-3xl mx-auto flex items-center justify-center min-h-[calc(100vh-180px)]'
              }`}
          >
            <div className="w-full space-y-4">
              {viewMode === 'SPLIT' && (
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Studio Workflow
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    Left Panel ({Math.round(splitRatio)}%)
                  </span>
                </div>
              )}

              {appState === 'IDLE' && (
                <HeroForm
                  onSubmit={handleStartGeneration}
                  isLoading={isSubmitting}
                  error={apiError}
                />
              )}

              {appState === 'GENERATING' && jobId && (
                <ProgressTracker
                  jobId={jobId}
                  topic={topic}
                  targetDuration={durationMinutes}
                  onComplete={handleJobComplete}
                  onError={handleJobError}
                  onReset={handleReset}
                />
              )}

              {appState === 'COMPLETED' && videoUrl && (
                <VideoResult
                  videoUrl={videoUrl}
                  topic={topic}
                  jobData={jobData}
                  onGenerateAnother={handleReset}
                />
              )}
            </div>
          </div>

          {/* Interactive Drag Resizer Divider with Mouse-Following Handle Knob */}
          {viewMode === 'SPLIT' && (
            <div
              ref={dividerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleDividerMouseMove}
              title="Click & drag to adjust panel widths"
              className="hidden lg:flex relative items-center justify-center w-4 self-stretch cursor-col-resize select-none shrink-0 group py-2"
            >
              {/* Full Height Vertical Track Line */}
              <div
                className={`w-1 h-full rounded-full transition-colors ${isDragging ? 'bg-amber-400' : 'bg-slate-800 group-hover:bg-amber-500/50'
                  }`}
              />

              {/* Dynamic Drag Handle Knob - Follows mouse hover position along the track */}
              <div
                className={`absolute w-4 h-16 rounded-full flex items-center justify-center shadow-xl transition-all duration-75 -translate-y-1/2 ${isDragging
                  ? 'bg-amber-400 text-slate-950 scale-110 shadow-amber-500/50 ring-2 ring-amber-400/50'
                  : 'bg-slate-900 border border-slate-700 text-slate-300 group-hover:border-amber-500 group-hover:text-amber-400 group-hover:scale-105'
                  }`}
                style={{
                  top: handleY !== null ? `${handleY}px` : '180px',
                }}
              >
                <GripVertical className="w-3.5 h-3.5 shrink-0" />
              </div>
            </div>
          )}

          {/* Agent Control Center Telemetry Component Wrapper */}
          <div
            style={
              viewMode === 'SPLIT'
                ? { width: `calc(${100 - splitRatio}% - 16px)` }
                : undefined
            }
            className={`${viewMode === 'STUDIO'
              ? 'hidden'
              : viewMode === 'SPLIT'
                ? 'w-full space-y-4 shrink-0'
                : 'w-full max-w-[1850px] mx-auto'
              } pr-4`}
          >
            {viewMode === 'SPLIT' && (
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Real-Time Companion Telemetry
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Right Panel ({Math.round(100 - splitRatio)}%)
                </span>
              </div>
            )}
            <AgentControlCenter jobId={jobId} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Loreframe AI. Multi-Agent Swarm Companion UI.</p>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">WebSocket /ws • LangGraph • BullMQ • Express • FFmpeg</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
