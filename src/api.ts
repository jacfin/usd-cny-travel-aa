export type ApiResponse<T> = { data: T };

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error?: unknown }).error || '') : '';
    throw new Error(message || `HTTP ${response.status}`);
  }
  return { data: body as T };
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: <T = unknown>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) }),
  delete: <T = unknown>(path: string, data?: unknown) => request<T>(path, { method: 'DELETE', body: data === undefined ? undefined : JSON.stringify(data) }),
};
