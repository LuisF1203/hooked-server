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
    verifyCustomerOwnsProduct,
    verifyOrderContainsProduct,
    uploadFileToShopify,
} from "../services/shopify.js";

const router = Router();
import multer from "multer";
import crypto from "crypto";

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Verify HMAC signature from Liquid
 */
function verifyShopifySignature(customerId, signature) {
    // If no secret is set, we can't verify. 
    // WARN: In production, this should be enforced.
    if (!process.env.SHOPIFY_CUSTOMER_SECRET) {
        console.warn("⚠️ SHOPIFY_CUSTOMER_SECRET not set. Skipping signature verification.");
        return true;
    }

    const hash = crypto.createHmac('sha256', process.env.SHOPIFY_CUSTOMER_SECRET)
        .update(customerId.toString())
        .digest('hex');

    return hash === signature;
}

/**
 * Upload a file to Shopify
 * POST /shopify/upload
 * Content-Type: multipart/form-form (field: file)
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

        const uploadResult = await uploadFileToShopify(fileData);

        res.json({
            success: true,
            fileId: uploadResult.fileId,
            url: uploadResult.url,
            message: "File uploaded to Shopify. You can now use this fileId in metafields."
        });
    } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Upload a file to Shopify AND assign it to a product metafield
 * POST /shopify/upload-and-assign
 * Content-Type: multipart/form-data (field: file, field: productId)
 */
router.post("/upload-and-assign", upload.single("file"), async (req, res) => {
    try {
        const { productId, customerId, signature, orderId } = req.body;

        if (!productId) {
            return res.status(400).json({ error: "No productId provided." });
        }

        let isAuthorized = false;

        // 1. Verify Authentication & Ownership
        if (customerId) {
            // Verify Signature (optional but recommended)
            if (signature && !verifyShopifySignature(customerId, signature)) {
                return res.status(401).json({ error: "Invalid signature. Authentication failed." });
            }

            // Verify Ownership
            const ownership = await verifyCustomerOwnsProduct(customerId, productId);
            if (!ownership.verified) {
                return res.status(403).json({
                    error: "Ownership verification failed. You must purchase this product to post."
                });
            }
            isAuthorized = true;
        } else if (orderId) {
            // Verify Order contains product
            const hasProduct = await verifyOrderContainsProduct(orderId, productId);
            if (!hasProduct) {
                return res.status(403).json({
                    error: "This order does not contain the specified product."
                });
            }
            isAuthorized = true;
        } else {
            // For now, allow consistent with previous behavior BUT warn
            // Ideally this should be blocked
            console.warn("⚠️ Uploading without customer/order verification!");
            // Temporary Allow for dev until frontend is fully updated
            // isAuthorized = true; 
            // STRICT MODE:
            return res.status(401).json({ error: "Authentication required (customerId or orderId)." });
        }

        let fileData;

        // Check if file is uploaded via multipart/form-data
        if (req.file) {
            fileData = {
                name: req.file.originalname,
                type: req.file.mimetype,
                size: req.file.size,
                buffer: req.file.buffer,
            };
        } else {
            return res.status(400).json({ error: "No file uploaded." });
        }

        // 1. Upload file to Shopify
        const uploadResult = await uploadFileToShopify(fileData);
        console.log(`✅ File uploaded: ${uploadResult.fileId}`);

        // 2. Get existing metafields to find current list
        const metafields = await getProductMetafields(productId);
        const targetMetafield = metafields.find(
            (m) => m.namespace === "custom" && m.key === "user_media_urls"
        );

        let currentFiles = [];
        if (targetMetafield && targetMetafield.value) {
            try {
                currentFiles = JSON.parse(targetMetafield.value);
                if (!Array.isArray(currentFiles)) {
                    currentFiles = [];
                }
            } catch (e) {
                console.warn("Could not parse existing metafield value:", e);
                currentFiles = [];
            }
        }

        // 3. Append new file URL (not GID)
        currentFiles.push(uploadResult.url);

        // 4. Update the metafield as JSON (not list.file_reference)
        const updatedValue = JSON.stringify(currentFiles);
        const metafieldData = {
            namespace: "custom",
            key: "user_media_urls",
            value: updatedValue,
            type: "json",  // Changed from list.file_reference
        };

        let resultMetafield;
        if (targetMetafield) {
            resultMetafield = await setProductMetafield(productId, metafieldData);
        } else {
            resultMetafield = await setProductMetafield(productId, metafieldData);
        }

        res.json({
            success: true,
            fileId: uploadResult.fileId,
            url: uploadResult.url,
            metafield: resultMetafield,
            message: "File uploaded and assigned to product."
        });

    } catch (error) {
        console.error("Error in upload-and-assign:", error);
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

/**
 * Verify if customer owns a product
 * GET /shopify/verify-ownership/:productId?customerId=...&signature=...
 */
router.get("/verify-ownership/:productId", async (req, res) => {
    try {
        const { productId } = req.params;
        const { customerId, signature } = req.query;

        if (!customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }

        if (signature && !verifyShopifySignature(customerId, signature)) {
            return res.status(401).json({ error: "Invalid signature" });
        }

        const result = await verifyCustomerOwnsProduct(customerId, productId);
        res.json(result);

    } catch (error) {
        console.error("Error verifying ownership:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get product gallery (only for owners)
 * GET /shopify/products/:productId/gallery?customerId=...&signature=...
 */
router.get("/products/:productId/gallery", async (req, res) => {
    try {
        const { productId } = req.params;
        const { customerId, signature } = req.query;

        if (!customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }

        if (signature && !verifyShopifySignature(customerId, signature)) {
            return res.status(401).json({ error: "Invalid signature" });
        }

        // 1. Verify Ownership
        const ownership = await verifyCustomerOwnsProduct(customerId, productId);
        if (!ownership.verified) {
            return res.status(403).json({
                error: "Access denied. You must purchase this product to view the gallery."
            });
        }

        // 2. Fetch Metafields
        const metafields = await getProductMetafields(productId);
        const galleryMetafield = metafields.find(m => m.namespace === "custom" && m.key === "user_media_urls");

        let media = [];
        if (galleryMetafield) {
            try {
                media = JSON.parse(galleryMetafield.value);
            } catch (e) {
                console.warn("Failed to parse gallery metafield", e);
            }
        }

        res.json({
            authorized: true,
            media
        });

    } catch (error) {
        console.error("Error fetching gallery:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
