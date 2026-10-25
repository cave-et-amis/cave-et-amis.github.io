/** QR code d'un lien, dessiné en SVG (cases calculées par la bibliothèque libre qrcode-generator, intégrée au site). */
import { useMemo } from 'react';
import qrcode from '../vendor/qrcode-generator.mjs';

/** Les cases noires d'un QR code (niveau de correction M), et sa taille en cases. */
export function qrModules(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (qr.isDark(r, c)) path += `M${c},${r}h1v1h-1z`;
  }
  return { size, path };
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => qrModules(text), [text]);
  // Marge blanche de 4 cases, comme le prévoit la norme.
  return (
    <svg className="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
