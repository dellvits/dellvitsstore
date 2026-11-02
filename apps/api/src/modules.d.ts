declare module 'heic-decode' {
  export default function decode(input: {
    buffer: Buffer | ArrayBuffer;
  }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}
