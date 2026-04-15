import { openaiClient } from './openai.client';
import { config } from '../../config';
import { logger } from '../../shared/logger/logger';
import { aiProcessingDuration } from '../../shared/metrics/metrics';
import type { FoodExtractionResult } from './ai.types';
import { textProcessorService } from './text-processor.service';

export const audioProcessorService = {
  /**
   * Transcribe audio using OpenAI Whisper, then extract food info
   */
  async processAudio(
    audioBuffer: Buffer,
    mimeType: string,
    userId: string,
    timestamp: Date = new Date(),
  ): Promise<{ transcription: string; extraction: FoodExtractionResult }> {
    const end = aiProcessingDuration.startTimer({ operation: 'audio_transcription', model: config.openaiModelAudio });

    let transcription: string;

    try {
      // Determine file extension from mime type
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';

      // Whisper requires a File-like object; copy buffer into a proper ArrayBuffer
      const arrayBuffer = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength,
      ) as ArrayBuffer;
      const file = new File([arrayBuffer], `audio.${ext}`, { type: mimeType });

      const response = await openaiClient.audio.transcriptions.create({
        model: config.openaiModelAudio,
        file,
        language: 'pt',
        response_format: 'text',
      });

      transcription = response as unknown as string;

      logger.info({ userId, transcriptionLength: transcription.length }, 'Audio transcribed');
    } finally {
      end();
    }

    // Now extract food from transcription
    const extraction = await textProcessorService.extractFoodsFromText(
      transcription,
      userId,
      timestamp,
    );

    return { transcription, extraction };
  },
};
