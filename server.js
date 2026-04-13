const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3030;

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Root route - serve FortunaTrade dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'FortunaTrade-unified.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'VidiFund', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`VidiFund server running on port ${PORT}`);
});
