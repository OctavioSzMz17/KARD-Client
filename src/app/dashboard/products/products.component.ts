import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService, UserSession } from '../../core/services/auth.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ImageService, ProductImage } from '../../core/services/image.service';
import { ProductStore, Product } from '../../core/store/product.store';

export type { Product };   // re-export so existing template references compile

type FilterKey = 'all' | 'in-stock' | 'low-stock' | 'out-of-stock';

@Component({
  selector: 'app-products',
  imports: [ReactiveFormsModule, FormsModule],
  templateUrl: './products.component.html',
  styleUrl: './products.component.scss'
})
export class ProductsComponent implements OnInit {
  private store   = inject(ProductStore);
  private auth    = inject(AuthService);
  private fb      = inject(FormBuilder);
  private snack   = inject(SnackbarService);
  private imgSvc  = inject(ImageService);

  session: UserSession | null = null;

  // ── Products state (from store — survive navigation) ──
  readonly products = this.store.products;
  readonly loading  = this.store.loading;

  // ── Local UI state ────────────────────────────────────
  saving        = signal(false);
  searchQuery   = signal('');
  activeFilter  = signal<FilterKey>('all');

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

  // ── Quick actions ─────────────────────────────────────
  quickAction  = signal<{ id: string; type: 'sell' | 'restock'; qty: number } | null>(null);
  quickLoading = signal(false);

  deleteConfirmId = signal<string | null>(null);

  // ── Form ──────────────────────────────────────────────
  form = this.fb.group({
    name:                   ['', Validators.required],
    description:            [''],
    price:                  [0, [Validators.required, Validators.min(0.01)]],
    inventory_count:        [0, [Validators.required, Validators.min(0)]],
    low_stock_threshold:    [5, [Validators.required, Validators.min(1)]],
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
  filteredProducts = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const f = this.activeFilter();
    return this.products().filter(p => {
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
      const matchFilter =
        f === 'all'          ? true :
        f === 'out-of-stock' ? p.inventory_count === 0 :
        f === 'low-stock'    ? p.inventory_count > 0 && p.inventory_count < p.low_stock_threshold :
        p.inventory_count >= p.low_stock_threshold;
      return matchSearch && matchFilter;
    });
  });

  counts = computed(() => {
    const all = this.products();
    return {
      all:        all.length,
      inStock:    all.filter(p => p.inventory_count >= p.low_stock_threshold).length,
      lowStock:   all.filter(p => p.inventory_count > 0 && p.inventory_count < p.low_stock_threshold).length,
      outOfStock: all.filter(p => p.inventory_count === 0).length,
    };
  });

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

  // ── Filters ───────────────────────────────────────────
  setFilter(f: FilterKey): void { this.activeFilter.set(f); }
  onSearch(e: Event): void { this.searchQuery.set((e.target as HTMLInputElement).value); }

  // ── Drawer open/close ─────────────────────────────────
  openAdd(): void {
    this.drawerMode.set('add');
    this.editingId.set(null);
    this.selectedAlergenos = [];
    this.stagedImageUrl = '';
    this.stagedImageAlt = '';
    this.drawerImages.set([]);
    this.form.reset({
      price: 0, inventory_count: 0, low_stock_threshold: 5,
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
    this.form.patchValue({
      name:                   p.name,
      description:            p.description,
      price:                  parseFloat(p.price),
      inventory_count:        p.inventory_count,
      low_stock_threshold:    p.low_stock_threshold,
      categoria:              p.metadata?.['categoria']              ?? 'plato_fuerte',
      tiempo_preparacion_min: p.metadata?.['tiempo_preparacion_min'] ?? 15,
      picante:                p.metadata?.['picante']                ?? false,
      esfera:                 p.metadata?.['esfera']                 ?? '0.00',
      cilindro:               p.metadata?.['cilindro']               ?? '0.00',
      eje:                    p.metadata?.['eje']                    ?? 0,
      material:               p.metadata?.['material']               ?? 'CR-39',
    });
    this.drawerOpen.set(true);
  }

  closeDrawer(): void { this.drawerOpen.set(false); }

  // ── Alergenos ─────────────────────────────────────────
  toggleAlergen(a: string): void {
    const i = this.selectedAlergenos.indexOf(a);
    if (i >= 0) this.selectedAlergenos.splice(i, 1);
    else this.selectedAlergenos.push(a);
  }
  isAlergenSelected(a: string): boolean { return this.selectedAlergenos.includes(a); }

  // ── Save product ──────────────────────────────────────
  saveProduct(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);

    const v = this.form.value;
    const metadata = this.isRestaurant()
      ? { categoria: v.categoria, tiempo_preparacion_min: v.tiempo_preparacion_min, picante: v.picante,
          ...(this.selectedAlergenos.length ? { alergenos: this.selectedAlergenos } : {}) }
      : { esfera: v.esfera, cilindro: v.cilindro, eje: v.eje, material: v.material };

    const body = { product_type: 'final', name: v.name, description: v.description || '',
                   price: v.price, inventory_count: v.inventory_count,
                   low_stock_threshold: v.low_stock_threshold, metadata };

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
        next: (created) => {
          if (this.stagedImageUrl.trim()) {
            this.imgSvc.add(created.product_id, {
              url: this.stagedImageUrl.trim(),
              ...(this.stagedImageAlt.trim() ? { alt_text: this.stagedImageAlt.trim() } : {}),
              sort_order: 0
            }).subscribe({ error: () => this.snack.warning('Producto creado, pero no se pudo guardar la imagen.') });
          }
          this.saving.set(false);
          this.closeDrawer();
          this.snack.success('Producto creado exitosamente.');
        },
        error: (err: any) => {
          this.saving.set(false);
          this.snack.error(err.error?.error ?? 'Error al crear el producto.');
        }
      });
    }
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

  // ── Quick sell / restock ──────────────────────────────
  startQuick(id: string, type: 'sell' | 'restock'): void {
    this.quickAction.set({ id, type, qty: 1 });
  }
  cancelQuick(): void { this.quickAction.set(null); }

  adjustQty(delta: number): void {
    const q = this.quickAction();
    if (!q) return;
    this.quickAction.set({ ...q, qty: Math.max(1, q.qty + delta) });
  }

  confirmQuick(): void {
    const q = this.quickAction();
    if (!q) return;
    this.quickLoading.set(true);
    const label = q.type === 'sell' ? 'Venta' : 'Reabastecimiento';

    const op$ = q.type === 'sell'
      ? this.store.sell(q.id, q.qty)
      : this.store.restock(q.id, q.qty);

    op$.subscribe({
      next: () => {
        this.quickAction.set(null);
        this.quickLoading.set(false);
        this.snack.success(`${label} registrado.`);
      },
      error: (err: any) => {
        this.quickAction.set(null);
        this.quickLoading.set(false);
        this.snack.error(err.error?.error ?? `Error al registrar ${label.toLowerCase()}.`);
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────
  stockPercent(p: Product): number {
    if (p.low_stock_threshold === 0) return 100;
    return Math.min(100, (p.inventory_count / (p.low_stock_threshold * 3)) * 100);
  }

  stockStatus(p: Product): 'ok' | 'low' | 'out' {
    if (p.inventory_count === 0) return 'out';
    if (p.inventory_count < p.low_stock_threshold) return 'low';
    return 'ok';
  }

  metaLabel(p: Product): string {
    if (this.isRestaurant()) return p.metadata?.['categoria'] ?? '';
    if (this.isOptician())   return `${p.metadata?.['esfera']} / ${p.metadata?.['cilindro']}`;
    return '';
  }
}
