import { json } from "@remix-run/node";
import crypto from "crypto";

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

  return json({
    success: true,
    message: "No customer data stored by the BOGO app. No action required.",
  });
};
