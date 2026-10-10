export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, data, message };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
