/** Minimal files that pass content-type detection (magic bytes). */
export const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('test document body for e2e\n%%EOF'),
]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body for e2e'),
]);
