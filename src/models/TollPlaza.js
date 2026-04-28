const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const SENSITIVE_FIELDS = ['anydeskPass', 'windowPass', 'dbPass'];

const tollPlazaSchema = new mongoose.Schema({
  name: { type: String, required: true },
  plazaId: { type: String, required: true, unique: true },

  location: {
    highway: String, city: String, state: String, kmPost: Number,
    coordinates: { lat: Number, lng: Number }
  },

  lanes: [{
    laneNumber: Number,
    type: { type: String, enum: ['manual', 'automatic', 'fastag', 'hybrid'], required: true },
    status: { type: String, enum: ['operational', 'maintenance', 'faulty', 'closed'], default: 'operational' },
    lastMaintenance: Date,
    nextMaintenance: Date
  }],

  equipment: [{
    type: { type: String, enum: ['boom_barrier','cctv','lighting','signage','weighbridge','server','ups','antenna','display_board','sensor'] },
    count: Number,
    status: { type: String, enum: ['operational', 'maintenance', 'faulty'], default: 'operational' }
  }],

  operationalStatus: {
    type: String,
    enum: ['operational', 'maintenance', 'partial', 'closed'],
    default: 'operational'
  },

  qrCode: String,
  contactPerson: { name: String, phone: String, email: String },
  maintenanceSchedule: { daily: Date, weekly: Date, monthly: Date },
  lastInspection: Date,
  nextInspection: Date,

  bank:         { type: String },
  client:       { type: String },
  anydeskId:    { type: String },
  anydeskPass:  { type: String },  // stored encrypted
  windowPass:   { type: String },  // stored encrypted
  dbPass:       { type: String },  // stored encrypted
  dbBackupPath: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ── Encrypt before save ───────────────────────────────────────────────────────
tollPlazaSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  for (const field of SENSITIVE_FIELDS) {
    if (this.isModified(field) && this[field]) {
      this[field] = encrypt(this[field]);
    }
  }
  next();
});

// Also encrypt on findOneAndUpdate / updateOne / updateMany
function encryptOnUpdate(next) {
  const update = this.getUpdate();
  for (const field of SENSITIVE_FIELDS) {
    if (update[field]) update[field] = encrypt(update[field]);
    if (update.$set?.[field]) update.$set[field] = encrypt(update.$set[field]);
  }
  next();
}
tollPlazaSchema.pre('findOneAndUpdate', encryptOnUpdate);
tollPlazaSchema.pre('updateOne', encryptOnUpdate);
tollPlazaSchema.pre('updateMany', encryptOnUpdate);

// ── Decrypt after fetch ───────────────────────────────────────────────────────
function decryptDoc(doc) {
  if (!doc) return;
  for (const field of SENSITIVE_FIELDS) {
    if (doc[field]) doc[field] = decrypt(doc[field]);
  }
}

tollPlazaSchema.post('save', decryptDoc);
tollPlazaSchema.post('find', (docs) => docs.forEach(decryptDoc));
tollPlazaSchema.post('findOne', decryptDoc);
tollPlazaSchema.post('findOneAndUpdate', decryptDoc);

module.exports = mongoose.model('TollPlaza', tollPlazaSchema);