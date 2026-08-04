-- Режим «ролик по референсам» принимает до четырёх картинок, а не один кадр,
-- поэтому одного firstFrameAssetId для него не хватает.
ALTER TABLE "Generation" ADD COLUMN "referenceAssetIds" TEXT;
