import { json } from "@remix-run/node";
import { useNavigate, useActionData, Form } from "@remix-run/react";
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
} from "@shopify/polaris";
import { CaretUpIcon, CaretDownIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useEffect, useCallback } from "react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

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

    // later implemetation adding shop id to offers
    //     const shopInfo = await admin.api.clients.Graphql({ session }).query({
    //   data: `{
    //     shop {
    //       id
    //       myshopifyDomain
    //     }
    //   }`,
    // });

    // console.log("shopinfo:", shopInfo);

    const data = JSON.parse(offerDataString);
    console.log("Parsed offer data:", data);

    let rewardType = "free";
    let rewardValue = null;

    if (data.discountType.includes("percentage")) {
      rewardType = "percentage";
      rewardValue = parseFloat(data.percentage);
    } else if (data.discountType.includes("fixed")) {
      rewardType = "fixed";
      rewardValue = parseFloat(data.fixedPrice);
    }

    // Save in DB - Enhanced to support both products and collections for rewards
    const offer = await prisma.offer.create({
      data: {
        title: data.title,
        triggerType: data.triggerType,
        triggerIds:
          data.triggerType === "products"
            ? data.selectedProducts.map((p) => p.id)
            : data.selectedCollections.map((c) => c.id),
        minQty: parseInt(data.minQuantity, 10),

        rewardType,
        rewardValue,
        rewardApplyTo: "selected",
        // Enhanced to support both products and collections for rewards
        rewardIds:
          data.getType === "products"
            ? data.getProducts.map((p) => p.id)
            : data.getCollections.map((c) => c.id),
        rewardQty: parseInt(data.getQuantity, 10) || 1,
        // rewardItemType: data.getType, // Track if reward is products or collections

        combinesOrder: data.combines?.orderDiscounts || false,
        combinesProduct: data.combines?.productDiscounts || false,
        combinesShipping: data.combines?.shippingDiscounts || false,

        limitTotalUses: data.usageLimits?.includes("limit_total") || null,
        limitPerCustomer:
          data.usageLimits?.includes("limit_per_customer") || false,

        startsAt: new Date(`${data.startsAt}T${data.startTime || "00:00"}:00Z`),
        endsAt: data.endsAt
          ? new Date(`${data.endsAt}T${data.endTime || "23:59"}:00Z`)
          : null,

        functionId: "0199377a-e148-7a61-bedb-f7d25bd5d3ab",
        status: "DRAFT",
        shop: shop,
      },
    });

    // Enhanced BXGY mutation to support collections in customerGets
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
                customerBuys {
                  value {
                    ... on DiscountQuantity {
                      quantity
                    }
                  }
                  items {
                    ... on DiscountProducts {
                      products(first: 10) {
                        nodes {
                          id
                        }
                      }
                    }
                    ... on DiscountCollections {
                      collections(first: 10) {
                        nodes {
                          id
                        }
                      }
                    }
                  }
                }
                customerGets {
                  value {
                    ... on DiscountPercentage {
                      percentage
                    }
                  }
                  items {
                    ... on DiscountProducts {
                      products(first: 10) {
                        nodes {
                          id
                        }
                      }
                    }
                    ... on DiscountCollections {
                      collections(first: 10) {
                        nodes {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    let effect = {};

    if (data.discountType.includes("free")) {
      effect = { percentage: 1 }; // 100% off
    } else if (data.discountType.includes("percentage")) {
      effect = { percentage: parseFloat(data.percentage) / 100 };
    } else if (data.discountType.includes("fixed")) {
      effect = {
        fixedAmount: { amount: data.fixedPrice, appliesOnEachItem: true },
      };
    }

    // Enhanced variables to support collections in customerGets
    var variables = {
      automaticBxgyDiscount: {
        title: data.title,
        startsAt: new Date(
          `${data.startsAt}T${data.startTime || "00:00"}:00Z`,
        ).toISOString(),
        endsAt: data.endsAt
          ? new Date(
              `${data.endsAt}T${data.endTime || "23:59"}:00Z`,
            ).toISOString()
          : null,

        customerBuys: {
          value: {
            quantity: parseInt(data.minQuantity, 10).toString(),
          },
          items:
            data.triggerType === "products"
              ? {
                  products: {
                    productsToAdd: data.selectedProducts.map((p) => p.id),
                  },
                }
              : {
                  collections: {
                    add: data.selectedCollections.map((c) => c.id), // Changed from collectionsToAdd
                  },
                },
        },

        customerGets: {
          value: {
            discountOnQuantity: {
              quantity: data.getQuantity.toString(),
              effect,
            },
          },
          items:
            data.getType === "products"
              ? {
                  products: {
                    productsToAdd: data.getProducts.map((p) => p.id),
                  },
                }
              : {
                  collections: {
                    add: data.getCollections.map((c) => c.id), // Changed from id to add
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

    console.log(
      "Enhanced BXGY GraphQL Variables:",
      JSON.stringify(variables, null, 2),
    );

    const response = await admin.graphql(mutation, { variables });
    const jsonResponse = await response.json();

    console.log(
      "Shopify BXGY API Response:",
      JSON.stringify(jsonResponse, null, 2),
    );

    if (
      jsonResponse?.data?.discountAutomaticBxgyCreate?.userErrors?.length > 0
    ) {
      const errors = jsonResponse.data.discountAutomaticBxgyCreate.userErrors;
      console.error("Shopify BXGY API Errors:", errors);
      throw new Error(errors.map((e) => e.message).join(", "));
    }

    if (
      !jsonResponse?.data?.discountAutomaticBxgyCreate?.automaticDiscountNode
    ) {
      console.error("No discount created in BXGY response:", jsonResponse);
      throw new Error("Failed to create BXGY discount");
    }

    console.log(
      "Shopify BXGY API Success:",
      jsonResponse.data.discountAutomaticBxgyCreate,
    );

    return json({
      success: true,
      data: offer,
      shopify:
        jsonResponse.data.discountAutomaticBxgyCreate.automaticDiscountNode,
      message: "BOGO offer created with collection support!",
    });
  } catch (error) {
    console.error("Error creating BXGY offer:", error);
    console.log("BXGY GraphQL Variables:", JSON.stringify(variables, null, 2));

    return json(
      {
        success: false,
        errors: error.message || "Failed to create BXGY offer",
        variables,
      },
      { status: 500 },
    );
  }
}

// CLIENT-SIDE COMPONENT
export default function BuyXGetY() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const actionData = useActionData();

  // Enhanced form state to support collections for rewards
  const [formData, setFormData] = useState({
    title: "Buy X get Y #1",

    // Customer buys
    minQuantity: "",
    triggerType: "products",
    selectedProducts: [],
    selectedCollections: [],

    // Customer gets - Enhanced to support collections
    getQuantity: "",
    getType: "products",
    getProducts: [],
    getCollections: [], // Added collections support

    combines: {
      productDiscounts: false,
      orderDiscounts: false,
      shippingDiscounts: false,
    },

    discountType: ["free"],
    percentage: "",
    fixedPrice: "",

    usageLimits: [],
    customerEligibility: "all",
    startsAt: new Date().toISOString().split("T")[0],
    startTime: "00:00",
    endsAt: "",
    endTime: "23:59",
  });

  const [openSections, setOpenSections] = useState({
    section1: false,
    section2: false,
    section3: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle successful submission
  useEffect(() => {
    if (actionData?.success) {
      setIsSubmitting(false);
      // Redirect to offers list or show success message
      setTimeout(() => {
        navigate("/app");
      }, 2000);
    } else if (actionData?.error) {
      setIsSubmitting(false);
    }
  }, [actionData, navigate]);

  // Handle toggle for collapsible sections
  const handleToggle = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const openBuyPicker = async () => {
    try {
      if (formData.triggerType === "products") {
        // Pick products
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
        }
      } else if (formData.triggerType === "collections") {
        // Pick collections
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
      console.error("Error opening Buy picker:", error);
    }
  };

  // Enhanced Get picker to support both products and collections
  const openGetPicker = async () => {
    try {
      if (formData.getType === "products") {
        const selected = await shopify.resourcePicker({
          type: "product",
          multiple: true,
          action: "select",
        });

        if (selected && selected.length > 0) {
          setFormData((prev) => ({
            ...prev,
            getProducts: selected,
          }));
        }
      } else if (formData.getType === "collections") {
        const selected = await shopify.resourcePicker({
          type: "collection",
          multiple: true,
          action: "select",
        });

        if (selected && selected.length > 0) {
          setFormData((prev) => ({
            ...prev,
            getCollections: selected,
          }));
        }
      }
    } catch (error) {
      console.error("Error opening Get picker:", error);
    }
  };

  // Generic form change handler
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

  // Enhanced form validation
  const validateForm = () => {
    const errors = [];
    if (!formData.title.trim()) errors.push("Campaign name is required");
    if (!formData.minQuantity || parseInt(formData.minQuantity) < 1) {
      errors.push("Minimum quantity must be at least 1");
    }

    // Check if trigger items are selected
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

    // Check if reward items are selected
    if (formData.getType === "products" && formData.getProducts.length === 0) {
      errors.push("At least one reward product must be selected");
    }
    if (
      formData.getType === "collections" &&
      formData.getCollections.length === 0
    ) {
      errors.push("At least one reward collection must be selected");
    }

    if (!formData.getQuantity || parseInt(formData.getQuantity) < 1) {
      errors.push("Get quantity must be at least 1");
    }
    if (!formData.startsAt) errors.push("Start date is required");

    if (formData.discountType.includes("percentage") && !formData.percentage) {
      errors.push("Enter a percentage value");
    }
    if (formData.discountType.includes("fixed") && !formData.fixedPrice) {
      errors.push("Enter a fixed price value");
    }

    return errors;
  };

  // Handle form submission
  const handleSubmit = (event) => {
    const errors = validateForm();
    if (errors.length > 0) {
      event.preventDefault();
      alert("Please fix the following errors:\n" + errors.join("\n"));
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
    // Let the form submit naturally to Remix action
  };

  const renderChildren = useCallback(
    (isSelected) =>
      isSelected && (
        <TextField
          type="number"
          value={formData.percentage}
          onChange={(val) => handleChange("percentage", val)}
          autoComplete="off"
          prefix="%"
          min={1}
          max={100}
        />
      ),
    [formData.percentage],
  );

  const renderFixedChildren = (isSelected) =>
    isSelected && (
      <TextField
        type="number"
        value={formData.fixedPrice}
        onChange={(val) => handleChange("fixedPrice", val)}
        autoComplete="off"
        prefix="$"
        min={0}
      />
    );

  return (
    <Page
      title="Create BOGO Offer"
      backAction={{ content: "Settings", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Show success/error messages */}
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
              {/* Hidden input to pass form data */}
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
                  </BlockStack>
                </Card>

                {/* Customer Buys */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" fontWeight="medium">
                      Customer buys
                    </Text>

                    {/* Responsive row */}
                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: "150px" }}>
                        <TextField
                          type="number"
                          label="Minimum quantity of items"
                          value={formData.minQuantity}
                          onChange={(val) => handleChange("minQuantity", val)}
                          autoComplete="off"
                          min="1"
                          required
                        />
                      </div>

                      <div style={{ flex: 1, minWidth: "150px" }}>
                        <Select
                          label="Any items from"
                          options={[
                            { label: "Specific Products", value: "products" },
                            { label: "Collections", value: "collections" },
                          ]}
                          value={formData.triggerType}
                          onChange={(val) => handleChange("triggerType", val)}
                        />
                      </div>

                      <div style={{ alignSelf: "end", minWidth: "120px" }}>
                        <Button
                          onClick={openBuyPicker}
                          variant="secondary"
                          fullWidth
                        >
                          Browse
                        </Button>
                      </div>
                    </InlineStack>

                    {/* Display selected products */}
                    {formData.triggerType === "products" &&
                      formData.selectedProducts.length > 0 && (
                        <Card sectioned>
                          <Text as="h4" variant="headingSm" fontWeight="medium">
                            Trigger Products ({formData.selectedProducts.length}
                            )
                          </Text>
                          <ResourceList
                            resourceName={{
                              singular: "product",
                              plural: "products",
                            }}
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
                                <ResourceList.Item
                                  id={product.id}
                                  media={media}
                                >
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
                                          selectedProducts:
                                            prev.selectedProducts.filter(
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

                    {formData.triggerType === "collections" &&
                      formData.selectedCollections.length > 0 && (
                        <Card sectioned>
                          <Text as="h4" variant="headingSm" fontWeight="medium">
                            Trigger Collections (
                            {formData.selectedCollections.length})
                          </Text>
                          <ResourceList
                            resourceName={{
                              singular: "collection",
                              plural: "collections",
                            }}
                            items={formData.selectedCollections}
                            renderItem={(collection) => {
                              const media = (
                                <Thumbnail
                                  source={
                                    collection.image?.src ||
                                    collection.image?.url ||
                                    ""
                                  }
                                  alt={collection.title}
                                  size="small"
                                />
                              );
                              return (
                                <ResourceList.Item
                                  id={collection.id}
                                  media={media}
                                >
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
                  </BlockStack>
                </Card>

                {/* Customer Gets - Enhanced */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" fontWeight="medium">
                      Customer Gets
                    </Text>

                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: "150px" }}>
                        <TextField
                          type="number"
                          label="Quantity of items"
                          value={formData.getQuantity}
                          onChange={(val) => handleChange("getQuantity", val)}
                          autoComplete="off"
                          min="1"
                          required
                        />
                      </div>

                      <div style={{ flex: 1, minWidth: "150px" }}>
                        <Select
                          label="Any items from"
                          options={[
                            { label: "Specific Products", value: "products" },
                            { label: "Collections", value: "collections" },
                          ]}
                          value={formData.getType}
                          onChange={(val) => handleChange("getType", val)}
                        />
                      </div>

                      <div style={{ alignSelf: "end", minWidth: "120px" }}>
                        <Button
                          onClick={openGetPicker}
                          variant="secondary"
                          fullWidth
                        >
                          Browse
                        </Button>
                      </div>
                    </InlineStack>

                    {/* Display selected reward products */}
                    {formData.getType === "products" &&
                      formData.getProducts.length > 0 && (
                        <Card sectioned>
                          <Text as="h4" variant="headingSm" fontWeight="medium">
                            Reward Products ({formData.getProducts.length})
                          </Text>
                          <ResourceList
                            resourceName={{
                              singular: "product",
                              plural: "products",
                            }}
                            items={formData.getProducts}
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
                                <ResourceList.Item
                                  id={product.id}
                                  media={media}
                                >
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
                                          getProducts: prev.getProducts.filter(
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

                    {/* Display selected reward collections */}
                    {formData.getType === "collections" &&
                      formData.getCollections.length > 0 && (
                        <Card sectioned>
                          <Text as="h4" variant="headingSm" fontWeight="medium">
                            Reward Collections ({formData.getCollections.length}
                            )
                          </Text>
                          <ResourceList
                            resourceName={{
                              singular: "collection",
                              plural: "collections",
                            }}
                            items={formData.getCollections}
                            renderItem={(collection) => {
                              const media = (
                                <Thumbnail
                                  source={
                                    collection.image?.src ||
                                    collection.image?.url ||
                                    ""
                                  }
                                  alt={collection.title}
                                  size="small"
                                />
                              );
                              return (
                                <ResourceList.Item
                                  id={collection.id}
                                  media={media}
                                >
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
                                          getCollections:
                                            prev.getCollections.filter(
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
                  </BlockStack>
                </Card>

                {/* Discount Settings */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Discount settings
                    </Text>
                    <ChoiceList
                      title="Discount Type"
                      choices={[
                        { label: "Free", value: "free" },
                        {
                          label: "Percentage",
                          value: "percentage",
                          renderChildren,
                        },
                        {
                          label: "Fixed Price",
                          value: "fixed",
                          renderChildren: renderFixedChildren,
                        },
                      ]}
                      selected={formData.discountType}
                      onChange={(val) => handleChange("discountType", val)}
                    />

                    <BlockStack>
                      <Text as="h4" variant="headingSm" fontWeight="regular">
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

                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingSm" fontWeight="semibold">
                          Maximum discount uses
                        </Text>
                        <p
                          onClick={() => handleToggle("section1")}
                          style={{ cursor: "pointer" }}
                        >
                          <Icon
                            source={
                              openSections.section1
                                ? CaretUpIcon
                                : CaretDownIcon
                            }
                            tone="base"
                          />
                        </p>
                      </InlineStack>
                      <Collapsible open={openSections.section1}>
                        <ChoiceList
                          allowMultiple
                          title=""
                          choices={[
                            {
                              label: "Limit total number of uses",
                              value: "limit_total",
                              helpText:
                                "Set a maximum number of times this discount can be used",
                            },
                            {
                              label: "Limit to one use per customer",
                              value: "limit_per_customer",
                              helpText:
                                "Allow each customer to use this discount only once",
                            },
                          ]}
                          selected={formData.usageLimits}
                          onChange={(val) => handleChange("usageLimits", val)}
                        />
                      </Collapsible>
                    </BlockStack>
                  </BlockStack>
                </Card>

                {/* Customer Eligibility */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingSm" fontWeight="semibold">
                        Customer eligibility
                      </Text>
                      <p
                        onClick={() => handleToggle("section2")}
                        style={{ cursor: "pointer" }}
                      >
                        <Icon
                          source={
                            openSections.section2 ? CaretUpIcon : CaretDownIcon
                          }
                          tone="base"
                        />
                      </p>
                    </InlineStack>
                    <Collapsible open={openSections.section2}>
                      <ChoiceList
                        title=""
                        choices={[
                          { label: "All customers", value: "all" },
                          { label: "Customer segment", value: "segment" },
                          { label: "Specific link", value: "link" },
                          { label: "Customer location", value: "location" },
                        ]}
                        selected={[formData.customerEligibility]}
                        onChange={(val) =>
                          handleChange("customerEligibility", val[0])
                        }
                      />
                    </Collapsible>
                  </BlockStack>
                </Card>

                {/* Submit Button */}
                <InlineStack align="end">
                  <Button variant="primary" submit loading={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save BOGO Offer"}
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
                {formData.title || "BOGO Campaign Name"}
              </Text>
              <Text as="p" color="subdued">
                Buy {formData.minQuantity || "X"} from{" "}
                {formData.triggerType === "products"
                  ? "selected products"
                  : "collections"}
                , get {formData.getQuantity || "Y"} from{" "}
                {formData.getType === "products"
                  ? "selected products"
                  : "collections"}{" "}
                {formData.discountType.includes("free")
                  ? "free"
                  : formData.discountType.includes("percentage")
                    ? `${formData.percentage}% off`
                    : formData.discountType.includes("fixed")
                      ? `${formData.fixedPrice} off`
                      : ""}
              </Text>

              {/* Show trigger items count */}
              {formData.triggerType === "products" &&
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

              {/* Show reward items count */}
              {formData.getType === "products" &&
                formData.getProducts.length > 0 && (
                  <Text as="p" color="subdued">
                    Rewards: {formData.getProducts.length} product(s)
                  </Text>
                )}
              {formData.getType === "collections" &&
                formData.getCollections.length > 0 && (
                  <Text as="p" color="subdued">
                    Rewards: {formData.getCollections.length} collection(s)
                  </Text>
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

          {/* BOGO Examples Card */}
          <LegacyCard title="BOGO Examples" sectioned>
            <BlockStack gap="300">
              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Collection → Product
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Buy 2 items from "Summer Collection", get 1 "Beach Towel" free
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Product → Collection
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Buy 1 "Premium Shirt", get 50% off any item from "Accessories
                  Collection"
                </Text>
              </div>

              <div>
                <Text as="h5" variant="headingXs" fontWeight="medium">
                  Collection → Collection
                </Text>
                <Text as="p" variant="bodySm" color="subdued">
                  Buy 3 items from "Winter Wear", get 1 item from "Winter
                  Accessories" free
                </Text>
              </div>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
