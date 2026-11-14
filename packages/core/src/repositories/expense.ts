/**
 * Expense repository.
 */
import { DbAdapter } from '../db-adapter.js';
import { Expense, ExpenseSchema } from '../types/schemas.js';

export class ExpenseRepo {
  constructor(private db: DbAdapter) {}

  async getAll(shopId: string, startDate?: string, endDate?: string): Promise<Expense[]> {
    let sql = `SELECT * FROM expenses WHERE shop_id = ? AND deleted_at IS NULL`;
    const params: unknown[] = [shopId];

    if (startDate && endDate) {
      sql += ` AND expense_date BETWEEN ? AND ?`;
      params.push(startDate.substring(0, 10), endDate.substring(0, 10));
    }
    sql += ` ORDER BY expense_date DESC, created_at DESC`;

    return this.db.query<Expense>(sql, params);
  }

  async save(expense: Expense): Promise<void> {
    const validated = ExpenseSchema.parse(expense);
    await this.db.query(
      `INSERT INTO expenses (id, shop_id, expense_date, amount, category, note, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)
       ON CONFLICT(id) DO UPDATE SET
         expense_date = excluded.expense_date,
         amount = excluded.amount,
         category = excluded.category,
         note = excluded.note,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         dirty = 1`,
      [
        validated.id,
        validated.shop_id,
        validated.expense_date,
        validated.amount,
        validated.category,
        validated.note,
        validated.created_at,
        validated.updated_at,
        validated.device_id,
      ]
    );
  }

  async softDelete(id: string, updatedAt: string): Promise<void> {
    await this.db.query(
      `UPDATE expenses SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [updatedAt, updatedAt, id]
    );
  }
}
