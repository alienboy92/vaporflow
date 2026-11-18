import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import { ShopRepo, ExpenseRepo, DeviceRepo, uuidv7, formatMoney, localDate } from '@vaporflow/core';
import type { Shop, Expense } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';

const CATEGORIES = [
  'Rent',
  'Utilities',
  'Supplies',
  'Salaries',
  'Maintenance',
  'Marketing',
  'Miscellaneous',
];

export function ExpensesScreen() {
  const db = useDb();
  const [shop, setShop] = useState<Shop | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal form state for add/edit
  const formRef = useRef<HTMLFormElement>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseDate, setExpenseDate] = useState(localDate(new Date()));
  const [amountInput, setAmountInput] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  // Synchronous double-submit guard (same-tick double-click / double-Enter).
  const submittingRef = useRef(false);

  const loadExpenses = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);

      // Sync attribution needs THIS device, not the shop's creating device.
      const device = await new DeviceRepo(db).getActiveDevice(activeShop.id);
      setDeviceId(device?.id ?? null);

      const expenseRepo = new ExpenseRepo(db);
      const list = await expenseRepo.getAll(activeShop.id);
      setExpenses(list);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  function resetForm() {
    setEditingExpenseId(null);
    setExpenseDate(localDate(new Date()));
    setAmountInput('');
    setCategory(CATEGORIES[0]!);
    setNote('');
  }

  function openEditModal(exp: Expense) {
    setEditingExpenseId(exp.id);
    setExpenseDate(exp.expense_date);
    setAmountInput(String(exp.amount));
    setCategory(exp.category);
    setNote(exp.note || '');
    formRef.current?.scrollIntoView({ block: 'start' });
    formRef.current?.querySelector('input')?.focus();
  }

  async function handleSaveExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!shop || submittingRef.current) return;

    const amount = parseInt(amountInput || '0', 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Expense amount must be a positive integer');
      return;
    }
    if (!expenseDate) {
      setError('Expense date is required');
      return;
    }
    if (!deviceId) {
      setError('Device is not registered yet. Open Settings to register this device.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      const expenseRepo = new ExpenseRepo(db);
      const nowIso = new Date().toISOString();
      const id = editingExpenseId || uuidv7();

      const expense: Expense = {
        id,
        shop_id: shop.id,
        expense_date: expenseDate,
        amount,
        category,
        note: note.trim() ? note.trim() : null,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      };

      await expenseRepo.save(expense);
      resetForm();
      await loadExpenses();
    } catch (err: unknown) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleDeleteExpense(id: string) {
    if (!window.confirm('Are you sure you want to delete this expense?')) return;
    try {
      const expenseRepo = new ExpenseRepo(db);
      const nowIso = new Date().toISOString();
      await expenseRepo.softDelete(id, nowIso);
      if (editingExpenseId === id) resetForm();
      await loadExpenses();
    } catch (err) {
      globalErrorLogger.log(err);
      window.alert('Failed to delete expense.');
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading expenses...</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      <section className="bg-white p-4 rounded-2xl border shadow-sm">
        <h2 className="font-bold mb-3">
          {editingExpenseId ? 'Edit Expense' : 'Record New Expense'}
        </h2>
        <form ref={formRef} onSubmit={handleSaveExpense} className="expense-form">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Amount ({currency})
            </label>
            <input
              type="number"
              min="1"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="e.g. 5000"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note / Reference</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional details or vendor name..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="col-span-full flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2.5 border rounded-xl hover:bg-gray-100 font-medium text-sm text-gray-700 min-h-11"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white font-bold py-2.5 px-6 rounded-xl text-sm shadow transition-colors min-h-11"
            >
              {submitting ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </form>
      </section>
      {/* Summary Card */}
      <div className="bg-white p-6 rounded-xl border shadow-sm flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-500">Total Recorded Expenses</h3>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {formatMoney(totalExpenses, 0, currency)}
          </p>
        </div>
        <div className="bg-emerald-50 text-emerald-700 font-semibold px-4 py-2 rounded-lg text-sm">
          {expenses.length} record(s)
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="record-list w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <th className="p-4">Date</th>
                <th className="p-4">Category</th>
                <th className="p-4">Note / Description</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-400">
                    No expenses recorded yet.
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-gray-50 transition-colors">
                    <td data-label="Date" className="p-4 font-medium text-gray-900">
                      {exp.expense_date}
                    </td>
                    <td data-label="Category" className="p-4">
                      <span className="bg-gray-100 text-gray-800 text-xs px-2.5 py-1 rounded-full font-medium">
                        {exp.category}
                      </span>
                    </td>
                    <td data-label="Note / Description" className="p-4 text-gray-600">
                      {exp.note || '—'}
                    </td>
                    <td data-label="Amount" className="p-4 text-right font-bold text-red-600">
                      -{formatMoney(exp.amount, 0, currency)}
                    </td>
                    <td data-label="Actions" className="p-4 text-right space-x-2">
                      <button
                        onClick={() => openEditModal(exp)}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded-lg text-xs font-medium min-h-11 inline-flex items-center"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDeleteExpense(exp.id)}
                        className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-medium min-h-11 inline-flex items-center"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
