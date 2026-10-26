import type { ErrorCode } from '../models/errorSharedmodel';
/** A request-scoped application failure; transport layers choose its HTTP representation. */
export class ApplicationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
