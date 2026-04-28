// test-notifications.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const NotificationService = require('./src/services/NotificationService');
const User = require('./src/models/User');

// Load environment variables
dotenv.config();

// Test function
async function testNotifications() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check Firebase initialization
    if (!NotificationService.isFirebaseInitialized()) {
      console.log('❌ Firebase not initialized. Check your Firebase credentials.');
      return;
    }
    console.log('✅ Firebase initialized');

    // Get a test user (you can specify a user ID or email)
    const testUser = await User.findOne({ email: 'your-test-email@example.com' });
    
    if (!testUser) {
      console.log('❌ Test user not found');
      return;
    }

    console.log(`\n📱 Testing with user: ${testUser.name} (${testUser.email})`);
    console.log(`User ID: ${testUser._id}`);
    console.log(`FCM Tokens: ${testUser.fcmTokens?.length || 0}`);

    // Test 1: Send simple notification
    console.log('\n🔔 Test 1: Sending simple notification...');
    const result1 = await NotificationService.sendToUser(
      testUser._id,
      {
        title: 'Test Notification',
        body: 'This is a test notification from the system'
      },
      {
        type: 'test',
        testId: '12345'
      }
    );

    if (result1) {
      console.log('✅ Simple notification sent:', result1.successCount, 'successful');
    } else {
      console.log('❌ Failed to send simple notification');
    }

    // Test 2: Test different notification types
    console.log('\n🔔 Test 2: Testing report notifications...');
    
    // Mock report data
    const mockReport = {
      _id: new mongoose.Types.ObjectId(),
      title: 'Test Maintenance Issue',
      reportId: 'REP-2025-001',
      priority: 'high',
      issueType: 'electrical',
      department: 'maintenance',
      plazaId: new mongoose.Types.ObjectId(),
      reportedBy: { _id: testUser._id, name: testUser.name }
    };

    // Test new report notification
    await NotificationService.sendNewReportNotifications(
      mockReport,
      { name: testUser.name, _id: testUser._id }
    );
    console.log('✅ New report notification sent');

    // Test assignment notification
    await NotificationService.sendAssignmentNotification(
      mockReport,
      testUser._id,
      { name: 'Test Supervisor' }
    );
    console.log('✅ Assignment notification sent');

    // Test status update
    await NotificationService.sendStatusUpdateNotification(
      { ...mockReport, status: 'in-progress' },
      'pending',
      { name: testUser.name }
    );
    console.log('✅ Status update notification sent');

    // Test 3: Test critical alert
    console.log('\n🔔 Test 3: Testing critical alert...');
    await NotificationService.sendCriticalReportAlert(
      { ...mockReport, title: 'CRITICAL: Power Outage' },
      { name: testUser.name }
    );
    console.log('✅ Critical alert sent');

    // Test 4: Test token management
    console.log('\n🔔 Test 4: Testing token management...');
    
    // Get user tokens
    const tokens = await NotificationService.getUserTokens(testUser._id);
    console.log(`User has ${tokens.length} active tokens:`, tokens);

    // Test 5: Send to multiple users
    console.log('\n🔔 Test 5: Sending to multiple users...');
    const allUsers = await User.find({ role: 'employee' }).limit(3).select('_id');
    const userIds = allUsers.map(u => u._id);
    
    const result5 = await NotificationService.sendToMultipleUsers(
      userIds,
      {
        title: 'Bulk Test Notification',
        body: 'This is a test notification sent to multiple users'
      },
      { type: 'bulk_test' }
    );
    
    if (result5) {
      console.log(`✅ Bulk notification sent: ${result5.successCount} successful`);
    }

    // Test 6: Send to department
    console.log('\n🔔 Test 6: Sending to department...');
    await NotificationService.sendToDepartment(
      'maintenance',
      {
        title: 'Department Test',
        body: 'This is a test for the maintenance department'
      },
      { type: 'department_test' }
    );
    console.log('✅ Department notification sent');

    console.log('\n✨ All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n📡 Disconnected from MongoDB');
  }
}

// Run the tests
testNotifications();