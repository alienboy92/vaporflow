import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb } from '../context/DbProvider';
import {
  ProductRepo,
  StockRepo,
  CategoryRepo,
  ShopRepo,
  generateEAN13,
  uuidv7,
} from '@vaporflow/core';
import type { Product, Variant, Category, Shop } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';

interface VariantFormState {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  cost_price: string;
  sale_price: string;
  low_stock_threshold: string;
  opening_stock: string;
  /** True for rows created in this editor session; opening stock applies only to these. */
  isNew: boolean;
}

export function ProductsScreen() {
  const db = useDb();
  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [variantsMap, setVariantsMap] = useState<Record<string, Variant[]>>({});
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formVariants, setFormVariants] = useState<VariantFormState[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);

  const barcodeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const loadData = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const productRepo = new ProductRepo(db);
      const stockRepo = new StockRepo(db);
      const categoryRepo = new CategoryRepo(db);

      const activeShop = await shopRepo.getActiveShop();
      if (!activeShop) return;
      setShop(activeShop);

      const cats = await categoryRepo.getAll(activeShop.id);
      setCategories(cats);

      const prods = await productRepo.getProducts(activeShop.id);
      setProducts(prods);

      const allVariants = await productRepo.getVariants(activeShop.id);
      const map: Record<string, Variant[]> = {};
      for (const v of allVariants) {
        if (!map[v.product_id]) map[v.product_id] = [];
        map[v.product_id]!.push(v);
      }
      setVariantsMap(map);

      const onHandList = await stockRepo.getStockOnHand(activeShop.id);
      const stockObj: Record<string, number> = {};
      for (const item of onHandList) {
        stockObj[item.variant_id] = item.on_hand;
      }
      setStockMap(stockObj);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function handleOpenCreate() {
    setEditingProduct(null);
    setFormName('');
    const firstCat = categories[0];
    setFormCategoryId(firstCat ? firstCat.id : '');
    setFormBrand('');
    setFormNotes('');
    setFormVariants([
      {
        id: uuidv7(),
        name: 'Default',
        sku: '',
        barcode: generateEAN13(),
        cost_price: '0',
        sale_price: '0',
        low_stock_threshold: '',
        opening_stock: '0',
        isNew: true,
      },
    ]);
    setRemovedVariantIds([]);
    setError('');
    setSuccess('');
    setModalOpen(true);
  }

  async function handleOpenEdit(product: Product) {
    setEditingProduct(product);
    setFormName(product.name);
    setFormCategoryId(product.category_id ?? '');
    setFormBrand(product.brand ?? '');
    setFormNotes(product.notes ?? '');
    const vars = variantsMap[product.id] || [];
    setFormVariants(
      vars.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku ?? '',
        barcode: v.barcode ?? '',
        cost_price: v.cost_price.toString(),
        sale_price: v.sale_price.toString(),
        low_stock_threshold: v.low_stock_threshold !== null ? v.low_stock_threshold.toString() : '',
        // Existing variants never take opening stock here; stock changes go through Stock In / Adjustment.
        opening_stock: '',
        isNew: false,
      })),
    );
    setRemovedVariantIds([]);
    setError('');
    setSuccess('');
    setModalOpen(true);
  }

  function handleAddVariantRow() {
    setFormVariants((prev) => [
      ...prev,
      {
        id: uuidv7(),
        name: '',
        sku: '',
        barcode: generateEAN13(),
        cost_price: '0',
        sale_price: '0',
        low_stock_threshold: '',
        opening_stock: '0',
        isNew: true,
      },
    ]);
  }

  function handleRemoveVariantRow(index: number) {
    if (formVariants.length <= 1) return;
    const removed = formVariants[index];
    if (removed && !removed.isNew) {
      // Existing variants are soft-deleted in the same save batch.
      setRemovedVariantIds((prev) => [...prev, removed.id]);
    }
    setFormVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleInlineCategoryCreate() {
    if (!newCategoryName.trim() || !shop) return;
    try {
      const categoryRepo = new CategoryRepo(db);
      const newCatId = uuidv7();
      const now = new Date().toISOString();
      await categoryRepo.save({
        id: newCatId,
        shop_id: shop.id,
        name: newCategoryName.trim(),
        sort_order: categories.length + 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: shop.device_id,
        dirty: 1,
        server_updated_at: null,
      });
      setNewCategoryName('');
      setShowNewCatInput(false);
      const cats = await categoryRepo.getAll(shop.id);
      setCategories(cats);
      setFormCategoryId(newCatId);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to create category');
    }
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) return;
    setError('');
    setSuccess('');

    if (!formName.trim()) {
      setError('Product name is required.');
      return;
    }

    try {
      const productRepo = new ProductRepo(db);
      const now = new Date().toISOString();
      const productId = editingProduct ? editingProduct.id : uuidv7();

      const product: Product = {
        id: productId,
        shop_id: shop.id,
        category_id: formCategoryId || null,
        name: formName.trim(),
        brand: formBrand.trim() || null,
        notes: formNotes.trim() || null,
        is_active: 1,
        created_at: editingProduct ? editingProduct.created_at : now,
        updated_at: now,
        deleted_at: null,
        device_id: shop.device_id,
        dirty: 1,
        server_updated_at: null,
      };

      const variants: Variant[] = [];
      const openingStocks: { variantId: string; qty: number; unitCost: number; note?: string }[] = [];

      for (const [index, vf] of formVariants.entries()) {
        const cost = parseInt(vf.cost_price, 10);
        const sale = parseInt(vf.sale_price, 10);
        const threshold = vf.low_stock_threshold ? parseInt(vf.low_stock_threshold, 10) : null;
        const openingQty = vf.isNew ? parseInt(vf.opening_stock, 10) || 0 : 0;

        if (isNaN(cost) || cost < 0 || isNaN(sale) || sale < 0) {
          throw new Error(`Invalid price for variant #${index + 1}. Prices must be non-negative integers.`);
        }

        variants.push({
          id: vf.id,
          shop_id: shop.id,
          product_id: productId,
          name: vf.name.trim() || 'Default',
          sku: vf.sku.trim() || null,
          barcode: vf.barcode.trim() || null,
          cost_price: cost,
          sale_price: sale,
          low_stock_threshold: threshold,
          track_stock: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: shop.device_id,
          dirty: 1,
          server_updated_at: null,
        });

        if (openingQty > 0) {
          openingStocks.push({
            variantId: vf.id,
            qty: openingQty,
            unitCost: cost,
            note: 'Opening stock',
          });
        }
      }

      await productRepo.saveProductWithVariantsAndOpeningStock(
        product,
        variants,
        openingStocks,
        shop.device_id,
        now,
        removedVariantIds,
      );

      setSuccess('Product saved successfully.');
      setRemovedVariantIds([]);
      setModalOpen(false);
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!shop) return;
    try {
      const productRepo = new ProductRepo(db);
      const now = new Date().toISOString();
      await productRepo.softDeleteProduct(productId, now);
      setDeleteConfirmId(null);
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to deactivate product');
    }
  }

  // Filtered products
  const filteredProducts = products.filter((p) => {
    if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    const matchesName = p.name.toLowerCase().includes(s) || (p.brand && p.brand.toLowerCase().includes(s));
    const vars = variantsMap[p.id] || [];
    const matchesVariant = vars.some(
      (v) =>
        v.name.toLowerCase().includes(s) ||
        (v.sku && v.sku.toLowerCase().includes(s)) ||
        (v.barcode && v.barcode.toLowerCase().includes(s)),
    );
    return matchesName || matchesVariant;
  });

  if (loading) {
    return (
      <div className="p-8 text-gray-600" role="status">
        Loading catalog...
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products & Catalog</h1>
          <p className="text-gray-600">Manage products, variants, pricing, and opening stock.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg min-h-11 shadow"
        >
          + Add Product
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="p-4 bg-green-50 text-green-700 rounded-lg border border-green-200">
          {success}
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border flex flex-col md:flex-row gap-4">
        <input
          type="text"
          placeholder="Search by name, SKU, or barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2.5 border rounded-lg min-h-11 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Product Grid / Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b text-gray-700 text-sm">
                <th className="p-4 font-semibold">Product / Brand</th>
                <th className="p-4 font-semibold">Category</th>
                <th className="p-4 font-semibold">Variants</th>
                <th className="p-4 font-semibold">Price Range</th>
                <th className="p-4 font-semibold">Total Stock</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    No products found.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const vars = variantsMap[p.id] || [];
                  const cat = categories.find((c) => c.id === p.category_id);
                  const prices = vars.map((v) => v.sale_price);
                  const minPrice = prices.length ? Math.min(...prices) : 0;
                  const maxPrice = prices.length ? Math.max(...prices) : 0;
                  const priceStr =
                    minPrice === maxPrice
                      ? `PKR ${minPrice}`
                      : `PKR ${minPrice} - PKR ${maxPrice}`;
                  const totalStock = vars.reduce(
                    (sum, v) => sum + (stockMap[v.id] ?? 0),
                    0,
                  );

                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-semibold text-gray-900">{p.name}</div>
                        {p.brand && <div className="text-xs text-gray-500">{p.brand}</div>}
                      </td>
                      <td className="p-4 text-gray-600">{cat?.name ?? 'Uncategorized'}</td>
                      <td className="p-4">
                        <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                          {vars.length} variant{vars.length === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="p-4 font-medium text-gray-800">{priceStr}</td>
                      <td className="p-4 font-semibold text-gray-900">{totalStock}</td>
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => void handleOpenEdit(p)}
                          className="px-3 py-1.5 border rounded text-blue-600 hover:bg-blue-50 min-h-11 font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(p.id)}
                          className="px-3 py-1.5 border rounded text-red-600 hover:bg-red-50 min-h-11 font-medium"
                        >
                          Deactivate
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Confirm Deactivation</h3>
            <p className="text-gray-600">
              Are you sure you want to deactivate this product and its variants? Historical snapshots will be preserved.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteProduct(deleteConfirmId)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg min-h-11 font-medium"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-4xl w-full space-y-6 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingProduct ? 'Edit Product' : 'Create Product'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold px-3 py-1 min-h-11"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Premium Pod Kit"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <div className="flex gap-2">
                    <select
                      value={formCategoryId}
                      onChange={(e) => setFormCategoryId(e.target.value)}
                      className="flex-1 px-4 py-2.5 border rounded-lg min-h-11 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowNewCatInput(!showNewCatInput)}
                      className="px-3 py-2 border rounded-lg bg-gray-50 text-blue-600 font-medium hover:bg-gray-100 min-h-11"
                    >
                      + New
                    </button>
                  </div>
                  {showNewCatInput && (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="text"
                        placeholder="Category name"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-lg min-h-11 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void handleInlineCategoryCreate()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium min-h-11"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                  <input
                    type="text"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Smok / Vaporesso"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg min-h-11 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              {/* Variants Section */}
              <div className="space-y-4 border-t pt-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-800">Variants & Pricing</h3>
                  <button
                    type="button"
                    onClick={handleAddVariantRow}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium min-h-11"
                  >
                    + Add Variant
                  </button>
                </div>

                <div className="space-y-4">
                  {formVariants.map((vf, index) => {
                    const cost = parseInt(vf.cost_price, 10) || 0;
                    const sale = parseInt(vf.sale_price, 10) || 0;
                    const profit = sale - cost;
                    const margin = sale > 0 ? ((profit / sale) * 100).toFixed(1) : '0.0';
                    const isBelowCost = sale < cost;

                    return (
                      <div
                        key={vf.id}
                        className="p-4 bg-gray-50 border rounded-xl space-y-4 relative"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-sm text-gray-700">
                            Variant #{index + 1}
                          </span>
                          {formVariants.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveVariantRow(index)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium min-h-11 px-2"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Variant Name
                            </label>
                            <input
                              type="text"
                              value={vf.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, name: val } : item)),
                                );
                              }}
                              className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                              placeholder="e.g. 3mg / Red"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
                            <input
                              type="text"
                              value={vf.sku}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, sku: val } : item)),
                                );
                              }}
                              className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                              placeholder="SKU code"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Barcode (Enter advances focus)
                            </label>
                            <div className="flex gap-2">
                              <input
                                ref={(el) => {
                                  barcodeInputRefs.current[index] = el;
                                }}
                                type="text"
                                value={vf.barcode}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFormVariants((prev) =>
                                    prev.map((item, i) => (i === index ? { ...item, barcode: val } : item)),
                                  );
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const nextInput = barcodeInputRefs.current[index + 1];
                                    if (nextInput) {
                                      nextInput.focus();
                                    }
                                  }
                                }}
                                className="flex-1 px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                                placeholder="Scan or type barcode"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const gen = generateEAN13();
                                  setFormVariants((prev) =>
                                    prev.map((item, i) => (i === index ? { ...item, barcode: gen } : item)),
                                  );
                                }}
                                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-xs font-medium min-h-11"
                              >
                                Generate
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Purchase price *
                            </label>
                            <input
                              type="number"
                              min="0"
                              required
                              value={vf.cost_price}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, cost_price: val } : item)),
                                );
                              }}
                              className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Selling price *
                            </label>
                            <input
                              type="number"
                              min="0"
                              required
                              value={vf.sale_price}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, sale_price: val } : item)),
                                );
                              }}
                              className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Per-unit Profit / Margin
                            </label>
                            <div className="px-3 py-2 bg-white border rounded-lg text-xs font-medium text-gray-700 flex flex-col justify-center min-h-11">
                              <span>PKR {profit}</span>
                              <span className="text-gray-500">{margin}% margin</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Threshold Override
                            </label>
                            <input
                              type="number"
                              min="0"
                              placeholder="Default"
                              value={vf.low_stock_threshold}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, low_stock_threshold: val } : item)),
                                );
                              }}
                              className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                            />
                          </div>
                          <div>
                            {vf.isNew ? (
                              <>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  Opening Stock
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  value={vf.opening_stock}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFormVariants((prev) =>
                                      prev.map((item, i) => (i === index ? { ...item, opening_stock: val } : item)),
                                    );
                                  }}
                                  className="w-full px-3 py-2 border rounded-lg min-h-11 bg-white text-sm"
                                />
                              </>
                            ) : (
                              <>
                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                  Opening Stock
                                </label>
                                <div className="px-3 py-2 border rounded-lg min-h-11 bg-gray-100 text-xs text-gray-500 flex items-center">
                                  Existing variant — use Stock In / Adjustment to change stock
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {isBelowCost && (
                          <div className="p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200">
                            Warning: Selling price is below purchase price.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg min-h-11 font-medium shadow"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
