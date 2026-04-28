const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = './uploads/excel';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /xlsx|xls/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );

  if (extname) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files are allowed (.xls, .xlsx)'));
  }
};

const excelUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

module.exports = excelUpload;