export class AppError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {number} statusCode - HTTP status code
   * @param {any} [details=null] - Optional structured error details
   */
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', details = null) {
    return new AppError(message, 400, details);
  }

  static unauthorized(message = 'Unauthorized', details = null) {
    return new AppError(message, 401, details);
  }

  static forbidden(message = 'Forbidden', details = null) {
    return new AppError(message, 403, details);
  }

  static notFound(message = 'Resource Not Found', details = null) {
    return new AppError(message, 404, details);
  }

  static conflict(message = 'Conflict', details = null) {
    return new AppError(message, 409, details);
  }

  static locked(message = 'Account Locked', details = null) {
    return new AppError(message, 423, details);
  }
}
