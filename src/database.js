import mysql from 'mysql2/promise';
import { config } from './config.js';

export function createDatabase(options = config.database) {
  const pool = mysql.createPool(options);
  return {
    pool,
    async query(sql, values = []) {
      const [rows] = await pool.execute(sql, values);
      return rows;
    },
    async transaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
