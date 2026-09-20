// Makes sure the computer has a new enough Node.js before starting the store.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.log('\n  Your Node.js is version ' + process.versions.node + ', which is too old for the AZHARS store.');
  console.log('  Please install the latest LTS version (24 or newer) from https://nodejs.org');
  console.log('  then run this file again.\n');
  process.exit(1);
}
