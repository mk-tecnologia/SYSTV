UPDATE screens SET name='Balcão principal'
WHERE id='tv01' AND name IN ('TV 01', 'TV01', 'tv01', 'TV 1')
AND NOT EXISTS (SELECT id FROM (SELECT id,name FROM screens) AS named_screens WHERE name='Balcão principal');
