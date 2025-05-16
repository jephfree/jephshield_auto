const fs = require('fs');
const bcrypt = require('bcrypt');

// User credentials
const username = 'admin';
const password = 'admin123';

// Hash the password and write to users.json
bcrypt.hash(password, 10, (err, hash) => {
  if (err) throw err;

  const users = [{ username, password: hash }];
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  console.log('User saved with hashed password.');
});
