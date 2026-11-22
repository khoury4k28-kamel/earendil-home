// Makes the thumbnail for a document someone adds: the first page of a PDF, or
// a smaller copy of a picture. It is drawn in the browser, so the file goes
// nowhere until the person presses Add.

const WIDTH = 720;            // the same width the first documents' thumbnails have
const MAX_BYTES = 50 * 1024 * 1024;
export const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const KINDS = ACCEPT.split(",");

// Why a file can't be added, in plain words; null when it can.
export function refusal(file) {
  if (!KINDS.includes(file.type)) return "Add a PDF or a picture (JPEG, PNG or WebP). Other kinds of file can't show a thumbnail yet.";
  if (file.size > MAX_BYTES) return "That file is over 50 MB. Export a smaller copy and add that.";
  if (!file.size) return "That file is empty.";
  return null;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const toJpeg = (canvas) => new Promise((resolve, reject) =>
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The thumbnail couldn't be made."))), "image/jpeg", 0.84));

async function fromPicture(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, WIDTH / bitmap.width);
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";   // a see-through picture gets a white ground, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { blob: await toJpeg(canvas), w: canvas.width, h: canvas.height, pages: null };
}

// The PDF reader is large, so it is only fetched when someone adds a PDF.
let reader = null;
async function pdfReader() {
  if (!reader) {
    reader = import("./vendor/pdfjs-4.10.38/pdf.min.js").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs-4.10.38/pdf.worker.min.js", import.meta.url).href;
      return lib;
    });
  }
  return reader;
}
async function fromPdf(file) {
  const lib = await pdfReader();
  const task = lib.getDocument({ data: await file.arrayBuffer() });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / natural.width });
    const canvas = canvasOf(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { blob: await toJpeg(canvas), w: canvas.width, h: canvas.height, pages: pdf.numPages };
  } finally {
    task.destroy();
  }
}

// { blob, w, h, pages } for a file that passed refusal().
export function makeThumb(file) {
  return file.type === "application/pdf" ? fromPdf(file) : fromPicture(file);
}
