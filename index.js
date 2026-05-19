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
    // 1. Security Check (accepts either old or new payload names)
    const secretProvided = req.body.adminSecret || req.body.adminPassword; 
    const { clientName, duration, unit, exactDate, daysValid } = req.body;
    
    if (secretProvided !== ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // 2. --- NEW TIME ENGINE ---
    let expiryDate = new Date();
    
    if (exactDate) {
        // Mode 1: Admin picked an exact calendar date & time
        expiryDate = new Date(exactDate);
    } else {
        // Mode 2: Admin picked an amount of Days, Hours, or Minutes
        // (Falls back to the old 'daysValid' if you use an older Postman request)
        const amount = parseInt(duration) || parseInt(daysValid) || 30; 
        const timeUnit = unit || 'days';

        if (timeUnit === 'minutes') {
            expiryDate.setMinutes(expiryDate.getMinutes() + amount);
        } else if (timeUnit === 'hours') {
            expiryDate.setHours(expiryDate.getHours() + amount);
        } else {
            expiryDate.setDate(expiryDate.getDate() + amount); // defaults to days
        }
    }

    // 3. Forge the New License
    const newLicense = {
        key: `BB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        client: clientName || "Unknown Client",
        validUntil: expiryDate.toISOString(),
        active: true
    };

    // 4. Save to Vercel/KV Database
    const clients = readDB(); 
    clients.push(newLicense); 
    saveDB(clients);          
    
    res.json({ message: "Key Generated successfully", data: newLicense });
});

// ==========================================
// 3. ADMIN ROUTE: Lock a Client out
// ==========================================
app.post('/admin/revoke-key', (req, res) => {
    // Check both payload names just like the generate route!
    const secretProvided = req.body.adminSecret || req.body.adminPassword;
    const { licenseKey } = req.body;
    
    if (secretProvided !== ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const clients = readDB();
    const licenseIndex = clients.findIndex(c => c.key === licenseKey);
    
    if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

    clients[licenseIndex].active = false; // Lock them out
    saveDB(clients); // Save the change permanently!
    
    res.json({ message: `Client locked out successfully.` });
});
