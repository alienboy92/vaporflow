import { useRecordWindow } from '../utils/use-record-window';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDb, usePlatform } from '../context/DbProvider';
import {
  ProductRepo,
  StockRepo,
  CategoryRepo,
  ShopRepo,
  DeviceRepo,
  generateEAN13,
  validateBarcode,
  formatMoney,
  uuidv7,
  generateCsvTemplate,
  previewCsvImport,
  executeCsvImport,
} from '@vaporflow/core';
import type { Product, Variant, Category, Shop, ImportPreviewRow, ImportResult } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';
import { notifyStockChanged } from '../utils/stock-events';
import { registerBackHandler } from '../utils/back-nav';
import { CameraScanButton, useWedgeMode } from '../components/ScanControls';
import { htmlDocument } from '../utils/print';
import { barcodeSvgString } from '../utils/barcode-svg';

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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** A4 portrait label sheet: 3 columns x 8 rows (24 labels per page). */
const LABEL_CSS = `
@page { size: A4 portrait; margin: 10mm; }
.sheet { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 30mm; gap: 3mm; font-family: Arial, sans-serif; }
.cell { text-align: center; border: 0.2mm solid #999; border-radius: 1mm; padding: 2mm; page-break-inside: avoid; display: flex; flex-direction: column; justify-content: center; gap: 1mm; overflow: hidden; }
.cell .name { font-size: 9pt; font-weight: bold; }
.cell .variant { font-size: 8pt; color: #333; }
.cell .price { font-size: 10pt; font-weight: bold; }
.cell .barcode svg { width: 100%; max-width: 30mm; height: auto; }
`;

export function ProductsScreen() {
  const db = useDb();
  const platform = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
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
  // Current device for sync attribution (NOT the shop's creating device).
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);

  const [wedge] = useWedgeMode();
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

  // Label printing: the product being labelled and its selected variant ids.
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);
  const [labelSelected, setLabelSelected] = useState<string[]>([]);
  // Global label selection across products (prototype table checkboxes).
  const [globalLabelSelected, setGlobalLabelSelected] = useState<string[]>([]);

  // CSV Import Modal State
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvPreviewRows, setCsvPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [csvGlobalErrors, setCsvGlobalErrors] = useState<string[]>([]);
  const [csvPriceStrategy, setCsvPriceStrategy] = useState<'skip' | 'update'>('skip');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState({ current: 0, total: 0 });
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const [csvError, setCsvError] = useState('');
  // Synchronous double-submit guard (same-tick double-click / double-Enter).
  const csvImportingRef = useRef(false);

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

      const device = await new DeviceRepo(db).getActiveDevice(activeShop.id);
      setDeviceId(device?.id ?? null);

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

  // Android back button: close the create/edit and CSV-import dialogs first.
  useEffect(() => {
    if (!modalOpen && !csvModalOpen) return;
    return registerBackHandler(() => {
      if (csvModalOpen) setCsvModalOpen(false);
      else setModalOpen(false);
      return true;
    });
  }, [modalOpen, csvModalOpen]);

  // SaleScreen scan-not-found offer: open the create modal with the scanned
  // barcode prefilled, then clear the navigation state so a refresh or back
  // navigation does not reopen the modal.
  useEffect(() => {
    const state = location.state as { prefillBarcode?: unknown } | null;
    const prefill = typeof state?.prefillBarcode === 'string' ? state.prefillBarcode : '';
    if (!prefill) return;
    handleOpenCreate();
    setFormVariants((prev) =>
      prev.map((variant, index) => (index === 0 ? { ...variant, barcode: prefill } : variant)),
    );
    navigate(location.pathname, { replace: true, state: null });
    // Open once per incoming navigation state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, navigate]);

  function handleOpenLabels(product: Product) {
    const vars = (variantsMap[product.id] || []).filter((v) => v.is_active === 1 && v.barcode);
    setLabelProduct(product);
    setLabelSelected(vars.map((v) => v.id));
  }

  function toggleLabelVariant(variantId: string) {
    setLabelSelected((prev) =>
      prev.includes(variantId) ? prev.filter((id) => id !== variantId) : [...prev, variantId],
    );
  }

  // Builds A4 label sheets (3 columns x 8 rows = 24 labels per page) with the
  // variant name, price and a scannable EAN-13 barcode, then opens the print
  // dialog for exactly that content.
  async function printLabelsFor(
    entries: { product: Product; variant: Variant }[],
    title: string,
  ): Promise<void> {
    if (!shop) return;
    const printable = entries.filter((e) => e.variant.barcode && validateBarcode(e.variant.barcode));
    if (printable.length === 0) return;

    const cells = printable
      .map(
        ({ product, variant }) => `
        <div class="cell">
          <div class="name">${escapeHtml(product.name)}</div>
          <div class="variant">${escapeHtml(variant.name)}</div>
          <div class="price">${escapeHtml(formatMoney(variant.sale_price, shop.currency_decimals, shop.currency_code))}</div>
          <div class="barcode">${barcodeSvgString(variant.barcode!, { moduleWidth: 2, height: 36 })}</div>
        </div>`,
      )
      .join('');
    try {
      setError('');
      await platform.printer.printLabels(
        htmlDocument(`<div class="sheet">${cells}</div>`, LABEL_CSS, title),
      );
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Could not open the print dialog.');
    }
  }

  async function handlePrintLabels() {
    if (!labelProduct) return;
    const entries = (variantsMap[labelProduct.id] || [])
      .filter((v) => labelSelected.includes(v.id))
      .map((variant) => ({ product: labelProduct, variant }));
    await printLabelsFor(entries, `Labels — ${labelProduct.name}`);
  }

  async function handlePrintGlobalLabels() {
    const entries: { product: Product; variant: Variant }[] = [];
    for (const product of products) {
      for (const variant of variantsMap[product.id] || []) {
        if (globalLabelSelected.includes(variant.id)) entries.push({ product, variant });
      }
    }
    await printLabelsFor(entries, 'Labels — Selected products');
  }

  function toggleProductLabels(product: Product, checked: boolean) {
    const printable = (variantsMap[product.id] || [])
      .filter((v) => v.is_active === 1 && v.barcode && validateBarcode(v.barcode))
      .map((v) => v.id);
    setGlobalLabelSelected((prev) => {
      if (checked) return Array.from(new Set([...prev, ...printable]));
      return prev.filter((id) => !printable.includes(id));
    });
  }

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
    if (!deviceId) {
      setError('Device is not registered yet. Open Settings to register this device.');
      return;
    }
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
        device_id: deviceId,
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
    if (!deviceId) {
      setError('Device is not registered yet. Open Settings to register this device.');
      return;
    }
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
        device_id: deviceId,
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
          device_id: deviceId,
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
        deviceId,
        now,
        removedVariantIds,
      );

      notifyStockChanged();
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
      notifyStockChanged();
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

  useEffect(() => {
    const scan = (event: Event) => {
      const index = barcodeInputRefs.current.findIndex(el => el && el === document.activeElement);
      const code: unknown = (event as CustomEvent<unknown>).detail;
      if (index < 0 || typeof code !== 'string') return;
      setFormVariants(prev => prev.map((item, i) => i === index ? { ...item, barcode: code } : item));
      barcodeInputRefs.current[index + 1]?.focus();
    };
    window.addEventListener('vf-barcode', scan);
    return () => window.removeEventListener('vf-barcode', scan);
  }, []);
  const recordWindow = useRecordWindow(filteredProducts);
  if (loading) {
    return (
      <div className="vf-page text-sm text-slate-500" role="status">
        Loading catalog...
      </div>
    );
  }

  const currency = shop?.currency_code ?? 'PKR';
  const decimals = shop?.currency_decimals ?? 0;

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
      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {success}
        </div>
      )}

      {/* Search, filters and actions */}
      <div className="vf-card flex flex-col justify-between gap-3 p-4 md:flex-row md:items-center">
        <div className="flex flex-1 flex-col gap-2.5 sm:flex-row">
          <input
            type="text"
            placeholder="Search product name, SKU, or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="vf-input max-w-md flex-1"
            aria-label="Search products"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="vf-select w-full sm:w-52"
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void handlePrintGlobalLabels()}
            disabled={globalLabelSelected.length === 0}
            className="vf-btn-ghost"
          >
            Print Labels ({globalLabelSelected.length})
          </button>
          <button
            onClick={() => {
              setCsvError('');
              setCsvResult(null);
              setCsvPreviewRows([]);
              setCsvGlobalErrors([]);
              setCsvModalOpen(true);
            }}
            className="vf-btn-ghost"
          >
            Import CSV
          </button>
          <button onClick={handleOpenCreate} className="vf-btn-primary">
            + Add Product
          </button>
        </div>
      </div>

      {/* Product table */}
      <div className="vf-card overflow-hidden">
        <div className="overflow-x-auto" ref={recordWindow.viewport} style={recordWindow.viewportStyle}>
          <div style={recordWindow.padding}>
          <table className="record-list vf-table">
            <thead>
              <tr>
                <th className="w-10">Label</th>
                <th>Product</th>
                <th>Category</th>
                <th>Variants &amp; Barcodes</th>
                <th>Price Range</th>
                <th className="text-right">Total Stock</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No products found.
                  </td>
                </tr>
              ) : (
                recordWindow.visible.map((p, i) => {
                  const vars = variantsMap[p.id] || [];
                  const cat = categories.find((c) => c.id === p.category_id);
                  const prices = vars.map((v) => v.sale_price);
                  const minPrice = prices.length ? Math.min(...prices) : 0;
                  const maxPrice = prices.length ? Math.max(...prices) : 0;
                  const priceStr =
                    minPrice === maxPrice
                      ? formatMoney(minPrice, decimals, currency)
                      : `${formatMoney(minPrice, decimals, currency)} – ${formatMoney(maxPrice, decimals, currency)}`;
                  const totalStock = vars.reduce(
                    (sum, v) => sum + (stockMap[v.id] ?? 0),
                    0,
                  );
                  const printableVars = vars.filter(
                    (v) => v.is_active === 1 && v.barcode && validateBarcode(v.barcode),
                  );
                  const allLabelSelected =
                    printableVars.length > 0 &&
                    printableVars.every((v) => globalLabelSelected.includes(v.id));

                  return (
                    <tr key={p.id} ref={recordWindow.measure} data-index={recordWindow.start + i}>
                      <td data-label="Label">
                        {printableVars.length > 0 ? (
                          <input
                            type="checkbox"
                            checked={allLabelSelected}
                            onChange={(e) => toggleProductLabels(p, e.target.checked)}
                            className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            aria-label={`Select ${p.name} variants for labels`}
                          />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td data-label="Product">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        {p.brand && <div className="text-xs text-slate-500">{p.brand}</div>}
                      </td>
                      <td data-label="Category">
                        <span className="vf-badge-slate">{cat?.name ?? 'Uncategorized'}</span>
                      </td>
                      <td data-label="Variants & Barcodes">
                        <div className="flex flex-wrap gap-1">
                          {vars.map((v) => (
                            <span
                              key={v.id}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                            >
                              <span>{v.name === 'Default' ? 'Single' : v.name}</span>
                              {v.barcode && (
                                <span className="vf-num text-[10px] text-slate-400">
                                  ({v.barcode})
                                </span>
                              )}
                            </span>
                          ))}
                          {vars.length === 0 && <span className="text-xs text-slate-400">No variants</span>}
                        </div>
                      </td>
                      <td data-label="Price Range" className="vf-num whitespace-nowrap font-semibold text-slate-900">
                        {priceStr}
                      </td>
                      <td
                        data-label="Total Stock"
                        className={`vf-num text-right font-bold ${
                          totalStock <= 0 ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {totalStock}
                      </td>
                      <td data-label="Actions" className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {vars.length > 0 && (
                            <button
                              onClick={() => handleOpenLabels(p)}
                              className="vf-btn-ghost min-h-9 px-3 text-xs"
                            >
                              Labels
                            </button>
                          )}
                          <button
                            onClick={() => void handleOpenEdit(p)}
                            className="vf-btn-ghost min-h-9 px-3 text-xs text-emerald-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(p.id)}
                            className="vf-btn-danger min-h-9 px-3 text-xs"
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Label Printing Modal */}
      {labelProduct && (
        <div className="vf-modal">
          <div className="vf-modal-card max-w-lg space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Print Labels — {labelProduct.name}</h2>
              <button
                onClick={() => setLabelProduct(null)}
                className="icon-button text-xl font-bold"
                aria-label="Close labels"
              >
                ✕
              </button>
            </div>
            <p className="vf-sub">
              Select the variants to label. Labels print on A4 sheets, 3 × 8 grid (24 per page), with the
              variant name, price and a scannable EAN-13 barcode.
            </p>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {(variantsMap[labelProduct.id] || [])
                .filter((v) => v.is_active === 1)
                .map((v) => {
                  const printable = Boolean(v.barcode && validateBarcode(v.barcode));
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center gap-3 rounded p-2.5 ${
                        printable ? 'cursor-pointer hover:bg-slate-50' : 'opacity-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!printable}
                        checked={labelSelected.includes(v.id)}
                        onChange={() => toggleLabelVariant(v.id)}
                        className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{v.name}</span>
                        <span className="vf-num block text-xs text-slate-500">
                          {v.barcode ?? 'No barcode'}
                          {!printable && ' — not a valid EAN-13, skipped'}
                        </span>
                      </span>
                      <span className="vf-num text-sm font-semibold text-slate-800">
                        {formatMoney(v.sale_price, decimals, currency)}
                      </span>
                    </label>
                  );
                })}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button
                onClick={() => setLabelProduct(null)}
                className="vf-btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => void handlePrintLabels()}
                disabled={labelSelected.length === 0}
                className="vf-btn-primary"
              >
                Print {labelSelected.length} label{labelSelected.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="vf-modal">
          <div className="vf-modal-card max-w-md space-y-4 p-6">
            <h3 className="text-xl font-bold text-slate-900">Confirm Deactivation</h3>
            <p className="text-slate-600">
              Are you sure you want to deactivate this product and its variants? Historical snapshots will be preserved.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="vf-btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteProduct(deleteConfirmId)}
                className="vf-btn-primary bg-rose-600 border-rose-600 hover:bg-rose-700"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Create / Edit Modal */}
      {modalOpen && (
        <div className="vf-modal overflow-y-auto">
          <div className="vf-modal-card max-w-4xl space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 className="text-xl font-bold text-slate-900">
                {editingProduct ? 'Edit Product' : 'Create Product'}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalOpen(false)}
                  className="icon-button"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="vf-label">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="vf-input"
                    placeholder="e.g. Premium Pod Kit"
                  />
                </div>
                <div>
                  <label className="vf-label">Category</label>
                  <div className="flex gap-2">
                    <select
                      value={formCategoryId}
                      onChange={(e) => setFormCategoryId(e.target.value)}
                      className="vf-select flex-1"
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
                      className="vf-btn-ghost min-h-11 px-3 text-emerald-600"
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
                        className="vf-input flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => void handleInlineCategoryCreate()}
                        className="vf-btn-primary min-h-11 px-3.5 text-sm"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="vf-label">Brand</label>
                  <input
                    type="text"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="vf-input"
                    placeholder="e.g. Smok / Vaporesso"
                  />
                </div>
                <div>
                  <label className="vf-label">Notes</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="vf-input"
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              {/* Variants Section */}
              <div className="space-y-4 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="vf-title">Variants & Pricing</h3>
                  <button
                    type="button"
                    onClick={handleAddVariantRow}
                    className="vf-btn-ghost min-h-10 px-3.5 text-sm"
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
                        className="relative space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">
                            Variant #{index + 1}
                          </span>
                          {formVariants.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveVariantRow(index)}
                              className="min-h-11 px-2 text-sm font-medium text-rose-600 hover:text-rose-800"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div>
                            <label className="vf-label">Variant Name</label>
                            <input
                              type="text"
                              value={vf.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, name: val } : item)),
                                );
                              }}
                              className="vf-input text-sm"
                              placeholder="e.g. 3mg / Red"
                            />
                          </div>
                          <div>
                            <label className="vf-label">SKU (optional)</label>
                            <input
                              type="text"
                              value={vf.sku}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, sku: val } : item)),
                                );
                              }}
                              className="vf-input text-sm"
                              placeholder="e.g. POD-3MG-RED"
                              title="Your own internal code for this variant. Optional — search and scanning work from the name and barcode."
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="vf-label">Barcode (Enter advances focus)</label>
                            <div className="flex gap-2">
                              <input
                                ref={(el) => {
                                  barcodeInputRefs.current[index] = el;
                                }}
                                type="text"
                                inputMode={wedge ? 'none' : 'text'}
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
                                className="vf-input min-w-0 flex-1 text-sm"
                                placeholder={wedge ? 'Wedge: scan with OTG scanner…' : 'Scan or type barcode'}
                              />
                              <CameraScanButton
                                onError={setError}
                                onScan={(code) => {
                                  setFormVariants((prev) =>
                                    prev.map((item, i) => (i === index ? { ...item, barcode: code } : item)),
                                  );
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const gen = generateEAN13();
                                  setFormVariants((prev) =>
                                    prev.map((item, i) => (i === index ? { ...item, barcode: gen } : item)),
                                  );
                                }}
                                className="vf-btn-ghost min-h-10 px-3 text-xs"
                              >
                                Generate
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
                          <div>
                            <label className="vf-label">
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
                              className="vf-input text-sm"
                            />
                          </div>
                          <div>
                            <label className="vf-label">
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
                              className="vf-input text-sm"
                            />
                          </div>
                          <div>
                            <label className="vf-label">
                              Per-unit Profit / Margin
                            </label>
                            <div className="vf-input flex flex-col justify-center font-medium">
                              <span>{formatMoney(profit, decimals, currency)}</span>
                              <span className="text-slate-500">{margin}% margin</span>
                            </div>
                          </div>
                          <div>
                            <label
                              className="vf-label"
                              title="Show a low-stock warning when this variant's stock reaches this number. Leave blank to use the shop default."
                            >
                              Low-stock alert at
                            </label>
                            <input
                              type="number"
                              min="0"
                              placeholder={`Default (${shop?.default_low_stock_threshold ?? 3})`}
                              title="Show a low-stock warning when this variant's stock reaches this number. Leave blank to use the shop default."
                              value={vf.low_stock_threshold}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, low_stock_threshold: val } : item)),
                                );
                              }}
                              className="vf-input text-sm"
                            />
                            <p className="vf-sub mt-1">Blank uses the shop default.</p>
                          </div>
                          <div>
                            {vf.isNew ? (
                              <>
                                <label
                                  className="vf-label"
                                  title="Units you already have on hand. Recorded as an opening stock movement when you save."
                                >
                                  Opening stock
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
                                  className="vf-input text-sm"
                                />
                                <p className="vf-sub mt-1">Units already on hand.</p>
                              </>
                            ) : (
                              <>
                                <label className="vf-label text-slate-400">
                                  Opening stock
                                </label>
                                <div className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-500">
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
                  className="vf-btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="vf-btn-primary"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvModalOpen && (
        <div className="vf-modal overflow-y-auto">
          <div className="vf-modal-card max-w-3xl space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 className="text-xl font-bold text-slate-900">Import Products from CSV</h2>
              <button
                onClick={() => setCsvModalOpen(false)}
                className="icon-button"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                <div>
                  <h3 className="font-semibold text-emerald-900">Need the CSV template?</h3>
                  <p className="text-sm text-emerald-700">Download the formatted template with required headers and example rows.</p>
                </div>
                <button
                  onClick={() => {
                    const template = generateCsvTemplate();
                    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'vaporflow_product_template.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="vf-btn-primary min-h-10 px-3.5 text-sm"
                >
                  Download Template
                </button>
              </div>

              <div>
                <label className="vf-label mb-2">Select CSV File</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file || !shop) return;
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      const text = event.target?.result as string;
                      if (!text) return;
                      const res = await previewCsvImport(db, shop.id, text);
                      setCsvPreviewRows(res.rows);
                      setCsvGlobalErrors(res.globalErrors);
                      setCsvResult(null);
                      setCsvError('');
                    };
                    reader.readAsText(file);
                  }}
                  className="vf-file-input"
                />
              </div>

              {csvGlobalErrors.length > 0 && (
                <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
                  <h4 className="font-semibold">Parse Errors:</h4>
                  {csvGlobalErrors.map((err, i) => (
                    <p key={i} className="text-sm">{err}</p>
                  ))}
                </div>
              )}

              {csvPreviewRows.length > 0 && (
                <div className="space-y-4 border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-800">Preview ({csvPreviewRows.length} rows)</h3>
                      <p className="vf-sub">
                        Valid rows: {csvPreviewRows.filter(r => r.errors.length === 0).length} |
                        Errors: {csvPreviewRows.filter(r => r.errors.length > 0).length} |
                        Existing variants matched: {csvPreviewRows.filter(r => r.matchBy).length}
                      </p>
                    </div>
                    <div>
                      <label className="mr-2 text-sm font-medium text-slate-700">Existing Barcodes Strategy:</label>
                      <select
                        value={csvPriceStrategy}
                        onChange={(e) => setCsvPriceStrategy(e.target.value as 'skip' | 'update')}
                        className="vf-select w-auto min-h-10 py-1.5 text-sm"
                      >
                        <option value="skip">Skip existing</option>
                        <option value="update">Update prices</option>
                      </select>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="p-2">Row</th>
                          <th className="p-2">Product</th>
                          <th className="p-2">Variant</th>
                          <th className="p-2">Barcode</th>
                          <th className="p-2">Price</th>
                          <th className="p-2">Stock</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {csvPreviewRows.map((r) => {
                          const hasErr = r.errors.length > 0;
                          return (
                            <tr key={r.rowNumber} className={hasErr ? 'bg-rose-50' : 'hover:bg-slate-50'}>
                              <td className="p-2 font-mono">{r.rowNumber}</td>
                              <td className="p-2 font-medium">{r.data.product_name || '(empty)'}</td>
                              <td className="p-2">{r.data.variant_name}</td>
                              <td className="p-2 font-mono">{r.data.barcode || '—'}</td>
                              <td className="p-2">{formatMoney(r.data.sale_price, decimals, currency)}</td>
                              <td className="p-2">{r.data.opening_stock}</td>
                              <td className="p-2">
                                {hasErr ? (
                                  <span className="font-semibold text-rose-600" title={r.errors.join(', ')}>
                                    Error ({r.errors.length})
                                  </span>
                                ) : r.matchBy ? (
                                  <span
                                    className="text-amber-600 font-semibold"
                                    title={`Matches an existing variant by ${r.matchBy === 'barcode' ? 'barcode' : 'product/variant name'}; will be ${csvPriceStrategy === 'skip' ? 'skipped' : 'updated'}`}
                                  >
                                    Exists ({r.matchBy === 'barcode' ? 'barcode' : 'name'})
                                  </span>
                                ) : (
                                  <span className="font-semibold text-emerald-600">New</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {csvError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {csvError}
                </div>
              )}

              {csvImporting && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Importing rows…</span>
                    <span className="vf-num">{csvProgress.current} / {csvProgress.total}</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-200">
                    <div
                      className="bg-emerald-600 h-2.5 rounded-full transition-all duration-200"
                      style={{ width: `${(csvProgress.current / (csvProgress.total || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {csvResult && (
                <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                  <h4 className="font-bold">Import Completed Successfully!</h4>
                  <p className="text-sm">Imported new: {csvResult.importedCount}</p>
                  <p className="text-sm">Updated existing: {csvResult.updatedCount}</p>
                  <p className="text-sm">Skipped: {csvResult.skippedCount}</p>
                  {csvResult.errors.length > 0 && (
                    <p className="text-sm text-rose-600">Errors encountered: {csvResult.errors.length}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                onClick={() => setCsvModalOpen(false)}
                className="vf-btn-ghost"
              >
                Close
              </button>
              <button
                disabled={csvPreviewRows.filter(r => r.errors.length === 0).length === 0 || csvImporting}
                onClick={async () => {
                  if (!shop || csvImportingRef.current) return;
                  if (!deviceId) {
                    setCsvError('Device is not registered yet. Open Settings to register this device.');
                    return;
                  }
                  csvImportingRef.current = true;
                  setCsvImporting(true);
                  setCsvResult(null);
                  setCsvError('');
                  try {
                    const res = await executeCsvImport(
                      db,
                      shop.id,
                      deviceId,
                      csvPreviewRows,
                      csvPriceStrategy,
                      (prog) => setCsvProgress(prog),
                    );
                    setCsvResult(res);
                    notifyStockChanged();
                    void loadData();
                  } catch (err) {
                    globalErrorLogger.log(err);
                    // Errors must be visible inside the open modal, not on the
                    // page behind the overlay.
                    setCsvError(err instanceof Error ? err.message : 'CSV Import failed');
                  } finally {
                    csvImportingRef.current = false;
                    setCsvImporting(false);
                  }
                }}
                className="vf-btn-primary"
              >
                {csvImporting ? 'Importing…' : `Import ${csvPreviewRows.filter(r => r.errors.length === 0).length} Valid Rows`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
