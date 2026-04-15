import { openaiClient } from './openai.client';
import { config } from '../../config';
import { prisma } from '../../shared/database/prisma';
import { logger } from '../../shared/logger/logger';
import type { EmbeddingType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export const embeddingService = {
  /**
   * Generate an embedding vector for a text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await openaiClient.embeddings.create({
      model: config.openaiModelEmbedding,
      input: text,
      dimensions: config.embeddingDimensions,
    });

    return response.data[0].embedding;
  },

  /**
   * Store an embedding for a user
   */
  async storeUserEmbedding(
    userId: string,
    content: string,
    type: EmbeddingType,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const embedding = await this.generateEmbedding(content);

    const record = await prisma.userEmbedding.create({
      data: {
        userId,
        content,
        type,
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Store the vector in pgvector via raw SQL
    await prisma.$executeRaw`
      UPDATE user_embeddings 
      SET embedding = ${JSON.stringify(embedding)}::vector
      WHERE id = ${record.id}
    `;

    return record.id;
  },

  /**
   * Find similar meal descriptions for a user (semantic search)
   */
  async findSimilarMeals(
    userId: string,
    query: string,
    limit = 5,
    threshold = 0.8,
  ): Promise<Array<{ content: string; metadata: unknown; similarity: number }>> {
    const queryEmbedding = await this.generateEmbedding(query);

    const results = await prisma.$queryRaw<
      Array<{ content: string; metadata: unknown; similarity: number }>
    >`
      SELECT content, metadata,
             1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
      FROM user_embeddings
      WHERE user_id = ${userId}
        AND type = 'MEAL_DESCRIPTION'
        AND 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) >= ${threshold}
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT ${limit}
    `;

    logger.debug({ userId, query, resultsCount: results.length }, 'Semantic similarity search');
    return results;
  },

  /**
   * Check if a message refers to a named meal pattern (e.g., "meu café da manhã de sempre")
   */
  async findNamedMeal(
    userId: string,
    description: string,
  ): Promise<{ content: string; metadata: unknown } | null> {
    const queryEmbedding = await this.generateEmbedding(description);

    const results = await prisma.$queryRaw<Array<{ content: string; metadata: unknown; similarity: number }>>`
      SELECT content, metadata,
             1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
      FROM user_embeddings
      WHERE user_id = ${userId}
        AND type = 'NAMED_MEAL'
        AND 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) >= 0.9
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT 1
    `;

    return results[0] ?? null;
  },
};
