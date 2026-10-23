-- Seed data: the band roster (public Members page) and the site settings singleton.
-- Idempotent (ON CONFLICT DO NOTHING) so it never overwrites edits made in the admin area.
-- Instruments and bios are blank on purpose; Admins fill them in.

INSERT INTO "site_settings" ("id", "bookingEmail", "generalEmail", "copyrightEmail", "socialLinks", "updatedAt")
VALUES (1, 'booking@theleftoversband.com', 'hello@theleftoversband.com', 'copyright@theleftoversband.com', '[]', NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "band_member" ("id", "name", "sortOrder", "updatedAt") VALUES
  ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a01', 'Erik Delaney', 1, NOW()),
  ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a02', 'Jim Meyers', 2, NOW()),
  ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a03', 'Brandon Petersen', 3, NOW()),
  ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a04', 'Jake Meyers', 4, NOW()),
  ('6b0f2c1e-4a8d-4d3e-9a51-0c2f7e8d1a05', 'Mike Douglas', 5, NOW())
ON CONFLICT ("id") DO NOTHING;
