const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "my_super_secret_admin_password_123";

// ==========================================
// 🗄️ CACHE-BUSTING UPSTASH CLOUD DB
// ==========================================
const readDB = async () => {
    try {
        // We added a timestamp (?_t) and 'no-store' so Vercel is FORCED to fetch fresh data!
        const res = await fetch(`${process.env.KV_REST_API_URL}/get/licenses?_t=${Date.now()}`, {
            headers: { 
                'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                'Cache-Control': 'no-cache, no-store'
            },
            cache: 'no-store'
        });
        const data = await res.json();
        return data.result ? JSON.parse(data.result) : [];
    } catch (e) {
        return [];
    }
};

const saveDB = async (data) => {
    try {
        await fetch(`${process.env.KV_REST_API_URL}/set/licenses`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data) 
        });
    } catch (e) {}
};

// ==========================================
// 1. CLIENT ROUTE: What the POS software pings
// ==========================================
app.post('/api/verify-license', async (req, res) => {
    const { licenseKey } = req.body;
    
    const clients = await readDB();
    const license = clients.find(c => c.key === licenseKey);

    if (!license) return res.status(404).json({ error: "Invalid License Key." });
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// 2. ADMIN ROUTE: Generate a new Key
// ==========================================
app.post('/admin/generate-key', async (req, res) => {
    const secretProvided = req.body.adminSecret || req.body.adminPassword; 
    const { clientName, duration, unit, exactDate, daysValid } = req.body;
    
    if (secretProvided !== ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    let expiryDate = new Date();
    
    if (exactDate) {
        expiryDate = new Date(exactDate);
    } else {
        const amount = parseInt(duration) || parseInt(daysValid) || 30; 
        const timeUnit = unit || 'days';

        if (timeUnit === 'minutes') {
            expiryDate.setMinutes(expiryDate.getMinutes() + amount);
        } else if (timeUnit === 'hours') {
            expiryDate.setHours(expiryDate.getHours() + amount);
        } else {
            expiryDate.setDate(expiryDate.getDate() + amount);
        }
    }

    const newLicense = {
        key: `BB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        client: clientName || "Unknown Client",
        validUntil: expiryDate.toISOString(),
        active: true
    };

    const clients = await readDB(); 
    clients.push(newLicense); 
    await saveDB(clients);
    
    res.json({ message: "Key Generated successfully", data: newLicense });
});

// ==========================================
// 3. ADMIN ROUTE: Lock a Client out
// ==========================================
app.post('/admin/revoke-key', async (req, res) => {
    const secretProvided = req.body.adminSecret || req.body.adminPassword;
    const { licenseKey } = req.body;
    
    if (secretProvided !== ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const clients = await readDB();
    const licenseIndex = clients.findIndex(c => c.key === licenseKey);
    
    if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

    clients[licenseIndex].active = false; 
    await saveDB(clients); 
    
    res.json({ message: `Client locked out successfully.` });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`📡 Baraka Master Server running on port ${PORT}`));
