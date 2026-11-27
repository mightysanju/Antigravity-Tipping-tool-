import type { ServerConfig } from '../config.ts';

export interface OcrAdapter {
  readonly mode: ServerConfig['ocrMode'];
  extractTextFromImage(imageBuffer: Buffer, mimeType: string): Promise<string>;
}

class MockOcrAdapter implements OcrAdapter {
  readonly mode = 'mock' as const;

  async extractTextFromImage(imageBuffer: Buffer, _mimeType: string): Promise<string> {
    return imageBuffer.toString('utf8');
  }
}

class TesseractOcrAdapter implements OcrAdapter {
  readonly mode = 'tesseract' as const;

  async extractTextFromImage(imageBuffer: Buffer, _mimeType: string): Promise<string> {
    // Loaded lazily so the dependency (and its WASM) is only touched when OCR is actually used.
    // Note: tesseract.js downloads the English language data on first use unless langPath is configured.
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(imageBuffer);
      return data.text ?? '';
    } finally {
      await worker.terminate();
    }
  }
}

export function createOcrAdapter(config: ServerConfig): OcrAdapter {
  if (config.ocrMode === 'mock') {
    return new MockOcrAdapter();
  }
  return new TesseractOcrAdapter();
}
