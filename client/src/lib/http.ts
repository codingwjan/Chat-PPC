import type { ApiErrorPayload } from "@/lib/types";

export async function apiJson<TResponse>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const json = (await response.json()) as ApiErrorPayload;
      if (json?.error) {
        message = json.error;
      }
    } catch {
      // Keep fallback message.
    }

    throw new Error(message);
  }

  return (await response.json()) as TResponse;
}
