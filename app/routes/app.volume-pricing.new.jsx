import { json } from "@remix-run/node";
import { useNavigate, useActionData, Form, useSearchParams } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Card,
  Text,
  TextField,
  Layout,
  InlineStack,
  Button,
  Banner,
  Select,
  FormLayout,
  Tag,
  Badge,
  Divider,
  Checkbox,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { getProductsFromCollections } from "../utils/products.server";
import prisma from "../db.server";

// LOADER - Ensures the session is valid when the page loads
export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

// ============================================================================
// SUBTYPE DEFINITIONS
// ============================================================================

const SUBTYPES = {
  fixed_bundle: {
    title: "Fixed Price Bundles",
    description: "Buy 2 for ₹999, Buy 3 for ₹1,000",
    fields: ["volumeTiers", "applyTo", "products", "collections"], // Added collections
    tierType: "fixed",
  },
  tiered_percentage: {
    title: "Tiered Percentage Discounts",
    description: "Buy 2–3 items → 10% off, Buy 4–5 → 20% off",
    fields: ["percentageTiers", "applyTo", "products", "collections"], // Added collections
    tierType: "percentage",
  },
  mix_match_volume: {
    title: "Mix & Match Volume Pricing",
    description: "Any 3 snacks for ₹500 total",
    fields: ["volumeTiers", "applyTo", "products", "collections"], // Added collections
    tierType: "fixed",
  },
  cart_wide_volume: {
    title: "Cart-Wide Volume Pricing",
    description: "Bundle pricing applied to entire cart",
    fields: ["volumeTiers"],
    tierType: "fixed",
  },
  multi_tier_volume: {
    title: "Multi-Tier Volume Pricing",
    description: "Buy 2 at ₹999, Buy 4 at ₹1,899",
    fields: ["volumeTiers", "applyTo", "products", "collections"], // Added collections
    tierType: "fixed",
  },
};

// ============================================================================
// SERVER ACTION
// ============================================================================

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const offerDataStr = formData.get("offerData");

  if (!offerDataStr) {
    return json({ success: false, error: "No offer data received" }, { status: 400 });
  }

  try {
    const data = JSON.parse(offerDataStr);
    const subtypeInfo = SUBTYPES[data.subtype] || SUBTYPES.fixed_bundle;

    // Helper to resolve products from collections
    const resolveProductIds = async (productIds, collectionIds) => {
      const directIds = (productIds || []).map((p) => p.id);
      if (!collectionIds || collectionIds.length === 0) return directIds;

      const collectionGids = collectionIds.map(c => c.id);
      const collectionProductIds = await getProductsFromCollections(admin, collectionGids);
      return Array.from(new Set([...directIds, ...collectionProductIds]));
    };

    // Resolve IDs based on configuration
    let selectedProductIds = [];
    if (data.applyTo === "products") {
      selectedProductIds = (data.selectedProducts || []).map(p => p.id);
    } else if (data.applyTo === "collections") {
      selectedProductIds = await resolveProductIds([], data.selectedCollections);
    }

    const config = {
      configType: data.configType,
      pricingType: data.configType, // backward compat
      applyTo: data.applyTo || "any",
      selectedProducts: selectedProductIds.map(id => ({ id })), // Store resolved IDs
      volumeTiers: data.volumeTiers,
      percentageTiers: data.percentageTiers,
      title: data.title,
      message: data.message || data.title,

      // Persist originals for UI
      originalSelectedCollections: data.selectedCollections,
    };

    const functionId = process.env.SHOPIFY_TIER_PRICING_DISCOUNT_ID;
    if (!functionId) {
      return json({ success: false, error: "Function ID not configured in .env" }, { status: 500 });
    }

    const mutation = `
      mutation CreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount {
            discountId
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      discount: {
        title: data.title,
        functionId,
        startsAt: data.startsAt
          ? new Date(`${data.startsAt}T${data.startTime || "00:00"}:00Z`).toISOString()
          : new Date().toISOString(),
        endsAt: data.endsAt
          ? new Date(`${data.endsAt}T${data.endTime || "23:59"}:00Z`).toISOString()
          : null,
        combinesWith: {
          orderDiscounts: data.combinesOrder || false,
          productDiscounts: data.combinesProduct || false,
          shippingDiscounts: data.combinesShipping || false,
        },
        discountClasses: ["PRODUCT"],
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

    const response = await admin.graphql(mutation, { variables });
    const result = await response.json();

    if (result.data?.discountAutomaticAppCreate?.userErrors?.length > 0) {
      const errors = result.data.discountAutomaticAppCreate.userErrors;
      return json({ success: false, errors: errors.map((e) => e.message).join(", ") });
    }

    const discountId = result.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId;

    // Save to internal database
    await prisma.offer.create({
      data: {
        title: data.title,
        offerType: "volume_pricing",
        triggerType: data.subtype === "cart_wide_volume" ? "order_value" : "products",
        triggerIds: selectedProductIds,
        minQty: data.volumeTiers?.[0]?.minQty ? parseInt(data.volumeTiers[0].minQty) : null,
        
        rewardType: subtypeInfo.tierType === "percentage" ? "percent" : "amount",
        rewardValue: null, // Detailed in config
        
        combinesOrder: data.combinesOrder || false,
        combinesProduct: data.combinesProduct || false,
        combinesShipping: data.combinesShipping || false,
        
        startsAt: data.startsAt
          ? new Date(`${data.startsAt}T${data.startTime || "00:00"}:00Z`)
          : new Date(),
        endsAt: data.endsAt
          ? new Date(`${data.endsAt}T${data.endTime || "23:59"}:00Z`)
          : null,
          
        status: "ACTIVE",
        functionId,
        discountId,
        config: config,
        shop: session.shop,
      }
    });

    return json({
      success: true,
      discountId,
      message: "Volume pricing offer created successfully!",
    });
  } catch (error) {
    console.error("Error creating Volume Pricing:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}

// ============================================================================
// CLIENT COMPONENT
// ============================================================================

export default function VolumePricing() {
  const navigate = useNavigate();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();

  const subtypeParam = searchParams.get("subtype") || "fixed_bundle";
  const subtypeInfo = SUBTYPES[subtypeParam] || SUBTYPES.fixed_bundle;
  const isPercentage = subtypeInfo.tierType === "percentage";

  const [formData, setFormData] = useState({
    title: "",
    configType: subtypeParam,
    applyTo: subtypeParam === "cart_wide_volume" ? "any" : "products",
    selectedProducts: [],
    selectedCollections: [], // New state
    volumeTiers: [{ minQty: "2", fixedPrice: "999" }],
    percentageTiers: [{ minQty: "2", maxQty: "3", percentage: "10" }],
    message: "",
    startsAt: new Date().toISOString().split("T")[0],
    startTime: new Date().toTimeString().slice(0, 5),
    endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toTimeString().slice(0, 5),
    combinesOrder: false,
    combinesProduct: false,
    combinesShipping: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormData((prev) => ({ ...prev, configType: subtypeParam }));
  }, [subtypeParam]);

  useEffect(() => {
    if (actionData?.success) {
      setIsSubmitting(false);
      shopify.toast.show(actionData.message || "Offer created successfully!");
      navigate("/app/offers");
    } else if (actionData?.error || actionData?.errors) {
      setIsSubmitting(false);
      shopify.toast.show(
        actionData.error || actionData.errors || "Failed to create offer",
        { isError: true },
      );
    }
  }, [actionData, navigate, shopify]);

  const handleChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const openProductPicker = useCallback(
    async () => {
      try {
        const selected = await shopify.resourcePicker({
          type: "product",
          multiple: true,
          action: "select",
        });
        if (selected && selected.length > 0) {
          setFormData((prev) => ({
            ...prev,
            selectedProducts: selected.map((p) => ({
              id: p.id,
              title: p.title,
            })),
          }));
        }
      } catch (error) {
        console.error("Picker error:", error);
      }
    },
    [shopify],
  );

  const openCollectionPicker = useCallback(
    async (target) => {
      try {
        const selected = await shopify.resourcePicker({
          type: "collection",
          multiple: true,
          action: "select",
        });
        if (selected && selected.length > 0) {
          setFormData((prev) => ({
            ...prev,
            [target]: selected.map((c) => ({
              id: c.id,
              title: c.title,
              handle: c.handle,
            })),
          }));
        }
      } catch (error) {
        console.error("Picker error:", error);
      }
    },
    [shopify],
  );

  // Fixed Price Tier management
  const addVolumeTier = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      volumeTiers: [...prev.volumeTiers, { minQty: "", fixedPrice: "" }],
    }));
  }, []);

  const removeVolumeTier = useCallback((index) => {
    setFormData((prev) => ({
      ...prev,
      volumeTiers: prev.volumeTiers.filter((_, i) => i !== index),
    }));
  }, []);

  const updateVolumeTier = useCallback((index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      volumeTiers: prev.volumeTiers.map((t, i) =>
        i === index ? { ...t, [field]: value } : t,
      ),
    }));
  }, []);

  // Percentage Tier management
  const addPercentageTier = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      percentageTiers: [
        ...prev.percentageTiers,
        { minQty: "", maxQty: "", percentage: "" },
      ],
    }));
  }, []);

  const removePercentageTier = useCallback((index) => {
    setFormData((prev) => ({
      ...prev,
      percentageTiers: prev.percentageTiers.filter((_, i) => i !== index),
    }));
  }, []);

  const updatePercentageTier = useCallback((index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      percentageTiers: prev.percentageTiers.map((t, i) =>
        i === index ? { ...t, [field]: value } : t,
      ),
    }));
  }, []);

  const handleSubmit = useCallback(
    (event) => {
      if (!formData.title) {
        event.preventDefault();
        shopify.toast.show("Please enter a title", { isError: true });
        return;
      }
      setIsSubmitting(true);
    },
    [formData, shopify],
  );

  const fields = subtypeInfo.fields;
  const showApplyTo = fields.includes("applyTo");
  const showVolumeTiers = fields.includes("volumeTiers");
  const showPercentageTiers = fields.includes("percentageTiers");
  const showCollections = fields.includes("collections");

  const applyToOptions = [
    { label: "All Products", value: "any" },
    { label: "Specific Products", value: "products" },
  ];
  if (showCollections) {
    applyToOptions.push({ label: "Specific Collections", value: "collections" });
  }

  return (
    <Page
      title={subtypeInfo.title}
      subtitle={subtypeInfo.description}
      backAction={{ content: "Back", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Form method="post" onSubmit={handleSubmit}>
            <input
              type="hidden"
              name="offerData"
              value={JSON.stringify(formData)}
            />
            <BlockStack gap="500">
              {actionData?.error && (
                <Banner tone="critical">
                  <p>{actionData.error}</p>
                </Banner>
              )}

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Offer Details
                  </Text>
                  <TextField
                    label="Offer Title"
                    value={formData.title}
                    onChange={(v) => handleChange("title", v)}
                    placeholder={`e.g., ${subtypeInfo.title}`}
                    autoComplete="off"
                  />
                  <TextField
                    label="Discount Message (shown on cart)"
                    value={formData.message}
                    onChange={(v) => handleChange("message", v)}
                    placeholder="e.g., Buy 2 for ₹999!"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              {showVolumeTiers && (
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Price Tiers
                      </Text>
                      <Button onClick={addVolumeTier}>Add Tier</Button>
                    </InlineStack>
                    {formData.volumeTiers.map((tier, index) => (
                      <InlineStack key={index} gap="300" blockAlign="end">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label={`Tier ${index + 1}: Quantity`}
                            type="number"
                            value={tier.minQty}
                            onChange={(v) => updateVolumeTier(index, "minQty", v)}
                            min="1"
                            autoComplete="off"
                            helpText="Buy this many items"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Bundle Price"
                            type="number"
                            value={tier.fixedPrice}
                            onChange={(v) => updateVolumeTier(index, "fixedPrice", v)}
                            prefix="₹"
                            autoComplete="off"
                            helpText="Total price for the bundle"
                          />
                        </div>
                        {formData.volumeTiers.length > 1 && (
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => removeVolumeTier(index)}
                          >
                            Remove
                          </Button>
                        )}
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {showPercentageTiers && (
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Percentage Tiers
                      </Text>
                      <Button onClick={addPercentageTier}>Add Tier</Button>
                    </InlineStack>
                    {formData.percentageTiers.map((tier, index) => (
                      <InlineStack key={index} gap="300" blockAlign="end">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label={`Tier ${index + 1}: Min Qty`}
                            type="number"
                            value={tier.minQty}
                            onChange={(v) => updatePercentageTier(index, "minQty", v)}
                            min="1"
                            autoComplete="off"
                            helpText={<span style={{ visibility: "hidden" }}>spacer</span>}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Max Qty"
                            type="number"
                            value={tier.maxQty}
                            onChange={(v) => updatePercentageTier(index, "maxQty", v)}
                            autoComplete="off"
                            helpText="Leave empty for unlimited"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Discount %"
                            type="number"
                            value={tier.percentage}
                            onChange={(v) => updatePercentageTier(index, "percentage", v)}
                            suffix="%"
                            min="1"
                            max="100"
                            autoComplete="off"
                            helpText={<span style={{ visibility: "hidden" }}>spacer</span>}
                          />
                        </div>
                        {formData.percentageTiers.length > 1 && (
                          <div style={{ marginBottom: "28px" }}>
                            <Button
                              variant="plain"
                              tone="critical"
                              onClick={() => removePercentageTier(index)}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {showApplyTo && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Applies To
                    </Text>
                    <Select
                      label="Apply discount to"
                      options={applyToOptions}
                      value={formData.applyTo}
                      onChange={(v) => handleChange("applyTo", v)}
                    />
                    {formData.applyTo === "products" && (
                      <BlockStack gap="200">
                        <Button onClick={openProductPicker}>Select Products</Button>
                        <InlineStack gap="200" wrap>
                          {formData.selectedProducts.map((p) => (
                            <Tag key={p.id}>{p.title}</Tag>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    )}
                    {formData.applyTo === "collections" && (
                      <BlockStack gap="200">
                        <Button onClick={() => openCollectionPicker("selectedCollections")}>
                          Select Collections
                        </Button>
                        <InlineStack gap="200" wrap>
                          {formData.selectedCollections.map((c) => (
                            <Tag key={c.id}>{c.title}</Tag>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Cart-Wide Info */}
              {subtypeParam === "cart_wide_volume" && (
                <Banner tone="info">
                  <p>
                    Cart-Wide Volume Pricing applies to ALL products in the cart.
                    The bundle price is for the total cart, not per product.
                  </p>
                </Banner>
              )}


              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Discount Combinations
                  </Text>
                  <Checkbox
                    label="Combine with other product discounts"
                    checked={formData.combinesProduct}
                    onChange={(v) => handleChange("combinesProduct", v)}
                  />
                  <Checkbox
                    label="Combine with order discounts"
                    checked={formData.combinesOrder}
                    onChange={(v) => handleChange("combinesOrder", v)}
                  />
                  <Checkbox
                    label="Combine with shipping discounts"
                    checked={formData.combinesShipping}
                    onChange={(v) => handleChange("combinesShipping", v)}
                  />
                </BlockStack>
              </Card>

              <InlineStack align="end" gap="300">
                <Button onClick={() => navigate("/app/offers")}>Cancel</Button>
                <Button variant="primary" submit loading={isSubmitting}>
                  Create Volume Pricing Offer
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Summary
              </Text>
              <Divider />
              <InlineStack align="space-between">
                <Text tone="subdued">Type</Text>
                <Badge>{subtypeInfo.title}</Badge>
              </InlineStack>
              {showVolumeTiers && (
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Tiers:
                  </Text>
                  {formData.volumeTiers.map((tier, i) => (
                    <Text key={i} as="p" variant="bodyMd">
                      Buy {tier.minQty || "?"} → ₹{tier.fixedPrice || "?"}
                    </Text>
                  ))}
                </BlockStack>
              )}
              {showPercentageTiers && (
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Tiers:
                  </Text>
                  {formData.percentageTiers.map((tier, i) => (
                    <Text key={i} as="p" variant="bodyMd">
                      {tier.minQty || "?"}–{tier.maxQty || "∞"} items → {tier.percentage || "?"}% off
                    </Text>
                  ))}
                </BlockStack>
              )}
              <InlineStack align="space-between">
                <Text tone="subdued">Applies to</Text>
                <Text>
                  {formData.applyTo === "any"
                    ? "All products"
                    : formData.applyTo === "collections"
                      ? `${formData.selectedCollections.length} collection(s)`
                      : `${formData.selectedProducts.length} product(s)`}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
