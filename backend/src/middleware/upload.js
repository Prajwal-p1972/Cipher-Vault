import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10
  }
}).single('file');

/**
 * Middleware handling single-file multipart uploads into memory.
 * Maps multer limits and validation failures to standardized AppErrors.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function uploadMiddleware(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              `Uploaded file exceeds maximum limit of ${env.MAX_UPLOAD_BYTES} bytes`,
              413
            )
          );
        }
        return next(new AppError(`Upload validation error: ${err.message}`, 400));
      }
      return next(err);
    }
    next();
  });
}

export default uploadMiddleware;
