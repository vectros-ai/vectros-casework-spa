import { afterEach, describe, expect, it, vi } from 'vitest';

import { presignedUploadHeaders, putBytesOrCompensate } from './putBytesOrCompensate';

// The upload address comes back from the API and the file's bytes are sent to whatever it names.
// Only an https address is used, the value used is the one that was checked, and a refused address
// sends nothing.
describe('putBytesOrCompensate address check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const FILE = new File(['bytes'], 'a.pdf', { type: 'application/pdf' });

  it.each([
    ['plain http', 'http://s3.example/put'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/plain,x'],
    ['protocol-relative', '//evil.example/put'],
    ['a relative path', '/put'],
    ['an empty string', ''],
  ])('sends nothing to %s and rejects', async (_name, uploadUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      putBytesOrCompensate({ id: 'doc_1', uploadUrl }, FILE, 'application/pdf', async () => undefined),
    ).rejects.toThrow(/presigned URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still cleans up a document this call created when the address is refused', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    await expect(
      putBytesOrCompensate(
        { id: 'doc_new', created: true, uploadUrl: 'http://s3.example/put' },
        FILE,
        'application/pdf',
        deleteDocument,
      ),
    ).rejects.toThrow();
    expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_new' });
  });

  it('PUTs to the checked (normalised) https address (control)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await putBytesOrCompensate(
      { id: 'doc_1', uploadUrl: '  HTTPS://S3.Example/put?X-Amz-Signature=abc  ' },
      FILE,
      'application/pdf',
      async () => undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/put?X-Amz-Signature=abc',
      expect.objectContaining({ method: 'PUT', body: FILE }),
    );
  });
});

describe('presignedUploadHeaders', () => {
  it('returns the header the response names, with its exact value', () => {
    expect(
      presignedUploadHeaders({ requiredHeaderName: 'If-None-Match', requiredHeaderValue: '*' }),
    ).toEqual({ 'If-None-Match': '*' });
  });

  it('uses whatever header name the response carries rather than a fixed one', () => {
    expect(
      presignedUploadHeaders({ requiredHeaderName: 'If-Match', requiredHeaderValue: '"etag-1"' }),
    ).toEqual({ 'If-Match': '"etag-1"' });
  });

  it('returns no header when the response names none', () => {
    expect(presignedUploadHeaders({})).toEqual({});
  });

  it('returns no header for a blank or non-string name, or a missing value', () => {
    expect(presignedUploadHeaders({ requiredHeaderName: '', requiredHeaderValue: '*' })).toEqual({});
    expect(presignedUploadHeaders({ requiredHeaderName: 42, requiredHeaderValue: '*' })).toEqual({});
    expect(presignedUploadHeaders({ requiredHeaderName: 'If-None-Match' })).toEqual({});
  });
});
