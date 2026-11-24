export interface DetectedFileType {
  mime: string;
  extension: string;
}

interface Signature {
  mime: string;
  extension: string;
  matches: (bytes: Buffer) => boolean;
}

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const SIGNATURES: Signature[] = [
  {
    mime: 'image/png',
    extension: 'png',
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mime: 'image/jpeg', extension: 'jpg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/gif', extension: 'gif', matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  },
  {
    mime: 'application/pdf',
    extension: 'pdf',
    matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  },
];

/** Valid UTF-8 without control characters other than tab, CR and LF. */
function isPlainText(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
  } catch {
    return false;
  }
}

/**
 * Identifies a file from its content ("magic bytes"), never from the client-supplied
 * name or Content-Type, which are trivially forged. Returns null for unsupported types.
 */
export function detectFileType(bytes: Buffer): DetectedFileType | null {
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (signature) return { mime: signature.mime, extension: signature.extension };
  if (isPlainText(bytes)) return { mime: 'text/plain', extension: 'txt' };
  return null;
}
