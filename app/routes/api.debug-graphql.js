import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "bogo-store-test.myshopify.com";

  try {
    const { admin } = await unauthenticated.admin(shop);

    const campaigns = await prisma.offer.findMany({
      where: { shop: shop },
      orderBy: { createdAt: "desc" },
    });

    const discountIds = campaigns
      .map((c) => c.discountId)
      .filter((id) => id && typeof id === "string");

    let rawNodes = [];
    if (discountIds.length > 0) {
      const response = await admin.graphql(`
        query getDiscountStatuses($ids: [ID!]!) {
          nodes(ids: $ids) {
            id
            __typename
            ... on DiscountAutomaticNode {
              automaticDiscount {
                __typename
                ... on DiscountAutomaticApp {
                  status
                  title
                }
                ... on DiscountAutomaticBasic {
                  status
                  title
                }
              }
            }
            ... on DiscountCodeNode {
              codeDiscount {
                __typename
                ... on DiscountCodeApp {
                  status
                  title
                }
                ... on DiscountCodeBasic {
                  status
                  title
                }
              }
            }
          }
        }
      `, { variables: { ids: discountIds } });
      const resJson = await response.json();
      rawNodes = resJson.data?.nodes || [];
    }

    return new Response(JSON.stringify({
      campaignsCount: campaigns.length,
      discountIds,
      rawNodes
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
}
