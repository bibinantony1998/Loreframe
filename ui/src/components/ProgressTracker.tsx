'use client';

import React, { useEffect, useState } from 'react';
import { pollVideoStatus } from '../lib/api';
import { JobStatusResponse, VideoJobStatus } from '../types/api';
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  AlertTriangle, 
  FileText, 
  Edit3, 
  Volume2, 
  Image as ImageIcon, 
  Video, 
  RefreshCw,
  Sparkles
} from 'lucide-react';

interface ProgressTrackerProps {
  jobId: string;
  topic: string;
  targetDuration: number;
  onComplete: (videoUrl: string, statusResponse: JobStatusResponse) => void;
  onError: (errorMessage: string) => void;
  onReset: () => void;
}

interface ProgressStep {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

const PIPELINE_STEPS: ProgressStep[] = [
  {
    id: 'outline',
    label: 'Outline Generated',
    description: 'Structure and chapter overview designed by Director Agent',
    icon: FileText,
  },
  {
    id: 'script',
    label: 'Script Written',
    description: 'Historical narrative written and segmented by Writer Agent',
    icon: Edit3,
  },
  {
    id: 'audio',
    label: 'Audio Generated',
    description: 'Voiceover narration synthesized via Google Cloud TTS',
    icon: Volume2,
  },
  {
    id: 'images',
    label: 'Images Rendered',
    description: 'Historical visuals & scene assets generated for each segment',
    icon: ImageIcon,
  },
  {
    id: 'video',
    label: 'Video Assembled',
    description: 'Final documentary compiled with FFmpeg & stitched together',
    icon: Video,
  },
];

export default function ProgressTracker({
  jobId,
  topic,
  targetDuration,
  onComplete,
  onError,
  onReset,
}: ProgressTrackerProps) {
  const [jobData, setJobData] = useState<JobStatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let timerId: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const data = await pollVideoStatus(jobId);
        if (!isMounted) return;

        setJobData(data);
        setPollCount((prev) => prev + 1);

        if (data.status === 'COMPLETED') {
          if (data.videoUrl) {
            onComplete(data.videoUrl, data);
          } else {
            // Fallback video URL if static route
            const fallbackUrl = `/public/outputs/${jobId}.mp4`;
            onComplete(fallbackUrl, data);
          }
          return;
        }

        if (data.status === 'FAILED') {
          const err = data.error || 'Video generation failed in pipeline.';
          setErrorMsg(err);
          onError(err);
          return;
        }

        // Schedule next poll in 5 seconds
        timerId = setTimeout(checkStatus, 5000);
      } catch (err) {
        if (!isMounted) return;
        console.error('Polling error:', err);
        // Continue polling despite temporary network glitch
        timerId = setTimeout(checkStatus, 5000);
      }
    };

    checkStatus();

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [jobId, onComplete, onError]);

  // Determine current active step index based on job status & segment progression
  const getStepProgressIndex = (): number => {
    if (!jobData) return 0;
    if (jobData.status === 'COMPLETED') return PIPELINE_STEPS.length;
    if (jobData.status === 'PENDING') return 0;

    const segments = jobData.segments || [];
    if (segments.length === 0) return 1; // Outline/Script in progress

    const hasAudio = segments.some((s) => s.audioUrl || s.status === 'AUDIO_DONE');
    const hasImage = segments.some((s) => s.imageUrl || s.status === 'IMAGE_DONE');
    const allSegmentsDone = segments.every((s) => s.status === 'COMPLETED');

    if (allSegmentsDone) return 4;
    if (hasImage) return 3;
    if (hasAudio) return 2;
    return 1;
  };

  const currentStepIndex = getStepProgressIndex();
  const progressPercent = Math.min(
    100,
    Math.round(((currentStepIndex + 0.5) / PIPELINE_STEPS.length) * 100)
  );

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/40 via-orange-500/40 to-yellow-500/40 rounded-3xl blur opacity-40 animate-pulse"></div>

        <div className="relative rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-5 sm:p-7 shadow-2xl space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-5">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-2">
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                Multi-Agent Pipeline Active
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-100 break-words">{topic}</h2>
              <p className="text-slate-400 text-xs sm:text-sm mt-1">
                Target Duration: {targetDuration} min • Job ID: <span className="font-mono text-slate-300">{jobId.slice(0, 8)}...</span>
              </p>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-400">
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              Polling #{pollCount} (5s)
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-slate-400">
              <span>Overall Progress</span>
              <span className="text-amber-400 font-bold">{progressPercent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${jobData?.status === 'COMPLETED' ? 100 : progressPercent}%` }}
              ></div>
            </div>
          </div>

          {/* Error Alert if Failed */}
          {errorMsg && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-base">
                <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
                Generation Encountered an Error
              </div>
              <p className="text-xs text-red-300">{errorMsg}</p>
              <button
                onClick={onReset}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs font-semibold transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Return to Dashboard
              </button>
            </div>
          )}

          {/* Pipeline Step Checklist */}
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Agent Execution Steps
            </h3>

            <div className="space-y-3">
              {PIPELINE_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isCompleted = idx < currentStepIndex || jobData?.status === 'COMPLETED';
                const isCurrent = idx === currentStepIndex && jobData?.status !== 'COMPLETED' && !errorMsg;

                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-4 p-4 rounded-2xl border transition-all duration-300 ${
                      isCompleted
                        ? 'bg-slate-950/60 border-slate-800/80 text-slate-200'
                        : isCurrent
                        ? 'bg-amber-500/10 border-amber-500/40 text-slate-100 shadow-md shadow-amber-500/5'
                        : 'bg-slate-950/20 border-slate-900 text-slate-500 opacity-60'
                    }`}
                  >
                    {/* Status Icon */}
                    <div className="pt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : isCurrent ? (
                        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-600" />
                      )}
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`text-base font-semibold ${isCurrent ? 'text-amber-300' : ''}`}>
                          {step.label}
                        </h4>
                        <Icon className={`w-4 h-4 ${isCurrent ? 'text-amber-400' : 'text-slate-500'}`} />
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Segment Details Breakdown (if available) */}
          {jobData?.segments && jobData.segments.length > 0 && (
            <div className="border-t border-slate-800 pt-6 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
                <span>Segment Multi-Agent Workers ({jobData.segmentCount})</span>
                <span>
                  {jobData.segments.filter((s) => s.status === 'COMPLETED').length} / {jobData.segmentCount} Ready
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {jobData.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-300 truncate max-w-[180px]">
                      {segment.sequenceIndex + 1}. {segment.title || `Segment ${segment.sequenceIndex + 1}`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        segment.status === 'COMPLETED'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {segment.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
