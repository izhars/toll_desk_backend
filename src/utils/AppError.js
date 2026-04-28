class AppError extends Error {
  constructor(message, statusCode) {
    super(message); // call parent constructor
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // mark as operational error (vs programming error)

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;