/** Lazy OCR wrapper: tesseract.js loads on first scan only (its worker,
 * wasm, and language data never weigh down the normal app bundle). */
let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

async function getWorker() {
  const { createWorker, PSM } = await import('tesseract.js');
  workerPromise ??= (async () => {
    const worker = await createWorker('eng');
    // Card titles, not documents: hunt sparse text and never guess
    // characters that card names don't use — art noise stops becoming "3)|".
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',- ",
    });
    return worker;
  })();
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
