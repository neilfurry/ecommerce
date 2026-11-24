import { detectFileType } from './detect-file-type';

const bytes = (...values: number[]) => Buffer.from(values);

describe('detectFileType', () => {
  it.each([
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0), 'image/png', 'png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0), 'image/jpeg', 'jpg'],
    ['GIF', Buffer.from('GIF89a....'), 'image/gif', 'gif'],
    [
      'WebP',
      Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBPVP8 ')]),
      'image/webp',
      'webp',
    ],
    ['PDF', Buffer.from('%PDF-1.7\n...'), 'application/pdf', 'pdf'],
    ['UTF-8 text', Buffer.from('Salamat po! ₱1,499.50\n'), 'text/plain', 'txt'],
  ])('detects %s', (_label, content, mime, extension) => {
    expect(detectFileType(content)).toEqual({ mime, extension });
  });

  it.each([
    ['a Windows executable', Buffer.concat([Buffer.from('MZ'), bytes(0x90, 0x00, 0x03, 0x00)])],
    ['a ZIP archive', bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)],
    ['invalid UTF-8', bytes(0xc3, 0x28, 0x41)],
    ['an empty file', Buffer.alloc(0)],
    [
      'RIFF that is not WebP (e.g. AVI)',
      Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('AVI ')]),
    ],
  ])('rejects %s', (_label, content) => {
    expect(detectFileType(content)).toBeNull();
  });

  it('ignores a misleading text extension on binary content', () => {
    // An HTML file disguised as an image is plain text, not image/png.
    expect(detectFileType(Buffer.from('<script>alert(1)</script>'))?.mime).toBe('text/plain');
  });
});
