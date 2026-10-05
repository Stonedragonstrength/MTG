/** Lazy OCR wrapper: tesseract.js loads on first scan only (its worker,
 * wasm, and language data never weigh down the normal app bundle). */
let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

async function getWorker() {
  const { createWorker } = await import('tesseract.js');
  workerPromise ??= createWorker('eng');
  return workerPromise;
}

/** Reads the cropped band; returns every text line it saw. The caller
 * matches each against real card names and keeps the cleanest hit. */
export async function recognizeLines(source: HTMLCanvasElement): Promise<string[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(source);
  return data.text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
