'use client';

import React from 'react';
import { JobStatusResponse } from '../types/api';
import { Play, RotateCcw, CheckCircle2, Download, Film, Layers } from 'lucide-react';

interface VideoResultProps {
  videoUrl: string;
  topic: string;
  jobData?: JobStatusResponse | null;
  onGenerateAnother: () => void;
}

export default function VideoResult({
  videoUrl,
  topic,
  jobData,
  onGenerateAnother,
}: VideoResultProps) {
  // Ensure video URL is properly formatted for rewrite proxy or backend absolute path
  const formattedVideoUrl = videoUrl.startsWith('http')
    ? videoUrl
    : videoUrl.startsWith('/')
    ? videoUrl
    : `/public/outputs/${videoUrl}`;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 via-amber-500 to-orange-500 rounded-3xl blur opacity-40"></div>

        <div className="relative rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-6 sm:p-10 shadow-2xl space-y-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Documentary Production Complete
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-100 tracking-tight">{topic}</h2>
              <p className="text-slate-400 text-sm mt-1">
                Your AI-generated documentary is ready for playback.
              </p>
            </div>

            <button
              onClick={onGenerateAnother}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-md transition-all duration-200"
            >
              <RotateCcw className="w-4 h-4" />
              Generate Another
            </button>
          </div>

          {/* HTML5 Video Player */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl group/video">
            <video
              src={formattedVideoUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
              poster="/placeholder-poster.png"
            >
              Your browser does not support HTML5 video playback.
            </video>
          </div>

          {/* Details Footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-amber-400" />
                <span>Format: MP4 (H.264 / AAC)</span>
              </div>
              {jobData?.segmentCount && (
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>{jobData.segmentCount} Animated Segments</span>
                </div>
              )}
            </div>

            <a
              href={formattedVideoUrl}
              download={`${topic.toLowerCase().replace(/\s+/g, '-')}-documentary.mp4`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Download Video
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
