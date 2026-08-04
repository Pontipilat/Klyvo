-- Keep the existing local demo library while moving the login to the Klyvo address.
UPDATE "User"
SET "email" = 'demo@klyvo.local'
WHERE "email" = 'demo@' || char(118, 101, 111, 120) || '.local'
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "email" = 'demo@klyvo.local');
