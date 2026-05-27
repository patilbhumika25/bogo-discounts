import {
  ProductDiscountSelectionStrategy,
} from "../generated/api";

export function cartLinesDiscountsGenerateRun(input) {
  // Read config from metafield
  const metafieldValue = input.discount?.metafield?.value;
  if (!metafieldValue) {
    console.log("No config metafield found");
    return { operations: [] };
  }

  let config;
  try {
    config = JSON.parse(metafieldValue);
  } catch (e) {
    console.error("Failed to parse config JSON:", e);
    return { operations: [] };
  }

  console.log("Config:", config);

  // Filter eligible lines
  const eligibleLines = input.cart.lines.filter(line => {
    if (!line.merchandise || !line.merchandise.id) return false;
    
    const productId = line.merchandise.product?.id;
    
    if (config.applyTo === "any") {
      return true;
    }
    
    if (config.applyTo === "products") {
      return config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
    }
    
    return false;
  });

  if (eligibleLines.length === 0) {
    console.log("No eligible lines found");
    return { operations: [] };
  }

  const candidates = [];
  const configType = config.configType || config.pricingType;

  if (configType === "fixed_bundle" || configType === "multi_tier_volume" || configType === "cart_wide_volume" || configType === "mix_match_volume") {
    const tiers = config.volumeTiers;
    if (!tiers || tiers.length === 0) return { operations: [] };

    // Group lines by product ID to count UNIQUE products
    const productLines = {};
    eligibleLines.forEach(line => {
      const productId = line.merchandise.product?.id;
      if (productId) {
        if (!productLines[productId]) {
          productLines[productId] = [];
        }
        productLines[productId].push(line);
      }
    });

    const uniqueProductIds = Object.keys(productLines);
    const uniqueProductsCount = uniqueProductIds.length;
    console.log(`Unique Products Count: ${uniqueProductsCount}`);

    // Sort tiers by minQty descending
    const sortedTiers = [...tiers].sort((a, b) => parseInt(b.minQty) - parseInt(a.minQty));

    let applicableTier = null;
    for (const tier of sortedTiers) {
      if (uniqueProductsCount >= parseInt(tier.minQty)) {
        applicableTier = tier;
        break;
      }
    }

    if (!applicableTier) {
      console.log("No applicable tier found for unique products count:", uniqueProductsCount);
      return { operations: [] };
    }

    const minQty = parseInt(applicableTier.minQty);
    const fixedPrice = parseFloat(applicableTier.fixedPrice);

    // We need to select `minQty` DIFFERENT products to form the bundle!
    const productPrices = uniqueProductIds.map(productId => {
      const lines = productLines[productId];
      const maxPrice = Math.max(...lines.map(line => parseFloat(line.cost.amountPerQuantity.amount)));
      const line = lines.find(l => parseFloat(l.cost.amountPerQuantity.amount) === maxPrice);
      return { productId, price: maxPrice, lineId: line.id };
    });

    // Sort products by price descending
    productPrices.sort((a, b) => b.price - a.price);

    // Take the top `minQty` products for the bundle
    const bundleProducts = productPrices.slice(0, minQty);
    const fullPriceOfBundle = bundleProducts.reduce((sum, p) => sum + p.price, 0);
    
    const totalDiscount = fullPriceOfBundle - fixedPrice;
    console.log(`Bundle products price: ${fullPriceOfBundle}, Target Price: ${fixedPrice}, Discount: ${totalDiscount}`);

    if (totalDiscount > 0) {
      let remainingDiscount = totalDiscount;
      
      for (let i = 0; i < bundleProducts.length; i++) {
        const p = bundleProducts[i];
        let lineDiscount = 0;
        
        if (i === bundleProducts.length - 1) {
          // Last item gets whatever is left over to ensure sum is exact
          lineDiscount = remainingDiscount;
        } else {
          // Equal share floored to 2 decimals
          lineDiscount = Math.floor((totalDiscount / minQty) * 100) / 100;
          remainingDiscount -= lineDiscount;
        }
        
        candidates.push({
          targets: [
            {
              cartLine: {
                id: p.lineId,
              },
            },
          ],
          value: {
            fixedAmount: {
              amount: lineDiscount.toFixed(2),
            },
          },
          message: config.message || config.title || "Volume Discount Applied 🎉",
        });
        console.log(`Line ${p.lineId} gets discount: ${lineDiscount.toFixed(2)}`);
      }
    }
  } else if (configType === "tiered_percentage") {
    const totalQty = eligibleLines.reduce((sum, line) => sum + line.quantity, 0);
    const tiers = config.percentageTiers;
    if (!tiers || tiers.length === 0) return { operations: [] };

    let applicableTier = null;
    for (const tier of tiers) {
      const min = parseInt(tier.minQty);
      const max = tier.maxQty ? parseInt(tier.maxQty) : Infinity;
      if (totalQty >= min && totalQty <= max) {
        applicableTier = tier;
        break;
      }
    }

    if (!applicableTier) return { operations: [] };

    const percentage = parseFloat(applicableTier.percentage);
    
    candidates.push({
      targets: eligibleLines.map(line => ({
        cartLine: {
          id: line.id,
        },
      })),
      value: {
        percentage: {
          value: percentage,
        },
      },
      message: config.message || config.title || "Volume Discount Applied 🎉",
    });
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates: candidates,
        },
      },
    ],
  };
}