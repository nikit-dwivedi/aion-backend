export class AppError extends Error {
    statusCode;
    isOperational;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}
export const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: 'error',
            message: err.message,
        });
    }
    if (err.name === 'MulterError') {
        return res.status(400).json({
            status: 'error',
            message: err.message,
        });
    }
    console.error('🔥 UNEXPECTED ERROR:', err);
    return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
    });
};
export const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
//# sourceMappingURL=error.middleware.js.map