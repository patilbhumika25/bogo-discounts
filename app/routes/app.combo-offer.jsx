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
    combo_bogo_discount: {
        title: "BOGO + Discount Combo",
        description: "Buy 1, get 1 free + 10% off rest of cart",
        fields: ["bogoType", "buyQty", "getQty", "extraDiscountPercent", "applyTo", "products", "collections"], // Added collections
    },
    combo_bogo_gift: {
        title: "BOGO + Gift",
        description: "Buy 2, get 1 free + free mystery gift",
        fields: ["bogoType", "buyQty", "getQty", "giftProducts", "applyTo", "products", "collections"], // Added collections
    },
    combo_bundle_gift: {
        title: "Bundle + Gift",
        description: "Buy a bundle of 3 products for ₹1,499 and get a free gift",
        fields: ["volumeTiers", "giftProducts", "applyTo", "products", "collections"], // Added collections
    },
    custom_multi_tier_bogo: {
        title: "Multi-Tier BOGO",
        description: "Buy 2 get 1, Buy 4 get 3 - Custom tiers",
        fields: ["bogoTiers", "applyTo", "products", "collections"], 
    },
};

const BOGO_TYPE_OPTIONS = [
    { label: "Basic (Same Product)", value: "bogo_same" },
    { label: "Cheapest Free", value: "bogo_cheapest_free" },
    { label: "Multi-Tier", value: "bogo_multi_tier" },
    // Note: We avoid complex BOGO types here to keep Combos simple
];

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
            bogoType: data.bogoType,
            buyQty: data.buyQty,
            getQty: data.getQty,
            extraDiscountPercent: data.extraDiscountPercent,
            extraMessage: data.extraMessage,
            applyTo: data.applyTo || "any",

            // Store resolved IDs
            selectedProducts: selectedProductIds.map(id => ({ id })),

            giftProductIds: (data.giftProducts || []).map((p) => p.id),
            rewardIds: (data.giftProducts || []).map((p) => p.id),
            volumeTiers: data.volumeTiers,
            bogoTiers: data.bogoTiers,
            message: data.message || data.title,

            // Persist originals
            originalSelectedCollections: data.selectedCollections,
        };

        const functionId = process.env.SHOPIFY_BOGO_BUNDLES_FREE_GIFT_ID;
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
                offerType: "combo_offer",
                triggerType: "products", // Combo offers always products-based
                triggerIds: selectedProductIds,
                minQty: 1,

                rewardType: "mixed",
                rewardValue: null,

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
            message: "Combo offer created successfully!",
        });
    } catch (error) {
        console.error("Error creating Combo:", error);
        return json({ success: false, error: error.message }, { status: 500 });
    }
}

// ============================================================================
// CLIENT COMPONENT
// ============================================================================

export default function ComboOffer() {
    const navigate = useNavigate();
    const actionData = useActionData();
    const shopify = useAppBridge();
    const [searchParams] = useSearchParams();

    const subtypeParam = searchParams.get("subtype") || "combo_bogo_discount";
    const subtypeInfo = SUBTYPES[subtypeParam] || SUBTYPES.combo_bogo_discount;

    const [formData, setFormData] = useState({
        title: "",
        configType: subtypeParam,
        bogoType: "bogo_same",
        buyQty: "1",
        getQty: "1",
        extraDiscountPercent: "10",
        extraMessage: "",
        applyTo: "any",
        selectedProducts: [],
        selectedCollections: [], // New state
        giftProducts: [],
        volumeTiers: [{ minQty: "3", fixedPrice: "1499" }],
        bogoTiers: [{ buyQty: "2", getQty: "1" }],
        message: "",
        startsAt: new Date().toISOString().split("T")[0],
        startTime: "00:00",
        endsAt: "",
        endTime: "23:59",
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
            navigate("/app");
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
        async (target) => {
            try {
                const selected = await shopify.resourcePicker({
                    type: "product",
                    multiple: true,
                    action: "select",
                });
                if (selected && selected.length > 0) {
                    setFormData((prev) => ({
                        ...prev,
                        [target]: selected.map((p) => ({
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

    const addBogoTier = useCallback(() => {
        setFormData((prev) => ({
            ...prev,
            bogoTiers: [...prev.bogoTiers, { buyQty: "", getQty: "" }],
        }));
    }, []);

    const removeBogoTier = useCallback((index) => {
        setFormData((prev) => ({
            ...prev,
            bogoTiers: prev.bogoTiers.filter((_, i) => i !== index),
        }));
    }, []);

    const updateBogoTier = useCallback((index, field, value) => {
        setFormData((prev) => ({
            ...prev,
            bogoTiers: prev.bogoTiers.map((t, i) =>
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
    const showBogoType = fields.includes("bogoType");
    const showBuyGetQty = fields.includes("buyQty");
    const showExtraDiscount = fields.includes("extraDiscountPercent");
    const showGiftProducts = fields.includes("giftProducts");
    const showVolumeTiers = fields.includes("volumeTiers");
    const showApplyTo = fields.includes("applyTo");
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
                                        label="Primary Message (shown on cart)"
                                        value={formData.message}
                                        onChange={(v) => handleChange("message", v)}
                                        placeholder="e.g., Buy 1 Get 1 Free + 10% off!"
                                        autoComplete="off"
                                    />
                                </BlockStack>
                            </Card>

                            {showBogoType && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">
                                            🛍️ Step 1: BOGO Rule
                                        </Text>
                                        <Select
                                            label="BOGO Type"
                                            options={BOGO_TYPE_OPTIONS}
                                            value={formData.bogoType}
                                            onChange={(v) => handleChange("bogoType", v)}
                                        />
                                        {showBuyGetQty && (
                                            <FormLayout>
                                                <FormLayout.Group>
                                                    <TextField
                                                        label="Customer Buys"
                                                        type="number"
                                                        value={formData.buyQty}
                                                        onChange={(v) => handleChange("buyQty", v)}
                                                        min="1"
                                                        autoComplete="off"
                                                    />
                                                    <TextField
                                                        label="Gets Free"
                                                        type="number"
                                                        value={formData.getQty}
                                                        onChange={(v) => handleChange("getQty", v)}
                                                        min="1"
                                                        autoComplete="off"
                                                    />
                                                </FormLayout.Group>
                                            </FormLayout>
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            {showVolumeTiers && (
                                <Card>
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between">
                                            <Text as="h2" variant="headingMd">
                                                📦 Step 1: Bundle Pricing
                                            </Text>
                                            <Button onClick={addVolumeTier}>Add Tier</Button>
                                        </InlineStack>
                                        {formData.volumeTiers.map((tier, index) => (
                                            <InlineStack key={index} gap="300" blockAlign="end">
                                                <div style={{ flex: 1 }}>
                                                    <TextField
                                                        label={`Tier ${index + 1}: Qty`}
                                                        type="number"
                                                        value={tier.minQty}
                                                        onChange={(v) => updateVolumeTier(index, "minQty", v)}
                                                        min="1"
                                                        autoComplete="off"
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <TextField
                                                        label="Price"
                                                        type="number"
                                                        value={tier.fixedPrice}
                                                        onChange={(v) => updateVolumeTier(index, "fixedPrice", v)}
                                                        prefix="₹"
                                                        autoComplete="off"
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

                            {fields.includes("bogoTiers") && (
                                <Card>
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between">
                                            <Text as="h2" variant="headingMd">
                                                📊 Step 1: BOGO Tiers
                                            </Text>
                                            <Button onClick={addBogoTier}>Add Tier</Button>
                                        </InlineStack>
                                        {formData.bogoTiers.map((tier, index) => (
                                            <InlineStack key={index} gap="300" blockAlign="end">
                                                <div style={{ flex: 1 }}>
                                                    <TextField
                                                        label={`Tier ${index + 1}: Customer Buys`}
                                                        type="number"
                                                        value={tier.buyQty}
                                                        onChange={(v) => updateBogoTier(index, "buyQty", v)}
                                                        min="1"
                                                        autoComplete="off"
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <TextField
                                                        label="Customer Gets Free"
                                                        type="number"
                                                        value={tier.getQty}
                                                        onChange={(v) => updateBogoTier(index, "getQty", v)}
                                                        min="1"
                                                        autoComplete="off"
                                                    />
                                                </div>
                                                {formData.bogoTiers.length > 1 && (
                                                    <Button
                                                        variant="plain"
                                                        tone="critical"
                                                        onClick={() => removeBogoTier(index)}
                                                    >
                                                        Remove
                                                    </Button>
                                                )}
                                            </InlineStack>
                                        ))}
                                    </BlockStack>
                                </Card>
                            )}

                            {showExtraDiscount && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">
                                            💰 Step 2: Extra Discount on Rest of Cart
                                        </Text>
                                        <TextField
                                            label="Additional Discount Percentage"
                                            type="number"
                                            value={formData.extraDiscountPercent}
                                            onChange={(v) => handleChange("extraDiscountPercent", v)}
                                            suffix="%"
                                            min="1"
                                            max="100"
                                            autoComplete="off"
                                            helpText="Applied to items NOT part of the BOGO"
                                        />
                                        <TextField
                                            label="Extra Discount Message"
                                            value={formData.extraMessage}
                                            onChange={(v) => handleChange("extraMessage", v)}
                                            placeholder="e.g., 10% off the rest of your cart!"
                                            autoComplete="off"
                                        />
                                    </BlockStack>
                                </Card>
                            )}

                            {showGiftProducts && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">
                                            🎁 Step 2: Free Gift
                                        </Text>
                                        <Button onClick={() => openProductPicker("giftProducts")}>
                                            Select Gift Product(s)
                                        </Button>
                                        <InlineStack gap="200" wrap>
                                            {formData.giftProducts.map((p) => (
                                                <Tag key={p.id}>{p.title}</Tag>
                                            ))}
                                        </InlineStack>
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
                                                <Button onClick={() => openProductPicker("selectedProducts")}>
                                                    Select Products
                                                </Button>
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
                                    Create Combo Offer
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
                                <Badge tone="info">{subtypeInfo.title}</Badge>
                            </InlineStack>
                            {showBogoType && (
                                <>
                                    <InlineStack align="space-between">
                                        <Text tone="subdued">BOGO</Text>
                                        <Text>
                                            Buy {formData.buyQty}, Get {formData.getQty} Free
                                        </Text>
                                    </InlineStack>
                                </>
                            )}
                            {showExtraDiscount && (
                                <InlineStack align="space-between">
                                    <Text tone="subdued">Extra</Text>
                                    <Text>{formData.extraDiscountPercent}% off rest</Text>
                                </InlineStack>
                            )}
                            {showGiftProducts && (
                                <InlineStack align="space-between">
                                    <Text tone="subdued">Gift(s)</Text>
                                    <Text>{formData.giftProducts.length} product(s)</Text>
                                </InlineStack>
                            )}
                            {showVolumeTiers && (
                                <BlockStack gap="100">
                                    <Text tone="subdued">Bundle:</Text>
                                    {formData.volumeTiers.map((t, i) => (
                                        <Text key={i}>
                                            {t.minQty || "?"} items → ₹{t.fixedPrice || "?"}
                                        </Text>
                                    ))}
                                </BlockStack>
                            )}
                            {fields.includes("bogoTiers") && (
                                <BlockStack gap="100">
                                    <Text tone="subdued">Tiers:</Text>
                                    {formData.bogoTiers.map((t, i) => (
                                        <Text key={i}>
                                            Buy {t.buyQty || "?"} → Get {t.getQty || "?"} Free
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
