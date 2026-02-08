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

// ============================================
// OAuth Routes
// ============================================

/**
 * Start OAuth flow - redirect to Shopify authorization
 * Visit: http://localhost:3000/shopify/auth
 */
router.get("/auth", async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;

    const authUrl = await shopify.auth.begin({
        shop,
        callbackPath: "/shopify/callback",
        isOnline: false,
        rawRequest: req,
        rawResponse: res,
    });

    res.redirect(authUrl);
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
