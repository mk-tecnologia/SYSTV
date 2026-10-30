CREATE TEMPORARY TABLE systv_product_order AS
SELECT id, ROW_NUMBER() OVER (PARTITION BY screen ORDER BY position,id) - 1 AS new_position
FROM products;

UPDATE products p JOIN systv_product_order o ON o.id=p.id
SET p.position=o.new_position;

DROP TEMPORARY TABLE systv_product_order;

ALTER TABLE products ADD UNIQUE INDEX IF NOT EXISTS products_screen_position_unique (screen,position);
