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

app.get('/', (req, res) => { res.send('✅ Baraka SaaS Master Server is Live!'); });

// ==========================================
// POS ENDPOINTS (Lock Screen)
// ==========================================
app.post('/api/activate-license', async (req, res) => {
    const { key, action } = req.body;
    if (key === 'BB-TEST') return res.json({ valid: true, validUntil: "2099-12-31T23:59:59.000Z", client: "Local Test Debug", planType: "premium", maxUsers: 99 });

    const clients = await readDB();
    const licenseIndex = clients.findIndex(c => c.key === key);

    if (licenseIndex === -1) return res.status(404).json({ error: "Invalid License Key." });
    
    const license = clients[licenseIndex];
    if (!license.active) return res.status(403).json({ error: "Service Paused. Please contact support to resume your subscription." });

    license.maxUses = license.maxUses || 1; 
    license.useCount = license.useCount || 0;

    if (action === 'activate') {
        if (license.useCount >= license.maxUses) {
            return res.status(403).json({ error: "Activation limit reached for this key." });
        }
        clients[licenseIndex].useCount += 1;
        await saveDB(clients);
    }

    res.json({ valid: true, validUntil: license.validUntil, client: license.client, clientId: license.clientId, planType: license.planType, maxUsers: license.maxUsers });
});

app.post('/api/verify-license', async (req, res) => {
    const { licenseKey } = req.body;
    if (licenseKey === 'BB-TEST') return res.json({ valid: true, validUntil: "2099-12-31T23:59:59.000Z", client: "Local Test", planType: "premium", maxUsers: 99 });

    const clients = await readDB();
    const license = clients.find(c => c.key === licenseKey);

    if (!license) return res.status(404).json({ error: "Invalid License Key." });
    if (!license.active) return res.status(403).json({ error: "Service Paused." });

    res.json({ valid: true, validUntil: license.validUntil, client: license.client, clientId: license.clientId, planType: license.planType, maxUsers: license.maxUsers });
});

// ==========================================
// ADMIN DASHBOARD ENDPOINTS
// ==========================================
app.post('/admin/generate-key', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const { clientName, clientId, duration, unit, exactDate, maxUses, planType, maxUsers, hasReports } = req.body;

    let expiryDate = new Date();
    if (exactDate) expiryDate = new Date(exactDate);
    else {
        const amount = parseInt(duration) || 30; 
        if (unit === 'minutes') expiryDate.setMinutes(expiryDate.getMinutes() + amount);
        else if (unit === 'hours') expiryDate.setHours(expiryDate.getHours() + amount);
        else expiryDate.setDate(expiryDate.getDate() + amount);
    }

    // Assign existing Client ID for upgrades, or generate a permanent new one
    const assignedClientId = clientId && clientId.trim() !== "" ? clientId.trim() : `CID-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const newLicense = {
        clientId: assignedClientId,
        key: `BB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        client: clientName || "Unknown Client",
        createdAt: new Date().toISOString(),
        validUntil: expiryDate.toISOString(),
        active: true,
        pauseCount: 0,
        activationCount: 1, // First activation is system creation
        maxUses: parseInt(maxUses) || 1,
        useCount: 0,
        planType: planType || "basic", 
        maxUsers: maxUsers || 3,        
        hasReports: hasReports || false 
    };

    try {
        const clients = await readDB(); 
        clients.push(newLicense); 
        await saveDB(clients); 
        res.json({ message: `Key Generated! Client ID: ${assignedClientId}`, data: newLicense });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/revoke-key', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    try {
        const clients = await readDB();
        const index = clients.findIndex(c => c.key === req.body.licenseKey);
        if (index === -1) return res.status(404).json({ error: "Key not found." });
        
        clients[index].active = false;
        clients[index].pauseCount = (clients[index].pauseCount || 0) + 1; // Track pauses
        await saveDB(clients);
        res.json({ message: "Service successfully paused/revoked." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/resume-key', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    try {
        const clients = await readDB();
        const index = clients.findIndex(c => c.key === req.body.licenseKey);
        if (index === -1) return res.status(404).json({ error: "Key not found." });
        
        clients[index].active = true;
        clients[index].activationCount = (clients[index].activationCount || 0) + 1; // Track reactivations
        await saveDB(clients);
        res.json({ message: "Service successfully resumed." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ THE FIX: The new endpoint to reset device activations!
app.post('/admin/reset-uses', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    try {
        const clients = await readDB();
        const index = clients.findIndex(c => c.key === req.body.licenseKey);
        if (index === -1) return res.status(404).json({ error: "Key not found." });
        
        clients[index].useCount = 0; // Resets the activation counter back to 0
        await saveDB(clients);
        
        res.json({ message: "Device activations reset to 0. The key is unlocked!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/extend-key', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    try {
        const clients = await readDB();
        const index = clients.findIndex(c => c.key === req.body.licenseKey);
        if (index === -1) return res.status(404).json({ error: "Key not found." });
        
        const amount = parseInt(req.body.duration) || 30; 
        const unit = req.body.unit || 'days';
        let newExpiry = new Date(clients[index].validUntil);
        
        // If already expired, start extension from TODAY
        if (newExpiry < new Date()) newExpiry = new Date();

        if (unit === 'minutes') newExpiry.setMinutes(newExpiry.getMinutes() + amount);
        else if (unit === 'hours') newExpiry.setHours(newExpiry.getHours() + amount);
        else newExpiry.setDate(newExpiry.getDate() + amount);

        clients[index].validUntil = newExpiry.toISOString();
        await saveDB(clients);
        res.json({ message: `Subscription extended until ${newExpiry.toLocaleDateString()}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/view-licenses', async (req, res) => {
    if (req.body.adminSecret !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
    try {
        const clients = await readDB();
        res.json({ licenses: clients });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = app;
