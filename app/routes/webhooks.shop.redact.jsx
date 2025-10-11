import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server"; 

export const action = async ({ request }) => {
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const rawBody = await request.text();

  const generatedHash = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  if (generatedHash !== hmacHeader) {
    console.error("❌ HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  console.log("✅ HMAC verified for customers/data_request:", payload);

  //  delete all BOGO campaigns or shop-related records
  await prisma.offer.deleteMany({
    where: { shop: payload.shop_domain },
  });

  return json({
    success: true,
    message: "Shop data erased successfully.",
  });
};
