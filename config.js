'use strict';
// Central place for "where does this run?" decisions.
// Locally: everything works with no setup. Online (Railway): a Volume is used for permanent storage.
const path = require('path');
const env = process.env;
const ON_RAILWAY = Object.keys(env).some(k => k.startsWith('RAILWAY_'));
const IS_PROD = env.NODE_ENV === 'production' || ON_RAILWAY;
const VOLUME = env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || '';
const DATA_DIR = VOLUME || path.join(__dirname, 'data');
const UPLOADS_DIR = env.UPLOADS_DIR || (VOLUME ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, 'public', 'uploads'));
// Online without a volume means data is wiped on every update - we warn loudly about that.
const PERSISTENT = !IS_PROD || !!VOLUME;
module.exports = { IS_PROD, ON_RAILWAY, DATA_DIR, UPLOADS_DIR, PERSISTENT };
