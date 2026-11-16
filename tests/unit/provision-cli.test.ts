import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import { MutableStdout } from '@/cli/provision-owner';

describe('CLI MutableStdout Stream Muting Unit Tests', () => {
  it('passes chunks through to target stream when muted is false', () => {
    const writtenChunks: string[] = [];
    const mockTarget = new Writable({
      write(chunk, encoding, callback) {
        writtenChunks.push(chunk.toString());
        callback();
      },
    });

    const stream = new MutableStdout(mockTarget);
    expect(stream.muted).toBe(false);

    stream.write('Password: ');
    expect(writtenChunks).toEqual(['Password: ']);
  });

  it('suppresses writes to target stream when muted is true', () => {
    const writtenChunks: string[] = [];
    const mockTarget = new Writable({
      write(chunk, encoding, callback) {
        writtenChunks.push(chunk.toString());
        callback();
      },
    });

    const stream = new MutableStdout(mockTarget);
    stream.muted = true;

    stream.write('SuperSecretPassword123!');
    expect(writtenChunks).toEqual([]); // Muted: zero chunks leaked to output

    // When unmuted, subsequent chunks are passed through
    stream.muted = false;
    stream.write('\n');
    expect(writtenChunks).toEqual(['\n']);
  });
});
