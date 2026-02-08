import { Router } from "express";
import {
    shopify,
    getAccessToken,
    setAccessToken,
    getProductMetafields,
    setProductMetafield,
    setProductMetafields,
    updateMetafield,
    deleteMetafield,
    getProduct,
} from "../services/shopify.js";

const router = Router();
import multer from "multer";
import { uploadFileToShopify } from "../services/shopify.js";

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Upload a file to Shopify
 * POST /shopify/upload
 * Content-Type: multipart/form-data (field: file)
 * OR
 * Content-Type: application/json (body: { filename, mimetype, base64 })
 */
router.post("/upload", upload.single("file"), async (req, res) => {
    try {
        let fileData;

        // Check if file is uploaded via multipart/form-data
        if (req.file) {
            fileData = {
                name: req.file.originalname,
                type: req.file.mimetype,
                size: req.file.size,
                buffer: req.file.buffer,
            };
        }
        // Check if file is provided as base64 in body (JSON)
        else if (req.body.base64 && req.body.filename && req.body.mimetype) {
            const buffer = Buffer.from(req.body.base64, "base64");
            fileData = {
                name: req.body.filename,
                type: req.body.mimetype,
                size: buffer.length,
                buffer: buffer,
            };
        } else {
            return res.status(400).json({ error: "No file uploaded. Provide 'file' (multipart) or 'base64', 'filename', and 'mimetype' (JSON)." });
        }

        const fileId = await uploadFileToShopify(fileData);

        res.json({
            success: true,
            fileId,
            message: "File uploaded to Shopify. You can now use this fileId in metafields."
        });
    } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// OAuth Routes
// ============================================

/**
 * Start OAuth flow - redirect to Shopify authorization
 * Visit: http://localhost:3000/shopify/auth
 */
router.get("/auth", async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;

    console.log("🔍 OAuth Debug Info:");
    console.log("Shop:", shop);
    console.log("Host Name:", shopify.config.hostName);
    console.log("Host Scheme:", shopify.config.hostScheme);
    console.log("Expected Callback URL:", `${shopify.config.hostScheme}://${shopify.config.hostName}/shopify/callback`);

    await shopify.auth.begin({
        shop,
        callbackPath: "/shopify/callback",
        isOnline: false,
        rawRequest: req,
        rawResponse: res,
    });
});

/**
 * OAuth callback - exchange code for access token
 */
router.get("/callback", async (req, res) => {
    try {
        const callback = await shopify.auth.callback({
            rawRequest: req,
            rawResponse: res,
        });

        // Store the access token
        setAccessToken(callback.session.accessToken);

        console.log("✅ Shopify OAuth successful!");
        console.log("Access Token:", callback.session.accessToken.substring(0, 20) + "...");

        res.send(`
            <html>
                <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                    <h1>✅ Conectado a Shopify!</h1>
                    <p>El servidor ahora puede acceder a la API de Shopify.</p>
                    <p>Puedes cerrar esta ventana.</p>
                </body>
            </html>
        `);
    } catch (error) {
        console.error("OAuth error:", error);
        res.status(500).send("Error en autenticación: " + error.message);
    }
});

/**
 * Check if authenticated
 */
router.get("/status", (req, res) => {
    const token = getAccessToken();
    res.json({
        authenticated: !!token,
        store: process.env.SHOPIFY_STORE_DOMAIN,
    });
});

// ============================================
// Product Metafield Routes
// ============================================

/**
 * Get all metafields for a product
 * GET /shopify/products/:productId/metafields
 */
router.get("/products/:productId/metafields", async (req, res) => {
    try {
        const { productId } = req.params;
        const metafields = await getProductMetafields(productId);
        res.json({ metafields });
    } catch (error) {
        console.error("Error getting metafields:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Create a metafield for a product
 * POST /shopify/products/:productId/metafields
 * Body: { namespace, key, value, type }
 */
router.post("/products/:productId/metafields", async (req, res) => {
    try {
        const { productId } = req.params;
        const { namespace, key, value, type } = req.body;

        const metafield = await setProductMetafield(productId, {
            namespace,
            key,
            value,
            type,
        });

        res.json({ metafield });
    } catch (error) {
        console.error("Error creating metafield:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Create multiple metafields for a product
 * POST /shopify/products/:productId/metafields/bulk
 * Body: { metafields: [{ namespace, key, value, type }, ...] }
 */
router.post("/products/:productId/metafields/bulk", async (req, res) => {
    try {
        const { productId } = req.params;
        const { metafields } = req.body;

        const results = await setProductMetafields(productId, metafields);
        res.json({ metafields: results });
    } catch (error) {
        console.error("Error creating metafields:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update a metafield
 * PUT /shopify/metafields/:metafieldId
 * Body: { value, type }
 */
router.put("/metafields/:metafieldId", async (req, res) => {
    try {
        const { metafieldId } = req.params;
        const { value, type } = req.body;

        const metafield = await updateMetafield(metafieldId, { value, type });
        res.json({ metafield });
    } catch (error) {
        console.error("Error updating metafield:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete a metafield
 * DELETE /shopify/metafields/:metafieldId
 */
router.delete("/metafields/:metafieldId", async (req, res) => {
    try {
        const { metafieldId } = req.params;
        await deleteMetafield(metafieldId);
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting metafield:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get product details
 * GET /shopify/products/:productId
 */
router.get("/products/:productId", async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await getProduct(productId);
        res.json({ product });
    } catch (error) {
        console.error("Error getting product:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
