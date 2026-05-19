const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "my_super_secret_admin_password_123";

// ==========================================
// 🗄️ UPSTASH CLOUD DB - BULLETPROOF POST SYNTAX
// ==========================================
const readDB = async () => {
    try {
        // We now send a POST to the root URL with the command in the body.
        // This is 100% cache-proof and officially supported by Upstash.
        const res = await fetch(`${process.env.KV_REST_API_URL}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(["GET", "licenses"])
        });
        
        if (!res.ok) {
            console.error(`🔴 Upstash Read Error: Status ${res.status}`);
            return [];
        }
        const data = await res.json();
        return data.result ? JSON.parse(data.result) : [];
    } catch (e) {
        console.error("🔴 Upstash Read Exception:", e.message);
        return [];
    }
};

const saveDB = async (data) => {
    // We send the SET command in the body as well!
    const res = await fetch(`${process.env.KV_REST_API_URL}`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(["SET", "licenses", JSON.stringify(data)]) 
    });
    
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Status ${res.status} - ${errText}`);
    }
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

    try {
        const clients = await readDB(); 
        clients.push(newLicense); 
        await saveDB(clients); 
        res.json({ message: "Key Generated successfully", data: newLicense });
    } catch (dbError) {
        console.error("🔴 Database Save Failure:", dbError.message);
        res.status(500).json({ error: `Cloud Database Rejected Save: ${dbError.message}` });
    }
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

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        clients[licenseIndex].active = false; 
        await saveDB(clients); 
        res.json({ message: `Client locked out successfully.` });
    } catch (dbError) {
        res.status(500).json({ error: `Database Revoke Failure: ${dbError.message}` });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`📡 Baraka Master Server running on port ${PORT}`));
