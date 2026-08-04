-- Идентификатор модели из общего реестра, выбранный пользователем при создании.
-- Колонка добавляется как nullable, поэтому существующие генерации не теряются.
ALTER TABLE "Generation" ADD COLUMN "modelId" TEXT;

-- Проставляем реестровый идентификатор уже созданным записям по имени модели провайдера.
UPDATE "Generation" SET "modelId" = 'seedance-1-0-pro' WHERE "model" LIKE 'seedance-1-0%';
UPDATE "Generation" SET "modelId" = 'seedance-1-5-pro' WHERE "modelId" IS NULL;
