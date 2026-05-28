import {
  ProductDiscountSelectionStrategy,
} from '../generated/api';

export function cartLinesDiscountsGenerateRun(input) {
  const operations = [];

  // 1. Get the configuration from the metafield
  const metafieldValue = input.discount?.metafield?.value;
  if (!metafieldValue) {
    console.log("No config metafield found");
    return { operations: [] };
  }

  let config;
  try {
    config = JSON.parse(metafieldValue);
  } catch (error) {
    console.log("Failed to parse config metafield");
    return { operations: [] };
  }

  console.log("Config parsed successfully");

  // 2. Filter cart lines that are eligible for the discount
  const eligibleLines = input.cart.lines.filter(line => {
    if (!line.merchandise || !line.merchandise.id) return false;
    const productId = line.merchandise.product.id;
    
    if (config.applyTo === "any") {
      return true;
    }
    
    if (config.applyTo === "products" || config.applyTo === "collections") {
      return config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
    }
    
    return false;
  });

  console.log(`Eligible lines count: ${eligibleLines.length}`);

  const configType = config.configType;

  // 3. Handle Hybrid: BOGO + Discount
  if (configType === "combo_bogo_discount") {
    const buyQty = parseInt(config.buyQty) || 1;
    const getQty = parseInt(config.getQty) || 1;
    const extraDiscountPercent = parseFloat(config.extraDiscountPercent) || 0;
    const bogoSize = buyQty + getQty;

    console.log(`BOGO Discount: buy=${buyQty}, get=${getQty}, extra=${extraDiscountPercent}, bogoSize=${bogoSize}`);

    const allItems = [];
    input.cart.lines.forEach(line => {
      if (!line.merchandise || !line.merchandise.id) return;
      const productId = line.merchandise.product.id;
      const price = parseFloat(line.cost.amountPerQuantity.amount);

      let isEligible = false;
      if (config.applyTo === "any") {
        isEligible = true;
      } else if (config.applyTo === "products" || config.applyTo === "collections") {
        isEligible = config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
      }

      for (let i = 0; i < line.quantity; i++) {
        allItems.push({
          price,
          lineId: line.id,
          productId,
          isEligible,
          uniqueId: `${line.id}_${i}`
        });
      }
    });

    const eligibleItems = allItems.filter(item => item.isEligible);
    const totalCartQuantity = allItems.length;
    const candidates = [];

    // The offer only applies if total cart quantity is >= 3 and there are enough eligible items for BOGO
    if (totalCartQuantity >= 3 && eligibleItems.length >= bogoSize) {
      // Sort eligible items by price descending
      eligibleItems.sort((a, b) => b.price - a.price);

      const bogoPaidItems = eligibleItems.slice(0, buyQty);
      const bogoFreeItems = eligibleItems.slice(-getQty);

      const bogoPaidIds = new Set(bogoPaidItems.map(item => item.uniqueId));
      const bogoFreeIds = new Set(bogoFreeItems.map(item => item.uniqueId));
      const bogoIds = new Set([...bogoPaidIds, ...bogoFreeIds]);

      // All items in the cart except the BOGO pair get the extra discount
      const extraItems = allItems.filter(item => !bogoIds.has(item.uniqueId));

      const bogoLineDiscounts = {};
      const extraLineDiscounts = {};

      // 1. Free BOGO items
      bogoFreeItems.forEach(freeItem => {
        if (!bogoLineDiscounts[freeItem.lineId]) {
          bogoLineDiscounts[freeItem.lineId] = 0;
        }
        bogoLineDiscounts[freeItem.lineId] += freeItem.price;
      });

      // 2. Extra rest of cart items
      extraItems.forEach(extraItem => {
        const extraDiscountAmount = extraItem.price * (extraDiscountPercent / 100);
        if (!extraLineDiscounts[extraItem.lineId]) {
          extraLineDiscounts[extraItem.lineId] = 0;
        }
        extraLineDiscounts[extraItem.lineId] += extraDiscountAmount;
      });

      console.log(`BOGO Free count: ${Object.keys(bogoLineDiscounts).length}, Extra Discount count: ${Object.keys(extraLineDiscounts).length}`);

      // Add BOGO Free candidates
      for (const lineId in bogoLineDiscounts) {
        candidates.push({
          message: config.message || "BOGO Free Item!",
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: bogoLineDiscounts[lineId].toFixed(2) } },
        });
      }

      // Add extra discount candidates
      for (const lineId in extraLineDiscounts) {
        candidates.push({
          message: config.extraMessage || `${extraDiscountPercent}% off rest of cart!`,
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: extraLineDiscounts[lineId].toFixed(2) } },
        });
      }
    }

    console.log(`Generated candidates: ${candidates.length}`);

    if (candidates.length > 0) {
      return {
        operations: [
          {
            productDiscountsAdd: {
              candidates: candidates,
              selectionStrategy: ProductDiscountSelectionStrategy.All,
            },
          },
        ],
      };
    }
  }

  // 4. Handle Hybrid: BOGO + Gift
  if (configType === "combo_bogo_gift") {
    const buyQty = parseInt(config.buyQty) || 2;
    const getQty = parseInt(config.getQty) || 1;
    const bogoSize = buyQty + getQty;
    const giftIds = new Set(config.giftProductIds || config.rewardIds || []);

    console.log(`BOGO Gift: buy=${buyQty}, get=${getQty}, bogoSize=${bogoSize}, gifts=${Array.from(giftIds).join(",")}`);

    const allItems = [];
    input.cart.lines.forEach(line => {
      if (!line.merchandise || !line.merchandise.id) return;
      const productId = line.merchandise.product.id;
      const price = parseFloat(line.cost.amountPerQuantity.amount);

      let isEligible = false;
      if (config.applyTo === "any") {
        isEligible = true;
      } else if (config.applyTo === "products" || config.applyTo === "collections") {
        isEligible = config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
      }

      const isGift = giftIds.has(productId);

      for (let i = 0; i < line.quantity; i++) {
        allItems.push({
          price,
          lineId: line.id,
          productId,
          isEligible,
          isGift,
          uniqueId: `${line.id}_${i}`
        });
      }
    });

    const eligibleItems = allItems.filter(item => item.isEligible && !item.isGift);
    const candidates = [];

    const giftItems = allItems.filter(item => item.isGift);

    // The offer only applies if we have enough eligible items for BOGO and the free gift is present in the cart
    if (eligibleItems.length >= bogoSize && giftItems.length >= 1) {
      // Sort eligible items by price descending
      eligibleItems.sort((a, b) => b.price - a.price);

      const bogoPaidItems = eligibleItems.slice(0, buyQty);
      const bogoFreeItems = eligibleItems.slice(-getQty);

      const bogoFreeIds = new Set(bogoFreeItems.map(item => item.uniqueId));

      const bogoLineDiscounts = {};
      const giftLineDiscounts = {};

      // 1. Free BOGO items
      bogoFreeItems.forEach(freeItem => {
        if (!bogoLineDiscounts[freeItem.lineId]) {
          bogoLineDiscounts[freeItem.lineId] = 0;
        }
        bogoLineDiscounts[freeItem.lineId] += freeItem.price;
      });

      // 2. Free Gift items (exclude BOGO free items if they overlap)
      const bogoGiftItems = giftItems.filter(item => !bogoFreeIds.has(item.uniqueId));
      bogoGiftItems.forEach(giftItem => {
        if (!giftLineDiscounts[giftItem.lineId]) {
          giftLineDiscounts[giftItem.lineId] = 0;
        }
        giftLineDiscounts[giftItem.lineId] += giftItem.price;
      });

      console.log(`BOGO Free count: ${Object.keys(bogoLineDiscounts).length}, Gift count: ${Object.keys(giftLineDiscounts).length}`);

      // Add BOGO Free candidates
      for (const lineId in bogoLineDiscounts) {
        candidates.push({
          message: config.message || "BOGO Free Item!",
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: bogoLineDiscounts[lineId].toFixed(2) } },
        });
      }

      // Add Gift candidates
      for (const lineId in giftLineDiscounts) {
        candidates.push({
          message: config.giftMessage || "Free Mystery Gift!",
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: giftLineDiscounts[lineId].toFixed(2) } },
        });
      }
    }

    console.log(`Generated candidates: ${candidates.length}`);

    if (candidates.length > 0) {
      return {
        operations: [
          {
            productDiscountsAdd: {
              candidates: candidates,
              selectionStrategy: ProductDiscountSelectionStrategy.All,
            },
          },
        ],
      };
    }
  }

  // 5. Handle Hybrid: Bundle + Gift
  if (configType === "combo_bundle_gift") {
    const tiers = config.volumeTiers || [];
    if (tiers.length === 0) return { operations: [] };

    const sortedTiers = [...tiers].sort((a, b) => parseInt(b.minQty) - parseInt(a.minQty));
    const giftIds = new Set(config.giftProductIds || config.rewardIds || []);

    const allItems = [];
    input.cart.lines.forEach(line => {
      if (!line.merchandise || !line.merchandise.id) return;
      const productId = line.merchandise.product.id;
      const price = parseFloat(line.cost.amountPerQuantity.amount);

      let isEligible = false;
      if (config.applyTo === "any") {
        isEligible = true;
      } else if (config.applyTo === "products" || config.applyTo === "collections") {
        isEligible = config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
      }

      const isGift = giftIds.has(productId);

      for (let i = 0; i < line.quantity; i++) {
        allItems.push({
          price,
          lineId: line.id,
          productId,
          isEligible,
          isGift,
          uniqueId: `${line.id}_${i}`
        });
      }
    });

    const eligibleItems = allItems.filter(item => item.isEligible && !item.isGift);
    const giftItems = allItems.filter(item => item.isGift);

    let applicableTier = null;
    for (const tier of sortedTiers) {
      if (eligibleItems.length >= parseInt(tier.minQty)) {
        applicableTier = tier;
        break;
      }
    }

    const candidates = [];

    if (applicableTier && giftItems.length >= 1) {
      const minQty = parseInt(applicableTier.minQty);
      const fixedPrice = parseFloat(applicableTier.fixedPrice);

      eligibleItems.sort((a, b) => b.price - a.price);

      const numBundles = Math.floor(eligibleItems.length / minQty);
      const bundleSize = numBundles * minQty;
      const bundleItems = eligibleItems.slice(0, bundleSize);

      const bundleOriginalPrice = bundleItems.reduce((sum, item) => sum + item.price, 0);
      const bundleTargetPrice = numBundles * fixedPrice;
      const bundleDiscount = bundleOriginalPrice - bundleTargetPrice;

      if (bundleDiscount > 0) {
        let remainingDiscount = bundleDiscount;
        const bundleLineDiscounts = {};

        bundleItems.forEach((item, index) => {
          let itemDiscount = 0;
          if (index === bundleItems.length - 1) {
            itemDiscount = remainingDiscount;
          } else {
            itemDiscount = Math.floor((bundleDiscount / bundleItems.length) * 100) / 100;
            remainingDiscount -= itemDiscount;
          }

          if (!bundleLineDiscounts[item.lineId]) {
            bundleLineDiscounts[item.lineId] = 0;
          }
          bundleLineDiscounts[item.lineId] += itemDiscount;
        });

        for (const lineId in bundleLineDiscounts) {
          candidates.push({
            message: config.message || `Bundle Discount Applied 🎉`,
            targets: [{ cartLine: { id: lineId } }],
            value: { fixedAmount: { amount: bundleLineDiscounts[lineId].toFixed(2) } },
          });
        }
      }

      const giftLineDiscounts = {};

      giftItems.forEach(giftItem => {
        if (!giftLineDiscounts[giftItem.lineId]) {
          giftLineDiscounts[giftItem.lineId] = 0;
        }
        giftLineDiscounts[giftItem.lineId] += giftItem.price;
      });

      for (const lineId in giftLineDiscounts) {
        candidates.push({
          message: config.giftMessage || "Free Gift!",
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: giftLineDiscounts[lineId].toFixed(2) } },
        });
      }
    }

    console.log(`Generated candidates: ${candidates.length}`);

    if (candidates.length > 0) {
      return {
        operations: [
          {
            productDiscountsAdd: {
              candidates: candidates,
              selectionStrategy: ProductDiscountSelectionStrategy.All,
            },
          },
        ],
      };
    }
  }

  // 6. Handle Custom Multi-Tier BOGO
  if (configType === "custom_multi_tier_bogo") {
    const tiers = config.bogoTiers || [];
    if (tiers.length === 0) return { operations: [] };

    const sortedTiers = [...tiers].map(t => ({
      buyQty: parseInt(t.buyQty) || 1,
      getQty: parseInt(t.getQty) || 1,
      totalRequired: (parseInt(t.buyQty) || 1) + (parseInt(t.getQty) || 1)
    })).sort((a, b) => b.totalRequired - a.totalRequired);

    const allItems = [];
    input.cart.lines.forEach(line => {
      if (!line.merchandise || !line.merchandise.id) return;
      const productId = line.merchandise.product.id;
      const price = parseFloat(line.cost.amountPerQuantity.amount);

      let isEligible = false;
      if (config.applyTo === "any") {
        isEligible = true;
      } else if (config.applyTo === "products" || config.applyTo === "collections") {
        isEligible = config.selectedProducts && config.selectedProducts.some(p => p.id === productId);
      }

      for (let i = 0; i < line.quantity; i++) {
        allItems.push({
          price,
          lineId: line.id,
          productId,
          isEligible,
          uniqueId: `${line.id}_${i}`
        });
      }
    });

    const eligibleItems = allItems.filter(item => item.isEligible);
    
    let applicableTier = null;
    let numBundles = 0;

    for (const tier of sortedTiers) {
      if (eligibleItems.length >= tier.totalRequired) {
        applicableTier = tier;
        numBundles = Math.floor(eligibleItems.length / tier.totalRequired);
        break;
      }
    }

    const candidates = [];

    if (applicableTier && numBundles > 0) {
      eligibleItems.sort((a, b) => b.price - a.price);
      
      const totalFreeItemsCount = applicableTier.getQty * numBundles;
      const bogoFreeItems = eligibleItems.slice(-totalFreeItemsCount);
      
      const bogoLineDiscounts = {};
      bogoFreeItems.forEach(freeItem => {
        if (!bogoLineDiscounts[freeItem.lineId]) {
          bogoLineDiscounts[freeItem.lineId] = 0;
        }
        bogoLineDiscounts[freeItem.lineId] += freeItem.price;
      });

      for (const lineId in bogoLineDiscounts) {
        candidates.push({
          message: config.message || "BOGO Free Item!",
          targets: [{ cartLine: { id: lineId } }],
          value: { fixedAmount: { amount: bogoLineDiscounts[lineId].toFixed(2) } },
        });
      }
    }

    if (candidates.length > 0) {
      return {
        operations: [
          {
            productDiscountsAdd: {
              candidates: candidates,
              selectionStrategy: ProductDiscountSelectionStrategy.All,
            },
          },
        ],
      };
    }
  }

  // Fallback to empty operations if not handled
  return { operations: [] };
}