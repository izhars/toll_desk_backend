const { body, param, query, validationResult } = require('express-validator');
const { REPORT_STATUS, PRIORITY_LEVELS, ISSUE_TYPES, SEVERITY_LEVELS } = require('../utils/constants');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

// Existing validations
exports.validateCreateReport = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),
  body('priority')
    .optional()
    .isIn(Object.values(PRIORITY_LEVELS)).withMessage('Invalid priority value'),
  body('issueType')
    .notEmpty().withMessage('Issue type is required')
    .isIn(Object.values(ISSUE_TYPES)).withMessage('Invalid issue type'),
  body('severity')
    .optional()
    .isIn(Object.values(SEVERITY_LEVELS)).withMessage('Invalid severity value'),
  body('estimatedHours')
    .optional()
    .isFloat({ min: 0, max: 1000 }).withMessage('Estimated hours must be between 0 and 1000'),
  body('costEstimate')
    .optional()
    .isFloat({ min: 0 }).withMessage('Cost estimate must be a positive number'),
  handleValidationErrors
];

// Validate unassignment
exports.validateUnassignment = (req, res, next) => {
  const { userIds, reason } = req.body;

  if (!userIds) {
    return res.status(400).json({
      success: false,
      message: 'Please provide userId(s) to unassign'
    });
  }

  // Validate that userIds is either a string or array
  const isValid = typeof userIds === 'string' || Array.isArray(userIds);

  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: 'userIds must be a string or array of strings'
    });
  }

  // If array, ensure it's not empty
  if (Array.isArray(userIds) && userIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'userIds array cannot be empty'
    });
  }

  next();
};

// Updated status validation with new status values
exports.validateStatusUpdate = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn([
      ...Object.values(REPORT_STATUS),
      'fixed',      // Allow new status values
      'reopened',
      'closed'
    ]).withMessage('Invalid status value'),
  body('notes')
    .optional()
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  body('actualHours')
    .optional()
    .isFloat({ min: 0, max: 1000 }).withMessage('Actual hours must be between 0 and 1000'),
  body('actualCost')
    .optional()
    .isFloat({ min: 0 }).withMessage('Actual cost must be a positive number'),
  handleValidationErrors
];

exports.validateAssignment = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('assignedTo')
    .optional()
    .isMongoId().withMessage('Invalid assignee ID'),
  body('notes').optional().isLength({ max: 300 }),
  handleValidationErrors
];

exports.validateComment = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),

  body().custom((value, { req }) => {
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const photos = Array.isArray(req.files) ? req.files : [];

    const hasText = text.trim().length > 0;
    const hasPhotos = photos.length > 0;

    if (!hasText && !hasPhotos) {
      throw new Error('Comment must have text or at least one image');
    }

    return true;
  }),

  body('text')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Comment cannot exceed 1000 characters'),

  body('isInternal')
    .optional()
    .isBoolean()
    .withMessage('isInternal must be a boolean'),

  handleValidationErrors
];

// Updated resolution validation for mark as fixed
exports.validateMarkFixed = [
  param('id').isMongoId().withMessage('Invalid report ID'),

  body('fixSummary')
    .notEmpty().withMessage('Fix summary is required')
    .isLength({ min: 10, max: 500 }).withMessage('Fix summary must be between 10 and 500 characters'),

  body('rootCause')
    .optional()
    .isLength({ max: 500 }).withMessage('Root cause cannot exceed 500 characters'),

  body('preventiveMeasures')
    .optional()
    .isLength({ max: 500 }).withMessage('Preventive measures cannot exceed 500 characters'),

  body('photoCaption')
    .optional()
    .isLength({ max: 200 }).withMessage('Photo caption cannot exceed 200 characters'),

  handleValidationErrors
];

// New validation for closing reports (employee verification)
exports.validateClosure = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('satisfaction')
    .notEmpty().withMessage('Satisfaction level is required')
    .isIn(['satisfied', 'unsatisfied', 'partial']).withMessage('Invalid satisfaction level'),
  body('feedback')
    .optional()
    .isLength({ max: 1000 }).withMessage('Feedback cannot exceed 1000 characters'),
  body('verificationNotes')
    .optional()
    .isLength({ max: 500 }).withMessage('Verification notes cannot exceed 500 characters'),
  body('verifiedAt')
    .optional()
    .isISO8601().withMessage('Invalid verification date'),
  // Conditional validation based on satisfaction
  body('followUpRequired')
    .optional()
    .isBoolean().withMessage('followUpRequired must be a boolean'),
  body('followUpNotes')
    .optional()
    .isLength({ max: 500 }).withMessage('Follow-up notes cannot exceed 500 characters'),
  handleValidationErrors
];

// New validation for reopening reports
exports.validateReopen = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('reason')
    .notEmpty().withMessage('Reopen reason is required')
    .isLength({ min: 10, max: 500 }).withMessage('Reason must be between 10 and 500 characters'),
  body('additionalDetails')
    .optional()
    .isLength({ max: 1000 }).withMessage('Additional details cannot exceed 1000 characters'),
  body('issuePersists')
    .optional()
    .isBoolean().withMessage('issuePersists must be a boolean'),
  body('newSymptoms')
    .optional()
    .isLength({ max: 500 }).withMessage('New symptoms description cannot exceed 500 characters'),
  body('photos')
    .optional()
    .isArray().withMessage('Photos must be an array'),
  body('photos.*.caption')
    .optional()
    .isLength({ max: 200 }).withMessage('Photo caption cannot exceed 200 characters'),
  handleValidationErrors
];

// New validation for adding verification photos
exports.validateVerificationPhotos = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('photos')
    .optional()
    .isArray().withMessage('Photos must be an array'),
  body('photos.*.caption')
    .optional()
    .isLength({ max: 200 }).withMessage('Photo caption cannot exceed 200 characters'),
  body('photos.*.takenAt')
    .optional()
    .isISO8601().withMessage('Invalid photo timestamp'),
  handleValidationErrors
];

// New validation for requesting re-verification
exports.validateReverification = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('reason')
    .notEmpty().withMessage('Reverification reason is required')
    .isLength({ min: 10, max: 500 }).withMessage('Reason must be between 10 and 500 characters'),
  body('additionalWork')
    .optional()
    .isLength({ max: 500 }).withMessage('Additional work description cannot exceed 500 characters'),
  body('estimatedCompletion')
    .optional()
    .isISO8601().withMessage('Invalid estimated completion date'),
  handleValidationErrors
];

// New validation for satisfaction survey (optional feature)
exports.validateSatisfactionSurvey = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('responseTime')
    .optional()
    .isIn(['excellent', 'good', 'average', 'poor']).withMessage('Invalid response time rating'),
  body('quality')
    .optional()
    .isIn(['excellent', 'good', 'average', 'poor']).withMessage('Invalid quality rating'),
  body('communication')
    .optional()
    .isIn(['excellent', 'good', 'average', 'poor']).withMessage('Invalid communication rating'),
  body('comments')
    .optional()
    .isLength({ max: 1000 }).withMessage('Comments cannot exceed 1000 characters'),
  handleValidationErrors
];

// Validation for batch operations (optional)
exports.validateBatchStatusUpdate = [
  body('reportIds')
    .isArray().withMessage('Report IDs must be an array')
    .custom(value => value.length > 0).withMessage('At least one report ID is required')
    .custom(value => value.length <= 50).withMessage('Cannot update more than 50 reports at once'),
  body('reportIds.*')
    .isMongoId().withMessage('Invalid report ID format'),
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(Object.values(REPORT_STATUS)).withMessage('Invalid status value'),
  body('notes')
    .optional()
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  handleValidationErrors
];

// Validation for query parameters with new status filters
exports.validateGetReports = [
  query('status')
    .optional()
    .isIn([...Object.values(REPORT_STATUS), 'fixed', 'reopened', 'closed'])
    .withMessage('Invalid status filter'),
  query('priority')
    .optional()
    .isIn(Object.values(PRIORITY_LEVELS)).withMessage('Invalid priority filter'),
  query('issueType')
    .optional()
    .isIn(Object.values(ISSUE_TYPES)).withMessage('Invalid issue type filter'),
  query('severity')
    .optional()
    .isIn(Object.values(SEVERITY_LEVELS)).withMessage('Invalid severity filter'),
  query('plazaId')
    .optional()
    .isMongoId().withMessage('Invalid plaza ID'),
  query('laneNumber')
    .optional()
    .isInt({ min: 1 }).withMessage('Lane number must be a positive integer'),
  query('reportedBy')
    .optional()
    .isMongoId().withMessage('Invalid user ID'),
  query('assignedTo')
    .optional()
    .isMongoId().withMessage('Invalid user ID'),
  query('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date'),
  query('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date'),
  query('search')
    .optional()
    .isString().withMessage('Search term must be a string'),
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'priority', 'status']).withMessage('Invalid sort field'),
  handleValidationErrors
];

// Validation for verification workflow
exports.validateVerificationWorkflow = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('action')
    .notEmpty().withMessage('Action is required')
    .isIn(['verify', 'reject', 'escalate']).withMessage('Invalid action'),
  body('notes')
    .optional()
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  body('escalationReason')
    .if(body('action').equals('escalate'))
    .notEmpty().withMessage('Escalation reason is required when escalating')
    .isLength({ min: 10, max: 500 }).withMessage('Escalation reason must be between 10 and 500 characters'),
  body('escalateTo')
    .if(body('action').equals('escalate'))
    .isMongoId().withMessage('Invalid escalation recipient ID'),
  handleValidationErrors
];

exports.validateResolution = [
  param('id').isMongoId().withMessage('Invalid report ID'),
  body('resolutionSummary')
    .notEmpty().withMessage('Resolution summary is required')
    .isLength({ max: 500 }).withMessage('Summary cannot exceed 500 characters'),
  body('rootCause')
    .optional()
    .isLength({ max: 500 }),
  body('preventiveMeasures')
    .optional()
    .isLength({ max: 500 }),
  handleValidationErrors
];