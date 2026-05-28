import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(JSON.stringify({ error: "Missing shop parameter" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Fetch the latest offer for the shop
  const offer = await prisma.offer.findFirst({
    where: {
      shop: shop,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!offer) {
    return new Response(JSON.stringify(null), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  let handle = null;
  let variantId = null;
  
  // For combo/hybrid offers, the rewardIds might be stored in the config JSON
  let rewardIds = offer.rewardIds;
  if (!rewardIds || !Array.isArray(rewardIds) || rewardIds.length === 0) {
    if (offer.config) {
      let configObj = offer.config;
      if (typeof configObj === 'string') {
        try {
          configObj = JSON.parse(configObj);
        } catch (e) {}
      }
      rewardIds = configObj?.giftProductIds || configObj?.rewardIds;
    }
  }

  // Fetch product handle and variant if rewardIds exist
  if (rewardIds && Array.isArray(rewardIds) && rewardIds.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const productId = rewardIds[0]; // This is a GID like gid://shopify/Product/123
      
      const response = await admin.graphql(`
        query getProduct($id: ID!) {
          product(id: $id) {
            handle
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `, { variables: { id: productId } });
      
      const responseJson = await response.json();
      handle = responseJson.data?.product?.handle;
      const variantGid = responseJson.data?.product?.variants?.edges?.[0]?.node?.id;
      if (variantGid) {
        // Extract numeric ID from GID
        variantId = variantGid.split('/').pop();
      }
      console.log(`Fetched handle for ${productId}: ${handle}, variantId: ${variantId}`);
    } catch (e) {
      console.error("Failed to fetch product details:", e);
    }
  }

  const responseData = {
    ...offer,
    rewardHandle: handle,
    rewardVariantId: variantId,
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
