import React, { useState, useCallback } from "react";
import {
  Page,
  Card,
  DataTable,
  Badge,
  Tabs,
  Text,
  InlineStack,
  Icon,
  ButtonGroup,
  Button,
  Modal,
} from "@shopify/polaris";
import { EditIcon, DeleteIcon } from "@shopify/polaris-icons";
import { json, redirect, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";

import prisma  from "../db.server"; 
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  // Authenticate the user and get session shop domain
  const { admin, session } = await authenticate.admin(request);

  // Fetch campaigns/offers from DB for the logged-in shop only
  const campaigns = await prisma.offer.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  // Extract all non-null discountId's from the campaigns
  const discountIds = campaigns
    .map((c) => c.discountId)
    .filter((id) => id && typeof id === "string");

  let liveStatuses = {};
  if (discountIds.length > 0) {
    try {
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
                }
                ... on DiscountAutomaticBasic {
                  status
                }
                ... on DiscountAutomaticBxgy {
                  status
                }
                ... on DiscountAutomaticFreeShipping {
                  status
                }
              }
            }
            ... on DiscountCodeNode {
              codeDiscount {
                __typename
                ... on DiscountCodeApp {
                  status
                }
                ... on DiscountCodeBasic {
                  status
                }
                ... on DiscountCodeBxgy {
                  status
                }
                ... on DiscountCodeFreeShipping {
                  status
                }
              }
            }
          }
        }
      `, { variables: { ids: discountIds } });
      
      const resJson = await response.json();
      const nodes = resJson.data?.nodes || [];
      nodes.forEach(node => {
        if (node) {
          const discount = node.automaticDiscount || node.codeDiscount;
          if (discount) {
            liveStatuses[node.id] = discount.status;
          }
        }
      });
    } catch (e) {
      console.error("Failed to fetch live statuses from Shopify:", e);
    }
  }

  console.log('campaigns loaded', campaigns.length, 'liveStatuses', Object.keys(liveStatuses).length);

  return json({ campaigns, liveStatuses });
}

export async function action({ request }) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id");

  if (typeof id !== "string") {
    return json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.offer.delete({ where: { id } });

  return redirect("/app/campaign");
}

function getOfferStatus(offer, liveStatuses = {}) {
  // If we have a live status from Shopify, map it to the friendly UI status
  if (offer.discountId && liveStatuses[offer.discountId]) {
    const liveStatus = liveStatuses[offer.discountId];
    if (liveStatus === "ACTIVE") return "Active";
    if (liveStatus === "SCHEDULED") return "Scheduled";
    if (liveStatus === "EXPIRED") return "Expired";
  }

  // Fallback to local DB and time calculation
  const now = new Date();
  const startsAt = new Date(offer.startsAt);
  const endsAt = offer.endsAt ? new Date(offer.endsAt) : null;

  if (offer.status === "PAUSED") return "Paused";
  if (offer.status === "DRAFT") return "Draft";

  if (endsAt && endsAt < now) {
    return "Expired";
  }
  if (startsAt > now) {
    return "Scheduled";
  }
  return "Active";
}

function isOfferEditable(c) {
  let config = c.config;
  if (config && typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {}
  }
  const configType = config?.configType || c.offerType;
  
  // Only combo offers are editable and fetch current data.
  return (
    configType === "custom_multi_tier_bogo" ||
    (configType && configType.startsWith("combo_"))
  );
}

function getCampaignTypeName(c) {
  let config = c.config;
  if (config && typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {}
  }
  const configType = config?.configType || c.offerType;
  
  const names = {
    combo_bogo_discount: "BOGO + Discount Combo",
    combo_bogo_gift: "BOGO + Gift",
    combo_bundle_gift: "Bundle + Gift",
    custom_multi_tier_bogo: "Multi-Tier BOGO",
    free_gift_order_value: "Free Gift on Order Value",
    free_gift_product: "Free Gift on Product",
    free_gift_mystery: "Mystery Gift",
    free_gift_auto: "Auto-Add Gift",
    free_gift_choice: "Customer Choice Gift",
    free_gift_multi_choice: "Multi-Choice Gift",
    free_gift_time_limited: "Time-Limited Free Gift",
    fixed_bundle: "Fixed Price Bundles",
    tiered_percentage: "Tiered Percentage Discounts",
    mix_match_volume: "Mix & Match Volume",
    cart_wide_volume: "Cart-Wide Volume",
    multi_tier_volume: "Multi-Tier Volume",
    bogo_same: "Basic BOGO (Same Product)",
    bogo_xy_discount: "Buy X Get Y at Discount",
    bogo_cheapest_free: "Buy X Get Cheapest Free",
    bogo_diff_product: "Buy X Get Y (Diff Product)",
    bogo_mix_match: "Mix & Match BOGO",
    bogo_qty_limit: "BOGO with Qty Limits",
    bogo_variant_collection: "BOGO on Variants/Collections",
  };
  
  return names[configType] || configType || "Combo Offer";
}

function getCampaignEditUrl(c) {
  let config = c.config;
  if (config && typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {}
  }
  const configType = config?.configType || c.offerType;

  if (configType === "custom_multi_tier_bogo") {
    return `/app/combo-offer?subtype=custom_multi_tier_bogo&id=${c.id}`;
  }
  if (configType && configType.startsWith("combo_")) {
    return `/app/combo-offer?subtype=${configType}&id=${c.id}`;
  }
  return `/app/combo-offer?subtype=${configType}&id=${c.id}`;
}

export default function CampaignList() {
  const [selectedTab, setSelectedTab] = useState(0);
  const navigate = useNavigate();
  const { campaigns, liveStatuses } = useLoaderData();

  const fetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);

  const handleDeleteClick = (id) => {
    setCampaignToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (campaignToDelete) {
      fetcher.submit({ id: campaignToDelete }, { method: "post" });
      setDeleteModalOpen(false);
      setCampaignToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteModalOpen(false);
    setCampaignToDelete(null);
  };

  const handleTabChange = useCallback(
    (selectedTabIndex) => setSelectedTab(selectedTabIndex),
    []
  );

  const tabs = [
    { id: "all", content: "All", accessibilityLabel: "All campaigns" },
    { id: "active", content: "Active" },
    { id: "scheduled", content: "Scheduled" },
    { id: "expired", content: "Expired" },
  ];

  const filteredCampaigns = campaigns.filter(c => {
    const status = getOfferStatus(c, liveStatuses);
    if (selectedTab === 1) return status === "Active";
    if (selectedTab === 2) return status === "Scheduled";
    if (selectedTab === 3) return status === "Expired";
    return true; // All
  });

  const rows = filteredCampaigns.map((c) => {
    const status = getOfferStatus(c, liveStatuses);
    const badgeTone = status === "Active" ? "success" : status === "Scheduled" ? "attention" : "critical";
    const editable = isOfferEditable(c);
    
    return [
      <Text variant="bodyMd" fontWeight="bold">{c.title}</Text>,
      <Badge tone={badgeTone}>
        {status}
      </Badge>,
      getCampaignTypeName(c),
      <InlineStack gap="100" wrap>
        {c.combinesProduct && <Badge tone="info">Product discounts</Badge>}
        {c.combinesOrder && <Badge tone="info">Order discounts</Badge>}
        {c.combinesShipping && <Badge tone="info">Shipping discounts</Badge>}
        {!c.combinesProduct && !c.combinesOrder && !c.combinesShipping && <Text tone="subdued">None</Text>}
      </InlineStack>,
      <InlineStack gap="100">
        {editable && <Button icon={EditIcon} onClick={() => navigate(getCampaignEditUrl(c))} />}
        <Button icon={DeleteIcon} onClick={() => handleDeleteClick(c.id)} />
      </InlineStack>,
    ];
  });

  return (
    <Page
      title="Campaign list"
      subtitle="Manage your campaigns"
      primaryAction={{
        content: "Create campaign",
        onAction: () => navigate("/app"),
      }}
    >
      <Card>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
          <Card>
            <DataTable
              columnContentTypes={[
                "text", "text", "text",
                //  "numeric",
                  "text",
                // "numeric", "numeric", "numeric", "numeric",
                 "text"
              ]}
              headings={[
                "Campaign name",
                "Status",
                "Campaign type",
                // "Used",
                "Combinations",
                // "Views",
                // "ATCs",
                // "CR",
                // "Revenue",
                "Actions",
              ]}
              rows={rows}
            />
          </Card>
        </Tabs>
      </Card>

      <Modal
        open={deleteModalOpen}
        onClose={handleCancelDelete}
        title="Delete campaign?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleConfirmDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCancelDelete,
          },
        ]}
      >
        <Modal.Section>
          <Text>
            Are you sure you want to delete this campaign? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
