// Types de la bibliothèque qrcode-generator 2.0.4 (Kazuhiko Arase, licence MIT), intégrée telle quelle dans
// qrcode-generator.mjs. Seule la partie utilisée par l'application est déclarée.

export interface QRCode {
  addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

declare const qrcode: (typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H') => QRCode;
export default qrcode;
