-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "offerType" TEXT DEFAULT 'bxgy',
    "triggerType" TEXT,
    "triggerIds" JSONB,
    "minQty" INTEGER,
    "minOrderValue" REAL,
    "rewardType" TEXT,
    "rewardValue" REAL,
    "rewardApplyTo" TEXT,
    "rewardIds" JSONB,
    "rewardQty" INTEGER,
    "giftSelectionType" TEXT,
    "maxGiftSelection" INTEGER,
    "isMysteryGift" BOOLEAN DEFAULT false,
    "isTimeLimited" BOOLEAN DEFAULT false,
    "timeLimit" INTEGER,
    "timeLimitUnit" TEXT,
    "combinesOrder" BOOLEAN NOT NULL DEFAULT false,
    "combinesProduct" BOOLEAN NOT NULL DEFAULT false,
    "combinesShipping" BOOLEAN NOT NULL DEFAULT false,
    "limitTotalUses" INTEGER,
    "limitPerCustomer" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "functionId" TEXT,
    "discountId" TEXT,
    "config" JSONB,
    "shopifyResp" JSONB,
    "shop" TEXT NOT NULL DEFAULT 'NA',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Offer" ("combinesOrder", "combinesProduct", "combinesShipping", "config", "createdAt", "discountId", "endsAt", "functionId", "id", "limitPerCustomer", "limitTotalUses", "minQty", "rewardApplyTo", "rewardIds", "rewardQty", "rewardType", "rewardValue", "shop", "shopifyResp", "startsAt", "status", "title", "triggerIds", "triggerType", "updatedAt") SELECT "combinesOrder", "combinesProduct", "combinesShipping", "config", "createdAt", "discountId", "endsAt", "functionId", "id", "limitPerCustomer", "limitTotalUses", "minQty", "rewardApplyTo", "rewardIds", "rewardQty", "rewardType", "rewardValue", "shop", "shopifyResp", "startsAt", "status", "title", "triggerIds", "triggerType", "updatedAt" FROM "Offer";
DROP TABLE "Offer";
ALTER TABLE "new_Offer" RENAME TO "Offer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
