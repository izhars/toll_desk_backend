const User = require('../models/User');
const Counter = require('../models/Counter');

const generateEmployeeId = async () => {
  let counter = await Counter.findOne({ name: 'employeeId' });

  // 🧠 If counter not exists → initialize from DB
  if (!counter) {
    const lastUser = await User.findOne({
      employeeId: { $regex: /^SCAIPLH\d+$/ }
    }).sort({ employeeId: -1 });

    let lastNumber = 0;

    if (lastUser) {
      const match = lastUser.employeeId.match(/\d+/);
      lastNumber = match ? parseInt(match[0]) : 0;
    }

    counter = await Counter.create({
      name: 'employeeId',
      value: lastNumber
    });
  }

  // increment
  counter.value += 1;
  await counter.save();

  return `SCAIPLH${String(counter.value).padStart(3, '0')}`;
};

module.exports = generateEmployeeId;