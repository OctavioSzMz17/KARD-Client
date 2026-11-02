import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, concatMap, map } from 'rxjs/operators';
import { AuthService, UserSession } from '../../core/services/auth.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ImageService, ProductImage } from '../../core/services/image.service';
import { RecipeService, RecipeItem } from '../../core/services/recipe.service';
import { ProductStore, Product } from '../../core/store/product.store';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { printSheet } from '../pos/print';
import { LabelSheetComponent, LabelItem } from './label-sheet.component';
import { LABEL_MODES, LabelMode, barcodeSvg, labelCode, qrSvg, usesFallbackId } from './labels';

export type { Product };

/** Tamaño de las tarjetas del catálogo: más pequeñas = más productos a la vista. */
export type CardSize = 'l' | 'm' | 's' | 'xs';

const SIZE_KEY = 'kard.products.cardSize';
const SIZES: CardSize[] = ['l', 'm', 's', 'xs'];

/** El tamaño que el negocio eligió la última vez; si no se puede leer, el grande de siempre. */
function savedSize(): CardSize {
  try {
    const v = localStorage.getItem(SIZE_KEY) as CardSize | null;
    return v && SIZES.includes(v) ? v : 'l';
  } catch {
    return 'l';
  }
}   // re-export so existing template references compile

/**
 * Una fila de la edición masiva.
 *
 * Guarda el valor original junto al editable para poder detectar qué cambió
 * de verdad: así se envía una petición por campo tocado en vez de reescribir
 * los 25 productos cada vez que el negocio corrige un precio.
 */
interface BulkRow {
  product_id: string;
  originalName: string;
  originalPrice: number;
  originalUrl: string;
  imageId: string | null;

  name: string;
  price: number;
  url: string;

  status: 'idle' | 'saved' | 'error';
  error?: string;
}

@Component({
  selector: 'app-products',
  imports: [ReactiveFormsModule, FormsModule, LabelSheetComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.scss'
})
export class ProductsComponent implements OnInit {
  private store     = inject(ProductStore);
  private auth      = inject(AuthService);
  private fb        = inject(FormBuilder);
  private snack     = inject(SnackbarService);
  private imgSvc    = inject(ImageService);
  private recipeSvc = inject(RecipeService);
  private sanitizer = inject(DomSanitizer);

  session: UserSession | null = null;

  // ── Products state (from store — survive navigation) ──
  readonly products = this.store.products;
  readonly loading  = this.store.loading;

  // ── Local UI state ────────────────────────────────────
  saving        = signal(false);

  // Tamaño de las tarjetas (se recuerda entre visitas).
  cardSize = signal<CardSize>(savedSize());
  readonly cardSizes: { key: CardSize; label: string; cols: number }[] = [
    { key: 'l',  label: 'Grandes',   cols: 2 },
    { key: 'm',  label: 'Medianas',  cols: 3 },
    { key: 's',  label: 'Pequeñas',  cols: 4 },
    { key: 'xs', label: 'Compactas', cols: 5 },
  ];
  searchQuery   = signal('');

  // ── Etiquetas (QR y código de barras) ────────────────
  // Modo de selección: se marcan productos en el catálogo y se imprimen sus
  // etiquetas juntas; cada uno elige si lleva QR, barras o ambos.
  readonly labelModes = LABEL_MODES;
  selecting   = signal(false);
  selectedIds = signal<ReadonlySet<string>>(new Set());
  labelsOpen  = signal(false);
  /** Qué lleva la etiqueta de cada producto; el que no aparece usa `labelDefault`. */
  private labelChoice = signal<Record<string, LabelMode>>({});
  labelDefault = signal<LabelMode>('both');

  /** Productos seleccionados, en el orden en que se ven en el catálogo. */
  selectedProducts = computed(() => {
    const ids = this.selectedIds();
    return this.filteredProducts().filter(p => ids.has(p.product_id));
  });

  labelItems = computed<LabelItem[]>(() =>
    this.selectedProducts().map(product => ({ product, mode: this.modeOf(product.product_id) })),
  );

  /** Producto abierto en el panel de edición (para imprimir su etiqueta suelta). */
  editingProduct = computed(() => this.products().find(p => p.product_id === this.editingId()) ?? null);

  /** Código y dibujos del producto abierto en el panel de edición, para verlos por separado. */
  drawerLabel = signal<{ code: string; fallback: boolean; qr: SafeHtml; bars: SafeHtml } | null>(null);

  // ── Drawer state ──────────────────────────────────────
  drawerOpen   = signal(false);
  drawerMode   = signal<'add' | 'edit'>('add');
  editingId    = signal<string | null>(null);

  // ── Image state ───────────────────────────────────────
  drawerImages    = signal<ProductImage[]>([]);
  imgAdding       = signal(false);
  newImageUrl     = '';
  newImageAlt     = '';
  // staged image for create mode (product must exist before image can be POSTed)
  stagedImageUrl  = '';
  stagedImageAlt  = '';

  deleteConfirmId = signal<string | null>(null);

  // ── Edición masiva básica ─────────────────────────────
  // Nombre, precio e imagen de todos los productos a la vez. Pensado para
  // cargar un menú o corregir precios en bloque sin abrir 25 veces el drawer.
  bulkOpen   = signal(false);
  bulkRows   = signal<BulkRow[]>([]);
  bulkSaving = signal(false);

  // ── Recipe (ingredientes/insumos) ─────────────────────
  // Edit: se persiste al vuelo contra la API (/products/{id}/recipe).
  // Add:  se stagea local y se hace POST tras crear el producto.
  recipeItems       = signal<RecipeItem[]>([]);
  recipeLoading     = signal(false);   // GET inicial en modo edición
  recipeBusy        = signal(false);   // add/remove en vuelo (modo edición)
  selectedInsumoId  = '';
  selectedInsumoQty = 1;

  // ── Form ──────────────────────────────────────────────
  form = this.fb.group({
    name:                   ['', Validators.required],
    description:            [''],
    price:                  [0, [Validators.required, Validators.min(0.01)]],
    // Códigos opcionales para buscar y escanear en el punto de venta
    sku:                    ['', Validators.pattern(/^[A-Za-z0-9._\/\-]*$/)],
    barcode:                ['', Validators.pattern(/^[A-Za-z0-9._\/\-]*$/)],
    // restaurant
    categoria:              ['plato_fuerte'],
    tiempo_preparacion_min: [15],
    picante:                [false],
    // optician
    esfera:                 ['0.00'],
    cilindro:               ['0.00'],
    eje:                    [0],
    material:               ['CR-39'],
  });

  // ── Computed ──────────────────────────────────────────
  /** Base list: only finished goods (insumos go to Inventory page) */
  private finalProducts = computed(() => this.products().filter(p => p.product_type === 'final'));

  /** Insumos available to attach as ingredients/recipe items */
  availableInsumos = computed(() => this.products().filter(p => p.product_type === 'insumo'));

  filteredProducts = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.finalProducts().filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q)
    );
  });

  counts = computed(() => ({ all: this.finalProducts().length }));

  isRestaurant = computed(() => this.session?.business_type === 'restaurant');
  isOptician   = computed(() => this.session?.business_type === 'optician');

  primaryImage = (images: ProductImage[]) =>
    images.find(i => i.sort_order === 0) ?? images[0] ?? null;

  categorias = ['entrada', 'plato_fuerte', 'postre', 'bebida', 'guarnicion'];
  alergenos  = ['gluten', 'lacteos', 'huevo', 'nueces', 'mariscos', 'soya'];
  selectedAlergenos: string[] = [];

  // ── Lifecycle ─────────────────────────────────────────
  ngOnInit(): void {
    this.session = this.auth.getSession();
    this.store.load();   // no-op if cache is fresh; fetches only when stale/empty
  }

  setCardSize(size: CardSize): void {
    this.cardSize.set(size);
    try { localStorage.setItem(SIZE_KEY, size); } catch { /* sin almacenamiento: solo no se recuerda */ }
  }

  /** Puntos del ícono de cuadrícula: n × n cuadritos que ilustran cuántos caben. */
  gridDots(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }

  // ── Search ────────────────────────────────────────────
  onSearch(e: Event): void { this.searchQuery.set((e.target as HTMLInputElement).value); }

  // ── Drawer open/close ─────────────────────────────────
  openAdd(): void {
    this.drawerMode.set('add');
    this.editingId.set(null);
    this.selectedAlergenos = [];
    this.stagedImageUrl = '';
    this.stagedImageAlt = '';
    this.drawerImages.set([]);
    this.recipeItems.set([]);
    this.recipeLoading.set(false);
    this.selectedInsumoId = '';
    this.selectedInsumoQty = 1;
    this.form.reset({
      price: 0, sku: '', barcode: '',
      categoria: 'plato_fuerte', tiempo_preparacion_min: 15, picante: false,
      esfera: '0.00', cilindro: '0.00', eje: 0, material: 'CR-39'
    });
    this.drawerOpen.set(true);
  }

  openEdit(p: Product): void {
    this.drawerMode.set('edit');
    this.editingId.set(p.product_id);
    this.selectedAlergenos = p.metadata?.['alergenos'] ?? [];
    this.newImageUrl = '';
    this.newImageAlt = '';
    this.drawerImages.set([...(p.images ?? [])].sort((a, b) => a.sort_order - b.sort_order));
    this.recipeItems.set([]);
    this.selectedInsumoId = '';
    this.selectedInsumoQty = 1;
    // La receta vive en el backend; se carga bajo demanda al abrir el drawer.
    this.recipeLoading.set(true);
    this.recipeSvc.get(p.product_id).subscribe({
      next: (recipe) => { this.recipeItems.set(recipe.items); this.recipeLoading.set(false); },
      error: () => { this.recipeItems.set([]); this.recipeLoading.set(false); }
    });
    this.form.patchValue({
      name:                   p.name,
      description:            p.description,
      price:                  parseFloat(p.price),
      sku:                    p.sku ?? '',
      barcode:                p.barcode ?? '',
      categoria:              p.metadata?.['categoria']              ?? 'plato_fuerte',
      tiempo_preparacion_min: p.metadata?.['tiempo_preparacion_min'] ?? 15,
      picante:                p.metadata?.['picante']                ?? false,
      esfera:                 p.metadata?.['esfera']                 ?? '0.00',
      cilindro:               p.metadata?.['cilindro']               ?? '0.00',
      eje:                    p.metadata?.['eje']                    ?? 0,
      material:               p.metadata?.['material']               ?? 'CR-39',
    });
    this.showDrawerLabel(p);
    this.drawerOpen.set(true);
  }

  closeDrawer(): void { this.drawerOpen.set(false); }

  // ── Etiquetas ─────────────────────────────────────────
  private showDrawerLabel(p: Product): void {
    this.drawerLabel.set(null);
    const code = labelCode(p);
    qrSvg(code).then(qr => {
      // Si mientras tanto se abrió otro producto, no se pisa su vista.
      if (this.editingId() !== p.product_id) return;
      this.drawerLabel.set({
        code,
        fallback: usesFallbackId(p),
        qr: this.sanitizer.bypassSecurityTrustHtml(qr),
        bars: this.sanitizer.bypassSecurityTrustHtml(barcodeSvg(code)),
      });
    });
  }

  toggleSelecting(): void {
    this.selecting.update(v => !v);
    if (!this.selecting()) this.selectedIds.set(new Set());
  }

  isSelected(id: string): boolean { return this.selectedIds().has(id); }

  toggleSelect(id: string): void {
    this.selectedIds.update(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  selectAllVisible(): void {
    this.selectedIds.set(new Set(this.filteredProducts().map(p => p.product_id)));
  }

  clearSelection(): void { this.selectedIds.set(new Set()); }

  modeOf(id: string): LabelMode { return this.labelChoice()[id] ?? this.labelDefault(); }

  setLabelMode(id: string, mode: LabelMode): void {
    this.labelChoice.update(c => ({ ...c, [id]: mode }));
  }

  /** Aplica el mismo contenido a todas las etiquetas del lote (y lo deja como predeterminado). */
  setAllLabelModes(mode: LabelMode): void {
    this.labelDefault.set(mode);
    this.labelChoice.set({});
  }

  /** Abre el diálogo de impresión para lo seleccionado, o para un solo producto con un modo dado. */
  openLabels(single?: { product: Product; mode: LabelMode }): void {
    if (single) {
      this.selectedIds.set(new Set([single.product.product_id]));
      this.setLabelMode(single.product.product_id, single.mode);
    }
    if (this.selectedIds().size === 0) return;
    this.labelsOpen.set(true);
  }

  closeLabels(): void {
    this.labelsOpen.set(false);
    // Una impresión suelta (desde el panel de edición) no deja una selección invisible.
    if (!this.selecting()) this.selectedIds.set(new Set());
  }

  printLabels(): void { printSheet('.labels'); }


  // ── Alergenos ─────────────────────────────────────────
  toggleAlergen(a: string): void {
    const i = this.selectedAlergenos.indexOf(a);
    if (i >= 0) this.selectedAlergenos.splice(i, 1);
    else this.selectedAlergenos.push(a);
  }
  isAlergenSelected(a: string): boolean { return this.selectedAlergenos.includes(a); }

  // ── Recipe (ingredientes) ──────────────────────────────
  addIngredient(): void {
    const insumoId = this.selectedInsumoId;
    if (!insumoId || this.recipeBusy()) return;
    const insumo = this.availableInsumos().find(i => i.product_id === insumoId);
    if (!insumo) return;
    // La receta usa cantidades enteras (unidades de stock del insumo por unidad vendida).
    const quantity = Math.max(1, Math.floor(this.selectedInsumoQty || 1));

    const editingId = this.editingId();
    if (editingId) {
      // ── Edit: upsert contra la API, la receta persiste al vuelo ──
      this.recipeBusy.set(true);
      this.recipeSvc.addItem(editingId, insumoId, quantity).subscribe({
        next: (recipe) => {
          this.recipeItems.set(recipe.items);
          this.recipeBusy.set(false);
          this.selectedInsumoId = '';
          this.selectedInsumoQty = 1;
        },
        error: (err: any) => {
          this.recipeBusy.set(false);
          this.snack.error(err.error?.error ?? 'No se pudo agregar el ingrediente.');
        }
      });
    } else {
      // ── Add: staging local (el producto aún no existe) ──
      this.recipeItems.update(items => {
        const existing = items.find(i => i.insumo_id === insumoId);
        if (existing) {
          return items.map(i => i.insumo_id === insumoId ? { ...i, quantity } : i);
        }
        return [...items, { insumo_id: insumoId, insumo_name: insumo.name, quantity, unit: '' }];
      });
      this.selectedInsumoId = '';
      this.selectedInsumoQty = 1;
    }
  }

  removeIngredient(insumoId: string): void {
    if (this.recipeBusy()) return;
    const editingId = this.editingId();
    if (editingId) {
      this.recipeBusy.set(true);
      this.recipeSvc.removeItem(editingId, insumoId).subscribe({
        next: (recipe) => { this.recipeItems.set(recipe.items); this.recipeBusy.set(false); },
        error: (err: any) => {
          this.recipeBusy.set(false);
          this.snack.error(err.error?.error ?? 'No se pudo quitar el ingrediente.');
        }
      });
    } else {
      this.recipeItems.update(items => items.filter(i => i.insumo_id !== insumoId));
    }
  }

  // ── Save product ──────────────────────────────────────
  saveProduct(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);

    const v = this.form.value;
    // La receta ya NO vive en metadata — se gestiona con la API de recetas.
    const metadata = this.isRestaurant()
      ? { categoria: v.categoria, tiempo_preparacion_min: v.tiempo_preparacion_min, picante: v.picante,
          ...(this.selectedAlergenos.length ? { alergenos: this.selectedAlergenos } : {}) }
      : { esfera: v.esfera, cilindro: v.cilindro, eje: v.eje, material: v.material };

    // Finished goods don't track their own stock count — restaurants/opticians
    // can't sensibly say "I have 3 lasagna plates left". Stock tracking applies
    // to insumos only (see Inventory page). Send neutral defaults.
    const body = { product_type: 'final', name: v.name, description: v.description || '',
                   price: v.price, inventory_count: 0, low_stock_threshold: 1, metadata,
                   // Cadena vacía = sin código (en edición, la API la entiende como "quitar").
                   sku: (v.sku ?? '').trim(), barcode: (v.barcode ?? '').trim() };

    const id = this.editingId();

    if (id) {
      // ── Edit ──
      this.store.update(id, body).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDrawer();
          this.snack.success('Producto actualizado.');
        },
        error: (err: any) => {
          this.saving.set(false);
          this.snack.error(err.error?.error ?? 'Error al guardar.');
        }
      });
    } else {
      // ── Create ──
      this.store.create(body).subscribe({
        next: (created) => this.persistStagedThenClose(created.product_id),
        error: (err: any) => {
          this.saving.set(false);
          this.snack.error(err.error?.error ?? 'Error al crear el producto.');
        }
      });
    }
  }

  /**
   * Tras crear un producto: sube la imagen staged y los ingredientes staged.
   * La receta requiere que el producto exista, por eso se hace aquí y no antes.
   */
  private persistStagedThenClose(productId: string): void {
    const tasks = [];

    if (this.stagedImageUrl.trim()) {
      tasks.push(
        this.imgSvc.add(productId, {
          url: this.stagedImageUrl.trim(),
          ...(this.stagedImageAlt.trim() ? { alt_text: this.stagedImageAlt.trim() } : {}),
          sort_order: 0
        }).pipe(catchError(() => { this.snack.warning('Producto creado, pero no se pudo guardar la imagen.'); return of(null); }))
      );
    }

    for (const item of this.recipeItems()) {
      tasks.push(
        this.recipeSvc.addItem(productId, item.insumo_id, item.quantity)
          .pipe(catchError(() => { this.snack.warning(`No se pudo agregar el ingrediente "${item.insumo_name}".`); return of(null); }))
      );
    }

    const finish = () => {
      this.saving.set(false);
      this.closeDrawer();
      this.snack.success('Producto creado exitosamente.');
    };

    if (tasks.length === 0) { finish(); return; }
    forkJoin(tasks).subscribe({ next: finish, error: finish });
  }

  // ── Image management (edit drawer) ────────────────────
  addImage(): void {
    const url = this.newImageUrl.trim();
    if (!url) return;
    const productId = this.editingId();
    if (!productId) return;

    this.imgAdding.set(true);
    const nextOrder = this.drawerImages().length === 0
      ? 0
      : Math.max(...this.drawerImages().map(i => i.sort_order)) + 1;

    this.imgSvc.add(productId, {
      url,
      ...(this.newImageAlt.trim() ? { alt_text: this.newImageAlt.trim() } : {}),
      sort_order: nextOrder
    }).subscribe({
      next: (img) => {
        this.drawerImages.update(imgs => [...imgs, img]);
        this.newImageUrl = '';
        this.newImageAlt = '';
        this.imgAdding.set(false);
        this.snack.success('Imagen agregada.');
        this.refreshProductImages(productId);
      },
      error: (err: any) => {
        this.imgAdding.set(false);
        this.snack.error(err.error?.error ?? 'No se pudo agregar la imagen.');
      }
    });
  }

  removeImage(img: ProductImage): void {
    const productId = this.editingId();
    if (!productId) return;

    this.imgSvc.remove(productId, img.image_id).subscribe({
      next: () => {
        this.drawerImages.update(imgs => imgs.filter(i => i.image_id !== img.image_id));
        this.snack.success('Imagen eliminada.');
        this.refreshProductImages(productId);
      },
      error: () => this.snack.error('No se pudo eliminar la imagen.')
    });
  }

  setPrimary(img: ProductImage): void {
    const productId = this.editingId();
    if (!productId || img.sort_order === 0) return;

    this.imgSvc.update(productId, img.image_id, { sort_order: 0 }).subscribe({
      next: (updated) => {
        this.drawerImages.update(imgs =>
          imgs.map(i => i.image_id === updated.image_id ? updated : i)
              .sort((a, b) => a.sort_order - b.sort_order)
        );
        this.snack.success('Imagen principal actualizada.');
        this.refreshProductImages(productId);
      },
      error: () => this.snack.error('No se pudo actualizar la imagen.')
    });
  }

  private refreshProductImages(productId: string): void {
    this.imgSvc.list(productId).subscribe({
      next: (imgs) =>
        this.store.updateImages(productId, imgs.sort((a, b) => a.sort_order - b.sort_order))
    });
  }

  // ── Delete product ────────────────────────────────────
  // ── Edición masiva ────────────────────────────────────

  openBulk(): void {
    // Se parte de la lista visible: si el negocio filtró por "postre", edita
    // solo esos. Evita abrir una tabla de 80 filas para tocar tres.
    this.bulkRows.set(this.filteredProducts().map(p => {
      const img = this.primaryImage(p.images);
      return {
        product_id:    p.product_id,
        originalName:  p.name,
        originalPrice: Number(p.price),
        originalUrl:   img?.url ?? '',
        imageId:       img?.image_id ?? null,
        name:          p.name,
        price:         Number(p.price),
        url:           img?.url ?? '',
        status:        'idle' as const,
      };
    }));
    this.bulkOpen.set(true);
  }

  closeBulk(): void {
    if (this.bulkSaving()) return;   // no cerrar a media escritura
    this.bulkOpen.set(false);
  }

  /** Una fila está sucia si alguno de sus tres campos difiere del original. */
  isRowDirty(r: BulkRow): boolean {
    return r.name.trim() !== r.originalName
        || Number(r.price) !== r.originalPrice
        || r.url.trim() !== r.originalUrl;
  }

  /** Motivo por el que una fila no se puede guardar, o null si está bien. */
  rowError(r: BulkRow): string | null {
    if (!r.name.trim())        return 'El nombre no puede quedar vacío';
    if (!(Number(r.price) > 0)) return 'El precio debe ser mayor a cero';
    const u = r.url.trim();
    if (u && !/^https?:\/\//i.test(u)) return 'La URL debe empezar con http:// o https://';
    return null;
  }

  bulkDirty  = computed(() => this.bulkRows().filter(r => this.isRowDirty(r)));
  bulkBroken = computed(() => this.bulkDirty().filter(r => this.rowError(r) !== null));

  trackRow = (_: number, r: BulkRow) => r.product_id;

  onBulkField(row: BulkRow, field: 'name' | 'url', e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.bulkRows.update(rows =>
      rows.map(r => r.product_id === row.product_id ? { ...r, [field]: value, status: 'idle' } : r)
    );
  }

  onBulkPrice(row: BulkRow, e: Event): void {
    const value = Number((e.target as HTMLInputElement).value);
    this.bulkRows.update(rows =>
      rows.map(r => r.product_id === row.product_id ? { ...r, price: value, status: 'idle' } : r)
    );
  }

  /**
   * Guarda una fila: primero los datos del producto, después la imagen.
   *
   * Van encadenados y no en paralelo porque son recursos distintos de la API
   * (`/products/{id}` y `/products/{id}/images`), y si el nombre falla no
   * tiene sentido tocar la imagen.
   */
  private saveRow(row: BulkRow): Observable<BulkRow> {
    const body: Record<string, unknown> = {};
    if (row.name.trim() !== row.originalName)   body['name']  = row.name.trim();
    if (Number(row.price) !== row.originalPrice) body['price'] = Number(row.price);

    let chain: Observable<unknown> = Object.keys(body).length
      ? this.store.update(row.product_id, body)
      : of(null);

    const url = row.url.trim();
    if (url !== row.originalUrl) {
      chain = chain.pipe(concatMap(() => {
        if (url && row.imageId)  return this.imgSvc.update(row.product_id, row.imageId, { url });
        if (url)                 return this.imgSvc.add(row.product_id, { url, sort_order: 0 });
        if (row.imageId)         return this.imgSvc.remove(row.product_id, row.imageId);  // URL borrada = quitar imagen
        return of(null);
      }));
    }

    return chain.pipe(
      map(() => ({ ...row, status: 'saved' as const, error: undefined })),
      catchError(err => of({
        ...row,
        status: 'error' as const,
        error: err?.error?.error ?? 'No se pudo guardar',
      })),
    );
  }

  saveBulk(): void {
    const dirty = this.bulkDirty();
    if (!dirty.length || this.bulkBroken().length) return;

    this.bulkSaving.set(true);
    forkJoin(dirty.map(r => this.saveRow(r))).subscribe({
      next: results => {
        const ok    = results.filter(r => r.status === 'saved');
        const fail  = results.filter(r => r.status === 'error');

        // Las filas guardadas pasan a ser el nuevo "original": así dejan de
        // contar como pendientes sin tener que cerrar y reabrir el panel.
        this.bulkRows.update(rows => rows.map(r => {
          const res = results.find(x => x.product_id === r.product_id);
          if (!res) return r;
          return res.status === 'saved'
            ? { ...res, originalName: res.name.trim(), originalPrice: Number(res.price), originalUrl: res.url.trim() }
            : res;
        }));

        this.bulkSaving.set(false);
        // La lista se recarga para traer los image_id nuevos: sin eso, una
        // segunda edición de la misma imagen intentaría crearla otra vez.
        this.store.reload();

        if (fail.length) this.snack.error(`${ok.length} guardados · ${fail.length} con error`);
        else             this.snack.success(`${ok.length} producto(s) actualizados`);
      },
      error: () => {
        this.bulkSaving.set(false);
        this.snack.error('No se pudieron guardar los cambios');
      },
    });
  }

  confirmDelete(id: string): void { this.deleteConfirmId.set(id); }
  cancelDelete(): void            { this.deleteConfirmId.set(null); }

  deleteProduct(id: string): void {
    this.store.remove(id).subscribe({
      next: () => {
        this.deleteConfirmId.set(null);
        this.snack.success('Producto eliminado.');
      },
      error: () => {
        this.deleteConfirmId.set(null);
        this.snack.error('No se pudo eliminar el producto.');
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────
  metaLabel(p: Product): string {
    if (this.isRestaurant()) return p.metadata?.['categoria'] ?? '';
    if (this.isOptician())   return `${p.metadata?.['esfera']} / ${p.metadata?.['cilindro']}`;
    return '';
  }
}
