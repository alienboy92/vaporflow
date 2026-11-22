import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import { ShopRepo, ExpenseRepo, DeviceRepo, uuidv7, formatMoney, localDate } from '@vaporflow/core';
import type { Shop, Expense } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { useToast } from '../components/Toast';

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
  const toast = useToast();
  const [shop, setShop] = useState<Shop | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state for add/edit
  const formRef = useRef<HTMLFormElement>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseDate, setExpenseDate] = useState(localDate(new Date()));
  const [amountInput, setAmountInput] = useState('');
  const [category, setCategory] = useState('');
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
    setCategory('');
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
    if (!category.trim()) {
      setError('Expense category is required');
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
        category: category.trim(),
        note: note.trim() ? note.trim() : null,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      };

      await expenseRepo.save(expense);
      toast.show(editingExpenseId ? 'Expense updated' : 'Expense added');
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
      toast.show('Expense deleted');
      await loadExpenses();
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to delete expense.');
    }
  }

  if (loading) {
    return <div className="vf-page text-sm text-slate-500">Loading expenses…</div>;
  }

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const categorySuggestions = Array.from(
    new Set([...CATEGORIES, ...expenses.map((exp) => exp.category)]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="vf-page">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Add / edit expense form */}
        <section className="vf-card-pad h-fit lg:col-span-4">
          <h2 className="mb-3 text-base font-bold text-slate-900">
            {editingExpenseId ? 'Edit Expense' : 'Record New Expense'}
          </h2>
          <form ref={formRef} onSubmit={handleSaveExpense} className="space-y-3.5">
            <div>
              <label className="vf-label" htmlFor="expense-date">
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="vf-input"
                required
              />
            </div>

            <div>
              <label className="vf-label" htmlFor="expense-category">
                Category
              </label>
              <input
                id="expense-category"
                type="text"
                list="expense-category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Rent, Electricity, Tea, Packaging"
                className="vf-input"
                required
              />
              <datalist id="expense-category-options">
                {categorySuggestions.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="vf-label" htmlFor="expense-amount">
                Amount ({currency})
              </label>
              <input
                id="expense-amount"
                type="number"
                min="1"
                step="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Enter amount"
                className="vf-input vf-num"
                required
              />
            </div>

            <div>
              <label className="vf-label" htmlFor="expense-note">
                Note (optional)
              </label>
              <input
                id="expense-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Details or vendor name…"
                className="vf-input"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={resetForm}
                className="vf-btn-ghost flex-1"
                disabled={submitting}
              >
                Reset
              </button>
              <button type="submit" disabled={submitting} className="vf-btn-primary flex-[2]">
                {submitting ? 'Saving…' : editingExpenseId ? 'Update Expense' : '+ Add Expense'}
              </button>
            </div>
          </form>
        </section>

        {/* Expenses list */}
        <section className="vf-card overflow-hidden lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
            <div>
              <h2 className="font-bold text-slate-900">Recorded Shop Expenses</h2>
              <p className="vf-sub">{expenses.length} record(s)</p>
            </div>
            <span className="vf-num text-sm font-bold text-rose-600">
              Total: {formatMoney(totalExpenses, decimals, currency)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="record-list vf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Note</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      No expenses recorded yet.
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp) => (
                    <tr key={exp.id}>
                      <td data-label="Date" className="vf-num text-xs text-slate-600">
                        {exp.expense_date}
                      </td>
                      <td data-label="Category">
                        <span className="vf-badge-slate">{exp.category}</span>
                      </td>
                      <td data-label="Note" className="text-slate-600">
                        {exp.note || '—'}
                      </td>
                      <td
                        data-label="Amount"
                        className="vf-num text-right font-bold text-rose-600"
                      >
                        -{formatMoney(exp.amount, decimals, currency)}
                      </td>
                      <td data-label="Actions" className="space-x-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(exp)}
                          className="vf-btn-ghost min-h-10 px-3 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteExpense(exp.id)}
                          className="vf-btn-danger min-h-10 px-3 text-xs"
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
        </section>
      </div>
    </div>
  );
}
