import { Annotation } from '@langchain/langgraph';

export interface Chapter {
  sequenceIndex: number;
  title: string;
  summary: string;
  visualConcept: string;
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
    reducer: (_prev, next) => next,
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
