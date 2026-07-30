import { Annotation } from '@langchain/langgraph';

export interface Chapter {
  sequenceIndex: number;
  title: string;
  summary: string;
  visualConcept: string;
}

export function safeGetChapters(chapters: unknown): Chapter[] {
  if (Array.isArray(chapters)) {
    return chapters as Chapter[];
  }
  if (typeof chapters === 'string') {
    try {
      const parsed = JSON.parse(chapters);
      if (Array.isArray(parsed)) return parsed as Chapter[];
      if (parsed && Array.isArray((parsed as any).chapters)) return (parsed as any).chapters as Chapter[];
    } catch (e) {
      // JSON parse error
    }
  }
  if (chapters && typeof chapters === 'object' && Array.isArray((chapters as any).chapters)) {
    return (chapters as any).chapters as Chapter[];
  }
  return [];
}

export const StateAnnotation = Annotation.Root({
  jobId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  topic: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  targetDurationMinutes: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 5,
  }),
  chapters: Annotation<Chapter[]>({
    reducer: (_prev, next) => safeGetChapters(next),
    default: () => [],
  }),
  unprocessedSegmentIds: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentSegmentId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  workflowStatus: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => 'INITIALIZED',
  }),
  error: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type GraphStateType = typeof StateAnnotation.State;
