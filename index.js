const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "my_super_secret_admin_password_123";

const readDB = async () => {
    try {
        const res = await fetch(`${process.env.KV_REST_API_URL}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["GET", "licenses"])
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.result ? JSON.parse(data.result) : [];
    } catch (e) { return []; }
};

const saveDB = async (data) => {
    const res = await fetch(`${process.env.KV_REST_API_URL}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["SET", "licenses", JSON.stringify(data)]) 
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
};

// ==========================================
// 0. HEALTH CHECK ROUTE (Fixes "Cannot GET /")
// ==========================================
app.get('/', (req, res) => {
    res.send('✅ Baraka Master Server is Live and Routing Correctly!');
});

// ==========================================
// 1. POS ROUTE: Activate License
// ==========================================
app.post('/api/activate-license', async (req, res) => {
    const { key, action } = req.body;
    
    // --- HARDCODED TEST KEY FOR DEBUGGING ---
    if (key === 'BB-TEST') {
        return res.json({ valid: true, validUntil: "2099-12-31T23:59:59.000Z", client: "Local Test Debug" });
    }
    // ----------------------------------------

    const clients = await readDB();
    const licenseIndex = clients.findIndex(c => c.key === key);

    if (licenseIndex === -1) return res.status(404).json({ error: "Invalid License Key." });
    
    const license = clients[licenseIndex];
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    license.maxUses = license.maxUses || 1; 
    license.useCount = license.useCount || 0;

    if (action === 'activate') {
        if (license.useCount >= license.maxUses) {
            return res.status(403).json({ error: "This License Key has reached its maximum activation limit." });
        }
        clients[licenseIndex].useCount += 1;
        await saveDB(clients);
    }

    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// 2. POS ROUTE: Verify License (Heartbeat)
// ==========================================
app.post('/api/verify-license', async (req, res) => {
    const { licenseKey } = req.body;
    
    if (licenseKey === 'BB-TEST') {
        return res.json({ valid: true, validUntil: "2099-12-31T23:59:59.000Z", client: "Local Test Debug" });
    }

    const clients = await readDB();
    const license = clients.find(c => c.key === licenseKey);

    if (!license) return res.status(404).json({ error: "Invalid License Key." });
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// ADMIN ROUTES
// ==========================================
app.post('/admin/generate-key', async (req, res) => {
    const secretProvided = req.body.adminSecret; 
    const { clientName, duration, unit, exactDate, maxUses } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    let expiryDate = new Date();
    if (exactDate) {
        expiryDate = new Date(exactDate);
    } else {
        const amount = parseInt(duration) || 30; 
        if (unit === 'minutes') expiryDate.setMinutes(expiryDate.getMinutes() + amount);
        else if (unit === 'hours') expiryDate.setHours(expiryDate.getHours() + amount);
        else expiryDate.setDate(expiryDate.getDate() + amount);
    }

    const newLicense = {
        key: `BB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        client: clientName || "Unknown Client",
        validUntil: expiryDate.toISOString(),
        active: true,
        maxUses: parseInt(maxUses) || 1,
        useCount: 0
    };

    try {
        const clients = await readDB(); 
        clients.push(newLicense); 
        await saveDB(clients); 
        res.json({ message: "Key Generated successfully", data: newLicense });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/view-licenses', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        res.json({ licenses: clients });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🛑 CRITICAL FIX FOR VERCEL 🛑
// Do NOT use app.listen(). Export the Express app so Vercel can route it.
module.exports = app;
