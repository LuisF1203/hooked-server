import { Router } from "express";
import prisma from "../db.js";
import multer from "multer";
import cloudinary, { uploadStream } from "../services/cloudinary.js";
import jwt from "jsonwebtoken";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";

// ── Admin Auth Middleware ──
const requireAdmin = async (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminId = decoded.id;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
};

// ══════════════════════════════════════
// PUBLIC ENDPOINTS
// ══════════════════════════════════════

/**
 * GET /diy/products
 * Returns active DIY products (now is between startDate and endDate)
 */
router.get("/products", async (req, res) => {
    try {
        const now = new Date();
        const products = await prisma.diyProduct.findMany({
            where: {
                startDate: { lte: now },
                endDate: { gte: now },
            },
            orderBy: { createdAt: "desc" },
            include: {
                images: {
                    orderBy: { position: "asc" },
                },
            },
        });
        res.json(products);
    } catch (error) {
        console.error("Error fetching DIY products:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ══════════════════════════════════════
// ADMIN ENDPOINTS
// ══════════════════════════════════════

/**
 * GET /diy/products/all
 * Returns ALL DIY products (for admin panel)
 */
router.get("/products/all", requireAdmin, async (req, res) => {
    try {
        const products = await prisma.diyProduct.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                images: {
                    orderBy: { position: "asc" },
                },
            },
        });
        res.json(products);
    } catch (error) {
        console.error("Error fetching all DIY products:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * POST /diy/products
 * Create a new DIY product
 * multipart: images (multiple), pdf (single), name, description, startDate, endDate
 *
 * PDFs are uploaded as resource_type "image" (NOT "raw") because Cloudinary
 * free-plan blocks delivery of raw files. Cloudinary fully supports PDFs
 * under the "image" type — they are stored and delivered without restrictions.
 */
router.post(
    "/products",
    requireAdmin,
    upload.fields([
        { name: "images", maxCount: 10 },
        { name: "pdf", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const { name, description, startDate, endDate } = req.body;

            if (!name || !startDate || !endDate) {
                return res.status(400).json({ error: "name, startDate, and endDate are required." });
            }

            // Upload PDF to Cloudinary as "image" type (avoids raw-file delivery restrictions)
            let pdfUrl = "";
            if (req.files.pdf && req.files.pdf[0]) {
                const pdfResult = await uploadStream(req.files.pdf[0].buffer, {
                    folder: "hooked_diy/pdfs",
                    resource_type: "image",
                    format: "pdf",
                });
                pdfUrl = pdfResult.secure_url;
            }

            // Upload images to Cloudinary
            const imageUploads = [];
            if (req.files.images) {
                for (let i = 0; i < req.files.images.length; i++) {
                    const result = await uploadStream(req.files.images[i].buffer, {
                        folder: "hooked_diy/images",
                        resource_type: "image",
                    });
                    imageUploads.push({
                        url: result.secure_url,
                        cloudinaryId: result.public_id,
                        position: i,
                    });
                }
            }

            // Create product with images in DB
            const product = await prisma.diyProduct.create({
                data: {
                    name,
                    description: description || "",
                    pdfUrl,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    images: {
                        create: imageUploads,
                    },
                },
                include: { images: true },
            });

            res.json({ success: true, product });
        } catch (error) {
            console.error("Error creating DIY product:", error);
            res.status(500).json({ error: error.message });
        }
    }
);

/**
 * DELETE /diy/products/:id
 * Delete a DIY product and its images from Cloudinary
 */
router.delete("/products/:id", requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const product = await prisma.diyProduct.findUnique({
            where: { id },
            include: { images: true },
        });

        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        // Delete images from Cloudinary
        for (const img of product.images) {
            try {
                await cloudinary.uploader.destroy(img.cloudinaryId);
            } catch (e) {
                console.warn(`Could not delete Cloudinary image ${img.cloudinaryId}:`, e);
            }
        }

        // Delete PDF from Cloudinary
        if (product.pdfUrl) {
            try {
                const pdfPublicId = product.pdfUrl
                    .split("/upload/")[1]
                    ?.replace(/^v\d+\//, "")
                    ?.replace(/\.[^.]+$/, "");
                if (pdfPublicId) {
                    // Try both image and raw in case of old uploads
                    await cloudinary.uploader.destroy(pdfPublicId, { resource_type: "image" }).catch(() => {});
                    await cloudinary.uploader.destroy(pdfPublicId, { resource_type: "raw" }).catch(() => {});
                }
            } catch (e) {
                console.warn("Could not delete PDF from Cloudinary:", e);
            }
        }

        // Delete from DB (cascade deletes images)
        await prisma.diyProduct.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting DIY product:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
