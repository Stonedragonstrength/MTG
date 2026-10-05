/** Lazy OCR wrapper: tesseract.js loads on first scan only (its worker,
 * wasm, and language data never weigh down the normal app bundle). */
let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

async function getWorker() {
  const { createWorker } = await import('tesseract.js');
  workerPromise ??= createWorker('eng');
  return workerPromise;
}

/** Reads the cropped title strip; returns the longest line of text,
 * which in a title crop is the card name. */
export async function recognizeTitle(source: HTMLCanvasElement): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(source);
  const lines = data.text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.sort((a, b) => b.length - a.length)[0] ?? '';
}
