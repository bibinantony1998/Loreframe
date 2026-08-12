'use client';

import React, { useState } from 'react';
import { Sparkles, Clock, Compass, Film, AlertCircle } from 'lucide-react';

interface HeroFormProps {
  onSubmit: (topic: string, durationMinutes: number) => void;
  isLoading: boolean;
  error?: string | null;
}

const TOPIC_SUGGESTIONS = [
  'The Fall of the Roman Empire',
  'The Industrial Revolution',
  'Apollo 11 & The Space Race',
  'Ancient Egypt & The Pyramids',
  'The French Revolution',
];

export default function HeroForm({ onSubmit, isLoading, error }: HeroFormProps) {
  const [topic, setTopic] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [validationError, setValidationError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setValidationError('Please enter a historical topic.');
      return;
    }
    if (topic.trim().length < 3) {
      setValidationError('Topic must be at least 3 characters long.');
      return;
    }
    setValidationError('');
    onSubmit(topic.trim(), durationMinutes);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setTopic(suggestion);
    setValidationError('');
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Header Badge & Title */}
      <div className="text-center mb-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          Autonomous Multi-Agent AI Pipeline
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-100 tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
          AI Historical Documentary Generator
        </h1>

        <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
          Enter any historical era or event. Our multi-agent swarm will research, write, narrate, and produce a full documentary video for you.
        </p>
      </div>

      {/* Hero Form Box with Glassmorphism */}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-600 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-500"></div>

        <div className="relative rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-5 sm:p-7 shadow-2xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Topic Input */}
            <div className="space-y-2">
              <label htmlFor="topic-input" className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Compass className="w-4 h-4 text-amber-400" />
                Historical Topic
              </label>

              <div className="relative">
                <input
                  id="topic-input"
                  type="text"
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    if (validationError) setValidationError('');
                  }}
                  placeholder="e.g. The Siege of Constantinople or Renaissance Art"
                  className="w-full px-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all text-base sm:text-lg"
                  disabled={isLoading}
                />
              </div>

              {/* Suggestions */}
              <div className="pt-2">
                <span className="text-xs text-slate-400 mr-2">Try these:</span>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {TOPIC_SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleSelectSuggestion(item)}
                      className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-amber-500/10 hover:border-amber-500/30 border border-slate-700 text-slate-300 hover:text-amber-300 text-xs transition-all duration-200"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Target Duration Slider & Input */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label htmlFor="duration-slider" className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Target Duration
                </label>
                <span className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-bold">
                  {durationMinutes} {durationMinutes === 1 ? 'Minute' : 'Minutes'}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <input
                  id="duration-slider"
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  disabled={isLoading}
                />
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={durationMinutes}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(15, Number(e.target.value) || 1));
                    setDurationMinutes(val);
                  }}
                  className="w-20 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-center text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Error Message */}
            {(validationError || error) && (
              <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{validationError || error}</span>
              </div>
            )}

            {/* Action Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 hover:from-amber-400 hover:via-amber-500 hover:to-orange-500 text-slate-950 font-bold text-lg shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 group"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                  <span>Initializing Multi-Agent Swarm...</span>
                </>
              ) : (
                <>
                  <Film className="w-5 h-5 transition-transform group-hover:scale-110" />
                  <span>Generate Documentary</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
