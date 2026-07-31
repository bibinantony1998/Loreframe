import { StateGraph, START, END } from '@langchain/langgraph';
import { StateAnnotation, GraphStateType } from './graphState';
import { researchNode } from './nodes/research';
import { contentBuilderNode } from './nodes/contentBuilder';
import { dbPersistNode } from './nodes/dbPersist';
import { scriptWriterNode } from './nodes/scriptWriter';
import { textToAudioNode } from './nodes/textToAudio';
import { imagePrompterNode } from './nodes/imagePrompter';
import { imageGeneratorNode } from './nodes/imageGenerator';
import { videoAssemblerNode } from './nodes/videoAssembler';
import { prisma } from '../db/client';

export function supervisorLoopNode(state: GraphStateType): Partial<GraphStateType> {
  const queue = state.unprocessedSegmentIds || [];
  console.log(`[Supervisor Loop] Queue check: ${queue.length} segments remaining.`);

  if (queue.length === 0) {
    return {
      currentSegmentId: null,
      workflowStatus: 'ALL_SEGMENTS_READY',
    };
  }

  const [nextSegmentId, ...remainingIds] = queue;
  console.log(`[Supervisor Loop] Next active segment: ${nextSegmentId} (Remaining: ${remainingIds.length})`);

  return {
    currentSegmentId: nextSegmentId,
    unprocessedSegmentIds: remainingIds,
    workflowStatus: 'PROCESSING_SEGMENT',
  };
}

function routeAfterResearch(state: GraphStateType): string {
  if (state.error || state.workflowStatus === 'FAILED') {
    return END;
  }
  return 'contentBuilder';
}

function routeAfterContentBuilder(state: GraphStateType): string {
  if (state.error || state.workflowStatus === 'FAILED') {
    return END;
  }
  return 'dbPersist';
}

function routeAfterSupervisorLoop(state: GraphStateType): string {
  if (state.error || state.workflowStatus === 'FAILED') {
    return END;
  }
  if (state.currentSegmentId) {
    return 'scriptWriter';
  }
  return 'videoAssembler';
}

const workflow = new StateGraph(StateAnnotation)
  .addNode('research', researchNode)
  .addNode('contentBuilder', contentBuilderNode)
  .addNode('dbPersist', dbPersistNode)
  .addNode('supervisorLoop', supervisorLoopNode)
  .addNode('scriptWriter', scriptWriterNode)
  .addNode('textToAudio', textToAudioNode)
  .addNode('imagePrompter', imagePrompterNode)
  .addNode('imageGenerator', imageGeneratorNode)
  .addNode('videoAssembler', videoAssemblerNode)
  .addEdge(START, 'research')
  .addConditionalEdges('research', routeAfterResearch, {
    contentBuilder: 'contentBuilder',
    [END]: END,
  })
  .addConditionalEdges('contentBuilder', routeAfterContentBuilder, {
    dbPersist: 'dbPersist',
    [END]: END,
  })
  .addEdge('dbPersist', 'supervisorLoop')
  .addConditionalEdges('supervisorLoop', routeAfterSupervisorLoop, {
    scriptWriter: 'scriptWriter',
    videoAssembler: 'videoAssembler',
    [END]: END,
  })
  .addEdge('scriptWriter', 'textToAudio')
  .addEdge('textToAudio', 'imagePrompter')
  .addEdge('imagePrompter', 'imageGenerator')
  .addEdge('imageGenerator', 'supervisorLoop')
  .addEdge('videoAssembler', END);

export const documentaryGraph = workflow.compile();

import { logToTaskFile } from '../utils/taskLogger';

export async function executeDocumentaryWorkflow(input: {
  jobId: string;
  topic: string;
  targetDurationMinutes: number;
}): Promise<GraphStateType> {
  console.log(`[Supervisor] Launching multi-agent workflow for Job ID: ${input.jobId}`);
  logToTaskFile(input.jobId, `[Supervisor] Launching multi-agent workflow for Topic: "${input.topic}" (${input.targetDurationMinutes} mins)`);

  // Mark job as PLANNING in DB
  await prisma.videoJob.update({
    where: { id: input.jobId },
    data: { status: 'PLANNING' },
  });

  const initialState: GraphStateType = {
    jobId: input.jobId,
    topic: input.topic,
    targetDurationMinutes: input.targetDurationMinutes,
    researchData: '',
    chapters: [],
    unprocessedSegmentIds: [],
    currentSegmentId: null,
    workflowStatus: 'INITIALIZED',
    error: null,
  };

  try {
    const finalState = (await documentaryGraph.invoke(
      initialState,
      { recursionLimit: 150 }
    )) as GraphStateType;

    if (finalState.error || finalState.workflowStatus === 'FAILED') {
      console.error(`[Supervisor] Workflow finished with error for Job ${input.jobId}:`, finalState.error);
      logToTaskFile(input.jobId, `[Supervisor] Workflow FAILED: ${finalState.error}`);
      await prisma.videoJob.update({
        where: { id: input.jobId },
        data: {
          status: 'FAILED',
          error: finalState.error || 'Unknown workflow error',
        },
      });
    } else {
      console.log(`[Supervisor] Workflow successfully completed for Job ${input.jobId}.`);
      logToTaskFile(input.jobId, `[Supervisor] Workflow COMPLETED successfully.`);
      await prisma.videoJob.update({
        where: { id: input.jobId },
        data: {
          status: 'COMPLETED',
        },
      });
    }

    return finalState;
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[Supervisor] Unexpected error executing workflow for Job ${input.jobId}:`, error);
    logToTaskFile(input.jobId, `[Supervisor] Unexpected error executing workflow: ${errorMessage}`);
    await prisma.videoJob.update({
      where: { id: input.jobId },
      data: {
        status: 'FAILED',
        error: errorMessage,
      },
    });

    return {
      ...initialState,
      workflowStatus: 'FAILED',
      error: errorMessage,
    };
  }
}
