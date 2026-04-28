// utils/transformNotification.js
const Plaza = require('../models/TollPlaza');

class NotificationTransformer {
  // Static cache for plazas to avoid duplicate queries
  static plazaCache = new Map();
  
  static async getPlazaWithCache(plazaId) {
    if (!plazaId) return null;
    
    // Check cache first
    if (this.plazaCache.has(plazaId.toString())) {
      return this.plazaCache.get(plazaId.toString());
    }
    
    const plaza = await Plaza.findById(plazaId)
      .select('_id name code location operationalStatus')
      .lean();
    
    if (plaza) {
      const plazaObject = {
        id: plaza._id,
        name: plaza.name,
        code: plaza.code,
        location: plaza.location,
        operationalStatus: plaza.operationalStatus
      };
      this.plazaCache.set(plazaId.toString(), plazaObject);
      
      // Clear cache after 5 minutes
      setTimeout(() => this.plazaCache.delete(plazaId.toString()), 5 * 60 * 1000);
      
      return plazaObject;
    }
    
    return null;
  }
  
  static async transform(notification) {
    if (!notification) return notification;
    
    const notificationObj = notification.toObject ? notification.toObject() : { ...notification };
    
    if (notificationObj.data?.plazaId) {
      const plaza = await this.getPlazaWithCache(notificationObj.data.plazaId);
      if (plaza) {
        notificationObj.data.plaza = plaza;
      }
      delete notificationObj.data.plazaId;
    }
    
    return notificationObj;
  }
  
  static async transformMany(notifications) {
    if (!notifications || !notifications.length) return notifications;
    
    // Get unique plaza IDs
    const plazaIds = [...new Set(
      notifications
        .map(n => n.data?.plazaId)
        .filter(id => id)
        .map(id => id.toString())
    )];
    
    // Fetch all plazas in one query
    const plazas = await Plaza.find({ _id: { $in: plazaIds } })
      .select('_id name code location operationalStatus')
      .lean();
    
    // Create map for quick lookup
    const plazaMap = new Map();
    plazas.forEach(plaza => {
      plazaMap.set(plaza._id.toString(), {
        id: plaza._id,
        name: plaza.name,
        code: plaza.code,
        location: plaza.location,
        operationalStatus: plaza.operationalStatus
      });
    });
    
    // Transform all notifications
    return notifications.map(notification => {
      const notificationObj = { ...notification };
      
      if (notificationObj.data?.plazaId) {
        const plazaId = notificationObj.data.plazaId.toString();
        const plaza = plazaMap.get(plazaId);
        if (plaza) {
          notificationObj.data.plaza = plaza;
        }
        delete notificationObj.data.plazaId;
      }
      
      return notificationObj;
    });
  }
}

module.exports = NotificationTransformer;