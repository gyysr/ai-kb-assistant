// ===== 统一响应体与业务错误 =====
// 全后端普通接口的返回都是同一个形状 {code, data, message}。
// code===0 即成功——这是与前端 api.ts 约定死的契约（那边只认这个字段），
// 把"业务是否成功"和 HTTP 状态码解耦，成功判断只看一处
// T 是泛型参数：调用方指定 data 里到底装什么，前后端就都有类型提示
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

// 成功响应的快捷拼装：code 固定 0，data 装真实数据
export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, data, message };
}

// 带 HTTP 状态码的错误。路由里直接 throw 它，asyncHandler 接住后交给
// 错误中间件统一转成 JSON 响应——各路由因此不必各自写 try/catch。
// code 是可选的业务错误码（与 HTTP 状态码是两回事，目前很少用）
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
