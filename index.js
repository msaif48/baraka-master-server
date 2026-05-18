const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "my_super_secret_admin_password_123";

// 🗄️ THE PERMANENT DATABASE LOGIC
const DB_FILE = path.join(__dirname, 'master_database.json');

// Helper function to read the database
const readDB = () => {
    if (!fs.existsSync(DB_FILE)) return []; // If file doesn't exist, return empty array
    return JSON.parse(fs.readFileSync(DB_FILE));
};

// Helper function to save to the database
const saveDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// ==========================================
// 1. CLIENT ROUTE: What the POS software pings
// ==========================================
app.post('/api/verify-license', (req, res) => {
    const { licenseKey } = req.body;
    const clients = readDB(); // Read fresh from the hard drive
    const license = clients.find(c => c.key === licenseKey);

    if (!license) return res.status(404).json({ error: "Invalid License Key." });
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// 2. ADMIN ROUTE: Generate a new Key
// ==========================================
app.post('/admin/generate-key', (req, res) => {
    const { adminPassword, clientName, daysValid } = req.body;
    if (adminPassword !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const now = new Date();
    const expiry = new Date(now.getTime() + (daysValid * 24 * 60 * 60 * 1000));

    const newLicense = {
        key: `BB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        client: clientName,
        validUntil: expiry.toISOString(),
        active: true
    };

    const clients = readDB(); // Get current clients
    clients.push(newLicense); // Add the new one
    saveDB(clients);          // Save it permanently!
    
    res.json({ message: "Key Generated successfully", data: newLicense });
});

// ==========================================
// 3. ADMIN ROUTE: Lock a Client out
// ==========================================
app.post('/admin/revoke-key', (req, res) => {
    const { adminPassword, licenseKey } = req.body;
    if (adminPassword !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const clients = readDB();
    const licenseIndex = clients.findIndex(c => c.key === licenseKey);
    
    if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

    clients[licenseIndex].active = false; // Lock them out
    saveDB(clients); // Save the change permanently!
    
    res.json({ message: `Client locked out successfully.` });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`📡 Baraka Master Server running on port ${PORT}`));