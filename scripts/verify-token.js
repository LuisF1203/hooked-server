import "dotenv/config";

async function verifyToken() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !token) {
        console.error("❌ Faltan credenciales en .env");
        return;
    }

    console.log("🔍 Verificando credenciales...");
    console.log(`Tienda: ${shop}`);
    console.log(`Token: ${token.substring(0, 10)}...`);

    const url = `https://${shop}/admin/api/2024-01/shop.json`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log("✅ ¡ÉXITO! Conexión correcta.");
            console.log("Nombre de la tienda:", data.shop.name);
            console.log("Email:", data.shop.email);
        } else {
            console.error("❌ ERROR DE SHOPIFY:", response.status, response.statusText);
            const body = await response.text();
            console.error("Respuesta:", body);

            if (response.status === 401) {
                console.log("\n💡 PISTAS:");
                console.log("1. ¿Es 'hooked.myshopify.com' el dominio *original* de tu tienda? (el que tenía al crearse)");
                console.log("2. ¿El token 'shpat_...' es correcto y no ha sido revocado?");
                console.log("3. ¿La app tiene permisos de lectura (read_products, etc)?");
            }
        }
    } catch (error) {
        console.error("❌ ERROR DE RED:", error.message);
    }
}

verifyToken();
