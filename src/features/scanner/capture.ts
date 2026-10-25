/** Outils de capture du scanner : empreinte des photos (doublons) et lecture du code-barres par le navigateur. */
import { normalizeBarcode } from '../../domain/barcode';

/** Empreinte SHA-256 d'une photo réduite : deux emplacements ne peuvent pas recevoir la même image. */
export async function photoHash(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o: { formats: string[] }) => Detector;

/** Lecteur intégré au navigateur (Chrome sur Android, notamment). */
function nativeSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

/** Lecture possible sur cet appareil : lecteur intégré, sinon lecteur zxing chargé à la demande (iPhone, ordinateur). */
export function barcodeSupported(): boolean {
  return nativeSupported() || (typeof WebAssembly === 'object' && typeof createImageBitmap === 'function');
}

async function readNative(blob: Blob): Promise<string[]> {
  const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
  const bitmap = await createImageBitmap(blob);
  try {
    return (await new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }).detect(bitmap)).map((f) => f.rawValue);
  } finally {
    bitmap.close?.();
  }
}

/** zxing-wasm (MIT, gratuit) : le module et son fichier .wasm sont servis par le site, téléchargés seulement ici. */
async function readZxing(blob: Blob): Promise<string[]> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  const found = await readBarcodes(blob, { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'], tryHarder: true, maxNumberOfSymbols: 2 });
  return found.filter((f) => f.isValid).map((f) => f.text);
}

/** Code-barres EAN/UPC lu sur la photo, s'il est valable (chiffre de contrôle vérifié). */
export async function detectBarcode(blob: Blob): Promise<string | null> {
  if (!barcodeSupported()) return null;
  try {
    for (const raw of nativeSupported() ? await readNative(blob) : await readZxing(blob)) {
      const code = normalizeBarcode(raw);
      if (code) return code;
    }
  } catch {
    // Lecture impossible : sans gravité, Lia lira les chiffres sur la photo.
  }
  return null;
}
