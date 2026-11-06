-- The seed migration spelled Jim's and Jake's last name "Meyers"; it's "Myers".
-- (Applied migrations can't be edited, so fresh databases are corrected here. No-op where already fixed.)
UPDATE "band_member"
SET "name" = regexp_replace("name", 'Meyers', 'Myers', 'g'), "version" = "version" + 1, "updatedAt" = NOW()
WHERE "id" IN ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a02', '6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a04') AND "name" LIKE '%Meyers%';
