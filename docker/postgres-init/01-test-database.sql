-- Separate database for integration and end-to-end tests, so tests never touch dev data.
CREATE DATABASE leftovers_test OWNER leftovers;
