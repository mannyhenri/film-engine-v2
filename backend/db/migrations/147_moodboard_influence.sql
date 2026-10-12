-- Extend the existing board; existing uploads and notes retain their order.
ALTER TABLE film_mood_board ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE film_mood_board ADD COLUMN influence_roles TEXT NOT NULL DEFAULT '["style"]';
ALTER TABLE film_mood_board ADD COLUMN influence_note TEXT NOT NULL DEFAULT '';
UPDATE film_mood_board SET influence_roles = CASE kind
 WHEN 'palette' THEN '["colors"]' WHEN 'lighting' THEN '["lighting"]'
 WHEN 'framing' THEN '["framing"]' WHEN 'texture' THEN '["texture"]'
 ELSE '["style"]' END;
