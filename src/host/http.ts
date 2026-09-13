// Bound streaming bytes even when a service SDK performs the final JSON decoding.
export function boundedResponse(response: Response, limit = 8 * 1024 * 1024) {
  if (!response.body) return response;
  let size = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) throw Error('Service response exceeds limit');
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
export async function readJson(response: Response, limit = 8 * 1024 * 1024) {
  if (response.status !== 204) return boundedResponse(response, limit).json();
}
