require('dotenv').config();

const express = require('express');
const path = require('path');
const cache = require('./cache');
const { startPolling } = require('./poller');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/data', (req, res) => {
  res.json(cache.getAll());
});

// Register data sources here as they're added (Phase 2+)
const sources = [
  // require('./sources/weather'),
  // require('./sources/calendar'),
];

startPolling(sources);

app.listen(PORT, () => {
  console.log(`MirrorOS running at http://localhost:${PORT}`);
});
