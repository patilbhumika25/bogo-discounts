import { json } from "@remix-run/node";
import { useNavigate, useActionData, Form, useSearchParams } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Card,
  Text,
  TextField,
  LegacyCard,
  Layout,
  FormLayout,
  Select,
  ChoiceList,
  Checkbox,
  InlineStack,
  Button,
  Collapsible,
  Icon,
  Banner,
  ResourceList,
  Thumbnail,
  Badge,
} from "@shopify/polaris";
import { CaretUpIcon, CaretDownIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useEffect, useCallback } from "react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// LOADER - Ensures the session is valid when the page loads
export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

// SERVER-SIDE ACTION
export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const { shop } = session;

    console.log("session: ", session);

    const offerDataString = formData.get("offerData");
    if (!offerDataString) {
      throw new Error("No offer data received");
    }

    const data = JSON.parse(offerDataString);
    console.log("Parsed offer data:", data);

    // Calculate exact startsAt and endsAt dates
    const startsAtDate = new Date();
    let endsAtDate = null;
    
    if (data.isTimeLimited && data.timeLimit) {
      const limit = parseInt(data.timeLimit, 10);
      const unit = data.timeLimitUnit || "hours";
      endsAtDate = new Date(startsAtDate.getTime());
      
      if (unit.toLowerCase() === "minutes") {
        endsAtDate.setMinutes(endsAtDate.getMinutes() + limit);
      } else if (unit.toLowerCase() === "hours") {
        endsAtDate.setHours(endsAtDate.getHours() + limit);
      } else if (unit.toLowerCase() === "days") {
        endsAtDate.setDate(endsAtDate.getDate() + limit);
      }
    } else if (data.endsAt) {
      endsAtDate = new Date(`${data.endsAt}T${data.endTime || "23:59"}:00Z`);
    }

    // Determine reward configuration based on offer type
    let rewardType = "free";
    let rewardValue = null;

    // Save in DB with enhanced fields for different gift types
    const offer = await prisma.offer.create({
      data: {
        title: data.title,
        offerType: data.offerType, // New field for offer type

        // Trigger configuration
        triggerType: data.triggerType, // 'order_value', 'products', 'collections', 'subscription'
        triggerIds: data.triggerType === "products"
          ? data.selectedProducts.map((p) => p.id)
          : data.triggerType === "collections"
          ? data.selectedCollections.map((c) => c.id)
          : [],
        minOrderValue: data.minOrderValue ? parseFloat(data.minOrderValue) : null,
        minQty: data.minQuantity ? parseInt(data.minQuantity, 10) : 1,

        // Gift configuration
        rewardType,
        rewardValue,
        rewardApplyTo: "selected",
        rewardIds: data.giftProducts.map((p) => p.id),
        rewardQty: parseInt(data.giftQuantity, 10) || 1,

        // Gift selection options
        giftSelectionType: data.giftSelectionType, // 'auto', 'single_choice', 'multi_choice', 'mystery'
        maxGiftSelection: data.maxGiftSelection ? parseInt(data.maxGiftSelection) : null,
        isMysteryGift: data.giftSelectionType === 'mystery',

        // Time-limited options
        isTimeLimited: data.isTimeLimited || false,
        timeLimit: data.timeLimit ? parseInt(data.timeLimit) : null,
        timeLimitUnit: data.timeLimitUnit || 'hours',

        combinesOrder: data.combines?.orderDiscounts || false,
        combinesProduct: data.combines?.productDiscounts || false,
        combinesShipping: data.combines?.shippingDiscounts || false,

        limitTotalUses: data.usageLimits?.includes("limit_total") || null,
        limitPerCustomer: data.usageLimits?.includes("limit_per_customer") || false,

        startsAt: startsAtDate,
        endsAt: endsAtDate,

        functionId: process.env.SHOPIFY_BOGO_BUNDLES_FREE_GIFT_ID || "0199379e-57e6-73a8-91df-bbb1eb0183f8",
        status: "DRAFT",
        shop: shop,
      },
    });

    console.log('save in db')

    // Build GraphQL mutation based on offer type
    const mutation = `
      mutation discountAutomaticBxgyCreate(
        $automaticBxgyDiscount: DiscountAutomaticBxgyInput!
      ) {
        discountAutomaticBxgyCreate(
          automaticBxgyDiscount: $automaticBxgyDiscount
        ) {
          userErrors {
            field
            message
          }
          automaticDiscountNode {
            id
            automaticDiscount {
              ... on DiscountAutomaticBxgy {
                title
                status
                startsAt
                endsAt
              }
            }
          }
        }
      }
    `;

    // Build customer buys based on trigger type
    let customerBuys = {};

    if (data.triggerType === "order_value") {
      let items = { all: true };
      
      if (data.applyTo === "products") {
        items = { products: { productsToAdd: data.selectedProducts.map(p => p.id) } };
      } else if (data.applyTo === "collections") {
        items = { collections: { add: data.selectedCollections.map(c => c.id) } };
      } else {
        // Fallback for "All Products" in BXGY: Fetch all collections
        try {
          const collectionsResponse = await admin.graphql(`
            query {
              collections(first: 250) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          `);
          const collectionsData = await collectionsResponse.json();
          const collectionIds = collectionsData.data?.collections?.edges?.map(e => e.node.id) || [];
          
          if (collectionIds.length > 0) {
            items = { collections: { add: collectionIds } };
          } else {
            items = { all: true }; // Fallback if no collections found
          }
        } catch (error) {
          console.error("Error fetching collections:", error);
          items = { all: true };
        }
      }

      customerBuys = {
        value: {
          amount: parseFloat(data.minOrderValue).toString(),
        },
        items: items,
      };
    } else if (data.triggerType === "products") {
      customerBuys = {
        value: {
          quantity: (data.minQuantity || 1).toString(),
        },
        items: {
          products: {
            productsToAdd: data.selectedProducts.map((p) => p.id),
          },
        },
      };
    } else if (data.triggerType === "collections") {
      customerBuys = {
        value: {
          quantity: (data.minQuantity || 1).toString(),
        },
        items: {
          collections: {
            add: data.selectedCollections.map((c) => c.id),
          },
        },
      };
    } else if (data.triggerType === "subscription") {
      // Subscription handling - use products/collections with subscription metadata
      customerBuys = {
        value: {
          quantity: "1",
        },
        items:
          data.selectedProducts.length > 0
            ? {
                products: {
                  productsToAdd: data.selectedProducts.map((p) => p.id),
                },
              }
            : {
                all: true,
              },
      };
    }

    const variables = {
      automaticBxgyDiscount: {
        title: data.title,
        startsAt: startsAtDate.toISOString(),
        endsAt: endsAtDate ? endsAtDate.toISOString() : null,

        customerBuys,

        customerGets: {
          value: {
            discountOnQuantity: {
              quantity: (data.giftSelectionType === "multi_choice"
                ? (data.maxGiftSelection || 1)
                : (data.giftQuantity || 1)
              ).toString(),
              effect: { percentage: 1.0 }, // 100% off for free gift
            },
          },
          items: {
            products: {
              productsToAdd: data.giftProducts.map((p) => p.id),
            },
          },
        },

        combinesWith: {
          orderDiscounts: data.combines?.orderDiscounts || false,
          productDiscounts: data.combines?.productDiscounts || false,
          shippingDiscounts: data.combines?.shippingDiscounts || false,
        },
        usesPerOrderLimit: "1",
      },
    };

    console.log("GraphQL Variables:", JSON.stringify(variables, null, 2));

    const response = await admin.graphql(mutation, { variables });
    const jsonResponse = await response.json();

    console.log("Shopify API Response:", JSON.stringify(jsonResponse, null, 2));

    if (
      jsonResponse?.data?.discountAutomaticBxgyCreate?.userErrors?.length > 0
    ) {
      const errors = jsonResponse.data.discountAutomaticBxgyCreate.userErrors;
      console.error("Shopify API Errors:", errors);
      throw new Error(errors.map((e) => e.message).join(", "));
    }

    if (
      !jsonResponse?.data?.discountAutomaticBxgyCreate?.automaticDiscountNode
    ) {
      console.error("No discount created in response:", jsonResponse);
      throw new Error("Failed to create discount");
    }

    return json({
      success: true,
      data: offer,
      shopify:
        jsonResponse.data.discountAutomaticBxgyCreate.automaticDiscountNode,
      message: "Free gift offer created successfully!",
    });
  } catch (error) {
    console.error("Error creating offer:", error);
    return json(
      {
        success: false,
        errors: error.message || "Failed to create offer",
      },
      { status: 500 },
    );
  }
}

// CLIENT-SIDE COMPONENT
export default function FreeGiftOffer() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const actionData = useActionData();
  const [searchParams] = useSearchParams();

  const subtypeParam = searchParams.get("subtype") || "free_gift_order_value";

  const getOfferTypeFromSubtype = (subtype) => {
    switch (subtype) {
      case "free_gift_order_value": return "order_value_gift";
      case "free_gift_product": return "product_gift";
      case "free_gift_subscription": return "subscription_gift";
      case "free_gift_mystery": return "mystery_gift";
      case "free_gift_auto": return "auto_add_gift";
      case "free_gift_choice": return "gift_choice_single";
      case "free_gift_multi_choice": return "gift_choice_multi";
      case "free_gift_time_limited": return "time_limited_gift";
      default: return "order_value_gift";
    }
  };

  const [formData, setFormData] = useState({
    title: "Free Gift Offer #1",
    offerType: getOfferTypeFromSubtype(subtypeParam), // Correctly pre-initialized from subtype!

    // Trigger configuration
    triggerType: "order_value", // 'order_value', 'products', 'collections', 'subscription'
    minOrderValue: "",
    minQuantity: "1",
    selectedProducts: [],
    selectedCollections: [],

    // Gift configuration
    giftProducts: [],
    giftQuantity: "1",
    giftSelectionType: "auto", // 'auto', 'single_choice', 'multi_choice', 'mystery'
    maxGiftSelection: "1",

    // Time-limited options
    isTimeLimited: subtypeParam === "free_gift_time_limited",
    timeLimit: "",
    timeLimitUnit: "hours",

    combines: {
      productDiscounts: false,
      orderDiscounts: false,
      shippingDiscounts: false,
    },

    usageLimits: [],
    customerEligibility: "all",
    startsAt: new Date().toISOString().split("T")[0],
    startTime: new Date().toTimeString().slice(0, 5),
    endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toTimeString().slice(0, 5),
  });

  const [openSections, setOpenSections] = useState({
    section1: false,
    section2: false,
    section3: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Offer type options
  const offerTypeOptions = [
    { label: "Free Gift on Order Value", value: "order_value_gift" },
    { label: "Free Gift on Product Purchase", value: "product_gift" },
    { label: "Mystery Gift", value: "mystery_gift" },
    { label: "Auto-Add Gift", value: "auto_add_gift" },
    { label: "Gift with Choice (Single)", value: "gift_choice_single" },
    { label: "Gift with Multi-Choice", value: "gift_choice_multi" },
    { label: "Time-Limited Gift", value: "time_limited_gift" },
  ];

  const giftSelectionOptions = [
    { label: "Auto-Add (Gift is automatically added)", value: "auto" },
    { label: "Single Choice (Customer picks 1 gift)", value: "single_choice" },
    { label: "Multi-Choice (Customer picks multiple)", value: "multi_choice" },
    { label: "Mystery Gift (Hidden until checkout)", value: "mystery" },
  ];

  // Update trigger type and selection type based on offer type
  useEffect(() => {
    switch (formData.offerType) {
      case "order_value_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "auto",
        }));
        break;
      case "product_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "products",
          giftSelectionType: "auto",
        }));
        break;
      case "subscription_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "subscription",
          giftSelectionType: "auto",
        }));
        break;
      case "mystery_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "mystery",
        }));
        break;
      case "auto_add_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "auto",
        }));
        break;
      case "gift_choice_single":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "single_choice",
          maxGiftSelection: "1",
        }));
        break;
      case "gift_choice_multi":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "multi_choice",
          maxGiftSelection: "2",
        }));
        break;
      case "time_limited_gift":
        setFormData((prev) => ({
          ...prev,
          triggerType: "order_value",
          giftSelectionType: "auto",
          isTimeLimited: true,
        }));
        break;
    }
  }, [formData.offerType]);

  useEffect(() => {
    if (actionData?.success) {
      setIsSubmitting(false);
      shopify.toast.show(actionData.message || "Offer created successfully!");
      navigate("/app");
    } else if (actionData?.errors) {
      setIsSubmitting(false);
      shopify.toast.show(
        typeof actionData.errors === "string"
          ? actionData.errors
          : "Failed to create offer. Please check the form.",
        { isError: true },
      );
    }
  }, [actionData, navigate, shopify]);

  const handleToggle = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Open collection picker
  const openCollectionPicker = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "collection",
        multiple: true,
        action: "select",
      });

      if (selected && selected.length > 0) {
        setFormData((prev) => ({
          ...prev,
          selectedCollections: selected,
        }));
      }
    } catch (error) {
      console.error("Resource Picker Error:", error);
    }
  };

  // Open trigger picker (products/collections)
  const openTriggerPicker = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (selected && selected.length > 0) {
        setFormData((prev) => ({
          ...prev,
          selectedProducts: selected,
        }));
      } else if (formData.triggerType === "collections") {
        const selected = await shopify.resourcePicker({
          type: "collection",
          multiple: true,
          action: "select",
        });

        if (selected && selected.length > 0) {
          setFormData((prev) => ({
            ...prev,
            selectedCollections: selected,
          }));
        }
      }
    } catch (error) {
      console.error("Error opening trigger picker:", error);
    }
  };

  // Open gift products picker
  const openGiftPicker = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (selected && selected.length > 0) {
        setFormData((prev) => ({
          ...prev,
          giftProducts: selected,
        }));
      }
    } catch (error) {
      console.error("Error opening gift picker:", error);
    }
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCombinesChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      combines: {
        ...prev.combines,
        [field]: value,
      },
    }));
  };

  const validateForm = () => {
    const errors = [];
    if (!formData.title.trim()) errors.push("Campaign name is required");

    // Validate trigger
    if (formData.triggerType === "order_value" && !formData.minOrderValue) {
      errors.push("Minimum order value is required");
    }
    if (
      formData.triggerType === "products" &&
      formData.selectedProducts.length === 0
    ) {
      errors.push("At least one trigger product must be selected");
    }
    if (
      formData.triggerType === "collections" &&
      formData.selectedCollections.length === 0
    ) {
      errors.push("At least one trigger collection must be selected");
    }

    // Validate gifts
    if (formData.giftProducts.length === 0) {
      errors.push("At least one gift product must be selected");
    }

    if (!formData.giftQuantity || parseInt(formData.giftQuantity) < 1) {
      errors.push("Gift quantity must be at least 1");
    }

    // Validate multi-choice
    if (formData.giftSelectionType === "multi_choice") {
      const maxSelection = parseInt(formData.maxGiftSelection);
      if (maxSelection > formData.giftProducts.length) {
        errors.push("Max gift selection cannot exceed available gifts");
      }
    }

    // Validate time-limited
    if (formData.isTimeLimited && !formData.timeLimit) {
      errors.push("Time limit is required for time-limited offers");
    }

    if (!formData.startsAt) errors.push("Start date is required");

    return errors;
  };

  const handleSubmit = (event) => {
    const errors = validateForm();
    if (errors.length > 0) {
      event.preventDefault();
      alert("Please fix the following errors:\n" + errors.join("\n"));
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
  };

  // Render trigger section based on type
  const renderTriggerSection = () => {
    if (formData.triggerType === "order_value") {
      return (
        <BlockStack gap="400">
          <TextField
            type="number"
            label="Minimum order value"
            value={formData.minOrderValue}
            onChange={(val) => handleChange("minOrderValue", val)}
            autoComplete="off"
            prefix="₹"
            min="0"
            helpText="Customer must spend this amount to qualify for the gift"
            required
          />
          
          <Select
            label="Apply to"
            options={[
              { label: "All Products", value: "all" },
              { label: "Specific Products", value: "products" },
              { label: "Specific Collections", value: "collections" },
            ]}
            value={formData.applyTo || "all"}
            onChange={(val) => handleChange("applyTo", val)}
          />

          {(formData.applyTo === "products") && (
            <div style={{ marginTop: "10px" }}>
              <Button onClick={openTriggerPicker}>Browse Products</Button>
            </div>
          )}

          {(formData.applyTo === "collections") && (
            <div style={{ marginTop: "10px" }}>
              <Button onClick={openCollectionPicker}>Browse Collections</Button>
            </div>
          )}

          {formData.applyTo === "products" && formData.selectedProducts.length > 0 && (
             <div style={{ marginTop: "10px" }}>
                <Text variant="bodyMd" as="p">{formData.selectedProducts.length} products selected</Text>
             </div>
          )}

          {formData.applyTo === "collections" && formData.selectedCollections.length > 0 && (
             <div style={{ marginTop: "10px" }}>
                <Text variant="bodyMd" as="p">{formData.selectedCollections.length} collections selected</Text>
             </div>
          )}
        </BlockStack>
      );
    }

    if (
      formData.triggerType === "products" ||
      formData.triggerType === "subscription"
    ) {
      return (
        <>
          <InlineStack gap="400" wrap>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <TextField
                type="number"
                label="Minimum quantity"
                value={formData.minQuantity}
                onChange={(val) => handleChange("minQuantity", val)}
                autoComplete="off"
                min="1"
                helpText={
                  formData.triggerType === "subscription"
                    ? "Applies to first subscription order"
                    : ""
                }
                required
              />
            </div>
            <div style={{ alignSelf: "end", minWidth: "120px" }}>
              <Button onClick={openTriggerPicker} variant="secondary" fullWidth>
                Browse Products
              </Button>
            </div>
          </InlineStack>

          {formData.selectedProducts.length > 0 && (
            <Card sectioned>
              <Text as="h4" variant="headingSm" fontWeight="medium">
                Trigger Products ({formData.selectedProducts.length})
              </Text>
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={formData.selectedProducts}
                renderItem={(product) => {
                  const media = (
                    <Thumbnail
                      source={
                        product.images?.[0]?.originalSrc ||
                        product.image?.src ||
                        ""
                      }
                      alt={product.title}
                      size="small"
                    />
                  );
                  return (
                    <ResourceList.Item id={product.id} media={media}>
                      <Text variant="bodyMd" as="span">
                        {product.title}
                      </Text>
                      <div>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              selectedProducts: prev.selectedProducts.filter(
                                (p) => p.id !== product.id,
                              ),
                            }))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </ResourceList.Item>
                  );
                }}
              />
            </Card>
          )}
        </>
      );
    }

    if (formData.triggerType === "collections") {
      return (
        <>
          <InlineStack gap="400" wrap>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <TextField
                type="number"
                label="Minimum quantity"
                value={formData.minQuantity}
                onChange={(val) => handleChange("minQuantity", val)}
                autoComplete="off"
                min="1"
                required
              />
            </div>
            <div style={{ alignSelf: "end", minWidth: "120px" }}>
              <Button onClick={openTriggerPicker} variant="secondary" fullWidth>
                Browse Collections
              </Button>
            </div>
          </InlineStack>

          {formData.selectedCollections.length > 0 && (
            <Card sectioned>
              <Text as="h4" variant="headingSm" fontWeight="medium">
                Trigger Collections ({formData.selectedCollections.length})
              </Text>
              <ResourceList
                resourceName={{ singular: "collection", plural: "collections" }}
                items={formData.selectedCollections}
                renderItem={(collection) => {
                  const media = (
                    <Thumbnail
                      source={
                        collection.image?.src || collection.image?.url || ""
                      }
                      alt={collection.title}
                      size="small"
                    />
                  );
                  return (
                    <ResourceList.Item id={collection.id} media={media}>
                      <Text variant="bodyMd" as="span">
                        {collection.title}
                      </Text>
                      <div>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              selectedCollections:
                                prev.selectedCollections.filter(
                                  (c) => c.id !== collection.id,
                                ),
                            }))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </ResourceList.Item>
                  );
                }}
              />
            </Card>
          )}
        </>
      );
    }

    return null;
  };

  // Get preview text based on offer type
  const getPreviewText = () => {
    const triggerText =
      formData.triggerType === "order_value"
        ? `Spend ₹${formData.minOrderValue || "X"}`
        : formData.triggerType === "subscription"
          ? `Subscribe to ${formData.selectedProducts.length > 0 ? formData.selectedProducts.length + " product(s)" : "any product"}`
          : `Buy ${formData.minQuantity || "X"} ${formData.triggerType}`;

    const giftText =
      formData.giftSelectionType === "mystery"
        ? "get a mystery gift"
        : formData.giftSelectionType === "single_choice"
          ? `choose 1 gift from ${formData.giftProducts.length} options`
          : formData.giftSelectionType === "multi_choice"
            ? `choose ${formData.maxGiftSelection} gifts from ${formData.giftProducts.length} options`
            : `get ${formData.giftQuantity || "Y"} free gift(s)`;

    const timeText = formData.isTimeLimited
      ? ` (Limited time: ${formData.timeLimit} ${formData.timeLimitUnit})`
      : "";

    return `${triggerText}, ${giftText}${timeText}`;
  };

  return (
    <Page
      title="Create Free Gift Offer"
      backAction={{ content: "Settings", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.success && (
              <Banner status="success" title="Success!">
                <p>{actionData.message}</p>
              </Banner>
            )}

            {actionData?.error && (
              <Banner status="critical" title="Error">
                <p>{actionData.error}</p>
              </Banner>
            )}

            <Form method="post" onSubmit={handleSubmit}>
              <input
                type="hidden"
                name="offerData"
                value={JSON.stringify(formData)}
              />

              <BlockStack gap="200">
                {/* General */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      General
                    </Text>
                    <TextField
                      label="Campaign name"
                      value={formData.title}
                      onChange={(val) => handleChange("title", val)}
                      autoComplete="off"
                      required
                    />
                    <Select
                      label="Offer Type"
                      options={offerTypeOptions}
                      value={formData.offerType}
                      onChange={(val) => handleChange("offerType", val)}
                      helpText="Select the type of free gift offer you want to create"
                    />
                  </BlockStack>
                </Card>

                {/* Customer Buys */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingSm" fontWeight="medium">
                        Customer Buys
                      </Text>
                      <Badge>
                        {formData.triggerType === "order_value"
                          ? "Order Value"
                          : formData.triggerType === "subscription"
                            ? "Subscription"
                            : formData.triggerType === "products"
                              ? "Products"
                              : "Collections"}
                      </Badge>
                    </InlineStack>
                    {renderTriggerSection()}
                  </BlockStack>
                </Card>

                {/* Gift Configuration */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingSm" fontWeight="medium">
                        Gift Configuration
                      </Text>
                      <Badge>
                        {formData.giftSelectionType === "auto"
                          ? "Auto-Add"
                          : formData.giftSelectionType === "mystery"
                            ? "Mystery"
                            : formData.giftSelectionType === "single_choice"
                              ? "Single Choice"
                              : "Multi-Choice"}
                      </Badge>
                    </InlineStack>

                    <Select
                      label="Selection Mode"
                      options={giftSelectionOptions}
                      value={formData.giftSelectionType}
                      onChange={(val) => handleChange("giftSelectionType", val)}
                      helpText="Choose how the customer receives or selects their gift"
                    />

                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: "150px" }}>
                        <TextField
                          type="number"
                          label="Gift quantity"
                          value={formData.giftQuantity}
                          onChange={(val) => handleChange("giftQuantity", val)}
                          autoComplete="off"
                          min="1"
                          disabled={
                            formData.giftSelectionType === "single_choice" ||
                            formData.giftSelectionType === "multi_choice"
                          }
                          helpText={
                            formData.giftSelectionType === "single_choice" ||
                            formData.giftSelectionType === "multi_choice"
                              ? "Customer will choose"
                              : ""
                          }
                          required
                        />
                      </div>



                      <div style={{ alignSelf: "end", minWidth: "120px" }}>
                        <Button
                          onClick={openGiftPicker}
                          variant="secondary"
                          fullWidth
                        >
                          Browse Gifts
                        </Button>
                      </div>
                    </InlineStack>

                    {formData.giftSelectionType === "multi_choice" && (
                      <TextField
                        type="number"
                        label="Max gifts customer can select"
                        value={formData.maxGiftSelection}
                        onChange={(val) =>
                          handleChange("maxGiftSelection", val)
                        }
                        autoComplete="off"
                        min="1"
                        max={formData.giftProducts.length.toString()}
                        helpText={`Customer can choose up to ${formData.maxGiftSelection} gift(s) from available options`}
                      />
                    )}

                    {formData.giftProducts.length > 0 && (
                      <Card sectioned>
                        <Text as="h4" variant="headingSm" fontWeight="medium">
                          Gift Products ({formData.giftProducts.length})
                          {formData.giftSelectionType === "mystery" && (
                            <Badge tone="attention" ml="2">
                              Hidden from customer
                            </Badge>
                          )}
                        </Text>
                        <ResourceList
                          resourceName={{
                            singular: "product",
                            plural: "products",
                          }}
                          items={formData.giftProducts}
                          renderItem={(product) => {
                            const media = (
                              <Thumbnail
                                source={
                                  product.images?.[0]?.originalSrc ||
                                  product.image?.src ||
                                  ""
                                }
                                alt={product.title}
                                size="small"
                              />
                            );
                            return (
                              <ResourceList.Item id={product.id} media={media}>
                                <Text variant="bodyMd" as="span">
                                  {product.title}
                                </Text>
                                <div>
                                  <Button
                                    variant="plain"
                                    tone="critical"
                                    onClick={() =>
                                      setFormData((prev) => ({
                                        ...prev,
                                        giftProducts: prev.giftProducts.filter(
                                          (p) => p.id !== product.id,
                                        ),
                                      }))
                                    }
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </ResourceList.Item>
                            );
                          }}
                        />
                      </Card>
                    )}
                  </BlockStack>
                </Card>

                {/* Time-Limited Settings */}
                {formData.isTimeLimited && (
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm" fontWeight="medium">
                        Time-Limited Settings
                      </Text>
                      <InlineStack gap="400" wrap>
                        <div style={{ flex: 1, minWidth: "150px" }}>
                          <TextField
                            type="number"
                            label="Time limit"
                            value={formData.timeLimit}
                            onChange={(val) => handleChange("timeLimit", val)}
                            autoComplete="off"
                            min="1"
                            required
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: "150px" }}>
                          <Select
                            label="Unit"
                            options={[
                              { label: "Hours", value: "hours" },
                              { label: "Days", value: "days" },
                              { label: "Minutes", value: "minutes" },
                            ]}
                            value={formData.timeLimitUnit}
                            onChange={(val) =>
                              handleChange("timeLimitUnit", val)
                            }
                          />
                        </div>
                      </InlineStack>
                      <Text as="p" variant="bodySm" color="subdued">
                        Offer will automatically expire after the specified time
                        from activation
                      </Text>
                    </BlockStack>
                  </Card>
                )}

                {/* Combinations */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Combinations
                    </Text>
                    <Checkbox
                      label="Product discounts"
                      checked={formData.combines.productDiscounts}
                      onChange={(val) =>
                        handleCombinesChange("productDiscounts", val)
                      }
                    />
                    <Checkbox
                      label="Order discounts"
                      checked={formData.combines.orderDiscounts}
                      onChange={(val) =>
                        handleCombinesChange("orderDiscounts", val)
                      }
                    />
                    <Checkbox
                      label="Shipping discounts"
                      checked={formData.combines.shippingDiscounts}
                      onChange={(val) =>
                        handleCombinesChange("shippingDiscounts", val)
                      }
                    />
                  </BlockStack>
                </Card>





                {/* Submit Button */}
                <InlineStack align="end">
                  <Button variant="primary" submit loading={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save Gift Offer"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Preview" sectioned>
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm" fontWeight="medium">
                {formData.title || "Free Gift Campaign"}
              </Text>
              <Text as="p" color="subdued">
                {getPreviewText()}
              </Text>

              {formData.triggerType === "order_value" &&
                formData.minOrderValue && (
                  <Text as="p" color="subdued">
                    Minimum spend: ₹{formData.minOrderValue}
                  </Text>
                )}

              {(formData.triggerType === "products" ||
                formData.triggerType === "subscription") &&
                formData.selectedProducts.length > 0 && (
                  <Text as="p" color="subdued">
                    Triggers: {formData.selectedProducts.length} product(s)
                  </Text>
                )}

              {formData.triggerType === "collections" &&
                formData.selectedCollections.length > 0 && (
                  <Text as="p" color="subdued">
                    Triggers: {formData.selectedCollections.length}{" "}
                    collection(s)
                  </Text>
                )}

              {formData.giftProducts.length > 0 && (
                <Text as="p" color="subdued">
                  {formData.giftSelectionType === "mystery"
                    ? "Mystery gift (hidden)"
                    : `${formData.giftProducts.length} gift product(s)`}
                </Text>
              )}

              {formData.isTimeLimited && formData.timeLimit && (
                <Badge tone="attention">
                  ⏰ Limited: {formData.timeLimit} {formData.timeLimitUnit}
                </Badge>
              )}

              {formData.startsAt && (
                <Text as="p" color="subdued">
                  Starts: {formData.startsAt}
                  {formData.startTime && ` at ${formData.startTime}`}
                </Text>
              )}

              {formData.endsAt && (
                <Text as="p" color="subdued">
                  Ends: {formData.endsAt}
                  {formData.endTime && ` at ${formData.endTime}`}
                </Text>
              )}
            </BlockStack>
          </LegacyCard>

          {/* Examples Card */}
          <LegacyCard title="Free Gift Examples" sectioned>
            <BlockStack gap="300">
              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Order Value Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Spend ₹2,500+, get a free tote bag
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Product Purchase Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Buy a shampoo, get a conditioner free
                </Text>
              </div>



              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Mystery Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Spend ₹3,000+, receive a mystery gift (revealed at checkout)
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Gift with Choice
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Spend ₹5,000+, choose 1 gift from 4 options
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Multi-Choice Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Spend ₹10,000+, pick any 2 gifts from 6 options
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Time-Limited Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Flash Sale: Spend ₹2,000+ in next 24 hours, get free gift
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Auto-Add Gift
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Gift automatically added to cart when conditions met
                </Text>
              </div>
            </BlockStack>
          </LegacyCard>

          {/* Tips Card */}
          <LegacyCard title="Tips" sectioned>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                💡 <strong>Mystery gifts</strong> create excitement and increase
                conversions
              </Text>
              <Text as="p" variant="bodySm">
                🎁 <strong>Gift choice</strong> options increase perceived value
              </Text>
              <Text as="p" variant="bodySm">
                ⏰ <strong>Time-limited</strong> offers create urgency and boost
                sales
              </Text>

              <Text as="p" variant="bodySm">
                🎯 Set minimum order values strategically to increase AOV
              </Text>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
