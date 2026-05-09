-- Add display_path for browser-compatible versions of non-web formats (HEIC/HEIF → JPEG)
ALTER TABLE assets ADD COLUMN display_path TEXT;
