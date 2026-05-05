import { DiscountApplicationStrategy } from "@shopify/shopify_function";

export function cartLinesDiscountsGenerateRun(input) {
  console.error("Function input:", JSON.stringify(input, null, 2));

  // Parse configuration from metafield
  const config = JSON.parse(input.discount?.metafield?.value || "{}");
  console.error("Parsed config:", config);

  const discounts = [];

  // Validate configuration
  if (!config.triggerIds || !Array.isArray(config.triggerIds) || config.triggerIds.length === 0) {
    return {
      discounts: [],
      discountApplicationStrategy: DiscountApplicationStrategy.Maximum,
    };
  }

  // Find cart lines for trigger products
  const triggerLines = input.cart.lines.filter((line) => {
    const productId = line.merchandise.product.id;
    return config.triggerIds.includes(productId);
  });

  if (triggerLines.length === 0) {
    return {
      discounts: [],
      discountApplicationStrategy: DiscountApplicationStrategy.Maximum,
    };
  }

  // Calculate total quantity of trigger products
  const totalTriggerQty = triggerLines.reduce(
    (sum, line) => sum + line.quantity,
    0
  );

  const minQty = parseInt(config.minQty || "0", 10);

  if (totalTriggerQty >= minQty && minQty > 0) {
    const freeItemsCount = Math.floor(totalTriggerQty / minQty) * (config.rewardQty || 1);

    // Sort trigger lines by price (cheapest first for BOGO)
    const sortedTriggerLines = [...triggerLines].sort((a, b) => {
      const priceA = parseFloat(a.cost.amountPerQuantity.amount);
      const priceB = parseFloat(b.cost.amountPerQuantity.amount);
      return priceA - priceB;
    });

    let itemsToDiscount = freeItemsCount;

    for (const line of sortedTriggerLines) {
      if (itemsToDiscount <= 0) break;

      const quantityToDiscount = Math.min(itemsToDiscount, line.quantity);

      discounts.push({
        targets: [
          {
            cartLine: {
              id: line.id,
              quantity: quantityToDiscount,
            },
          },
        ],
        value: {
          percentage: {
            value: "100.0", // Free
          },
        },
        message: `Buy ${minQty} Get ${config.rewardQty || 1} Free`,
      });

      itemsToDiscount -= quantityToDiscount;
    }
  }

  return {
    discounts,
    discountApplicationStrategy: DiscountApplicationStrategy.Maximum,
  };
}
