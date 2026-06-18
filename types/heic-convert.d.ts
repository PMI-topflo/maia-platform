// Minimal types for heic-convert (no bundled or @types definitions). Decodes
// HEIC/HEIF (incl. HEVC, which sharp's prebuilt libheif can't) to JPEG/PNG.
declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: Buffer | ArrayBuffer | Uint8Array
    format: 'JPEG' | 'PNG'
    /** 0..1, JPEG only. */
    quality?: number
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>
  export = convert
}
