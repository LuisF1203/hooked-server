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
// Import dependencies
import { uploadStream } from "../services/cloudinary.js";
import prisma from "../db.js";

/**
 * Upload a file to Cloudinary and assign it to a product (store in DB)
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
        let pOrder = null; // Prisma Order
        let dbCustomer = null;

        // 1. Verify Authentication & Ownership
        if (customerId) {
            // Verify Signature (optional but recommended)
            if (signature && !verifyShopifySignature(customerId, signature)) {
                return res.status(401).json({ error: "Invalid signature. Authentication failed." });
            }

            // Verify Ownership via Shopify
            const ownership = await verifyCustomerOwnsProduct(customerId, productId);
            if (!ownership.verified) {
                return res.status(403).json({
                    error: "Ownership verification failed. You must purchase this product to post."
                });
            }
            isAuthorized = true;

            // Try to find the local customer record associated with the verification order
            if (ownership.orderId) {
                const order = await prisma.order.findUnique({
                    where: { shopifyId: String(ownership.orderId) },
                    include: { customer: true }
                });
                if (order) {
                    pOrder = order;
                    dbCustomer = order.customer;
                }
            }

            // Fallback: Check if customer exists by shopifyId directly
            if (!dbCustomer) {
                dbCustomer = await prisma.customer.findUnique({
                    where: { shopifyId: String(customerId) }
                });
            }

        } else if (orderId) {
            // Verify Order contains product
            const hasProduct = await verifyOrderContainsProduct(orderId, productId);
            if (!hasProduct) {
                return res.status(403).json({
                    error: "This order does not contain the specified product."
                });
            }
            isAuthorized = true;

            // Find local order
            const order = await prisma.order.findUnique({
                where: { shopifyId: String(orderId) },
                include: { customer: true }
            });
            if (order) {
                pOrder = order;
                dbCustomer = order.customer;
            }
        } else {
            // STRICT MODE:
            return res.status(401).json({ error: "Authentication required (customerId or orderId)." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        // 2. Upload to Cloudinary
        console.log("📂 Uploading to Cloudinary...");

        const { filter } = req.body;
        console.log(`🎨 Applying filter: ${filter || 'none'}`);

        const uploadResult = await uploadStream(req.file.buffer, {
            folder: "hoop_community",
            resource_type: "auto",
            filter: filter
        });

        console.log(`✅ Uploaded to Cloudinary: ${uploadResult.secure_url}`);

        // 3. Find or Create Product placeholder if needed
        let dbProduct = await prisma.product.findUnique({
            where: { shopifyId: String(productId) }
        });

        // We can create a basic product record if missing, but we need a name. 
        // For now, we'll try to fetch it from Shopify if missing, or just use a placeholder
        if (!dbProduct) {
            try {
                const shopifyProduct = await getProduct(productId);
                if (shopifyProduct) {
                    dbProduct = await prisma.product.create({
                        data: {
                            shopifyId: String(productId),
                            name: shopifyProduct.title,
                            // date matches default now()
                        }
                    });
                }
            } catch (e) {
                console.warn("Could not fetch/create product record:", e);
            }
        }

        // 4. Create Media Record
        const media = await prisma.media.create({
            data: {
                cloudinaryId: uploadResult.public_id,
                url: uploadResult.secure_url,
                type: uploadResult.resource_type === 'video' ? 'VIDEO' : 'IMAGE',
                shopifyProductId: String(productId),
                productId: dbProduct ? dbProduct.id : null,
                customerId: dbCustomer ? dbCustomer.id : null
            }
        });

        res.json({
            success: true,
            media,
            url: media.url,
            message: "File uploaded to Cloudinary and saved to database."
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

        // 2. Fetch Media from DB (Approved Only)
        // const metafields = await getProductMetafields(productId);
        // ... replaced by Prisma query ...

        const mediaRecords = await prisma.media.findMany({
            where: {
                shopifyProductId: String(productId),
                approved: true
            },
            select: { url: true, type: true }
        });

        const media = mediaRecords.map(m => ({
            url: m.url,
            type: m.type
        }));

        res.json({
            authorized: true,
            media
        });

    } catch (error) {
        console.error("Error fetching gallery:", error);
        res.status(500).json({ error: error.message });
    }
});

router.post("/media/:id/like", async (req, res) => {
    try {
        const { id } = req.params;
        const { customerId } = req.body;

        if (!customerId) return res.status(400).json({ error: "customerId is required" });

        // Check if customer exists (optional, but good for integrity)
        // const customer = await prisma.customer.findUnique({ where: { shopifyId: String(customerId) } });

        // Find the internal customer ID based on Shopify ID
        let dbCustomer = await prisma.customer.findUnique({
            where: { shopifyId: String(customerId) }
        });

        if (!dbCustomer) {
            // Create if not exists (lazy creation)
            // ideally we should have it from order webhook, but for robustness:
            // We need email/name to create properly, so we might fail or create a shell
            return res.status(404).json({ error: "Customer not found in DB. Make a purchase first." });
        }

        const existingLike = await prisma.like.findUnique({
            where: {
                customerId_mediaId: {
                    customerId: dbCustomer.id,
                    mediaId: id
                }
            }
        });

        let liked = false;
        if (existingLike) {
            // Unlike
            await prisma.like.delete({
                where: { id: existingLike.id }
            });
        } else {
            // Like
            await prisma.like.create({
                data: {
                    customerId: dbCustomer.id,
                    mediaId: id
                }
            });
            liked = true;
        }

        // Get new count
        const likeCount = await prisma.like.count({ where: { mediaId: id } });

        res.json({ success: true, liked, likeCount });

    } catch (error) {
        console.error("Like Error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/products/:productId/media", async (req, res) => {
    try {
        const { productId } = req.params;
        const { customerId } = req.query; // Shopify Customer ID

        let dbCustomerId = null;
        if (customerId) {
            const dbCustomer = await prisma.customer.findUnique({
                where: { shopifyId: String(customerId) }
            });
            if (dbCustomer) dbCustomerId = dbCustomer.id;
        }

        // productId is Shopify Product ID
        const media = await prisma.media.findMany({
            where: {
                shopifyProductId: String(productId),
                approved: true
            },
            orderBy: { createdAt: 'desc' },
            include: {
                customer: {
                    select: { firstName: true, lastName: true }
                },
                likes: true // Include likes to calculate count and status
            }
        });

        // Map response
        const mappedMedia = media.map(m => {
            const likedByUser = dbCustomerId ? m.likes.some(l => l.customerId === dbCustomerId) : false;
            return {
                ...m,
                likes: undefined, // Remove raw likes array
                likeCount: m.likes.length,
                likedByUser
            };
        });

        res.json({ media: mappedMedia });
    } catch (error) {
        console.error("Error fetching media:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
