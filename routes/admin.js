import { Router } from "express";
import prisma from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";

// Middleware to protect routes
const requireAuth = async (req, res, next) => {
    const token = req.cookies.admin_token;

    if (!token) {
        return res.redirect("/admin/login");
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminId = decoded.id;
        next();
    } catch (err) {
        res.clearCookie("admin_token");
        return res.redirect("/admin/login");
    }
};

// Login Page
router.get("/login", (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Hoop Admin Login</title>
        <style>
            body { font-family: -apple-system, sans-serif; background: #111; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .login-box { background: #222; padding: 40px; border-radius: 8px; border: 1px solid #333; width: 300px; }
            h2 { margin-top: 0; text-align: center; }
            input { width: 100%; padding: 10px; margin: 10px 0; background: #333; border: 1px solid #444; color: #fff; border-radius: 4px; box-sizing: border-box; }
            button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; }
            button:hover { background: #0056b3; }
            .error { color: #e74c3c; font-size: 14px; text-align: center; margin-bottom: 10px; display: none; }
        </style>
    </head>
    <body>
        <div class="login-box">
            <h2>Admin Login</h2>
            <div id="error-msg" class="error"></div>
            <form id="login-form">
                <input type="email" id="email" placeholder="Email" required>
                <input type="password" id="password" placeholder="Password" required>
                <button type="submit">Login</button>
            </form>
        </div>
        <script>
            document.getElementById('login-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const errorMsg = document.getElementById('error-msg');
                
                try {
                    const res = await fetch('/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        window.location.href = '/admin';
                    } else {
                        errorMsg.textContent = data.error || 'Login failed';
                        errorMsg.style.display = 'block';
                    }
                } catch (err) {
                    errorMsg.textContent = 'Network error';
                    errorMsg.style.display = 'block';
                }
            });
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Login Handler
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const admin = await prisma.adminUser.findUnique({ where: { email } });
        if (!admin) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Set Cookie
        const token = jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie("admin_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Logout
router.get("/logout", (req, res) => {
    res.clearCookie("admin_token");
    res.redirect("/admin/login");
});

// Create First Admin (Secret Route - Remove after use or protect)
router.get("/setup-admin", async (req, res) => {
    try {
        const count = await prisma.adminUser.count();
        if (count > 0) {
            return res.status(403).send("Admin user already exists. Cannot setup.");
        }

        const email = "admin@hoop.com";
        const password = "admin"; // Default password
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.adminUser.create({
            data: { email, password: hashedPassword }
        });

        res.send(`Admin user created.<br>Email: ${email}<br>Password: ${password}<br><a href="/admin/login">Go to Login</a>`);
    } catch (error) {
        res.status(500).send("Error creating admin: " + error.message);
    }
});


// Toggle Approval Status (Protected)
router.post("/toggle-approval/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const media = await prisma.media.findUnique({ where: { id } });

        if (!media) return res.status(404).json({ error: "Media not found" });

        const updated = await prisma.media.update({
            where: { id },
            data: { approved: !media.approved }
        });

        res.json({ success: true, approved: updated.approved });
    } catch (error) {
        console.error("Toggle Error:", error);
        res.status(500).json({ error: "Internal Error" });
    }
});

// Protect Main Route
router.get("/", requireAuth, async (req, res) => {
    try {
        // ... (existing filter logic)
        const { status, startDate, endDate } = req.query;

        // Build Filter Query
        const where = {};
        if (status === 'approved') where.approved = true;
        if (status === 'pending') where.approved = false;

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate + "T23:59:59");
        }

        const media = await prisma.media.findMany({
            where,
            orderBy: [
                { approved: 'asc' }, // Pending (false) first
                { createdAt: 'desc' }
            ],
            include: {
                product: true,
                customer: true
            }
        });

        // Simple HTML Template
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hoop Admin - Community Media</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #111; color: #fff; margin: 0; padding: 20px; }
                header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
                h1 { margin: 0; }
                .logout-btn { color: #aaa; text-decoration: none; border: 1px solid #444; padding: 5px 10px; border-radius: 4px; transition: all 0.2s; }
                .logout-btn:hover { background: #333; color: #fff; border-color: #666; }
                
                .filters { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 15px; align-items: end; flex-wrap: wrap; border: 1px solid #333; }
                .filter-group { display: flex; flex-direction: column; gap: 5px; }
                label { font-size: 12px; color: #aaa; }
                select, input, button.filter-btn { padding: 8px 12px; border-radius: 4px; border: 1px solid #444; background: #111; color: #fff; }
                button.filter-btn { background: #007bff; border-color: #007bff; cursor: pointer; font-weight: bold; }
                button.filter-btn:hover { background: #0056b3; }
                a.reset-btn { color: #aaa; text-decoration: none; font-size: 14px; align-self: center; margin-left: 10px; }
                a.reset-btn:hover { color: #fff; }

                .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
                .card { background: #222; border-radius: 8px; overflow: hidden; border: 1px solid #333; transition: all 0.2s; position: relative; }
                .card.approved { border-color: #2ecc71; box-shadow: 0 0 10px rgba(46, 204, 113, 0.2); }
                .media-container { height: 250px; overflow: hidden; position: relative; background: #000; }
                img, video { width: 100%; height: 100%; object-fit: cover; }
                .info { padding: 15px; font-size: 14px; }
                .meta { color: #888; margin-bottom: 5px; }
                .user { color: #fff; font-weight: bold; }
                .product { color: #aaa; font-size: 12px; margin-top: 5px; }
                .type-badge { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; }
                .actions { padding: 10px 15px; border-top: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
                .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
                .status-pending { background: #f39c12; color: #000; }
                .status-approved { background: #2ecc71; color: #fff; }
                button { cursor: pointer; padding: 6px 12px; border: none; border-radius: 4px; background: #333; color: #fff; transition: background 0.2s; }
                button:hover { background: #444; }
                button.toggle-btn { background: #007bff; }
                button.toggle-btn:hover { background: #0056b3; }
            </style>
        </head>
        <body>
            <header>
                <h1>📸 Community Uploads (${media.length})</h1>
                <nav style="display:flex;gap:12px;align-items:center;">
                    <a href="/admin" style="color:#60a5fa;text-decoration:none;padding:6px 12px;border:1px solid #60a5fa;border-radius:4px;font-size:14px;">Media</a>
                    <a href="/admin/diy" style="color:#aaa;text-decoration:none;padding:6px 12px;border:1px solid #444;border-radius:4px;font-size:14px;transition:all 0.2s;">🧶 DIY</a>
                    <a href="/admin/logout" class="logout-btn">Logout</a>
                </nav>
            </header>
            
            <form class="filters" method="GET" action="/admin">
                <div class="filter-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="all" ${status === 'all' ? 'selected' : ''}>All Status</option>
                        <option value="pending" ${status === 'pending' || !status ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${status === 'approved' ? 'selected' : ''}>Approved</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Start Date</label>
                    <input type="date" name="startDate" value="${startDate || ''}">
                </div>
                <div class="filter-group">
                    <label>End Date</label>
                    <input type="date" name="endDate" value="${endDate || ''}">
                </div>
                <div class="filter-group">
                    <label>&nbsp;</label>
                    <button type="submit" class="filter-btn">Filter</button>
                </div>
                <a href="/admin" class="reset-btn">Reset</a>
            </form>

            <div class="grid">
                ${media.map(item => `
                    <div class="card ${item.approved ? 'approved' : ''}" id="card-${item.id}">
                        <div class="media-container">
                            <span class="type-badge">${item.type}</span>
                            ${item.type === 'VIDEO' ?
                `<video src="${item.url}" controls muted></video>` :
                `<img src="${item.url}" loading="lazy" />`
            }
                        </div>
                        <div class="info">
                            <div class="meta">${new Date(item.createdAt).toLocaleString()}</div>
                            <div class="user">${item.customer ? (item.customer.firstName || 'Customer') : 'Anonymous'}</div>
                            <div class="product">Product: ${item.product ? item.product.name : item.shopifyProductId}</div>
                            <div style="margin-top:5px; font-family:monospace; font-size:10px; color:#555;">ID: ${item.id}</div>
                        </div>
                        <div class="actions">
                            <span class="status-badge ${item.approved ? 'status-approved' : 'status-pending'}" id="status-${item.id}">
                                ${item.approved ? 'APPROVED' : 'PENDING'}
                            </span>
                            <button class="toggle-btn" onclick="toggleApproval('${item.id}')">
                                ${item.approved ? 'Reject' : 'Approve'}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <script>
                async function toggleApproval(id) {
                    try {
                        const btn = document.querySelector(\`#card-\${id} .toggle-btn\`);
                        const originalText = btn.textContent;
                        btn.textContent = '...';
                        btn.disabled = true;

                        const response = await fetch(\`/admin/toggle-approval/\${id}\`, { method: 'POST' });
                        const data = await response.json();

                        if (data.success) {
                            const card = document.getElementById(\`card-\${id}\`);
                            const statusBadge = document.getElementById(\`status-\${id}\`);
                            
                            if (data.approved) {
                                card.classList.add('approved');
                                statusBadge.className = 'status-badge status-approved';
                                statusBadge.textContent = 'APPROVED';
                                btn.textContent = 'Reject';
                            } else {
                                card.classList.remove('approved');
                                statusBadge.className = 'status-badge status-pending';
                                statusBadge.textContent = 'PENDING';
                                btn.textContent = 'Approve';
                            }
                        } else {
                            if (data.error && data.error.includes('login')) {
                                window.location.href = '/admin/login';
                            } else {
                                alert('Error updating status');
                                btn.textContent = originalText;
                            }
                        }
                    } catch (e) {
                        console.error(e);
                        alert('Network Error');
                    } finally {
                        const btn = document.querySelector(\`#card-\${id} .toggle-btn\`);
                        if (btn) btn.disabled = false;
                    }
                }
            </script>
        </body>
        </html>
        `;

        res.send(html);
    } catch (error) {
        console.error("Admin Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

// ══════════════════════════════════════
// DIY Products Admin Panel
// ══════════════════════════════════════
router.get("/diy", requireAuth, async (req, res) => {
    try {
        const products = await prisma.diyProduct.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                images: { orderBy: { position: "asc" } },
            },
        });

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hooked Admin — DIY Products</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }
                
                header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #222; padding-bottom: 16px; margin-bottom: 28px; }
                header h1 { font-size: 1.5rem; }
                header nav { display: flex; gap: 16px; align-items: center; }
                header nav a { color: #888; text-decoration: none; font-size: 14px; padding: 6px 12px; border: 1px solid #333; border-radius: 6px; transition: all 0.2s; }
                header nav a:hover { color: #fff; border-color: #555; background: #1a1a1a; }
                header nav a.active { color: #d68aff; border-color: #d68aff; }

                .section-title { font-size: 1.2rem; margin-bottom: 16px; color: #fff; border-left: 3px solid #d68aff; padding-left: 12px; }

                /* ── Form ── */
                .form-card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 28px; margin-bottom: 36px; }
                .form-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
                .form-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
                .form-group label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
                .form-group input, .form-group textarea { padding: 10px 14px; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; font-size: 14px; outline: none; transition: border 0.2s; }
                .form-group input:focus, .form-group textarea:focus { border-color: #d68aff; }
                .form-group textarea { min-height: 80px; resize: vertical; }
                .form-group input[type="file"] { padding: 8px; }

                .btn-submit { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: linear-gradient(135deg, #d68aff 0%, #a855f7 100%); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; margin-top: 8px; }
                .btn-submit:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168,85,247,0.4); }
                .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

                /* ── Product Grid ── */
                .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
                .product-card { background: #141414; border: 1px solid #222; border-radius: 12px; overflow: hidden; transition: border-color 0.2s; }
                .product-card:hover { border-color: #333; }
                .product-card__images { display: flex; overflow-x: auto; height: 180px; background: #000; scrollbar-width: thin; }
                .product-card__images img { height: 100%; width: auto; object-fit: cover; flex-shrink: 0; }
                .product-card__images::-webkit-scrollbar { height: 4px; }
                .product-card__images::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
                .product-card__body { padding: 16px; }
                .product-card__name { font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 6px; }
                .product-card__desc { font-size: 13px; color: #888; margin-bottom: 10px; max-height: 60px; overflow: hidden; }
                .product-card__meta { display: flex; gap: 12px; font-size: 12px; color: #666; margin-bottom: 12px; }
                .product-card__meta span { display: flex; align-items: center; gap: 4px; }
                .product-card__actions { display: flex; gap: 8px; }
                .btn-danger { padding: 8px 16px; background: #2a1215; color: #f87171; border: 1px solid #3f1418; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
                .btn-danger:hover { background: #4a1a1e; border-color: #f87171; }
                .btn-link { padding: 8px 16px; background: #1a1a2e; color: #60a5fa; border: 1px solid #1e3a5f; border-radius: 6px; font-size: 13px; cursor: pointer; text-decoration: none; transition: all 0.2s; }
                .btn-link:hover { background: #1e3a5f; }

                .empty-state { text-align: center; padding: 60px; color: #555; font-size: 1rem; }

                .status-active { color: #4ade80; }
                .status-inactive { color: #f87171; }
                .status-upcoming { color: #fbbf24; }

                #upload-progress { display: none; margin-top: 12px; padding: 12px; background: #1a1a2e; border: 1px solid #2d2d5e; border-radius: 8px; color: #a5b4fc; font-size: 14px; }
            </style>
        </head>
        <body>
            <header>
                <h1>🧶 DIY Products</h1>
                <nav>
                    <a href="/admin">Media</a>
                    <a href="/admin/diy" class="active">DIY</a>
                    <a href="/admin/logout">Logout</a>
                </nav>
            </header>

            <h2 class="section-title">Crear Producto DIY</h2>
            <div class="form-card">
                <form id="create-form" enctype="multipart/form-data">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nombre</label>
                            <input type="text" name="name" required placeholder="Ej: Gorro Julieta">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Descripción</label>
                            <textarea name="description" placeholder="Describe el patrón, materiales, nivel de dificultad..."></textarea>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Fecha Inicio</label>
                            <input type="date" name="startDate" required>
                        </div>
                        <div class="form-group">
                            <label>Fecha Fin</label>
                            <input type="date" name="endDate" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Imágenes (múltiples)</label>
                            <input type="file" name="images" multiple accept="image/*">
                        </div>
                        <div class="form-group">
                            <label>PDF del Patrón</label>
                            <input type="file" name="pdf" accept=".pdf">
                        </div>
                    </div>
                    <button type="submit" class="btn-submit" id="submit-btn">
                        <span>＋</span> Crear Producto
                    </button>
                    <div id="upload-progress">Subiendo archivos... por favor espera</div>
                </form>
            </div>

            <h2 class="section-title">Productos (${products.length})</h2>
            ${products.length === 0 ? '<div class="empty-state">No hay productos DIY aún. ¡Crea el primero!</div>' : ''}
            <div class="products-grid">
                ${products.map(p => {
                    const now = new Date();
                    const start = new Date(p.startDate);
                    const end = new Date(p.endDate);
                    let statusClass = 'status-inactive';
                    let statusText = 'Inactivo';
                    if (now >= start && now <= end) { statusClass = 'status-active'; statusText = 'Activo'; }
                    else if (now < start) { statusClass = 'status-upcoming'; statusText = 'Próximo'; }

                    return `
                    <div class="product-card" id="product-${p.id}">
                        <div class="product-card__images">
                            ${p.images.length > 0
                                ? p.images.map(img => `<img src="${img.url}" loading="lazy" />`).join('')
                                : '<div style="width:100%;display:flex;align-items:center;justify-content:center;color:#444">Sin imágenes</div>'
                            }
                        </div>
                        <div class="product-card__body">
                            <div class="product-card__name">${p.name}</div>
                            <div class="product-card__desc">${p.description || 'Sin descripción'}</div>
                            <div class="product-card__meta">
                                <span class="${statusClass}">● ${statusText}</span>
                                <span>📅 ${start.toLocaleDateString('es-MX')} — ${end.toLocaleDateString('es-MX')}</span>
                            </div>
                            <div class="product-card__actions">
                                <a href="/admin/diy/edit/${p.id}" class="btn-link">✏️ Editar</a>
                                ${p.pdfUrl ? `<a href="${p.pdfUrl}" target="_blank" class="btn-link">📄 Ver PDF</a>` : ''}
                                <button class="btn-danger" onclick="deleteProduct('${p.id}')">🗑 Eliminar</button>
                            </div>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>

            <script>
                // Create Product
                document.getElementById('create-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('submit-btn');
                    const progress = document.getElementById('upload-progress');
                    btn.disabled = true;
                    progress.style.display = 'block';

                    try {
                        const formData = new FormData(e.target);
                        const res = await fetch('/diy/products', {
                            method: 'POST',
                            body: formData,
                        });
                        const data = await res.json();

                        if (data.success) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown error'));
                        }
                    } catch (err) {
                        alert('Network error: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        progress.style.display = 'none';
                    }
                });

                // Delete Product
                async function deleteProduct(id) {
                    if (!confirm('¿Estás seguro? Esto eliminará el producto y todas sus imágenes.')) return;

                    try {
                        const res = await fetch('/diy/products/' + id, { method: 'DELETE' });
                        const data = await res.json();

                        if (data.success) {
                            document.getElementById('product-' + id).remove();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Network error');
                    }
                }
            </script>
        </body>
        </html>
        `;

        res.send(html);
    } catch (error) {
        console.error("Admin DIY Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

// ══════════════════════════════════════
// DIY Edit Page
// ══════════════════════════════════════
router.get("/diy/edit/:id", requireAuth, async (req, res) => {
    try {
        const product = await prisma.diyProduct.findUnique({
            where: { id: req.params.id },
            include: { 
                images: { orderBy: { position: "asc" } },
                materials: true 
            },
        });

        if (!product) {
            return res.status(404).send("Product not found");
        }

        const fmtDate = (d) => new Date(d).toISOString().split('T')[0];

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Editar — ${product.name}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }

                header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #222; padding-bottom: 16px; margin-bottom: 28px; }
                header h1 { font-size: 1.4rem; }
                header nav { display: flex; gap: 12px; align-items: center; }
                header nav a { color: #888; text-decoration: none; font-size: 14px; padding: 6px 12px; border: 1px solid #333; border-radius: 6px; transition: all 0.2s; }
                header nav a:hover { color: #fff; border-color: #555; background: #1a1a1a; }

                .section-title { font-size: 1.1rem; margin-bottom: 16px; color: #fff; border-left: 3px solid #d68aff; padding-left: 12px; }

                .form-card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 28px; margin-bottom: 28px; }
                .form-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
                .form-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
                .form-group label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
                .form-group input, .form-group textarea { padding: 10px 14px; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; font-size: 14px; outline: none; transition: border 0.2s; }
                .form-group input:focus, .form-group textarea:focus { border-color: #d68aff; }
                .form-group textarea { min-height: 80px; resize: vertical; }

                .btn-submit { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: linear-gradient(135deg, #d68aff 0%, #a855f7 100%); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
                .btn-submit:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168,85,247,0.4); }
                .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

                /* Image Grid */
                .images-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
                .img-card { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid #333; background: #000; aspect-ratio: 1; }
                .img-card img { width: 100%; height: 100%; object-fit: cover; }
                .img-card .delete-btn { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%; background: rgba(220,38,38,0.85); color: #fff; border: none; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.15s, background 0.15s; backdrop-filter: blur(4px); }
                .img-card .delete-btn:hover { background: #dc2626; transform: scale(1.15); }
                .img-card.deleting { opacity: 0.3; pointer-events: none; }

                /* PDF Section */
                .pdf-section { display: flex; align-items: center; gap: 12px; padding: 14px; background: #1a1a2e; border: 1px solid #2d2d5e; border-radius: 8px; margin-bottom: 16px; }
                .pdf-section a { color: #60a5fa; text-decoration: none; }
                .pdf-section a:hover { text-decoration: underline; }
                .btn-remove-pdf { padding: 6px 14px; background: #2a1215; color: #f87171; border: 1px solid #3f1418; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
                .btn-remove-pdf:hover { background: #4a1a1e; border-color: #f87171; }

                #progress-msg { display: none; margin-top: 12px; padding: 12px; background: #1a1a2e; border: 1px solid #2d2d5e; border-radius: 8px; color: #a5b4fc; font-size: 14px; }

                .empty-images { text-align: center; padding: 40px; color: #555; border: 2px dashed #333; border-radius: 10px; margin-bottom: 20px; }

                /* Materials Section */
                .material-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin-bottom: 12px; display: flex; gap: 16px; align-items: flex-start; }
                .material-card img { width: 60px; height: 60px; object-fit: cover; border-radius: 6px; background: #000; }
                .material-info { flex: 1; }
                .material-name { font-weight: 600; color: #fff; margin-bottom: 4px; font-size: 15px; }
                .material-qty { font-size: 13px; color: #d68aff; margin-bottom: 4px; font-family: monospace; }
                .material-desc { font-size: 13px; color: #888; }
            </style>
        </head>
        <body>
            <header>
                <h1>✏️ Editar: ${product.name}</h1>
                <nav>
                    <a href="/admin/diy">← Volver a DIY</a>
                    <a href="/admin">Media</a>
                    <a href="/admin/logout">Logout</a>
                </nav>
            </header>

            <!-- ── Product Details Form ── -->
            <h2 class="section-title">Datos del Producto</h2>
            <div class="form-card">
                <form id="edit-form" enctype="multipart/form-data">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nombre</label>
                            <input type="text" name="name" value="${product.name}" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Descripción</label>
                            <textarea name="description">${product.description || ''}</textarea>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Fecha Inicio</label>
                            <input type="date" name="startDate" value="${fmtDate(product.startDate)}" required>
                        </div>
                        <div class="form-group">
                            <label>Fecha Fin</label>
                            <input type="date" name="endDate" value="${fmtDate(product.endDate)}" required>
                        </div>
                    </div>
                    <button type="submit" class="btn-submit" id="save-btn">💾 Guardar Cambios</button>
                    <div id="progress-msg">Guardando cambios...</div>
                </form>
            </div>

            <!-- ── Images Section ── -->
            <h2 class="section-title">Imágenes (${product.images.length})</h2>
            <div class="form-card">
                ${product.images.length > 0 ? `
                    <div class="images-grid" id="images-grid">
                        ${product.images.map(img => `
                            <div class="img-card" id="img-${img.id}">
                                <img src="${img.url}" loading="lazy" />
                                <button class="delete-btn" onclick="deleteImage('${img.id}')" title="Eliminar imagen">✕</button>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="empty-images">No hay imágenes aún</div>'}

                <div class="form-group" style="margin-top:12px">
                    <label>Agregar Nuevas Imágenes</label>
                    <input type="file" id="new-images" multiple accept="image/*" style="padding:8px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff;">
                </div>
                <button class="btn-submit" style="margin-top:12px" id="upload-images-btn" onclick="uploadNewImages()">📷 Subir Imágenes</button>
            </div>

            <!-- ── PDF Section ── -->
            <h2 class="section-title">PDF del Patrón</h2>
            <div class="form-card">
                ${product.pdfUrl ? `
                    <div class="pdf-section" id="pdf-section">
                        <span>📄</span>
                        <a href="${product.pdfUrl}" target="_blank">Ver PDF actual</a>
                        <button class="btn-remove-pdf" onclick="removePdf()">Quitar PDF</button>
                    </div>
                ` : '<p style="color:#666; margin-bottom:16px;">No hay PDF asignado</p>'}
                <div class="form-group">
                    <label>${product.pdfUrl ? 'Reemplazar PDF' : 'Subir PDF'}</label>
                    <input type="file" id="new-pdf" accept=".pdf" style="padding:8px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff;">
                </div>
                <button class="btn-submit" style="margin-top:12px" id="upload-pdf-btn" onclick="uploadNewPdf()">📄 Subir PDF</button>
            </div>

            <!-- ── Steps (Tutorial) Section ── -->
            <h2 class="section-title">Tutorial Paso a Paso (${product.steps ? product.steps.length : 0})</h2>
            <div class="form-card">
                <div id="steps-list">
                    ${product.steps && product.steps.length > 0 ? product.steps.map(step => `
                        <div class="step-card" id="step-${step.id}" data-id="${step.id}" style="margin-bottom:12px; padding:12px; border:1px solid #333; border-radius:8px; display:flex; gap:16px;">
                            <div class="step-drag-handle" style="cursor:grab; font-size:24px; color:#555; display:flex; align-items:center;">↕</div>
                            ${step.imageUrl ? `<img src="${step.imageUrl}" loading="lazy" style="width:80px; height:80px; object-fit:cover; border-radius:6px;"/>` : '<div style="width:80px;height:80px;background:#222;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;">Sin foto</div>'}
                            <div class="step-info" style="flex:1;">
                                <div class="step-number" style="font-weight:bold; color:#d68aff; margin-bottom:4px;">Paso ${step.number}</div>
                                <div class="step-desc" style="color:#ccc; font-size:0.95rem; line-height:1.4;">${step.instruction}</div>
                            </div>
                            <button class="delete-btn btn-danger" onclick="deleteStep('${step.id}')" style="padding: 6px 10px; align-self: center;">✕ Eliminar</button>
                        </div>
                    `).join('') : '<p style="color:#666; margin-bottom:16px;">No hay pasos registrados.</p>'}
                </div>

                ${product.steps && product.steps.length > 1 ? `
                    <button class="btn-submit" id="save-order-btn" onclick="saveStepsOrder()" style="margin-top:12px; background:#4ade80; color:#000; border:none;">Guardar Orden</button>
                ` : ''}

                <div style="margin-top:24px; padding-top:20px; border-top:1px solid #333;">
                    <h3 style="font-size:1rem; margin-bottom:16px; color:#ccc;">+ Agregar Paso</h3>
                    <form id="add-step-form" enctype="multipart/form-data">
                        <div class="form-group">
                            <label>Instrucciones</label>
                            <textarea name="instruction" required placeholder="Ej: Haz 5 varetas y cierra con un punto deslizado." style="min-height:80px;"></textarea>
                        </div>
                        <div class="form-group">
                            <label>Foto Ilustrativa (Opcional)</label>
                            <input type="file" name="image" accept="image/*" style="padding:8px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff;">
                        </div>
                        <button type="submit" class="btn-submit" id="add-step-btn">Agregar Paso</button>
                    </form>
                </div>
            </div>

            <!-- ── Materials Section ── -->
            <h2 class="section-title">Materiales Necesarios (${product.materials.length})</h2>
            <div class="form-card">
                <div id="materials-list">
                    ${product.materials.length > 0 ? product.materials.map(mat => `
                        <div class="material-card" id="mat-${mat.id}">
                            ${mat.imageUrl ? `<img src="${mat.imageUrl}" loading="lazy"/>` : '<div style="width:60px;height:60px;background:#222;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;">Sin foto</div>'}
                            <div class="material-info">
                                <div class="material-name">${mat.name}</div>
                                <div class="material-qty">Cant / Grosor: ${mat.quantity}</div>
                                <div class="material-desc">${mat.description || 'Sin descripción'}</div>
                            </div>
                            <button class="delete-btn btn-danger" onclick="deleteMaterial('${mat.id}')" style="padding: 6px 10px; align-self: center;">✕ Eliminar</button>
                        </div>
                    `).join('') : '<p style="color:#666; margin-bottom:16px;">No hay materiales registrados.</p>'}
                </div>

                <div style="margin-top:24px; padding-top:20px; border-top:1px solid #333;">
                    <h3 style="font-size:1rem; margin-bottom:16px; color:#ccc;">+ Agregar Material</h3>
                    <form id="add-material-form" enctype="multipart/form-data">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Nombre del Material</label>
                                <input type="text" name="name" required placeholder="Ej: Hilo de algodón">
                            </div>
                            <div class="form-group">
                                <label>Cantidad / Grosor</label>
                                <input type="text" name="quantity" required placeholder="Ej: 2 ovillos, 5mm">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Descripción / Notas</label>
                                <textarea name="description" placeholder="Opcional. Ej: Color rosa pastel. Asegúrate de que sea 100% algodón." style="min-height:50px;"></textarea>
                            </div>
                            <div class="form-group">
                                <label>Foto del Material (Opcional)</label>
                                <input type="file" name="image" accept="image/*" style="padding:8px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff;">
                            </div>
                        </div>
                        <button type="submit" class="btn-submit" id="add-mat-btn">Agregar Material</button>
                    </form>
                </div>
            </div>

            <script>
                const productId = '${product.id}';

                // ── Save product details ──
                document.getElementById('edit-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('save-btn');
                    const msg = document.getElementById('progress-msg');
                    btn.disabled = true;
                    msg.style.display = 'block';
                    msg.textContent = 'Guardando cambios...';

                    try {
                        const formData = new FormData();
                        formData.append('name', e.target.name.value);
                        formData.append('description', e.target.description.value);
                        formData.append('startDate', e.target.startDate.value);
                        formData.append('endDate', e.target.endDate.value);

                        const res = await fetch('/diy/products/' + productId, {
                            method: 'PUT',
                            body: formData,
                        });
                        const data = await res.json();

                        if (data.success) {
                            msg.textContent = '✅ Cambios guardados';
                            msg.style.borderColor = '#22c55e';
                            msg.style.color = '#4ade80';
                            setTimeout(() => { msg.style.display = 'none'; }, 2000);
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                    }
                });

                // ── Delete single image ──
                async function deleteImage(imgId) {
                    if (!confirm('¿Eliminar esta imagen?')) return;
                    const card = document.getElementById('img-' + imgId);
                    card.classList.add('deleting');

                    try {
                        const res = await fetch('/diy/images/' + imgId, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                            card.remove();
                        } else {
                            card.classList.remove('deleting');
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        card.classList.remove('deleting');
                        alert('Error de red');
                    }
                }

                // ── Upload new images ──
                async function uploadNewImages() {
                    const input = document.getElementById('new-images');
                    if (!input.files.length) return alert('Selecciona al menos una imagen');

                    const btn = document.getElementById('upload-images-btn');
                    btn.disabled = true;
                    btn.textContent = 'Subiendo...';

                    try {
                        const formData = new FormData();
                        for (const file of input.files) {
                            formData.append('images', file);
                        }

                        const res = await fetch('/diy/products/' + productId, {
                            method: 'PUT',
                            body: formData,
                        });
                        const data = await res.json();
                        if (data.success) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = '📷 Subir Imágenes';
                    }
                }

                // ── Upload new PDF ──
                async function uploadNewPdf() {
                    const input = document.getElementById('new-pdf');
                    if (!input.files.length) return alert('Selecciona un archivo PDF');

                    const btn = document.getElementById('upload-pdf-btn');
                    btn.disabled = true;
                    btn.textContent = 'Subiendo PDF...';

                    try {
                        const formData = new FormData();
                        formData.append('pdf', input.files[0]);

                        const res = await fetch('/diy/products/' + productId, {
                            method: 'PUT',
                            body: formData,
                        });
                        const data = await res.json();
                        if (data.success) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = '📄 Subir PDF';
                    }
                }

                // ── Remove PDF ──
                async function removePdf() {
                    if (!confirm('¿Quitar el PDF de este producto?')) return;

                    try {
                        const formData = new FormData();
                        formData.append('removePdf', 'true');

                        const res = await fetch('/diy/products/' + productId, {
                            method: 'PUT',
                            body: formData,
                        });
                        const data = await res.json();
                        if (data.success) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red');
                    }
                }

                // ── Add Material ──
                document.getElementById('add-material-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('add-mat-btn');
                    btn.disabled = true;
                    btn.textContent = 'Agregando...';

                    try {
                        const formData = new FormData(e.target);
                        const res = await fetch('/diy/products/' + productId + '/materials', {
                            method: 'POST',
                            body: formData,
                        });
                        const data = await res.json();

                        if (data.success) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = 'Agregar Material';
                    }
                });

                // ── Delete Material ──
                async function deleteMaterial(matId) {
                    if (!confirm('¿Eliminar este material?')) return;
                    
                    const card = document.getElementById('mat-' + matId);
                    card.style.opacity = '0.5';
                    card.style.pointerEvents = 'none';

                    try {
                        const res = await fetch('/diy/materials/' + matId, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                            card.remove();
                        } else {
                            card.style.opacity = '1';
                            card.style.pointerEvents = 'auto';
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        card.style.opacity = '1';
                        card.style.pointerEvents = 'auto';
                        alert('Error de red');
                    }
                }

                // ── Add Step ──
                document.getElementById('add-step-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('add-step-btn');
                    btn.disabled = true;
                    btn.textContent = 'Agregando...';

                    try {
                        const formData = new FormData(e.target);
                        const res = await fetch('/diy/products/' + productId + '/steps', {
                            method: 'POST',
                            body: formData,
                        });
                        const data = await res.json();

                        if (data.id) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = 'Agregar Paso';
                    }
                });

                // ── Delete Step ──
                async function deleteStep(stepId) {
                    if (!confirm('¿Eliminar este paso?')) return;
                    
                    const card = document.getElementById('step-' + stepId);
                    card.style.opacity = '0.5';
                    card.style.pointerEvents = 'none';

                    try {
                        const res = await fetch('/diy/steps/' + stepId, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.message) {
                            card.remove();
                        } else {
                            card.style.opacity = '1';
                            card.style.pointerEvents = 'auto';
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        card.style.opacity = '1';
                        card.style.pointerEvents = 'auto';
                        alert('Error de red');
                    }
                }

                // ── Sortable Steps ──
                // Simple drag and drop logic for steps
                const stepsList = document.getElementById('steps-list');
                let draggedItem = null;

                if (stepsList) {
                    const stepCards = stepsList.querySelectorAll('.step-card');
                    stepCards.forEach(card => {
                        card.setAttribute('draggable', true);
                        
                        card.addEventListener('dragstart', function(e) {
                            draggedItem = card;
                            setTimeout(() => { card.style.opacity = '0.4'; }, 0);
                        });
                        
                        card.addEventListener('dragend', function() {
                            setTimeout(() => { 
                                draggedItem.style.opacity = '1';
                                draggedItem = null;
                            }, 0);
                        });
                        
                        card.addEventListener('dragover', function(e) {
                            e.preventDefault(); // Necessary to allow dropping
                        });
                        
                        card.addEventListener('dragenter', function(e) {
                            e.preventDefault();
                        });
                        
                        card.addEventListener('drop', function(e) {
                            if (card !== draggedItem) {
                                let allItems = [...stepsList.querySelectorAll('.step-card')];
                                let draggedIndex = allItems.indexOf(draggedItem);
                                let droppedIndex = allItems.indexOf(card);
                                
                                if (draggedIndex < droppedIndex) {
                                    card.parentNode.insertBefore(draggedItem, card.nextSibling);
                                } else {
                                    card.parentNode.insertBefore(draggedItem, card);
                                }
                            }
                        });
                    });
                }

                // ── Save Steps Order ──
                async function saveStepsOrder() {
                    const btn = document.getElementById('save-order-btn');
                    btn.disabled = true;
                    btn.textContent = 'Guardando...';

                    try {
                        const stepCards = document.querySelectorAll('.step-card');
                        const order = Array.from(stepCards).map((card, index) => ({
                            id: card.dataset.id,
                            number: index + 1
                        }));

                        const res = await fetch('/diy/products/' + productId + '/steps/reorder', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order })
                        });
                        const data = await res.json();

                        if (data.message) {
                            window.location.reload();
                        } else {
                            alert('Error: ' + (data.error || 'Unknown'));
                        }
                    } catch (err) {
                        alert('Error de red: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = 'Guardar Orden';
                    }
                }
            </script>
        </body>
        </html>
        `;

        res.send(html);
    } catch (error) {
        console.error("Admin DIY Edit Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

export default router;
