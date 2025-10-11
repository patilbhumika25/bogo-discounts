// app/utils/requireSubscription.js
import { authenticate, STARTER_PLAN, PRO_PLAN } from "../shopify.server";
import { redirect } from "@remix-run/node";
import prisma from "../db.server";

// This enforces subscription plan & feature usage
export async function requireSubscription(request) {
  const { billing, session } = await authenticate.admin(request);
  const { shop } = session;

  // Check active subscriptions
  const { hasActivePayment, appSubscriptions } = await billing.check({});
  const activePlan =
    appSubscriptions?.[0]?.name?.trim() || "FREE";

  console.log("Active plan:", activePlan);
  console.log("shop:", shop);
  // console.log("session:", session);
  
  // Fetch offers created by this shop from DB
  console.log("b db query");
  const offers = await prisma.offer.findMany({ where: { shop } });
  console.log(`Shop: ${shop} | Offers: ${offers}`);
  
  console.log("After db query");
//   // Enforce plan limits
  let limit = 1; // Free plan default
  if (activePlan.toUpperCase() === STARTER_PLAN.toUpperCase()) {
    limit = 10;
  } else if (activePlan.toUpperCase() === PRO_PLAN.toUpperCase()) {
    limit = Infinity;
  }

//   if (offers > limit) {
//     // Redirect to pricing page
//     console.log('redirect')
//     // throw redirect(`/pricing?reason=limit_exceeded&plan=${activePlan}`);
//   }

  return { shouldRedirect: false };
}
