import { authenticate } from "../shopify.server"; // helper from remix-shopify template

// Mutation to bind your function to Shopify
const CREATE_DISCOUNT_MUTATION = `
mutation DiscountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
    automaticAppDiscount {
      discountId
      title
      startsAt
      endsAt
    }
    userErrors {
      field
      message
    }
  }
}
`;

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Get form data from frontend
  const body = await request.json();
  const {
    title,
    startsAt,
    endsAt,
    config, // your custom rule config (Buy X, Get Y)
  } = body;

  // 2. Shopify expects config as metafield JSON string
  const variables = {
    automaticAppDiscount: {
      title,
      startsAt,
      endsAt,
      functionId: "0199326d-2d80-7a3d-b791-b169da013d50", 
      metafields: [
        {
          namespace: "bogo",
          key: "config",
          type: "json",
          value: JSON.stringify(config),
        },
      ],
    },
  };

  // 3. Call Shopify GraphQL Admin API
  const response = await admin.graphql(CREATE_DISCOUNT_MUTATION, {
    variables,
  });

  const result = await response.json();
  console.log("Discount creation result:", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
