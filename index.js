const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = "my_super_secret_admin_password_123"; // Make sure this matches your HTML!

// ==========================================
// 🗄️ UPSTASH CLOUD DB - BULLETPROOF POST
// ==========================================
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
// 1. CLIENT ROUTE (What the POS checks every 30s)
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
// 2. ADMIN ROUTE: Generate Key
// ==========================================
app.post('/admin/generate-key', async (req, res) => {
    const secretProvided = req.body.adminSecret; 
    const { clientName, duration, unit, exactDate } = req.body;
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
        active: true
    };

    try {
        const clients = await readDB(); 
        clients.push(newLicense); 
        await saveDB(clients); 
        res.json({ message: "Key Generated successfully", data: newLicense });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 3. ADMIN ROUTE: Revoke (Kill) Key
// ==========================================
app.post('/admin/revoke-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        clients[licenseIndex].active = false; 
        await saveDB(clients); 
        res.json({ message: `Client locked out successfully.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 4. ADMIN ROUTE: Resume (Un-Kill) Key
// ==========================================
app.post('/admin/resume-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        clients[licenseIndex].active = true; 
        await saveDB(clients); 
        res.json({ message: `Client access resumed successfully.`, validUntil: clients[licenseIndex].validUntil });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 5. ADMIN ROUTE: Extend Key Validity
// ==========================================
app.post('/admin/extend-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey, duration, unit, exactDate } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        let currentExpiry = new Date(clients[licenseIndex].validUntil);
        const now = new Date();
        
        // If the key was already expired in the past, start the new timer from RIGHT NOW
        if (currentExpiry < now) currentExpiry = now;

        if (exactDate) {
            clients[licenseIndex].validUntil = new Date(exactDate).toISOString();
        } else {
            const amount = parseInt(duration) || 0; 
            if (unit === 'minutes') currentExpiry.setMinutes(currentExpiry.getMinutes() + amount);
            else if (unit === 'hours') currentExpiry.setHours(currentExpiry.getHours() + amount);
            else currentExpiry.setDate(currentExpiry.getDate() + amount);
            
            clients[licenseIndex].validUntil = currentExpiry.toISOString();
        }
        
        clients[licenseIndex].active = true; // Automatically un-revoke if we are extending it!
        await saveDB(clients); 
        
        res.json({ 
            message: `License extended successfully.`, 
            newExpiry: clients[licenseIndex].validUntil 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`📡 Baraka Master Server running on port ${PORT}`));
