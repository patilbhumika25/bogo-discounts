import {
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * Tier Bundle Pricing
 * Buy 2 → ₹999
 * Buy 3 → ₹1499
 * Buy 4 → ₹1999
 */

export function cartLinesDiscountsGenerateRun(input) {
  const cartLines = input.cart.lines;

  // 1️⃣ Calculate total quantity
  let totalQty = 0;

  cartLines.forEach((line) => {
    totalQty += line.quantity;
  });

  // 2️⃣ Decide bundle price
  let bundlePrice = 0;

  if (totalQty >= 4) {
    bundlePrice = 1999;
  } else if (totalQty >= 3) {
    bundlePrice = 1499;
  } else if (totalQty >= 2) {
    bundlePrice = 999;
  } else {
    return { operations: [] };
  }

  // 3️⃣ Calculate cart total
  let cartTotal = 0;

  cartLines.forEach((line) => {
    cartTotal +=
      parseFloat(line.cost.subtotalAmount.amount) *
      line.quantity;
  });

  // 4️⃣ Discount amount
  const discountAmount = cartTotal - bundlePrice;

  if (discountAmount <= 0) {
    return { operations: [] };
  }

  // 5️⃣ Apply discount
  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy:
            ProductDiscountSelectionStrategy.First,

          candidates: [
            {
              targets: cartLines.map((line) => ({
                productVariant: {
                  id: line.merchandise.id,
                },
              })),

              value: {
                fixedAmount: {
                  amount: discountAmount,
                },
              },

              message: "Bundle Offer Applied 🎉",
            },
          ],
        },
      },
    ],
  };
}