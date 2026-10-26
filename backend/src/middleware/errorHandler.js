import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * Central Express error handler.
 * - ZodError -> 400 with field-level details
 * - AppError -> its explicit statusCode and message
 * - Malformed JSON SyntaxError -> 400
 * - Uncaught exceptions -> logged server-side and returned as generic 500
 */
export function errorHandler(err, req, res, next) {
  // 1. Zod schema validation errors
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message
    }));
    return res.status(400).json({
      error: 'Validation failed',
      details
    });
  }

  // 2. Operational application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }

  // 3. Body-parser malformed JSON payload errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Malformed JSON payload'
    });
  }

  // 4. Unexpected server errors
  console.error('[Unhandled Exception]:', err);
  return res.status(500).json({
    error: 'Internal server error'
  });
}
