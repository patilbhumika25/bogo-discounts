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

  let rewards = [];
  // Fetch product handles and variants if rewardIds exist
  if (rewardIds && Array.isArray(rewardIds) && rewardIds.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      
      const response = await admin.graphql(`
        query getProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              handle
              title
              variants(first: 1) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        }
      `, { variables: { ids: rewardIds } });
      
      const responseJson = await response.json();
      const nodes = responseJson.data?.nodes || [];
      
      rewards = nodes
        .filter(node => node && node.handle)
        .map(node => {
          const variantGid = node.variants?.edges?.[0]?.node?.id;
          const variantIdNumeric = variantGid ? variantGid.split('/').pop() : null;
          return {
            id: node.id,
            handle: node.handle,
            title: node.title,
            variantId: variantIdNumeric,
          };
        });
      
      if (rewards.length > 0) {
        handle = rewards[0].handle;
        variantId = rewards[0].variantId;
      }
      console.log(`Fetched ${rewards.length} rewards details successfully.`);
    } catch (e) {
      console.error("Failed to fetch product details:", e);
    }
  }

  const responseData = {
    ...offer,
    rewardHandle: handle,
    rewardVariantId: variantId,
    rewards: rewards,
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
