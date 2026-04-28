const Counter = require('../models/Counter');

const getNextSequence = async (name) => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name },
      { $inc: { value: 1 } },
      { 
        new: true, 
        upsert: true,
        setDefaultsOnInsert: true
      }
    );
    
    if (!counter) {
      throw new Error('Failed to get counter');
    }
    
    return counter.value;
  } catch (error) {
    console.error('Error in getNextSequence:', error);
    throw error;
  }
};

const getPlazaShortCode = (name = '') => {
  if (!name) return 'GEN';
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const code = cleanName.slice(0, 5);
  return code || 'GEN';
};

const generateReportId = async (plazaId, plazaName) => {
  try {
    if (!plazaId) {
      throw new Error('plazaId is required');
    }
    if (!plazaName) {
      throw new Error('plazaName is required');
    }

    const shortCode = getPlazaShortCode(plazaName);
    const now = new Date();
    const datePart = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
  
    const counterKey = `${shortCode}-${datePart}`;
    
    console.log('🔑 Counter Key:', counterKey);
    
    let retries = 3;
    let seq;
    
    while (retries > 0) {
      try {
        seq = await getNextSequence(counterKey);
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`Retry attempt ${3 - retries} for counter key: ${counterKey}`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before retry
      }
    }
    
    const seqPart = String(seq).padStart(4, '0');
    const reportId = `TMR-${shortCode}-${datePart}-${seqPart}`;
    
    const TollMaintenanceReport = require('../models/MaintenanceReport');
    const existingReport = await TollMaintenanceReport.findOne({ reportId });
    
    if (existingReport) {
      console.warn(`⚠️ Duplicate detected for ${reportId}, retrying...`);
      return generateReportId(plazaId, plazaName);
    }
    
    console.log('✅ Generated Report ID:', reportId);
    return reportId;
  } catch (error) {
    console.error('❌ Error in generateReportId:', error);
    const fallbackId = `TMR-${Date.now()}-${plazaId.toString().slice(-4)}-${Math.random().toString(36).substr(2, 4)}`;
    console.log('⚠️ Using fallback ID:', fallbackId);
    return fallbackId;
  }
};

module.exports = generateReportId;