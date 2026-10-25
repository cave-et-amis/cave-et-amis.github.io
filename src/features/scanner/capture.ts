/** Outils de capture du scanner : empreinte des photos (doublons) et lecture du code-barres par le navigateur. */
import { normalizeBarcode } from '../../domain/barcode';

/** Empreinte SHA-256 d'une photo réduite : deux emplacements ne peuvent pas recevoir la même image. */
export async function photoHash(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o: { formats: string[] }) => Detector;

/** Le navigateur sait-il lire un code-barres (Chrome sur Android, notamment) ? Sinon, Lia le lit sur la photo. */
export function barcodeSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

/** Code-barres EAN/UPC lu sur la photo par le navigateur, s'il est valable (chiffre de contrôle vérifié). */
export async function detectBarcode(blob: Blob): Promise<string | null> {
  if (!barcodeSupported()) return null;
  try {
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const bitmap = await createImageBitmap(blob);
    const found = await new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }).detect(bitmap);
    bitmap.close?.();
    for (const f of found) {
      const code = normalizeBarcode(f.rawValue);
      if (code) return code;
    }
  } catch {
    // Lecture impossible : sans gravité, Lia lira les chiffres sur la photo.
  }
  return null;
}
