// import { useEffect } from "react";
// import { useFetcher } from "@remix-run/react";
// import {
//   Page,
//   Layout,
//   Text,
//   Card,
//   Button,
//   BlockStack,
//   Box,
//   List,
//   Link,
//   InlineStack,
// } from "@shopify/polaris";
// import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   await authenticate.admin(request);

//   return null;
// };

// export const action = async ({ request }) => {
//   const { admin } = await authenticate.admin(request);
//   const color = ["Red", "Orange", "Yellow", "Green"][
//     Math.floor(Math.random() * 4)
//   ];
//   const response = await admin.graphql(
//     `#graphql
//       mutation populateProduct($product: ProductCreateInput!) {
//         productCreate(product: $product) {
//           product {
//             id
//             title
//             handle
//             status
//             variants(first: 10) {
//               edges {
//                 node {
//                   id
//                   price
//                   barcode
//                   createdAt
//                 }
//               }
//             }
//           }
//         }
//       }`,
//     {
//       variables: {
//         product: {
//           title: `${color} Snowboard`,
//         },
//       },
//     },
//   );
//   const responseJson = await response.json();
//   const product = responseJson.data.productCreate.product;
//   const variantId = product.variants.edges[0].node.id;
//   const variantResponse = await admin.graphql(
//     `#graphql
//     mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
//       productVariantsBulkUpdate(productId: $productId, variants: $variants) {
//         productVariants {
//           id
//           price
//           barcode
//           createdAt
//         }
//       }
//     }`,
//     {
//       variables: {
//         productId: product.id,
//         variants: [{ id: variantId, price: "100.00" }],
//       },
//     },
//   );
//   const variantResponseJson = await variantResponse.json();

//   return {
//     product: responseJson.data.productCreate.product,
//     variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
//   };
// };

// export default function Index() {
//   const fetcher = useFetcher();
//   const shopify = useAppBridge();
//   const isLoading =
//     ["loading", "submitting"].includes(fetcher.state) &&
//     fetcher.formMethod === "POST";
//   const productId = fetcher.data?.product?.id.replace(
//     "gid://shopify/Product/",
//     "",
//   );

//   useEffect(() => {
//     if (productId) {
//       shopify.toast.show("Product created");
//     }
//   }, [productId, shopify]);
//   const generateProduct = () => fetcher.submit({}, { method: "POST" });

//   return (
//     <Page>
//       <TitleBar title="Remix app template">
//         <button variant="primary" onClick={generateProduct}>
//           Generate a product
//         </button>
//       </TitleBar>
//       <BlockStack gap="500">
//         <Layout>
//           <Layout.Section>
//             <Card>
//               <BlockStack gap="500">
//                 <BlockStack gap="200">
//                   <Text as="h2" variant="headingMd">
//                     Congrats on creating a new Shopify app 🎉
//                   </Text>
//                   <Text variant="bodyMd" as="p">
//                     This embedded app template uses{" "}
//                     <Link
//                       url="https://shopify.dev/docs/apps/tools/app-bridge"
//                       target="_blank"
//                       removeUnderline
//                     >
//                       App Bridge
//                     </Link>{" "}
//                     interface examples like an{" "}
//                     <Link url="/app/additional" removeUnderline>
//                       additional page in the app nav
//                     </Link>
//                     , as well as an{" "}
//                     <Link
//                       url="https://shopify.dev/docs/api/admin-graphql"
//                       target="_blank"
//                       removeUnderline
//                     >
//                       Admin GraphQL
//                     </Link>{" "}
//                     mutation demo, to provide a starting point for app
//                     development.
//                   </Text>
//                 </BlockStack>
//                 <BlockStack gap="200">
//                   <Text as="h3" variant="headingMd">
//                     Get started with products
//                   </Text>
//                   <Text as="p" variant="bodyMd">
//                     Generate a product with GraphQL and get the JSON output for
//                     that product. Learn more about the{" "}
//                     <Link
//                       url="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
//                       target="_blank"
//                       removeUnderline
//                     >
//                       productCreate
//                     </Link>{" "}
//                     mutation in our API references.
//                   </Text>
//                 </BlockStack>
//                 <InlineStack gap="300">
//                   <Button loading={isLoading} onClick={generateProduct}>
//                     Generate a product
//                   </Button>
//                   {fetcher.data?.product && (
//                     <Button
//                       url={`shopify:admin/products/${productId}`}
//                       target="_blank"
//                       variant="plain"
//                     >
//                       View product
//                     </Button>
//                   )}
//                 </InlineStack>
//                 {fetcher.data?.product && (
//                   <>
//                     <Text as="h3" variant="headingMd">
//                       {" "}
//                       productCreate mutation
//                     </Text>
//                     <Box
//                       padding="400"
//                       background="bg-surface-active"
//                       borderWidth="025"
//                       borderRadius="200"
//                       borderColor="border"
//                       overflowX="scroll"
//                     >
//                       <pre style={{ margin: 0 }}>
//                         <code>
//                           {JSON.stringify(fetcher.data.product, null, 2)}
//                         </code>
//                       </pre>
//                     </Box>
//                     <Text as="h3" variant="headingMd">
//                       {" "}
//                       productVariantsBulkUpdate mutation
//                     </Text>
//                     <Box
//                       padding="400"
//                       background="bg-surface-active"
//                       borderWidth="025"
//                       borderRadius="200"
//                       borderColor="border"
//                       overflowX="scroll"
//                     >
//                       <pre style={{ margin: 0 }}>
//                         <code>
//                           {JSON.stringify(fetcher.data.variant, null, 2)}
//                         </code>
//                       </pre>
//                     </Box>
//                   </>
//                 )}
//               </BlockStack>
//             </Card>
//           </Layout.Section>
//           <Layout.Section variant="oneThird">
//             <BlockStack gap="500">
//               <Card>
//                 <BlockStack gap="200">
//                   <Text as="h2" variant="headingMd">
//                     App template specs
//                   </Text>
//                   <BlockStack gap="200">
//                     <InlineStack align="space-between">
//                       <Text as="span" variant="bodyMd">
//                         Framework
//                       </Text>
//                       <Link
//                         url="https://remix.run"
//                         target="_blank"
//                         removeUnderline
//                       >
//                         Remix
//                       </Link>
//                     </InlineStack>
//                     <InlineStack align="space-between">
//                       <Text as="span" variant="bodyMd">
//                         Database
//                       </Text>
//                       <Link
//                         url="https://www.prisma.io/"
//                         target="_blank"
//                         removeUnderline
//                       >
//                         Prisma
//                       </Link>
//                     </InlineStack>
//                     <InlineStack align="space-between">
//                       <Text as="span" variant="bodyMd">
//                         Interface
//                       </Text>
//                       <span>
//                         <Link
//                           url="https://polaris.shopify.com"
//                           target="_blank"
//                           removeUnderline
//                         >
//                           Polaris
//                         </Link>
//                         {", "}
//                         <Link
//                           url="https://shopify.dev/docs/apps/tools/app-bridge"
//                           target="_blank"
//                           removeUnderline
//                         >
//                           App Bridge
//                         </Link>
//                       </span>
//                     </InlineStack>
//                     <InlineStack align="space-between">
//                       <Text as="span" variant="bodyMd">
//                         API
//                       </Text>
//                       <Link
//                         url="https://shopify.dev/docs/api/admin-graphql"
//                         target="_blank"
//                         removeUnderline
//                       >
//                         GraphQL API
//                       </Link>
//                     </InlineStack>
//                   </BlockStack>
//                 </BlockStack>
//               </Card>
//               <Card>
//                 <BlockStack gap="200">
//                   <Text as="h2" variant="headingMd">
//                     Next steps
//                   </Text>
//                   <List>
//                     <List.Item>
//                       Build an{" "}
//                       <Link
//                         url="https://shopify.dev/docs/apps/getting-started/build-app-example"
//                         target="_blank"
//                         removeUnderline
//                       >
//                         {" "}
//                         example app
//                       </Link>{" "}
//                       to get started
//                     </List.Item>
//                     <List.Item>
//                       Explore Shopify’s API with{" "}
//                       <Link
//                         url="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
//                         target="_blank"
//                         removeUnderline
//                       >
//                         GraphiQL
//                       </Link>
//                     </List.Item>
//                   </List>
//                 </BlockStack>
//               </Card>
//             </BlockStack>
//           </Layout.Section>
//         </Layout>
//       </BlockStack>
//     </Page>
//   );
// }

import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Grid,
  Icon,
  Box,
} from "@shopify/polaris";
import { LightbulbIcon, TargetFilledIcon } from "@shopify/polaris-icons";

import { requireSubscription } from "../utils/requireSubscription";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { useEffect } from "react";

const campaigns = [
  {
    id: "buy-x-get-y",
    title: "Buy X Get Y",
    description: "Buy specific items and get a free product",
    example: "Buy bed, get a free chair",
    note: "Product-specific rewards",
    image:
      "https://cdnapps.avada.io/ag-free-gift/giftCampaigns/bxgy.png?width=400",
    exampleIcon: LightbulbIcon,
    noteIcon: TargetFilledIcon,
    link: 'buy-x-get-y'
  },
  {
    id: "cart-value",
    title: "Free Gift Offers",
    description: "Spend more, get free gift/discount",
    example: "Spend $250, get a free table",
    note: "Based on total spend",
    image:
      "https://cdnapps.avada.io/ag-free-gift/giftCampaigns/gwca.png?width=400",
    exampleIcon: LightbulbIcon,
    noteIcon: TargetFilledIcon,
  },
  {
    id: "free-shipping-1",
    title: "Combo / Hybrid Offers",
    description: "Buy 1, get 1 free + 10% off rest of cart.",
    example: "Spend $75 for free express shipping",
    note: "Shipping cost focus",
    image:
      "https://cdnapps.avada.io/ag-free-gift/giftCampaigns/shipping-goal.png?width=400",
    exampleIcon: LightbulbIcon,
    noteIcon: TargetFilledIcon,
  },

  {
    id: "Gift With Quantity Purchase",
    title: "Gift With Quantity Purchase",
    description: "Buy a total number of items to get a discount",
    example: "Buy 3 items, get 10% off",
    note: "Item quantity focus",
    image:
      "https://cdnapps.avada.io/ag-free-gift/giftCampaigns/gwqu.png?width=400",
    exampleIcon: LightbulbIcon,
    noteIcon: TargetFilledIcon,
  },
];

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const { shouldRedirect } = await requireSubscription(request);

    console.log('here');
    if (shouldRedirect) {
      // return json({ shouldRedirect: true });
      console.log('app index redirect')
    }

    return json({
      shouldRedirect
    })
  } catch (error) {
    return json({
      data: 'error'
    })
    
  }
};

export default function CampaignsPage() {
  const navigate = useNavigate();
  const{ shouldRedirect } = useLoaderData();
  
   useEffect(() => {
    //console.log("shouldRedirect inside orders:", shouldRedirect);
    if (shouldRedirect) {
     return navigate("/app/billing");
    }
  }, [shouldRedirect, navigate]);

  console.log('should redirect', shouldRedirect);

  return (
    <Page title="Choose campaign type">
      <Grid>
        {campaigns.map((campaign) => (
          <Grid.Cell
            key={campaign.id}
            columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}
            style={{ display: "flex", alignItems: "stretch" }} 
          >
            <Card style={{ flex: 1, display: "flex", flexDirection: "column", padding: '0px'  }}>
               <img
                  src={campaign.image}
                  alt={campaign.title}
                  style={{
                    width: "100%",
                    height: "160px",
                    objectFit: "cover",
                    borderTopLeftRadius: "8px",
                    borderTopRightRadius: "8px",
                  }}
                />
              <Box
                as="div"
                width="100%"
                padding="0"
                style={{
                  textAlign: "left",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                
                <BlockStack gap='100'>
                {/* Thumbnail */}
               

                {/* Title + description */}
                <Text
                  variant="headingSm"
                  as="h3"
                  tone="default"
                  alignment="start"
                  style={{ paddingTop: "10px" }}
                >
                  {campaign.title}
                </Text>
                <p style={{ fontSize: "12px" }}>{campaign.description}</p>

                {/* Example row */}
                <InlineStack gap="100" blockAlign="center" align="start">
                  {" "}
                  <div style={{ marginRight: "0", marginLeft: 0 }}>
                    {" "}
                    <Icon source={campaign.exampleIcon} tone="subdued" />{" "}
                  </div>{" "}
                  <p style={{ fontSize: "12px", color: "#616161" }}>
                    {" "}
                    {campaign.example}{" "}
                  </p>{" "}
                  {/* <Text as="span" tone="subdued"> </Text> */}{" "}
                </InlineStack>

                {/* Note row */}
                <InlineStack gap="100" blockAlign="center" align="start">
                  {" "}
                  <div style={{ marginRight: "0", marginLeft: 0 }}>
                    {" "}
                    <Icon source={campaign.noteIcon} tone="subdued" />{" "}
                  </div>{" "}
                  <p style={{ fontSize: "12px", color: "#616161" }}>
                    {" "}
                    {campaign.note}{" "}
                  </p>{" "}
                  {/* <Text as="span" tone="subdued"> {campaign.note} </Text> */}{" "}
                </InlineStack>

                {/* Button pinned at bottom */}
                <Box style={{ marginTop: "10px" }}>
                  {" "}
                  <Button onClick={() => navigate(`${campaign.link}`)}>
                    Create{" "}
                  </Button>{" "}
                </Box>

                </BlockStack>
              </Box>
            </Card>
          </Grid.Cell>
        ))}
      </Grid>
    </Page>
  );
}
