const express = require('express');
const cors = require('cors');

const app = express();

/* =========================================
   CONFIG
========================================= */

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* =========================================
   HELPERS
========================================= */

async function readDB() {
    try {
        const response = await fetch(KV_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${KV_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(["GET", "licenses"])
        });

        if (!response.ok) {
            throw new Error(`KV GET failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data.result) {
            return [];
        }

        return JSON.parse(data.result);

    } catch (error) {
        console.error("readDB error:", error.message);
        return [];
    }
}

async function saveDB(data) {
    try {
        const response = await fetch(KV_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${KV_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([
                "SET",
                "licenses",
                JSON.stringify(data)
            ])
        });

        if (!response.ok) {
            throw new Error(`KV SET failed: ${response.status}`);
        }

        return true;

    } catch (error) {
        console.error("saveDB error:", error.message);
        throw error;
    }
}

function generateKey() {
    return `BB-${Math.random()
        .toString(36)
        .slice(2, 10)
        .toUpperCase()}`;
}

function checkAdmin(req, res) {
    const secret = req.body.adminSecret;

    if (!secret || secret !== ADMIN_SECRET) {
        res.status(401).json({
            error: "Unauthorized"
        });

        return false;
    }

    return true;
}

/* =========================================
   HEALTH CHECK
========================================= */

app.get('/', (req, res) => {
    res.send('✅ Baraka Master Server is Live!');
});

/* =========================================
   POS ROUTE: ACTIVATE LICENSE
========================================= */

app.post('/api/activate-license', async (req, res) => {
    try {

        const { key, action } = req.body;

        if (!key) {
            return res.status(400).json({
                error: "License key is required"
            });
        }

        // DEBUG TEST KEY
        if (key === 'BB-TEST') {
            return res.json({
                valid: true,
                validUntil: "2099-12-31T23:59:59.000Z",
                client: "Local Test Debug"
            });
        }

        const licenses = await readDB();

        const index = licenses.findIndex(
            lic => lic.key === key
        );

        if (index === -1) {
            return res.status(404).json({
                error: "Invalid License Key"
            });
        }

        const license = licenses[index];

        if (!license.active) {
            return res.status(403).json({
                error: "License disabled by admin"
            });
        }

        const now = new Date();
        const expiry = new Date(license.validUntil);

        if (now > expiry) {
            return res.status(403).json({
                error: "License expired"
            });
        }

        license.maxUses = license.maxUses || 1;
        license.useCount = license.useCount || 0;

        if (action === 'activate') {

            if (license.useCount >= license.maxUses) {
                return res.status(403).json({
                    error: "Activation limit reached"
                });
            }

            licenses[index].useCount += 1;

            await saveDB(licenses);
        }

        return res.json({
            valid: true,
            validUntil: license.validUntil,
            client: license.client,
            planType: license.planType || "basic",
            maxUsers: license.maxUsers || 3,
            hasReports: license.hasReports || false
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Internal server error"
        });
    }
});

/* =========================================
   POS ROUTE: VERIFY LICENSE
========================================= */

app.post('/api/verify-license', async (req, res) => {

    try {

        const { licenseKey } = req.body;

        if (!licenseKey) {
            return res.status(400).json({
                error: "License key required"
            });
        }

        // DEBUG TEST KEY
        if (licenseKey === 'BB-TEST') {
            return res.json({
                valid: true,
                validUntil: "2099-12-31T23:59:59.000Z",
                client: "Local Test Debug"
            });
        }

        const licenses = await readDB();

        const license = licenses.find(
            lic => lic.key === licenseKey
        );

        if (!license) {
            return res.status(404).json({
                error: "Invalid License Key"
            });
        }

        if (!license.active) {
            return res.status(403).json({
                error: "License disabled by admin"
            });
        }

        const now = new Date();
        const expiry = new Date(license.validUntil);

        if (now > expiry) {
            return res.status(403).json({
                error: "License expired"
            });
        }

        return res.json({
            valid: true,
            validUntil: license.validUntil,
            client: license.client,
            planType: license.planType || "basic",
            maxUsers: license.maxUsers || 3,
            hasReports: license.hasReports || false
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Internal server error"
        });
    }
});

/* =========================================
   ADMIN: GENERATE LICENSE
========================================= */

app.post('/admin/generate-key', async (req, res) => {

    try {

        if (!checkAdmin(req, res)) return;

        const {
            clientName,
            duration,
            unit,
            exactDate,
            maxUses,
            planType,
            maxUsers,
            hasReports
        } = req.body;

        let expiryDate = new Date();

        if (exactDate) {

            expiryDate = new Date(exactDate);

        } else {

            const amount = parseInt(duration) || 30;

            if (unit === 'minutes') {
                expiryDate.setMinutes(
                    expiryDate.getMinutes() + amount
                );

            } else if (unit === 'hours') {

                expiryDate.setHours(
                    expiryDate.getHours() + amount
                );

            } else {

                expiryDate.setDate(
                    expiryDate.getDate() + amount
                );
            }
        }

        const newLicense = {
            key: generateKey(),
            client: clientName || "Unknown Client",
            validUntil: expiryDate.toISOString(),
            active: true,

            maxUses: parseInt(maxUses) || 1,
            useCount: 0,

            planType: planType || "basic",
            maxUsers: parseInt(maxUsers) || 3,
            hasReports: Boolean(hasReports),

            createdAt: new Date().toISOString()
        };

        const licenses = await readDB();

        licenses.push(newLicense);

        await saveDB(licenses);

        return res.json({
            success: true,
            message: "License generated successfully",
            data: newLicense
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Failed to generate license"
        });
    }
});

/* =========================================
   ADMIN: VIEW LICENSES
========================================= */

app.post('/admin/view-licenses', async (req, res) => {

    try {

        if (!checkAdmin(req, res)) return;

        const licenses = await readDB();

        return res.json({
            success: true,
            total: licenses.length,
            licenses
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Failed to load licenses"
        });
    }
});

/* =========================================
   ADMIN: REVOKE LICENSE
========================================= */

app.post('/admin/revoke-key', async (req, res) => {

    try {

        if (!checkAdmin(req, res)) return;

        const { licenseKey } = req.body;

        const licenses = await readDB();

        const index = licenses.findIndex(
            lic => lic.key === licenseKey
        );

        if (index === -1) {
            return res.status(404).json({
                error: "License not found"
            });
        }

        licenses[index].active = false;

        await saveDB(licenses);

        return res.json({
            success: true,
            message: "License revoked"
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Failed to revoke license"
        });
    }
});

/* =========================================
   ADMIN: RESUME LICENSE
========================================= */

app.post('/admin/resume-key', async (req, res) => {

    try {

        if (!checkAdmin(req, res)) return;

        const { licenseKey } = req.body;

        const licenses = await readDB();

        const index = licenses.findIndex(
            lic => lic.key === licenseKey
        );

        if (index === -1) {
            return res.status(404).json({
                error: "License not found"
            });
        }

        licenses[index].active = true;

        await saveDB(licenses);

        return res.json({
            success: true,
            message: "License resumed"
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Failed to resume license"
        });
    }
});

/* =========================================
   ADMIN: EXTEND LICENSE
========================================= */

app.post('/admin/extend-key', async (req, res) => {

    try {

        if (!checkAdmin(req, res)) return;

        const {
            licenseKey,
            duration,
            unit
        } = req.body;

        const licenses = await readDB();

        const index = licenses.findIndex(
            lic => lic.key === licenseKey
        );

        if (index === -1) {
            return res.status(404).json({
                error: "License not found"
            });
        }

        const expiry = new Date(
            licenses[index].validUntil
        );

        const amount = parseInt(duration) || 30;

        if (unit === 'minutes') {

            expiry.setMinutes(
                expiry.getMinutes() + amount
            );

        } else if (unit === 'hours') {

            expiry.setHours(
                expiry.getHours() + amount
            );

        } else {

            expiry.setDate(
                expiry.getDate() + amount
            );
        }

        licenses[index].validUntil =
            expiry.toISOString();

        await saveDB(licenses);

        return res.json({
            success: true,
            message: "License extended",
            validUntil: licenses[index].validUntil
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Failed to extend license"
        });
    }
});

/* =========================================
   404 HANDLER
========================================= */

app.use((req, res) => {
    res.status(404).json({
        error: "Route not found"
    });
});

/* =========================================
   EXPORT FOR VERCEL
========================================= */

module.exports = app;
