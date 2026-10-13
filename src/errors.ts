export type MemoryErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CORRUPTION"
  | "CONFIG"
  | "UNAUTHORIZED";

const HTTP_STATUS: Record<MemoryErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CORRUPTION: 500,
  CONFIG: 400,
  UNAUTHORIZED: 401,
};

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  readonly httpStatus: number;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function isMemoryError(value: unknown): value is MemoryError {
  return value instanceof MemoryError;
}
