import { useNavigate } from "@remix-run/react";
import {
    Page,
    Grid,
    Card,
    BlockStack,
    Text,
    Button,
    InlineStack,
    Badge,
    Divider,
    Box,
    Tabs,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
    await authenticate.admin(request);
    return null;
}

// ============================================================================
// OFFER DEFINITIONS — All 24 Offer Types
// ============================================================================

const bogoOffers = [
    {
        id: "bogo_same",
        title: "Basic BOGO (Same Product)",
        description: "Buy 1 Get 1 Free — classic same-product deal",
        badge: "Popular",
        badgeTone: "success",
        icon: "🎁",
    },
    {
        id: "bogo_xy_discount",
        title: "Buy X, Get Y at a Discount",
        description: "Buy 1, get 2nd at 50% off — or any custom %",
        badge: null,
        icon: "💰",
    },
    {
        id: "bogo_cheapest_free",
        title: "Buy Any X, Get Cheapest Free",
        description: "Works with mixed products — cheapest item is free",
        badge: "Popular",
        badgeTone: "success",
        icon: "🏷️",
    },
    {
        id: "bogo_diff_product",
        title: "Buy X, Get Y (Different Product)",
        description: "Buy a laptop, get a mouse free — link any different products together",
        badge: null,
        icon: "🔗",
    },
    {
        id: "bogo_multi_tier",
        title: "Multi-Tier BOGO",
        description: "Buy 2 get 1 free, Buy 4 get 2 free — tiered rewards",
        badge: null,
        icon: "📊",
    },
    {
        id: "bogo_mix_match",
        title: "Mix & Match BOGO",
        description: "Any 3 from Collection A, get 1 free from Collection B",
        badge: null,
        icon: "🎯",
    },
    {
        id: "bogo_qty_limit",
        title: "BOGO with Quantity Limits",
        description: "Buy up to 3 shirts, get 1 free — capped rewards",
        badge: null,
        icon: "🔒",
    },
    {
        id: "bogo_variant_collection",
        title: "BOGO on Variants / Collections",
        description: "Limited to certain colors, sizes, or product groups",
        badge: null,
        icon: "📦",
    },
];

const freeGiftOffers = [
    {
        id: "free_gift_order_value",
        title: "Free Gift on Order Value",
        description: "Spend ₹2,500+, get a gift — encourage larger orders",
        badge: "Popular",
        badgeTone: "success",
        icon: "🎁",
    },
    {
        id: "free_gift_product",
        title: "Free Gift on Product Purchase",
        description: "Buy a shampoo, get a conditioner free — incentivize specific product sales",
        badge: null,
        icon: "🧴",
    },

    {
        id: "free_gift_mystery",
        title: "Mystery Gift",
        description: "Gift hidden until checkout — surprise & delight",
        badge: null,
        icon: "🎲",
    },
    {
        id: "free_gift_auto",
        title: "Auto-Add Gift",
        description: "Gift automatically added to cart when conditions met",
        badge: "Popular",
        badgeTone: "success",
        icon: "⚡",
    },
    {
        id: "free_gift_choice",
        title: "Free Gift (Customer Choice)",
        description: "Threshold-based — customer picks 1 gift from options",
        badge: null,
        icon: "🎯",
    },
    {
        id: "free_gift_multi_choice",
        title: "Free Gift (Multi-Choice)",
        description: "Customer picks any 2 out of 4 gifts — more options",
        badge: null,
        icon: "🎪",
    },
    {
        id: "free_gift_time_limited",
        title: "Time-Limited Free Gift",
        description: "Flash sale gifting with countdown timer — create urgency and boost sales",
        badge: "Limited",
        badgeTone: "warning",
        icon: "⏰",
    },
];

const volumeOffers = [
    {
        id: "fixed_bundle",
        title: "Fixed Price Bundles",
        description: "Buy 2 for ₹999, Buy 3 for ₹1,000 — exact pricing",
        badge: "Popular",
        badgeTone: "success",
        icon: "📈",
    },
    {
        id: "tiered_percentage",
        title: "Tiered Percentage Discounts",
        description: "Buy 2–3 items → 10% off, Buy 4–5 → 20% off",
        badge: null,
        icon: "📉",
    },
    {
        id: "mix_match_volume",
        title: "Mix & Match Volume Pricing",
        description: "Any 3 snacks for ₹500 total — flexible bundles",
        badge: null,
        icon: "🎯",
    },
    {
        id: "cart_wide_volume",
        title: "Cart-Wide Volume Pricing",
        description: "Bundle pricing applied to entire cart total — discount applied wide across the cart",
        badge: null,
        icon: "🛒",
    },
    {
        id: "multi_tier_volume",
        title: "Multi-Tier Volume Pricing",
        description: "Buy 2 at ₹999, Buy 4 at ₹1,899 — stacked tiers",
        badge: null,
        icon: "📊",
    },
];

const comboOffers = [
    {
        id: "combo_bogo_discount",
        title: "BOGO + Discount Combo",
        description: "Buy 1 get 1 free + 10% off rest of cart — stack different discount types",
        badge: "New",
        badgeTone: "info",
        icon: "🔥",
    },
    {
        id: "combo_bogo_gift",
        title: "BOGO + Gift",
        description: "Buy 2, get 1 free + free mystery gift — reward shoppers with freebies",
        badge: "New",
        badgeTone: "info",
        icon: "🎁",
    },
    {
        id: "combo_bundle_gift",
        title: "Bundle + Gift",
        description: "Buy 3 products for ₹1,499 + free gift — package items with a free reward",
        badge: "New",
        badgeTone: "info",
        icon: "📦",
    },
];

// ============================================================================
// LINK MAPPING — which page each offer type goes to
// ============================================================================

function getOfferLink(offerId) {
    if (offerId === "bogo_multi_tier") return `combo-offer?subtype=custom_multi_tier_bogo`;
    if (offerId.startsWith("bogo_")) return `buy-x-get-y?subtype=${offerId}`;
    if (offerId.startsWith("free_gift_")) return `free-gift?subtype=${offerId}`;
    if (offerId.startsWith("combo_")) return `combo-offer?subtype=${offerId}`;
    // Volume types
    return `volume-pricing/new?subtype=${offerId}`;
}

// ============================================================================
// COMPONENTS
// ============================================================================

function OfferCard({ offer, navigate }) {
    return (
        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 4, xl: 4 }}>
            <Card>
                <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="headingLg">
                            {offer.icon}
                        </Text>
                        {offer.badge && (
                            <Badge tone={offer.badgeTone || "info"}>{offer.badge}</Badge>
                        )}
                    </InlineStack>

                    <Text as="h3" variant="headingMd" fontWeight="bold">
                        {offer.title}
                    </Text>

                    <div style={{ minHeight: "40px" }}>
                        <Text as="p" variant="bodyMd" tone="subdued">
                            {offer.description}
                        </Text>
                    </div>

                    <InlineStack align="end">
                        <Button
                            variant="primary"
                            onClick={() => navigate(`/app/${getOfferLink(offer.id)}`)}
                        >
                            Create Offer
                        </Button>
                    </InlineStack>
                </BlockStack>
            </Card>
        </Grid.Cell>
    );
}

function OfferSection({ title, offers, navigate }) {
    return (
        <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
                {title}
            </Text>
            <Grid>
                {offers.map((offer) => (
                    <OfferCard key={offer.id} offer={offer} navigate={navigate} />
                ))}
            </Grid>
        </BlockStack>
    );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function OffersPage() {
    const navigate = useNavigate();
    const [selectedTab, setSelectedTab] = useState(0);

    const tabs = [
        { id: "all", content: `All Offers (${bogoOffers.length + freeGiftOffers.length + volumeOffers.length + comboOffers.length})` },
        { id: "bogo", content: `BOGO (${bogoOffers.length})` },
        { id: "gifts", content: `Free Gifts (${freeGiftOffers.length})` },
        { id: "volume", content: `Volume Pricing (${volumeOffers.length})` },
        { id: "combo", content: `Combos (${comboOffers.length})` },
    ];

    const handleTabChange = useCallback((index) => setSelectedTab(index), []);

    return (
        <Page
            title="Create Offer"
            subtitle="Choose a discount type to create a new offer for your store"
            backAction={{ content: "Home", url: "/app" }}
        >
            <BlockStack gap="600">
                <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} />

                {(selectedTab === 0 || selectedTab === 1) && (
                    <OfferSection
                        title="🛍️ A. BOGO (Buy X, Get Y) Offers"
                        offers={bogoOffers}
                        navigate={navigate}
                    />
                )}

                {(selectedTab === 0 || selectedTab === 1) && selectedTab === 0 && (
                    <Divider />
                )}

                {(selectedTab === 0 || selectedTab === 2) && (
                    <OfferSection
                        title="🎁 B. Free Gift Offers"
                        offers={freeGiftOffers}
                        navigate={navigate}
                    />
                )}

                {(selectedTab === 0 || selectedTab === 2) && selectedTab === 0 && (
                    <Divider />
                )}

                {(selectedTab === 0 || selectedTab === 3) && (
                    <OfferSection
                        title="📈 C. Volume / Quantity Pricing"
                        offers={volumeOffers}
                        navigate={navigate}
                    />
                )}

                {(selectedTab === 0 || selectedTab === 3) && selectedTab === 0 && (
                    <Divider />
                )}

                {(selectedTab === 0 || selectedTab === 4) && (
                    <OfferSection
                        title="🔥 D. Combo / Hybrid Offers"
                        offers={comboOffers}
                        navigate={navigate}
                    />
                )}
            </BlockStack>
        </Page>
    );
}
