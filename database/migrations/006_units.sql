CREATE TABLE IF NOT EXISTS units (
  code VARCHAR(8) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO units (code,name) VALUES ('KG','Quilograma'),('UN','Unidade'),('G','Grama'),('L','Litro'),('PCT','Pacote'),('CX','Caixa');
ALTER TABLE products MODIFY unit VARCHAR(8) NOT NULL;
ALTER TABLE products ADD CONSTRAINT products_unit_fk FOREIGN KEY (unit) REFERENCES units(code) ON UPDATE CASCADE ON DELETE RESTRICT;
