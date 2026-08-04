-- Preserve existing local generations while expanding Klyvo's video capabilities.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL DEFAULT 1,
    "batchSize" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "originalPrompt" TEXT NOT NULL,
    "enhancedPrompt" TEXT,
    "detectedLanguage" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "timingMode" TEXT NOT NULL DEFAULT 'DURATION',
    "duration" INTEGER NOT NULL,
    "frames" INTEGER,
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "generateAudio" BOOLEAN NOT NULL DEFAULT true,
    "firstFrameAssetId" TEXT,
    "lastFrameAssetId" TEXT,
    "style" TEXT NOT NULL,
    "cameraMotion" TEXT NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "reservedCredits" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'seedance-1-5-pro-251215',
    "providerTaskId" TEXT,
    "forceFailure" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Generation" (
    "id", "batchId", "batchIndex", "batchSize", "userId", "mode", "status",
    "originalPrompt", "enhancedPrompt", "detectedLanguage", "aspectRatio", "timingMode",
    "duration", "resolution", "generateAudio", "style", "cameraMotion", "creditCost",
    "reservedCredits", "provider", "model", "providerTaskId", "forceFailure", "errorCode",
    "errorMessage", "createdAt", "startedAt", "completedAt"
)
SELECT
    "id", "id", 1, 1, "userId", "mode", "status", "originalPrompt", "enhancedPrompt",
    "detectedLanguage", "aspectRatio", 'DURATION', "duration",
    CASE WHEN "quality" = 'HIGH' THEN '1080p' ELSE '720p' END,
    true, "style", "cameraMotion", "creditCost", "reservedCredits", "provider",
    CASE WHEN "provider" = 'mock' THEN 'mock' ELSE 'seedance-1-5-pro-251215' END,
    "providerTaskId", "forceFailure", "errorCode", "errorMessage", "createdAt", "startedAt", "completedAt"
FROM "Generation";

DROP TABLE "Generation";
ALTER TABLE "new_Generation" RENAME TO "Generation";
CREATE INDEX "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt");
CREATE INDEX "Generation_batchId_idx" ON "Generation"("batchId");
CREATE INDEX "Generation_status_idx" ON "Generation"("status");

CREATE TABLE "new_Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "videoStorageKey" TEXT,
    "thumbnailStorageKey" TEXT,
    "duration" REAL NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Video_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Video_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Video" (
    "createdAt", "deletedAt", "duration", "fileSize", "generationId", "height", "id",
    "thumbnailUrl", "userId", "videoUrl", "visibility", "width"
)
SELECT
    "createdAt", "deletedAt", "duration", "fileSize", "generationId", "height", "id",
    "thumbnailUrl", "userId", "videoUrl", "visibility", "width"
FROM "Video";

DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
CREATE UNIQUE INDEX "Video_generationId_key" ON "Video"("generationId");
CREATE INDEX "Video_userId_createdAt_idx" ON "Video"("userId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
