import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';

export async function dbPersistNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[DBPersist Node] Persisting ${state.chapters.length} chapters for Job ID: ${state.jobId}...`);

  if (!state.jobId) {
    console.error('[DBPersist Node] Missing jobId in state.');
    return {
      error: 'DBPersist error: Missing jobId in workflow state',
      workflowStatus: 'FAILED',
    };
  }

  if (state.chapters.length === 0) {
    console.warn('[DBPersist Node] No chapters found to persist.');
    return {
      unprocessedSegmentIds: [],
      workflowStatus: 'SAVED_TO_DB',
    };
  }

  try {
    // Delete any existing segments for this job before re-inserting (idempotency)
    await prisma.videoSegment.deleteMany({
      where: { jobId: state.jobId },
    });

    // Create segments in batch / transaction
    const segmentData = state.chapters.map((chapter) => ({
      jobId: state.jobId,
      sequenceIndex: chapter.sequenceIndex,
      title: chapter.title,
      narrationScript: chapter.summary,
      imagePrompt: chapter.visualConcept,
      status: 'SCRIPTED',
    }));

    await prisma.videoSegment.createMany({
      data: segmentData,
    });

    // Fetch created segment IDs ordered by sequenceIndex
    const createdSegments = await prisma.videoSegment.findMany({
      where: { jobId: state.jobId },
      orderBy: { sequenceIndex: 'asc' },
      select: { id: true },
    });

    const unprocessedSegmentIds = createdSegments.map((s) => s.id);

    // Update job status in database
    await prisma.videoJob.update({
      where: { id: state.jobId },
      data: {
        status: 'SCRIPTING',
      },
    });

    console.log(`[DBPersist Node] Successfully created ${createdSegments.length} VideoSegment records. Segment IDs:`, unprocessedSegmentIds);

    return {
      unprocessedSegmentIds,
      workflowStatus: 'SAVED_TO_DB',
    };
  } catch (error) {
    console.error('[DBPersist Node] Failed to save segments to database:', error);
    return {
      error: `DBPersist error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
