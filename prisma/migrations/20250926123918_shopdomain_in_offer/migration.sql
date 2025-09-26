-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerIds" JSONB NOT NULL,
    "minQty" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardValue" REAL,
    "rewardApplyTo" TEXT NOT NULL,
    "rewardIds" JSONB NOT NULL,
    "rewardQty" INTEGER NOT NULL,
    "combinesOrder" BOOLEAN NOT NULL DEFAULT false,
    "combinesProduct" BOOLEAN NOT NULL DEFAULT false,
    "combinesShipping" BOOLEAN NOT NULL DEFAULT false,
    "limitTotalUses" INTEGER,
    "limitPerCustomer" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "functionId" TEXT NOT NULL,
    "discountId" TEXT,
    "config" JSONB,
    "shopifyResp" JSONB,
    "shop" TEXT NOT NULL DEFAULT 'NA',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Offer" ("combinesOrder", "combinesProduct", "combinesShipping", "config", "createdAt", "discountId", "endsAt", "functionId", "id", "limitPerCustomer", "limitTotalUses", "minQty", "rewardApplyTo", "rewardIds", "rewardQty", "rewardType", "rewardValue", "shopifyResp", "startsAt", "status", "title", "triggerIds", "triggerType", "updatedAt") SELECT "combinesOrder", "combinesProduct", "combinesShipping", "config", "createdAt", "discountId", "endsAt", "functionId", "id", "limitPerCustomer", "limitTotalUses", "minQty", "rewardApplyTo", "rewardIds", "rewardQty", "rewardType", "rewardValue", "shopifyResp", "startsAt", "status", "title", "triggerIds", "triggerType", "updatedAt" FROM "Offer";
DROP TABLE "Offer";
ALTER TABLE "new_Offer" RENAME TO "Offer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
