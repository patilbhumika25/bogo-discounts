import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";




export async function action({ request }) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let payload = {};
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData);
      if (payload.selectedOptions && typeof payload.selectedOptions === "string") {
        try {
          payload.selectedOptions = JSON.parse(payload.selectedOptions);
        } catch {
          // leave as string
        }
      }
    }

    const {
      shop,
      productId,
      productTitle,
      selectedOptions = {},
      customerEmail,
      quantity = 1,
      note = "",
    } = payload;

    if (!customerEmail) {
      return json({ success: false, error: "customerEmail is required" }, { status: 400 });
    }

    // Attempt to fetch shop owner's email
    let targetEmail = process.env.SENDGRID_TO_EMAIL;
    if (shop) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        if (admin) {
          const response = await admin.graphql(`{ shop { email } }`);
          const responseJson = await response.json();
          if (responseJson.data?.shop?.email) {
            targetEmail = responseJson.data.shop.email;
          }
        }
      } catch (err) {
        console.warn("Could not fetch shop email, falling back to default:", err);
      }
    }

    if (!targetEmail) {
       // If no target email is found (no env var and no shop email), we might fail or log
       console.warn("No target email available for estimate request.");
    }

    const lines = [];
    lines.push(`Estimate Request`);
    if (productId) lines.push(`Product ID: ${productId}`);
    if (productTitle) lines.push(`Product: ${productTitle}`);
    lines.push(`Quantity: ${quantity}`);
    if (selectedOptions && typeof selectedOptions === "object") {
      lines.push(`Options:`);
      for (const [k, v] of Object.entries(selectedOptions)) {
        lines.push(`- ${k}: ${v}`);
      }
    }
    if (note) lines.push(`Note: ${note}`);
    const text = lines.join("\n");

    let emailStatus = "skipped";
    let sendError = null;
    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL && targetEmail) {
      const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: targetEmail }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL, name: "Estimate Bot" },
          subject: `Estimate request: ${productTitle || productId || ""}`,
          content: [{ type: "text/plain", value: text }],
        }),
      });
      emailStatus = resp.ok ? "sent" : "failed";
      if (!resp.ok) {
        sendError = await resp.text();
      }
    } else if (process.env.ESTIMATE_MAIL_WEBHOOK_URL) {
      const resp = await fetch(process.env.ESTIMATE_MAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: customerEmail,
          subject: `Estimate request: ${productTitle || productId || ""}`,
          text,
        }),
      });
      emailStatus = resp.ok ? "sent" : "failed";
      if (!resp.ok) {
        sendError = await resp.text();
      }
    } else {
      emailStatus = "skipped";
    }

    return json({
      success: true,
      emailStatus,
      error: sendError,
    });
  } catch (error) {
    return json({ success: false, error: error.message || "Failed" }, { status: 500 });
  }
}

export async function loader() {
  return json({ ok: true });
}
