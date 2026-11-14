/**
 * Expense repository.
 */
import { DbAdapter } from '../db-adapter.js';
import { Expense } from '../types/schemas.js';

export class ExpenseRepo {
  constructor(private db: DbAdapter) {}

  getAll(shopId: string, startDate?: string, endDate?: string): Expense[] {
    let sql = `SELECT * FROM expenses WHERE shop_id = ? AND deleted_at IS NULL`;
    const params: unknown[] = [shopId];

    if (startDate && endDate) {
      sql += ` AND expense_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }
    sql += ` ORDER BY expense_date DESC, created_at DESC`;

    return this.db.query<Expense>(sql, params);
  }

  save(expense: Expense): void {
    this.db.query(
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
        expense.id,
        expense.shop_id,
        expense.expense_date,
        expense.amount,
        expense.category,
        expense.note,
        expense.created_at,
        expense.updated_at,
        expense.device_id,
      ]
    );
  }

  softDelete(id: string, updatedAt: string): void {
    this.db.query(
      `UPDATE expenses SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [updatedAt, updatedAt, id]
    );
  }
}
